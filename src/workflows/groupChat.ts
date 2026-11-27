import { z } from 'zod';
import { fingerprint } from '../domain/commands';
import { IdSchema, requireData } from '../domain/common';
import { chatBase } from '../domain/phone';
import {
  GroupAction,
  GroupOutcome,
  groupAudience,
  type GroupExchange,
  type GroupThread,
} from '../domain/phoneGroup';
import type { GameState } from '../domain/state';
import { awaitingPlayerAction } from '../domain/turnCommit';
import { readPromptResource } from '../prompts/loader';
import { groupTranscript, personalTurnHistory, publicGroupLine } from '../prompts/phoneKnowledge';
import { recentPhoneHistory } from '../prompts/phoneContext';
import { AiClient } from '../services/ai/client';
import { AiError } from '../services/ai/errors';
import { requestSnapshot } from '../services/ai/snapshot';
import type { SaveRepository } from '../services/storage/saveRepository';
import { storyDifficulty } from '../ui/settings/storyDifficulty';
import { phonePersona, type sendPrivateChat } from './phoneChat';
import type { StageGuard } from './stageGuard';
import { planRetry, waitForRetry } from './stageRetry';

type GroupInput = Omit<Parameters<typeof sendPrivateChat>[2], 'text' | 'npcId'> & {
  groupId: string;
  action: GroupAction;
};
const schedule = z.array(
  z.strictObject({ npcId: IdSchema, status: z.enum(['reply', 'unread', 'later', 'read_unanswered']) }),
);

function publicMember(state: GameState, id: string) {
  const roles = Object.values(state.organizations).flatMap((org) => {
    const member = org.members?.find((m) => m.npcId === id);
    if (member?.covert) return [];
    const title =
      member?.position ?? org.leadership?.find((m) => m.npcId === id && m.publicName)?.position;
    return title ? [{ organization: org.name, position: title }] : [];
  });
  return { id, name: state.npc[id].name, roles };
}

function visibleHistory(group: GroupThread | undefined, viewers: string[], personal = false) {
  const history = (group?.history ?? [])
    .flatMap(groupTranscript)
    .filter(publicGroupLine)
    .filter((line) => viewers.every((id) => (personal ? line.readers : line.audience).includes(id)))
    .map(({ id, at, sender, text, kind, audience, action }) => ({
      id,
      at,
      sender,
      text,
      kind,
      audience,
      action,
    }));
  return recentPhoneHistory(history);
}

