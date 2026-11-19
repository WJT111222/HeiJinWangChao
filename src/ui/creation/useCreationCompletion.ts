import { useLayoutEffect, useRef, useState } from 'react';
import { completeCreation } from '../../services/ai/creationCompletion';
import type { CreationCompletionInput } from '../../services/ai/creationCompletion';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { AiError } from '../../services/ai/errors';
import { professionName } from './model';
import type { Creation } from './model';

type Field = CreationCompletionInput['kind'];
type Attempt = { controller: AbortController; basis: string };
type Status = { pending: true } | { error: string };
const steps: Record<Field, number> = { appearance: 1, personality: 1, profession: 2, background: 3 };

function inputFor(field: Field, form: Creation): CreationCompletionInput | undefined {
  if (steps[field] !== form.step) return;
  const { name, age, gender, appearance, personality } = form.person;
  const person = { name, age, gender };
  switch (field) {
    case 'appearance': return { kind: field, person, appearance };
    case 'personality': return { kind: field, person, personality };
    case 'background': return { kind: field, person, background: form.background, profession: professionName(form), personality };
    case 'profession':
      if (form.profession === 'custom' && form.customProfession.trim()) return {
        kind: field,
        person,
        profession: form.customProfession,
        professionDescription: form.professionDescription ?? '',
        professionSkills: form.skills,
        professionLongTermImpact: form.professionLongTermImpact ?? '',
      };
  }
}

function basisFor(form: Creation, input: CreationCompletionInput | undefined) {
  const template = input?.kind === 'appearance' ? form.appearanceTemplate
    : input?.kind === 'personality' ? form.personalityTemplate : undefined;
  return JSON.stringify([form.saveId, form.step, template, input]);
}

function failureMessage(error: unknown) {
  if (error instanceof AiError) {
    if (error.code === 'configuration' || error.code === 'credentials')
      return '请检查正文模型设置和凭证。';
    if (error.code === 'timeout') return '生成超时，请重试。';
    if (error.code === 'output_limit') return '生成未完成，请检查正文渠道的输出上限。';
    if (['invalid_output', 'invalid_json', 'empty'].includes(error.code)) return '返回内容格式不正确，请重试。';
    if (error.code === 'authorization') return '正文模型授权失败，请检查凭证。';
  }
  return 'AI 补全失败，请重试。';
}

export function useCreationCompletion(
  form: Creation, saveForm: (next: Creation) => void, busy: boolean, timeoutSeconds?: number,
) {
  const latest = useRef(form), attempts = useRef(new Map<Field, Attempt>());
  const [statuses, setStatuses] = useState<Partial<Record<Field, Status>>>({});

  function invalidate(next: Creation, stop = false) {
    const reset = next.saveId !== latest.current.saveId || next.step !== latest.current.step;
    latest.current = next;
    const invalidated: Field[] = [];
    for (const [field, attempt] of attempts.current) {
      if (stop || attempt.basis !== basisFor(next, inputFor(field, next))) {
        attempt.controller.abort();
        attempts.current.delete(field);
        invalidated.push(field);
      }
    }
    if (reset || invalidated.length) setStatuses(current => {
      if (reset) return {};
      const next = { ...current };
      for (const field of invalidated) delete next[field];
      return next;
    });
  }

  useLayoutEffect(() => { invalidate(form, busy); });
  useLayoutEffect(() => {
    const active = attempts.current;
    return () => {
      for (const { controller } of active.values()) controller.abort();
      active.clear();
    };
  }, []);

  function changeForm(next: Creation) {
    // Capture user writes synchronously, including edits that return to the old value before React renders.
    invalidate(next);
    saveForm(next);
  }

  async function generate(field: Field) {
    const input = inputFor(field, latest.current);
    if (!input || busy || attempts.current.has(field)) return;
    const controller = new AbortController();
    const attempt = { controller, basis: basisFor(latest.current, input) };
    attempts.current.set(field, attempt);
    setStatuses(current => ({ ...current, [field]: { pending: true } }));
    const isCurrent = () => attempts.current.get(field) === attempt && !controller.signal.aborted;
    let status: Status | undefined;
    try {
      const result = await completeCreation(input, readAiConfig(localStorage), new CredentialVault(sessionStorage, localStorage), {
        signal: controller.signal, timeoutSeconds,
      });
      const current = latest.current;
      if (!isCurrent() || attempt.basis !== basisFor(current, inputFor(field, current))) return;
      attempts.current.delete(field);
      if (result.kind === 'profession') changeForm({
        ...current,
        professionDescription: result.fields.professionDescription,
        skills: result.fields.professionSkills.join('\n'),
        skillsSource: 'manual',
        professionLongTermImpact: result.fields.professionLongTermImpact,
      });
      else if (result.kind === 'background') changeForm({ ...current, background: result.text });
      else changeForm({ ...current, person: { ...current.person, [result.kind]: result.text } });
    } catch (error) {
      if (isCurrent()) status = { error: failureMessage(error) };
    } finally {
      if (isCurrent()) attempts.current.delete(field);
      if (!controller.signal.aborted) setStatuses(current => ({ ...current, [field]: status }));
    }
  }

  return { changeForm, generate, statuses };
}
