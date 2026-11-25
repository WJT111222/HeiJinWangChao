import { z } from 'zod';
import { readPromptResource } from '../../prompts/loader';
import { AiClient } from './client';
import type { AiConfig } from './configuration';
import type { CredentialVault } from './credentials';
import { AiError } from './errors';
import { channelSnapshot, resolveModelRoute } from './snapshot';

export type CreationCompletionInput = { person: Readonly<{ name: string; age: string; gender: string }> } & (
  | { kind: 'appearance'; appearance: string }
  | { kind: 'personality'; personality: string }
  | { kind: 'background'; background: string; profession: string; personality: string }
  | { kind: 'profession'; profession: string; professionDescription: string; professionSkills: string; professionLongTermImpact: string }
  /** 自定义开局城市的地域介绍；城市身份已由本地行政区划目录确认，模型只写介绍。 */
  | { kind: 'city'; cityName: string; cityRegion: string; cityIntro: string }
);

const nonempty = z.string().trim().min(1);
const professionResult = z.strictObject({
  professionDescription: nonempty,
  professionSkills: z.array(nonempty.refine(skill => !/[\r\n\u2028\u2029]/u.test(skill))).min(1),
  professionLongTermImpact: nonempty,
});

const defaultBudget = { appearance: 2048, personality: 2048, profession: 4096, background: 4096, city: 2048 };
function outputBudget(kind: CreationCompletionInput['kind'], fields: Record<string, string>) {
  const briefs = Object.entries(fields).filter(([key]) => (kind !== 'background' || key === 'background') && (kind !== 'city' || key === 'cityIntro'));
  let characters = 0, skills = 0;
  for (const [, text] of briefs) {
    for (const match of text.matchAll(/(\d{1,6})\s*(?:个\s*)?(?:汉字|字)(?![\p{N}])/gu))
      characters += Number(match[1]);
    if (kind === 'profession') {
      for (const match of text.matchAll(/(?:技能\s*(?:数量|共|为|[:：])?\s*(\d{1,5})\s*项|(\d{1,5})\s*项\s*(?:职业)?技能)/gu))
        skills = Math.max(skills, Number(match[1] ?? match[2]));
    }
  }
  // Budget units allow for CJK tokenization, JSON overhead and provider reasoning.
  // The existing channel limit remains the upper bound if one was set.
  return Math.min(1_000_000, Math.max(defaultBudget[kind], characters * 4 + skills * 96 + 768));
}

function parseProfession(text: string) {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new AiError('invalid_output'); }
  const checked = professionResult.safeParse(value);
  if (!checked.success) throw new AiError('invalid_output');
  return checked.data;
}

export async function completeCreation(
  input: CreationCompletionInput,
  config: AiConfig,
  vault: CredentialVault,
  options: { signal: AbortSignal; timeoutSeconds?: number },
  client = new AiClient(),
) {
  const { kind, person, ...fields } = input;
  if (input.kind === 'profession' && !input.profession.trim()) throw new AiError('configuration');
  if (input.kind === 'city' && !input.cityName.trim()) throw new AiError('configuration');
  const { channel, model } = resolveModelRoute(config, 'story');
  const budget = outputBudget(kind, fields);
  const snapshot = channelSnapshot({
    ...channel,
    parameters: { ...channel.parameters, maxOutputTokens: Math.min(channel.parameters.maxOutputTokens ?? budget, budget) },
  }, vault, model, 'story');
  const secrets = config.channels.map(route => vault.get(route.id)).filter(Boolean).flatMap(secret => {
    const textForms = [secret, JSON.stringify(secret).slice(1, -1)];
    try { return [...textForms, encodeURIComponent(secret)]; }
    catch { return textForms; }
  });
  const containsCredential = (text: string) => secrets.some(secret => text.includes(secret));
  if ([...Object.values(person), ...Object.values(fields)].some(containsCredential)) throw new AiError('credentials');

  const prompt = await readPromptResource(`creation.${kind}`);
  if (options.signal.aborted) throw new AiError('cancelled');
  const response = await client.generate(snapshot, [
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify(kind === 'city' ? fields : { person, ...fields }) },
  ], { ...options, stream: false, recordInspection: false });
  const text = response.text.trim();
  if (!text || containsCredential(text)) throw new AiError('invalid_output');
  if (kind === 'profession') {
    const fields = parseProfession(text);
    if (containsCredential(fields.professionDescription) || containsCredential(fields.professionLongTermImpact)
      || fields.professionSkills.some(containsCredential))
      throw new AiError('invalid_output');
    return { kind, fields };
  }
  if (text.startsWith('```') || text.startsWith('{') || text.startsWith('[')) throw new AiError('invalid_output');
  return { kind, text };
}