export async function sendGroupChat(
  repository: SaveRepository,
  guard: StageGuard,
  input: GroupInput,
  client = new AiClient(),
) {
  const { state, draft, instance, settings, groupId } = input;
  const action = GroupAction.parse(input.action);
  requireData(action.type !== 'message' || action.text.trim(), 'PHONE_TARGET', '请输入群聊消息');
  return guard.run(state.saveId, async (attempt) => {
    async function check() {
      attempt.check();
      const live = await repository.loadGame(state.saveId);
      requireData(
        (live.instance ?? null) === instance &&
          live.state.revision === state.revision &&
          live.state.npcManagementRevision === state.npcManagementRevision &&
          fingerprint(live.draft) === fingerprint(draft),
        'DRAFT_CONFLICT',
        '聊天版本已变化，请重新读取',
      );
      requireData(
        settings.runtime.phoneChat !== false &&
          state.turnNumber > 0 &&
          (!draft || awaitingPlayerAction(state, draft)),
        'PHONE_TARGET',
        '当前回合不能发送群聊',
      );
    }
    await check();
    const group = chatBase(state, draft?.phonePending ?? [], draft?.turnId ?? groupId).phone.groups?.[
      groupId
    ];
    const create = action.type === 'create';
    requireData(create ? !group : group && !group.playerLeft, 'PHONE_TARGET', '当前群聊已发生变化');
    const audience = groupAudience(group, action);
    if ('invitees' in action)
      requireData(
        action.invitees.length >= (create ? 2 : 1) &&
          new Set(audience).size === audience.length &&
          action.invitees.every((id) => state.npc[id]?.phoneContact?.status === 'known'),
        'PHONE_TARGET',
        '只能邀请拥有有效号码、尚未入群的成员',
      );
    const members = audience.map((id) => publicMember(state, id));
    const groupPublic = {
      name: create ? action.name : group!.name,
      category: create ? action.category : group!.category,
      members,
      playerName: state.protagonist.name,
      at: state.worldClock,
      action,
    };
    const row: GroupExchange = {
      kind: 'group',
      id: create ? groupId : crypto.randomUUID(),
      groupId,
      baseTurnId: state.journal.at(-1)!.turnId,
      at: state.worldClock,
      action,
      audience,
      outcomes: [],
    };

    async function ask<T>(rule: string, data: unknown, parse: (value: unknown) => T) {
      const snapshot = requestSnapshot(input.config, 'phone', input.vault, { route: 'phoneGroup' });
      for (let n = 1; ; n++) {
        await check();
        try {
          const response = await client.generate(
            snapshot,
            [
              { role: 'system', content: rule },
              { role: 'user', content: JSON.stringify(data) },
            ],
            { signal: attempt.signal, timeoutSeconds: settings.runtime.timeoutSeconds, stream: false },
          );
          try {
            return parse(JSON.parse(response.text));
          } catch {
            throw new AiError('invalid_output');
          }
        } catch (error) {
          attempt.check();
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
        }
      }
    }
    const difficulty = storyDifficulty(settings.prompts);
    const rules = await Promise.all(
      [
        'writing.intimacy_boundaries',
        ...(difficulty === 'relaxed' ? [] : ['writing.difficulty_' + difficulty]),
      ].map(readPromptResource),
    );
    async function individual(id: string, invite: boolean) {
      const rule = [
        '只扮演指定人物，按本人的经历、知识和性格决定。不要代主角说话或行动，承诺只属于对话。仅返回 JSON {npcId,status,text?}。',
        invite
          ? '回答是否接受邀请：joined 或 refused，不带 text。'
          : '回复用 replied 和原文 text；也可 left 退群或 read_unanswered、later、unread（不带 text）。',
        ...rules,
      ].join('\n');
      return ask(
        rule,
        {
          group: {
            ...groupPublic,
            members: members.filter(
              (member) =>
                !row.outcomes.some(
                  (o) => o.npcId === member.id && (o.status === 'left' || o.status === 'refused'),
                ),
            ),
          },
          npc: phonePersona(state, id),
          history: visibleHistory(state.phone.groups?.[groupId], [id], true),
          thisTurn: personalTurnHistory(draft?.phonePending ?? [], id),
          preceding: row.outcomes.filter((o) => o.status === 'replied' || o.status === 'left'),
        },
        (value) => {
          const result = GroupOutcome.parse(value);
          if (
            result.npcId !== id ||
            invite !== (result.status === 'joined' || result.status === 'refused')
          )
            throw Error('回执不匹配');
          return result;
        },
      );
    }
    if ('invitees' in action) {
      for (const id of action.invitees) row.outcomes.push(await individual(id, true));
    } else if (action.type === 'message' && audience.length) {
      const plan = await ask(
        '你是群聊调度。仅根据群内公开资料给出 JSON 数组 [{npcId,status}]。列出所有成员各一次，按发言顺序排列。status 为 reply、read_unanswered、later 或 unread。不得代写发言。',
        { group: groupPublic, history: visibleHistory(group, audience) },
        (value) => {
          const result = schedule.parse(value);
          if (
            result.length !== audience.length ||
            new Set(result.map((o) => o.npcId)).size !== audience.length ||
            result.some((o) => !audience.includes(o.npcId))
          )
            throw Error('成员不匹配');
          return result;
        },
      );
      let replies = 0;
      for (const item of plan) {
        if (item.status === 'reply' && settings.phone?.groupReplyLimit !== undefined && replies++ >= settings.phone.groupReplyLimit) {
          row.outcomes.push({ npcId: item.npcId, status: 'unread' });
          continue;
        }
        row.outcomes.push(
          item.status === 'reply'
            ? await individual(item.npcId, false)
            : { npcId: item.npcId, status: item.status },
        );
      }
    }
    await check();
    attempt.saving();
    return repository.appendPhoneExchange(state, draft, instance, row, attempt.signal);
  });
}
