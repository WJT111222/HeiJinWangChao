import { ModelRouteLabel } from '../settings/ModelRouteLabel';
import { useEffect, useState } from 'react';
import type { SaveRepository } from '../../services/storage/saveRepository';
import {
  autoLabels,
  backendNames,
  config,
  credentialId,
  defaults,
  endpoint,
  imageVault,
  saveConfig,
  reconcileConfig,
  subscribeConfig,
  templates,
} from '../../services/images/config';
import type { Backend, ImageConfig } from '../../services/images/config';
import { paths, probe } from '../../services/images/protocol';
import { 常用文生图尺寸选项, 自动场景竖屏尺寸选项, 自动场景横屏尺寸选项 } from '../../services/images/sizes';
import { Dialog } from '../Dialog';
import { Gallery } from './ImageGallery';
import { ImageScope, useImages } from './ImageScope';

function conflictPreview(value: unknown) {
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 160 ? text.slice(0, 160) + '…' : text || '（空）';
}

function KeyField({ kind, base }: { kind: Backend; base: string }) {
  let id = '';
  try {
    id = credentialId(kind, base);
  } catch {
    /* Incomplete address. */
  }
  const [key, setKey] = useState(''),
    [remember, setRemember] = useState(false),
    [notice, setNotice] = useState('');
  useEffect(() => {
    try {
      setKey(id ? imageVault().get(id) : '');
      setRemember(!!id && imageVault().remembered(id));
      setNotice('');
    } catch {
      setNotice('密钥库不可用');
    }
  }, [id]);
  return (
    <fieldset>
      <legend>图片接口密钥</legend>
      <input
        aria-label="图片密钥"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <label className="image-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        在此设备记住密钥
      </label>
      <button
        disabled={!id}
        onClick={() => {
          try {
            imageVault().set(id, key, remember);
            setNotice(key ? '密钥已保存' : '密钥已清除');
          } catch {
            setNotice('密钥保存失败');
          }
        }}
      >
        保存密钥
      </button>
      {notice && <small role="status">{notice}</small>}
    </fieldset>
  );
}
function ActiveGallery() {
  const v = useImages();
  return v ? <Gallery view={v} /> : null;
}
function SavedGallery({ repo }: { repo?: SaveRepository }) {
  const [saves, setSaves] = useState<{ saveId: string; title: string }[]>([]),
    [id, setId] = useState(''),
    [error, setError] = useState('');
  const [loaded, setLoaded] = useState<Awaited<ReturnType<SaveRepository['loadGame']>>>();
  useEffect(() => {
    let live = true;
    void repo?.list().then(
      (rows) => {
        if (live) {
          const list = rows.filter((s) => s.status === 'readable');
          setSaves(list);
          setId(list[0]?.saveId ?? '');
        }
      },
      () => {
        if (live) setError('存档列表读取失败');
      },
    );
    return () => {
      live = false;
    };
  }, [repo]);
  useEffect(() => {
    if (!id || !repo) return;
    let live = true;
    void repo.loadGame(id).then(
      (v) => {
        if (live) setLoaded(v);
      },
      () => {
        if (live) setError('存档读取失败');
      },
    );
    return () => {
      live = false;
    };
  }, [repo, id]);
  return (
    <>
      <label>
        所属存档
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {saves.map((s) => (
            <option key={s.saveId} value={s.saveId}>
              {s.title} · {s.saveId}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {!id && <p>暂无可读存档。</p>}
      {repo && loaded?.state.saveId === id && (
        <ImageScope key={id} lib={repo.images} {...loaded}>
          <ActiveGallery />
        </ImageScope>
      )}
    </>
  );
}
const modelChoices: Record<Backend, string[]> = {
  openai: ['gpt-image-1', 'dall-e-3'],
  novelai: ['nai-diffusion-4-5-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-3'],
  comfy: [],
  sd: [],
};
const legacyTextNotice = 'heijin.images.text-route-notice.v1';
export function ImageSettings({ repository, openRouting, onDirtyChange }: {
  repository?: SaveRepository; openRouting: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(() => {
    try { return localStorage.getItem(legacyTextNotice) === '1'; } catch { return false; }
  });
  const [editor, setEditor] = useState(() => {
      const initial = config();
      return reconcileConfig(initial, initial, initial);
    }),
    [notice, setNotice] = useState(''),
    [gallery, setGallery] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [pendingEnabled, setPendingEnabled] = useState<boolean>();
  const c = editor.draft;
  const dirty = JSON.stringify(c) !== JSON.stringify(editor.saved);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    const sync = () => {
      const latest = config();
      setEditor((prev) => reconcileConfig(prev.base, prev.draft, latest));
    };
    const unsubscribe = subscribeConfig(sync);
    sync();
    return unsubscribe;
  }, []);
  function set(next: ImageConfig) {
    setEditor((prev) => {
      const edited = c === prev.draft ? next : reconcileConfig(c, next, prev.draft).draft;
      return reconcileConfig(prev.base, edited, prev.saved);
    });
    setNotice('');
  }
  const active = useImages(),
    b = c.backend,
    p = c.connections[b];
  const setP = (patch: Partial<typeof p>) =>
    set({ ...c, connections: { ...c.connections, [b]: { ...p, ...patch } } });
  async function persist(base: ImageConfig, next: ImageConfig) {
    try {
      await saveConfig(base, next);
      setNotice('设置已保存');
    } catch (error) {
      const latest = config();
      setEditor((prev) => reconcileConfig(prev.base, prev.draft, latest));
      setNotice(
        error instanceof Error && error.name !== 'ZodError' ? error.message : '配置格式无效，请检查输入',
      );
    }
  }
  function save() {
    try {
      if (p.base) endpoint(p.base, p.path || paths[b]);
      void persist(editor.base, c);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '地址无效');
    }
  }
  const converterRoute = <>
            <div className="settings-form-row"><span>生图提示词</span><div><ModelRouteLabel route="imagePrompt"/> <button type="button" className="ai-link" onClick={openRouting}>在模型分配里改</button></div></div>
            {c.textModel && !acknowledged && <div className="image-migration-note"><p>之前单独填写的文本模型（{c.textModel}）已不再使用，现在用模型分配里的生图提示词。需要原来那个服务的话，请在「渠道与密钥」里添加一个渠道。</p>
              <button type="button" onClick={() => {
                try { localStorage.setItem(legacyTextNotice, '1'); setAcknowledged(true); } catch { setNotice('无法保存确认，请检查本地存储权限。'); }
              }}>知道了</button></div>}
  </>;
  return (
    <div className="image-tools">
      <label className="image-check">
        <input
          type="checkbox"
          checked={pendingEnabled ?? c.enabled}
          disabled={pendingEnabled !== undefined}
          onChange={(e) => {
            const enabled = e.target.checked;
            setPendingEnabled(enabled);
            void persist(editor.saved, { ...editor.saved, enabled }).finally(() =>
              setPendingEnabled(undefined),
            );
          }}
        />
        启用文生图
      </label>
      {!c.enabled && c.textModel && !acknowledged && converterRoute}
      {c.enabled && (
        <>
          <button onClick={() => setGallery(true)}>图片管理器</button>
          <fieldset>
            <legend>图片接口</legend>
            <label>
              后端
              <select value={b} onChange={(e) => set({ ...c, backend: e.target.value as Backend })}>
                {Object.entries(backendNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API 基础地址
              <input
                value={p.base}
                placeholder={
                  b === 'openai'
                    ? 'https://api.openai.com/v1'
                    : b === 'novelai'
                      ? 'https://image.novelai.net'
                      : b === 'sd'
                        ? 'http://127.0.0.1:7860'
                        : 'http://127.0.0.1:8188'
                }
                onChange={(e) => setP({ base: e.target.value })}
              />
            </label>
            <label>
              生成路径
              <input value={p.path} placeholder={paths[b]} onChange={(e) => setP({ path: e.target.value })} />
            </label>
            <KeyField kind={b} base={p.base} />
            {b === 'comfy' ? (
              <label>
                ComfyUI API 工作流 JSON
                <textarea value={p.workflow} onChange={(e) => setP({ workflow: e.target.value })} />
              </label>
            ) : (
              <label>
                图片模型
                <input
                  list="image-models"
                  value={p.model}
                  onChange={(e) => setP({ model: e.target.value })}
                />
                <datalist id="image-models">
                  {modelChoices[b].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </datalist>
              </label>
            )}
            <label>
              图片尺寸
              <input list="image-sizes" value={p.size} onChange={(e) => setP({ size: e.target.value })} />
              <datalist id="image-sizes">
                {[
                  ...new Set(
                    [...常用文生图尺寸选项, ...自动场景竖屏尺寸选项, ...自动场景横屏尺寸选项]
                      .map((o) => o.value)
                      .concat('1536x1024'),
                  ),
                ].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </datalist>
            </label>
            {b !== 'openai' && (
              <details>
                <summary>采样参数</summary>
                {(['steps', 'cfg', 'seed'] as const).map((k) => (
                  <label key={k}>
                    {{ steps: '步数', cfg: 'CFG 强度', seed: '随机种子（-1 随机）' }[k]}
                    <input
                      type="number"
                      value={p[k]}
                      onChange={(e) => setP({ [k]: Number(e.target.value) })}
                    />
                  </label>
                ))}
                <label>
                  采样器
                  <input value={p.sampler} onChange={(e) => setP({ sampler: e.target.value })} />
                </label>
                <label>
                  调度器 / 噪声计划
                  <input value={p.scheduler} onChange={(e) => setP({ scheduler: e.target.value })} />
                </label>
              </details>
            )}
            <button
              onClick={() => {
                setNotice('正在查询接口');
                void probe(c, AbortSignal.timeout(15000)).then(
                  () => setNotice('已读取接口信息，未提交生图请求'),
                  (e) => setNotice(e instanceof Error ? e.message : '接口查询失败'),
                );
              }}
            >
              测试连接（只读）
            </button>
          </fieldset>
          <details>
            <summary>模型预设</summary>
            <label>
              预设名称
              <input maxLength={80} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            </label>
            <button
              disabled={!presetName.trim() || c.presets.length >= 24}
              onClick={() => {
                const name = presetName.trim();
                set({
                  ...c,
                  presets: [
                    ...c.presets.filter((x) => x.name !== name),
                    { name, backend: b, connection: { ...p } },
                  ],
                });
                setPresetName('');
              }}
            >
              收录当前接口参数
            </button>
            {c.presets.map((x) => (
              <div key={x.name} className="image-actions">
                <button
                  onClick={() =>
                    set({
                      ...c,
                      backend: x.backend,
                      connections: { ...c.connections, [x.backend]: x.connection },
                    })
                  }
                >
                  应用 {x.name}
                </button>
                <button
                  aria-label={'删除预设 ' + x.name}
                  onClick={() => set({ ...c, presets: c.presets.filter((v) => v.name !== x.name) })}
                >
                  删除
                </button>
              </div>
            ))}
          </details>
          <label>
            画风
            <input
              list="image-styles"
              value={c.style}
              onChange={(e) => set({ ...c, style: e.target.value })}
            />
            <datalist id="image-styles">
              {[...new Set(['纪实摄影', '电影剧照', '水彩插画', ...c.styles])].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </datalist>
          </label>
          <div className="image-actions">
            <button
              disabled={!c.style.trim() || c.styles.includes(c.style.trim()) || c.styles.length >= 24}
              onClick={() => set({ ...c, styles: [...c.styles, c.style.trim()] })}
            >
              收录自定义画风
            </button>
            {c.styles.includes(c.style) && (
              <button onClick={() => set({ ...c, styles: c.styles.filter((s) => s !== c.style) })}>
                移除画风预设
              </button>
            )}
          </div>
          <label>
            附加正向提示词
            <textarea value={c.positive} onChange={(e) => set({ ...c, positive: e.target.value })} />
          </label>
          <label>
            负向提示词
            <textarea value={c.negative} onChange={(e) => set({ ...c, negative: e.target.value })} />
          </label>
          <fieldset>
            <legend>词组转化器与人物锚点</legend>
            <label className="image-check">
              <input
                type="checkbox"
                checked={c.convert}
                onChange={(e) => set({ ...c, convert: e.target.checked })}
              />
              生成前调用文本模型
            </label>
            {converterRoute}
            <details>
              <summary>转换提示词</summary>
              {(Object.keys(templates) as (keyof typeof templates)[]).map((k) => (
                <label key={k}>
                  {{ home: '居家照', person: '人物', story: '剧情', place: '地点', item: '物品' }[k]}
                  <textarea
                    value={c.templates[k]}
                    onChange={(e) => set({ ...c, templates: { ...c.templates, [k]: e.target.value } })}
                  />
                </label>
              ))}
              <button onClick={() => set({ ...c, templates: defaults.templates })}>恢复默认模板</button>
            </details>
          </fieldset>
          <fieldset>
            <legend>结算后自动生图</legend>
            <small>每个新任务可产生 1 次图片费用；开启转化器另有 1 次文本费用。失败后由玩家手动重绘。</small>
            {(Object.keys(autoLabels) as (keyof typeof autoLabels)[]).map((k) => (
              <label key={k} className="image-check">
                <input
                  type="checkbox"
                  checked={c.auto[k]}
                  onChange={(e) => set({ ...c, auto: { ...c.auto, [k]: e.target.checked } })}
                />
                {autoLabels[k]}
              </label>
            ))}
          </fieldset>
          <label className="image-check">
            <input
              type="checkbox"
              checked={c.includeImages}
              onChange={(e) => set({ ...c, includeImages: e.target.checked })}
            />
            普通存档备份包含图片（取消可导出轻量备份）
          </label>
          {editor.conflicts.length > 0 && (
            <div role="alert">
              <p>其他页面也修改了以下设置。请逐项选择要保留的值，再保存设置。</p>
              {editor.conflicts.map(({ path, local, saved }) => (
                <fieldset key={path}>
                  <legend>{path}</legend>
                  <button
                    onClick={() =>
                      setEditor(reconcileConfig(editor.base, c, editor.saved, { path, take: 'local' }))
                    }
                  >
                    保留本页的冲突值
                  </button>
                  <small style={{ overflowWrap: 'anywhere' }}>{conflictPreview(local)}</small>
                  <button
                    onClick={() =>
                      setEditor(reconcileConfig(editor.base, c, editor.saved, { path, take: 'saved' }))
                    }
                  >
                    采用其他页面的冲突值
                  </button>
                  <small style={{ overflowWrap: 'anywhere' }}>{conflictPreview(saved)}</small>
                </fieldset>
              ))}
            </div>
          )}
          <button disabled={editor.conflicts.length > 0} onClick={save}>
            保存文生图设置
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {gallery && c.enabled && (
        <Dialog title="图片管理器" onClose={() => setGallery(false)}>
          {active ? <Gallery view={active} /> : <SavedGallery repo={repository} />}
        </Dialog>
      )}
    </div>
  );
}
