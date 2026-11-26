import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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

function usePicture(view: ImageView, p: Picture | undefined) {
  const [value, setValue] = useState<{ key: string; url: string }>();
  const id = p?.id,
    mime = p?.mime,
    lib = view.lib,
    saveId = view.scope.saveId;
  const key = JSON.stringify([saveId, id, mime]);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void lib
      .file(saveId, id)
      .then((data) => {
        if (live && data) setValue({ key, url: 'data:' + mime + ';base64,' + data });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key, lib, saveId, id, mime]);
  return value?.key === key ? value.url : undefined;
}
function PictureRow({
  view,
  p,
  report,
}: {
  view: ImageView;
  p: Picture;
  report: (op: Promise<unknown>) => void;
}) {
  const url = usePicture(view, p);
  const [preview, setPreview] = useState(false),
    [deleting, setDeleting] = useState(false),
    [title, setTitle] = useState(p.album ?? p.target.title);
  const valid = validTarget(view.state, p.target);
  function edit(action: 'use' | 'album' | 'delete', value?: string) {
    report(view.lib.edit(view.scope, p.id, action, value));
  }
  return (
    <article className="image-record">
      {url && (
        <button
          className="image-preview"
          aria-label={'预览 ' + p.target.title}
          onClick={() => setPreview(true)}
        >
          <img src={url} alt={p.target.title} />
        </button>
      )}
      <div>
        <strong>{p.album || p.target.title}</strong>
        <small>
          {slots[p.slot]} · {valid ? (p.current ? '当前使用' : '历史图片') : '历史关联'} · {p.target.gameTime}
        </small>
        {p.target.kind === 'story' && <p>{p.target.summary}</p>}
        <div className="image-actions">
          {valid && !p.current && <button onClick={() => edit('use')}>选为当前</button>}
          {url && (
            <a href={url} download={p.target.title + '.' + p.mime.split('/')[1]}>
              导出图片
            </a>
          )}
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
      {preview && url && (
        <Dialog title={p.target.title} onClose={() => setPreview(false)}>
          <img className="image-full" src={url} alt={p.target.title} />
        </Dialog>
      )}
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
export function Gallery({ view, target }: { view: ImageView; target?: Target }) {
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [limit, setLimit] = useState(12),
    [error, setError] = useState('');
  const [slot, setSlot] = useState<Slot>(target ? slotOptions(target.kind)[0] : 'avatar');
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
              : p.target.kind === filter || (filter === 'item' && p.target.kind === 'vehicle')),
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
function CurrentAvatar({
  view,
  id,
  kind,
  children,
}: {
  view: ImageView;
  id: string;
  kind: 'player' | 'npc';
  children: ReactNode;
}) {
  const current = view.library.pictures.find(
    (p) =>
      p.target.id === id &&
      p.target.kind === kind &&
      p.slot === 'avatar' &&
      p.current &&
      validTarget(view.state, p.target),
  );
  const url = usePicture(view, current);
  return url ? <img className="dossier-image-avatar" src={url} alt="" /> : children;
}
export function ImageAvatar({
  id,
  kind,
  children,
}: {
  id: string;
  kind: 'player' | 'npc';
  children: ReactNode;
}) {
  const view = useImages();
  return view ? (
    <CurrentAvatar view={view} id={id} kind={kind}>
      {children}
    </CurrentAvatar>
  ) : (
    children
  );
}
function Entry({ view, t }: { view: ImageView; t: Target }) {
  const [open, setOpen] = useState(false);
  const m =
    t.kind === 'story'
      ? undefined
      : view.library.pictures.find(
          (p) =>
            p.current &&
            p.slot === slotOptions(t.kind)[0] &&
            sameSubject(p.target, t) &&
            validTarget(view.state, p.target),
        );
  const url = usePicture(view, m);
  return (
    <>
      <button className="link-btn image-entry" onClick={() => setOpen(true)}>
        {url && <img src={url} alt="" />}
        {kinds[t.kind] + '图片'}
      </button>
      {open && (
        <Dialog title={t.title + ' · 图片'} onClose={() => setOpen(false)}>
          <Gallery view={view} target={t} />
        </Dialog>
      )}
    </>
  );
}
function StoryEntry({ view, id }: { view: ImageView; id: string }) {
  const [open, setOpen] = useState(false);
  const target = open ? targetFor(view.state, 'story', id) : undefined;
  return (
    <>
      <button className="link-btn image-entry" onClick={() => setOpen(true)}>
        查看或生成插画
      </button>
      {target && (
        <Dialog title={target.title + ' · 图片'} onClose={() => setOpen(false)}>
          <Gallery view={view} target={target} />
        </Dialog>
      )}
    </>
  );
}
export function ImageEntry({ kind, id }: { kind: Kind; id: string }) {
  const view = useImages();
  if (!view) return null;
  if (kind === 'story') return <StoryEntry view={view} id={id} />;
  const t = targetFor(view.state, kind, id);
  return t ? <Entry key={id} view={view} t={t} /> : null;
}
