import { fingerprint } from '../domain/commands';
import { requireData } from '../domain/common';
import { ChatReply } from '../domain/phoneChat';
import type { GameState } from '../domain/state';
import { awaitingPlayerAction } from '../domain/turnCommit';
import type { TurnDraft } from '../domain/drafts';
import { readPromptResource } from '../prompts/loader';
import { recentCount, recentPhoneHistory } from '../prompts/phoneContext';
import { AiClient } from '../services/ai/client';
import type { AiConfig } from '../services/ai/configuration';
import type { CredentialVault } from '../services/ai/credentials';
import { AiError } from '../services/ai/errors';
import type { AiMessage } from '../services/ai/protocols';
import { requestSnapshot } from '../services/ai/snapshot';
import type { SaveRepository } from '../services/storage/saveRepository';
import type { Settings } from '../ui/settings/model';
import { storyDifficulty } from '../ui/settings/storyDifficulty';
import { StageGuard } from './stageGuard';
import { planRetry, waitForRetry } from './stageRetry';

export async function privateChatMessages(
  state: GameState,
  draft: TurnDraft | undefined,
  npcId: string,
  text: string,
  settings: Settings,
): Promise<AiMessage[]> {
  const npc = state.npc[npcId],
    difficulty = storyDifficulty(settings.prompts);
  const history = [
    ...(state.phone.threads[npcId]?.messages ?? []).map((m) => ({
      sender: m.sender,
      text: m.text,
      at: m.at,
      status: m.chatOutcome ?? m.status,
    })),
    ...(draft?.phonePending ?? [])
      .filter((row) => row.reply.npcId === npcId)
      .flatMap((row) => [
        { sender: 'protagonist', text: row.text, at: row.at, status: row.reply.status },
        ...(row.reply.status === 'replied' ? [{ sender: 'npc', text: row.reply.text, at: row.at }] : []),
      ]),
  ];
  const rules = await Promise.all(
    [
      'writing.intimacy_boundaries',
      ...(difficulty === 'relaxed' ? [] : ['writing.difficulty_' + difficulty]),
    ].map(readPromptResource),
  );
  return [
    {
      role: 'system',
      content: [
        '你只扮演这位收信人，用本人的口吻私聊。依据自己的性格、经历、记忆、知情范围和当前处境回应。区分本人所见、他人转述、推测与未读消息。不要替主角发言、作决定、执行交易、移动人物或推进时间。承诺只是说过的话。',
        '只返回 JSON 对象，npcId 为收信人 ID。status 可为 replied（另带 text 原文）、read_unanswered（已读不回）、later（稍后回复）或 unread（未读）。后三种省略 text。',
        ...rules,
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        npc: {
          id: npc.id,
          name: npc.name,
          identity: npc.identity,
          aliases: npc.aliases,
          age: npc.age,
          gender: npc.gender,
          temperament: npc.temperament,
          background: npc.background,
          addressing: npc.addressing,
          relationship: npc.relationshipText,
          affinity: npc.affinity,
          health: npc.healthText,
          location: npc.locationId && state.locations[npc.locationId]?.name,
          knowledge: npc.knownInformation,
          memories: npc.memories.filter((m) => m.visibility !== 'internal').slice(-recentCount),
          summaries: state.memories.npcSummaries[npcId]?.filter(
            (m) => m.visibility !== 'internal' && m.npcProvenance?.sourceVisibility !== 'internal',
          ),
          ...(npc.kind === 'special'
            ? { experience: npc.detailedBackground, habits: npc.habits, goals: npc.activeGoals }
            : {}),
        },
        playerName: state.protagonist.name,
        worldClock: state.worldClock,
        ...recentPhoneHistory(history),
        message: text,
      }),
    },
  ];
}

export async function sendPrivateChat(
  repository: SaveRepository,
  guard: StageGuard,
  input: {
    state: GameState;
    draft?: TurnDraft;
    instance: string | null;
    npcId: string;
    text: string;
    settings: Settings;
    config: AiConfig;
    vault: CredentialVault;
  },
  client = new AiClient(),
) {
  const { state, draft, instance, npcId, text, settings } = input;
  return guard.run(state.saveId, async (attempt) => {
    async function checkSource() {
      attempt.check();
      const live = await repository.loadGame(state.saveId);
      requireData(
        (live.instance ?? null) === instance &&
          state.revision === live.state.revision &&
          state.npcManagementRevision === live.state.npcManagementRevision &&
          fingerprint(live.draft) === fingerprint(draft),
        'DRAFT_CONFLICT',
        '聊天版本已变化，请重新读取',
      );
      requireData(
        settings.runtime.phoneChat !== false &&
          text.trim() &&
          live.state.turnNumber > 0 &&
          Object.hasOwn(live.state.npc, npcId) &&
          live.state.npc[npcId].phoneContact?.status === 'known' &&
          (!live.draft || awaitingPlayerAction(live.state, live.draft)),
        'PHONE_TARGET',
        '当前回合或号码不能发送消息',
      );
      return live.state;
    }
    const source = await checkSource();
    const snapshot = requestSnapshot(input.config, 'phone', input.vault);
    const messages = await privateChatMessages(source, draft, npcId, text, settings);
    const id = crypto.randomUUID();
    for (let n = 1; ; n++) {
      await checkSource();
      attempt.check();
      let reply;
      try {
        const response = await client.generate(snapshot, messages, {
          signal: attempt.signal,
          timeoutSeconds: settings.runtime.timeoutSeconds,
          stream: false,
          inspection: {
            kind: 'stage',
            mode: 'regular',
            saveId: state.saveId,
            revision: state.revision,
            modules: [],
          },
        });
        let value;
        try {
          value = JSON.parse(response.text);
        } catch {
          throw new AiError('invalid_output');
        }
        const result = ChatReply.safeParse(value);
        if (!result.success || result.data.npcId !== npcId) throw new AiError('invalid_output');
        reply = result.data;
      } catch (error) {
        attempt.check();
        // A malformed reply gets one fresh generation. All attempts share the same lock, ID and draft witness.
        if (
          error instanceof AiError &&
          error.code === 'invalid_output' &&
          n === 1 &&
          !settings.runtime.failureAutoRetry
        )
          continue;
        const retry = planRetry(error, settings, n);
        if (retry.action === 'stop') throw error;
        await waitForRetry(retry.ms, attempt.signal, () => {});
        continue;
      }
      attempt.saving();
      return repository.appendPhoneExchange(
        source,
        draft,
        instance,
        { id, baseTurnId: source.journal.at(-1)!.turnId, at: source.worldClock, text, reply },
        attempt.signal,
      );
    }
  });
}
