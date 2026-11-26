import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PictureThumb, downloadPicture } from './PictureThumb';
import { Dialog } from '../Dialog';
import { config } from '../../services/images/config';
import {
  kinds,
  person,
  sameSubject,
  slotOptions,
  slots,
  targetFor,
  validTarget,
} from '../../services/images/model';
import type { Kind, Picture, Slot, Target } from '../../services/images/model';
import { cancelJob, enqueue } from '../../services/images/queue';
import { convertText } from '../../services/images/protocol';
import { maxPictureBytes } from '../../services/images/raster';
import { terminal } from '../../services/images/library';
import { useImages } from './ImageScope';
import type { ImageView } from './ImageScope';
import './images.css';

function PictureRow({
  view,
  p,
  report,
}: {
  view: ImageView;
  p: Picture;
  report: (op: Promise<unknown>) => void;
}) {
  const [deleting, setDeleting] = useState(false),
    [title, setTitle] = useState(p.album ?? p.target.title);
  const valid = validTarget(view.state, p.target);
  function edit(action: 'use' | 'album' | 'delete', value?: string) {
    report(view.lib.edit(view.scope, p.id, action, value));
  }
  return (
    <article className="image-record">
      <PictureThumb resources={view.resources} p={p} variant="record" />
      <div>
        <strong>{p.album || p.target.title}</strong>
        <small>
          {slots[p.slot]} · {valid ? (p.current ? '当前使用' : '历史图片') : '历史关联'} · {p.target.gameTime}
        </small>
        {p.target.kind === 'story' && <p>{p.target.summary}</p>}
        <div className="image-actions">
          {valid && !p.current && <button onClick={() => edit('use')}>选为当前</button>}
          <a
            href="#export-image"
            onClick={(e) => {
              e.preventDefault();
              report(downloadPicture(view.resources, p));
            }}
          >
            导出图片
          </a>
          <button onClick={() => setDeleting(true)}>删除</button>
        </div>
        {p.target.kind === 'story' && (
          <div className="image-actions">
            {p.album !== undefined && (
              <label>
                相册标题
                <input value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} />
              </label>
            )}
            <button onClick={() => edit('album', title)}>
              {p.album === undefined ? '加入人生相册' : '保存标题'}
            </button>
            {p.album !== undefined && <button onClick={() => edit('album')}>移出相册</button>}
          </div>
        )}
      </div>
      {deleting && (
        <Dialog small title="删除这张图片？" onClose={() => setDeleting(false)}>
          <p>这会一并删除该图片的历史记录与收藏。</p>
          <button onClick={() => edit('delete')}>确认删除图片</button>
        </Dialog>
      )}
    </article>
  );
}
function ImageEditor({
  view,
  t,
  slot,
  report,
}: {
  view: ImageView;
  t: Target;
  slot: Slot;
  report: (op: Promise<unknown>) => void;
}) {
  const existing =
    view.library.anchors.find((a) => sameSubject(a.target, t) && validTarget(view.state, a.target))?.text ??
    '';
  const [anchor, setAnchor] = useState(existing),
    [extra, setExtra] = useState(''),
    [extracting, setExtracting] = useState(false);
  const extraction = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => extraction.current?.abort(), []);
  async function extract() {
    extraction.current?.abort();
    const controller = new AbortController();
    extraction.current = controller;
    setExtracting(true);
    try {
      const result = await convertText(
        config(),
        '提取人物稳定视觉特征，以真实年龄、身份和已有外貌为依据。只输出简洁形象描述，不补写正式人物事实。',
        t.summary,
        AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
      );
      setAnchor(result.slice(0, 4000));
    } finally {
      setExtracting(false);
    }
  }
  async function upload(f: File) {
    if (f.size > maxPictureBytes) throw new Error('单张图片上限为 16 MiB');
    await view.lib.save(view.scope, t, slot, new Uint8Array(await f.arrayBuffer()));
  }
  return (
    <>
      <label>
        本次画面补充
        <input value={extra} maxLength={2000} onChange={(e) => setExtra(e.target.value)} />
      </label>
      <div className="image-actions">
        <button onClick={() => report(enqueue(view.lib, view.scope, t, slot, false, extra))}>
          {view.library.pictures.some(
            (p) => sameSubject(p.target, t) && p.slot === slot && validTarget(view.state, p.target),
          )
            ? '重新绘制'
            : '生成图片'}
        </button>
        <label>
          本地上传
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) report(upload(file));
            }}
          />
        </label>
      </div>
      <small>
        每次生成提交 1 次图片请求{config().convert ? '，并先调用 1 次词组转化器' : ''}
        。取消时供应商可能已计费。
      </small>
      {person(t.kind) && (
        <details>
          <summary>人物形象锚点</summary>
          <label>
            稳定外貌
            <textarea maxLength={4000} value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          </label>
          <div className="image-actions">
            <button onClick={() => report(view.lib.anchor(view.scope, t, anchor))}>保存锚点</button>
            <button disabled={extracting} onClick={() => report(extract())}>
              重新提取（1 次文本请求）
            </button>
            <button
              onClick={() => {
                setAnchor('');
                report(view.lib.anchor(view.scope, t, ''));
              }}
            >
              清除锚点
            </button>
          </div>
          <small>提取后可编辑并保存。锚点帮助维持外观，实际效果取决于模型。</small>
        </details>
      )}
    </>
  );
}
export function Gallery({
  view,
  target,
  initialSlot,
}: {
  view: ImageView;
  target?: Target;
  initialSlot?: Slot;
}) {
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [limit, setLimit] = useState(12),
    [error, setError] = useState('');
  const [slot, setSlot] = useState<Slot>(initialSlot ?? (target ? slotOptions(target.kind)[0] : 'avatar'));
  function report(op: Promise<unknown>) {
    setError('');
    void op.catch((e) => setError(e instanceof Error ? e.message : '图片操作失败'));
  }
  const all = view.library.pictures,
    rows = all
      .filter((p) =>
        target
          ? sameSubject(p.target, target) && p.slot === slot
          : filter === 'all' ||
            (filter === 'album'
              ? p.album !== undefined
              : filter === 'home'
                ? p.slot === 'home'
                : p.target.kind === filter),
      )
      .filter((p) => !query || [p.target.title, p.album].some((t) => t?.includes(query)))
      .reverse();
  const jobs = view.jobs
    .filter((j) => !target || sameSubject(j.target, target))
    .sort((a, b) => b.time - a.time);
  return (
    <div className="image-tools">
      {target ? (
        <>
          <label>
            图片用途
            <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
              {slotOptions(target.kind).map((v) => (
                <option key={v} value={v}>
                  {slots[v]}
                </option>
              ))}
            </select>
          </label>
          <ImageEditor view={view} t={target} slot={slot} report={report} />
        </>
      ) : (
        <>
          <p>
            共 {all.length} 张 · {(all.reduce((n, p) => n + p.bytes, 0) / 1048576).toFixed(2)} MiB
          </p>
          <div className="image-actions">
            <label>
              分类
              <select
                aria-label="分类"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setLimit(12);
                }}
              >
                {Object.entries({
                  all: '全部',
                  player: '主角图片',
                  npc: 'NPC 图片',
                  home: '居家照',
                  vehicle: '车辆图片',
                  story: '剧情插画',
                  place: '地点图片',
                  item: '物品图片',
                  album: '人生相册',
                }).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              筛选标题
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
        </>
      )}
      {(error || view.error) && <p role="alert">{error || view.error}</p>}
      {!rows.length && <p className="muted">暂无{filter === 'album' ? '收藏' : '图片'}。</p>}
      {rows.slice(0, limit).map((p) => (
        <PictureRow key={p.id} view={view} p={p} report={report} />
      ))}
      {rows.length > limit && <button onClick={() => setLimit(limit + 12)}>查看更多图片</button>}
      {!!jobs.length && (
        <details open={jobs.some((j) => !terminal(j.phase) || j.phase === '失败')}>
          <summary>任务记录（{jobs.length}）</summary>
          {jobs.slice(0, limit).map((j) => (
            <p key={j.id}>
              {j.target.title} · {j.phase} {j.message}{' '}
              {!terminal(j.phase) && (
                <button onClick={() => cancelJob(view.scope.saveId, j.id)}>取消任务</button>
              )}
            </p>
          ))}
          {jobs.length > limit && <button onClick={() => setLimit(limit + 20)}>更多任务</button>}
        </details>
      )}
    </div>
  );
}
type Subject = { id: string; kind: Kind };
type Actor = { id: string; kind: 'player' | 'npc' };

