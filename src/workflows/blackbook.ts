import { z } from 'zod';
import { BookPost, bookSources, type BookSource } from '../domain/blackbook';
import { requireData } from '../domain/common';
import { awaitingPlayerAction } from '../domain/turnCommit';
import { AiClient } from '../services/ai/client';
import { AiError } from '../services/ai/errors';
import { requestSnapshot } from '../services/ai/snapshot';
import type { SaveRepository } from '../services/storage/saveRepository';
import type { sendPrivateChat } from './phoneChat';
import type { StageGuard } from './stageGuard';

type Input = Omit<Parameters<typeof sendPrivateChat>[2], 'npcId' | 'text'>;
export async function expandBook(
  repository: SaveRepository,
  guard: StageGuard,
  input: Input,
  sources: BookSource[],
  client = new AiClient(),
) {
  const keys = [...new Set(sources.map((s) => s.key))];
  async function check() {
    const live = await repository.loadGame(input.state.saveId);
    const visible = bookSources(live.state, live.instance ?? null);
    const available = new Map([...visible.topics, ...visible.hot].map((s) => [s.key, s]));
    requireData(
      (live.instance ?? null) === input.instance && keys.every((k) => available.has(k)),
      'DRAFT_CONFLICT',
      '话题已随时间线变化',
    );
    return { live, available };
  }
  await check();
  const cached = await repository.books.read(keys);
  if (keys.every((k) => cached[k])) return cached;
  return guard.run(input.state.saveId, async (attempt) => {
    const { live, available } = await check();
    requireData(
      !live.draft || awaitingPlayerAction(live.state, live.draft),
      'PHONE_TARGET',
      '当前草稿只能浏览已缓存的帖子',
    );
    const current = await repository.books.read(keys);
    const missing = keys.filter((k) => !current[k]).map((k) => available.get(k)!);
    if (!missing.length) return current;
    const wire = missing.map((s, i) => ({ index: i, title: s.title, summary: s.summary, at: s.at }));
    const response = await client.generate(
      requestSnapshot(input.config, 'phone', input.vault),
      [
        {
          role: 'system',
          content:
            '根据给出的公开话题一次生成整批城市氛围帖子，只返回 JSON 数组，按 index 对应。传闻不产生正式事件，不替玩家发帖评论。每项为 {index,post:{author,title,subtitle,body,tags:[字符串],at:带时区ISO时间,location,likes:整数,saves:整数,comments:[{author,text,at,region,likes,byAuthor,replyTo?,replies:[{author,text,at,region,likes,byAuthor,replyTo?}]}]}}。包含自然的楼中楼与作者回复。',
        },
        { role: 'user', content: JSON.stringify({ worldClock: live.state.worldClock, topics: wire }) },
      ],
      { signal: attempt.signal, stream: false, timeoutSeconds: input.settings.runtime.timeoutSeconds },
    );
    let entries;
    try {
      const rows = z
        .array(
          z.strictObject({
            index: z
              .number()
              .int()
              .min(0)
              .max(missing.length - 1),
            post: BookPost,
          }),
        )
        .parse(JSON.parse(response.text));
      if (rows.length !== missing.length || new Set(rows.map((r) => r.index)).size !== missing.length)
        throw Error();
      entries = rows.map((r) => ({ key: missing[r.index].key, post: r.post }));
    } catch {
      throw new AiError('invalid_output');
    }
    await check();
    attempt.check();
    attempt.saving();
    await repository.books.fill(entries, attempt.signal);
    return repository.books.read(keys);
  });
}
