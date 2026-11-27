import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BookSource } from '../../domain/blackbook';
import type { CachedPost } from '../../services/storage/bookCache';
import type { PrivateChatControls } from './PrivateChatComposer';
import { phoneDateTime } from './phoneView';

const covers = ['#634b48', '#385157', '#435845', '#554866', '#655139'];
function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="ph-avatar">
      {Array.from(name)[0]}
    </span>
  );
}
function cover(id: string) {
  return covers[Array.from(id).reduce((n, c) => (31 * n + c.charCodeAt(0)) >>> 0, 0) % covers.length];
}

export function Blackbook({
  topics,
  hot,
  controls,
  detail,
  select,
  refresh,
}: {
  topics: BookSource[];
  hot: BookSource[];
  controls: PrivateChatControls;
  detail?: string;
  select: (key?: string) => void;
  refresh: number;
}) {
  const [tab, setTab] = useState<'推荐' | '热榜'>('推荐');
  const [records, store] = useState<Record<string, CachedPost>>({});
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<number[]>([]);
  const [retry, bump] = useState(0);
  const selected = (tab === '热榜' ? [...hot, ...topics] : [...topics, ...hot]).find(
    (s) => s.key === detail,
  );
  const wanted = selected
    ? selected.kind === 'topic'
      ? topics
      : [selected]
    : detail
      ? []
      : tab === '推荐'
        ? topics
        : [];
  const signature = JSON.stringify(wanted.map((s) => s.key));
  const latest = useRef({ controls, wanted });
  useLayoutEffect(() => {
    latest.current = { controls, wanted };
  });
  useEffect(() => {
    let active = true;
    const { controls, wanted } = latest.current;
    setStatus('');
    async function read() {
      const cached = await controls.chat.books.read(wanted.map((s) => s.key));
      if (!active) return;
      store((old) => ({ ...old, ...cached }));
      const missing = wanted.filter((s) => !cached[s.key]);
      if (!missing.length || controls.frozen || controls.inactive) return;
      setStatus('正在把 ' + missing.length + ' 个话题展开成帖子…');
      const result = await controls.chat.book(wanted, () => active);
      if (!active) return;
      if (!result) throw Error('展开失败');
      store((old) => ({ ...old, ...result }));
      setStatus('');
    }
    void read().catch(() => {
      if (active) setStatus('展开失败');
    });
    return () => {
      active = false;
    };
  }, [signature, refresh, retry]);
  const busy = controls.chat.busy || controls.inactive;
  const record = selected && records[selected.key];
  async function like(item: string) {
    if (!selected) return;
    try {
      const updated = await controls.chat.books.like(selected.key, item);
      store((old) => ({ ...old, [selected.key]: updated }));
    } catch {
      setStatus('点赞未保存');
    }
  }
  const likes = (item: string, count: number) => (
    <button aria-pressed={record?.liked.includes(item) ?? false} onClick={() => void like(item)}>
      赞 {count + Number(record?.liked.includes(item) ?? false)}
    </button>
  );
  return (
    <section className="ph-feed">
      {!detail && (
        <div className="ph-tabs">
          {['推荐', '热榜'].map((t) => (
            <button key={t} aria-pressed={t === tab} onClick={() => setTab(t as typeof tab)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {status && (
        <div role="status">
          {status}
          {status === '展开失败' ? (
            <button disabled={busy || controls.frozen} onClick={() => bump((n) => n + 1)}>
              重试
            </button>
          ) : status.startsWith('正在') ? (
            <div className="ph-cards" aria-hidden="true">
              <span className="ph-skeleton" />
              <span className="ph-skeleton" />
            </div>
          ) : null}
        </div>
      )}
      {detail && !selected && <p>当前时间线已无此话题。</p>}
      {selected && record && (
        <article>
          <div className="ph-byline">
            <Avatar name={record.post.author} /> @{record.post.author} <button disabled>关注</button>
          </div>
          <h4 className="ph-cover" style={{ backgroundColor: cover(selected.seedId) }}>
            {record.post.title}
          </h4>
          {selected.related && <small className="ph-related">与你有关</small>}
          <p className="ph-post-body">{record.post.body}</p>
          <p className="ph-tags">{record.post.tags.map((t) => '#' + t).join(' ')}</p>
          <small>
            {phoneDateTime(record.post.at)} · {record.post.location}
          </small>
          <h4>共 {record.post.comments.length} 条评论</h4>
          {record.post.comments.map((c, i) => (
            <div className="ph-comment" key={i}>
              <b className="ph-byline">
                <Avatar name={c.author} />@{c.author} {c.byAuthor && '作者'}
              </b>
              <p>
                {c.replyTo && '回复 ' + c.replyTo + '：'}
                {c.text}
              </p>
              <small>
                {phoneDateTime(c.at)} · IP 属地 {c.region}
              </small>
              {likes('c' + i, c.likes)}
              {c.replies.slice(0, open.includes(i) ? undefined : 1).map((r, j) => (
                <div className="ph-comment" key={j}>
                  <b className="ph-byline">
                    <Avatar name={r.author} />@{r.author} {r.byAuthor && '作者'}
                  </b>
                  <p>
                    {r.replyTo && '回复 ' + r.replyTo + '：'}
                    {r.text}
                  </p>
                  <small>
                    {phoneDateTime(r.at)} · IP 属地 {r.region}
                  </small>
                  {likes('r' + i + '-' + j, r.likes)}
                </div>
              ))}
              {c.replies.length > 1 && (
                <button
                  onClick={() => setOpen(open.includes(i) ? open.filter((x) => x !== i) : [...open, i])}
                >
                  {open.includes(i) ? '收起' : '展开 ' + (c.replies.length - 1) + ' 条回复'}
                </button>
              )}
            </div>
          ))}
          <div className="ph-post-actions">
            <span>说点什么… 第一版不能发帖评论</span>
            {likes('post', record.post.likes)} · 收藏 {record.post.saves} · 评论{' '}
            {record.post.comments.length}
          </div>
          <p className="ph-foot">帖子和评论在打开时一次生成，只是城市氛围，不算正式事实。</p>
        </article>
      )}
      {!detail &&
        (tab === '推荐' ? (
          <div className="ph-cards">
            {topics.map((s) => {
              const entry = records[s.key];
              return (
                <button
                  key={s.key}
                  disabled={busy && !entry}
                  onClick={() => {
                    select(s.key);
                    setOpen([]);
                  }}
                >
                  <b className="ph-cover" style={{ backgroundColor: cover(s.seedId) }}>
                    {entry?.post.title ?? s.title}
                  </b>
                  <span>{entry?.post.subtitle ?? s.summary}</span>
                  {s.related && <small className="ph-related">与你有关</small>}
                  {entry && (
                    <small>
                      @{entry.post.author} · 赞 {entry.post.likes + Number(entry.liked.includes('post'))}
                    </small>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <ol>
            {hot.map((s) => (
              <li key={s.key}>
                <button
                  onClick={() => {
                    select(s.key);
                    setOpen([]);
                  }}
                >
                  {s.title}
                  <small>{s.summary}</small>
                  <small>主事件 · 公开话题</small>
                </button>
              </li>
            ))}
          </ol>
        ))}
      {!detail && !(tab === '推荐' ? topics : hot).length && <p className="ph-foot">暂无话题</p>}
      {selected && !record && !status && controls.frozen && (
        <p className="ph-foot">当前回合只能查看已缓存的帖子。</p>
      )}
    </section>
  );
}