export function ImageAvatar({ id, kind, children }: Actor & { children?: ReactNode }) {
  const view = useImages();
  const p = view?.current(kind, id, 'avatar');
  return view && p ? (
    <PictureThumb key={p.id} resources={view.resources} p={p} fallback={children} />
  ) : (
    children
  );
}

export function Portraits({ id, kind, home = false }: Actor & { home?: boolean }) {
  const view = useImages();
  const pictures = (home ? (['home'] as const) : (['bust', 'full'] as const)).flatMap(
    (slot) => view?.current(kind, id, slot) ?? [],
  );
  if (!view || !pictures.length) return null;
  return (
    <div className="profile-pictures">
      <div className="wide-portraits">
        {pictures.map((p) => (
          <PictureThumb key={p.id} resources={view.resources} p={p} />
        ))}
      </div>
      <details className="compact-portraits">
        <summary>{home ? '查看居家照' : '查看人物立绘'}</summary>
        {pictures.map((p) => (
          <PictureThumb key={p.id} resources={view.resources} p={p} />
        ))}
      </details>
    </div>
  );
}

export function ImageEntry(props: Subject & { home?: boolean }) {
  const view = useImages();
  return view ? <EnabledEntry key={props.id} {...props} view={view} /> : null;
}
function EnabledEntry({ kind, id, home, view }: Subject & { home?: boolean; view: ImageView }) {
  const [open, setOpen] = useState(false);
  const t = open ? targetFor(view.state, kind, id) : undefined;
  const p = !person(kind) ? view.current(kind, id, slotOptions(kind)[0]) : undefined;
  return (
    <>
      {p && <PictureThumb key={p.id} resources={view.resources} p={p} variant={kind} />}
      <button className="link-btn image-entry" onClick={() => setOpen(true)}>
        {home ? '管理居家照' : kind === 'story' ? (p ? '插画选项' : '查看或生成插画') : kinds[kind] + '图片'}
      </button>
      {t && (
        <Dialog title={t.title + ' · 图片'} onClose={() => setOpen(false)}>
          <Gallery
            key={JSON.stringify([id, home])}
            view={view}
            target={t}
            initialSlot={home ? 'home' : undefined}
          />
        </Dialog>
      )}
    </>
  );
}
