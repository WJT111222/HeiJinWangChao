import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AiConfigSchema,
  defaultAiConfig,
  defaultUrls,
  newChannel,
  readAiConfig,
  removeChannel,
  saveAiConfig,
} from '../../services/ai/configuration';
import type { AiConfig, AiTask, Channel } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { channelSnapshot } from '../../services/ai/snapshot';
import { AiClient } from '../../services/ai/client';
import { safeAiError } from '../../services/ai/errors';
import { ThemedSelect } from '../components/ThemedSelect';
import { ModelCatalog } from './modelCatalog';
import { ModelPicker } from './ModelPicker';
import { OutputTokenLimit } from './OutputTokenLimit';

const stages: [AiTask, string][] = [
  ['story', '正文生成'],
  ['variables', '变量管理'],
  ['world', '动态世界'],
  ['memory', '记忆维护'],
];
function initial() {
  try {
    return {
      config: readAiConfig(localStorage),
      vault: new CredentialVault(sessionStorage, localStorage),
      notice: '',
    };
  } catch {
    return {
      config: defaultAiConfig(),
      vault: undefined,
      notice: 'AI 配置或浏览器存储无法读取；原始数据未被覆盖。',
    };
  }
}
export function AiConnections({ timeoutSeconds }: { timeoutSeconds: number }) {
  const [start] = useState(initial);
  const [config, setConfig] = useState(start.config);
  const [selectedId, setSelectedId] = useState(start.config.channels[0]?.id ?? '');
  const [key, setKey] = useState(() => {
    try {
      return start.vault?.get(start.config.channels[0]?.id ?? '') ?? '';
    } catch {
      return '';
    }
  });
  const [remember, setRemember] = useState(() => {
    try {
      return start.vault?.remembered(start.config.channels[0]?.id ?? '') ?? false;
    } catch {
      return false;
    }
  });
  const [dirty, setDirty] = useState(false);
  const [catalog] = useState(() => new ModelCatalog());
  const lists = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const saved = useRef(start.config);
  const [notice, setNotice] = useState(start.notice);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      active.current?.abort();
      catalog.dispose();
      active.current = undefined;
    },
    [catalog],
  );
  const channel = config.channels.find((c) => c.id === selectedId);
  function update(next: AiConfig) {
    setConfig(next);
    setDirty(true);
    setNotice('有尚未保存的 AI 配置。');
  }
  function patch(values: Partial<Channel>) {
    update({
      ...config,
      channels: config.channels.map((c) => (c.id === selectedId ? { ...c, ...values } : c)),
    });
  }
  function select(id: string) {
    if (dirty) {
      setNotice('请先保存当前配置，再切换渠道。');
      return;
    }
    try {
      setKey(start.vault?.get(id) ?? '');
      setRemember(start.vault?.remembered(id) ?? false);
      setSelectedId(id);
      setNotice('');
      setDeleting(false);
    } catch {
      setNotice('凭证无法读取，请检查浏览器存储权限。');
    }
  }
  function save() {
    const checked = AiConfigSchema.safeParse(config);
    if (!checked.success) {
      setNotice(
        '配置无效：请核对名称、HTTPS 地址、模型 ID、路由和生成参数；地址不能含密钥或查询参数。',
      );
      return;
    }
    try {
      if (!start.vault) throw new Error();
      // 配置不含密钥；凭证失败时保持未保存提示，不伪造连接成功。
      if (channel) start.vault.set(channel.id, key, remember);
      saveAiConfig(localStorage, checked.data);
      setConfig(checked.data);
      setDirty(false);
      saved.current = checked.data;
      setNotice('AI 配置已保存；模型列表会自动获取，尚未发起生成请求。');
      const ids = new Set([selectedId, ...Object.values(checked.data.routes).flatMap((route) => 'channelId' in route ? [route.channelId] : [])]);
      for (const target of checked.data.channels) if (ids.has(target.id))
        void catalog.load(target, start.vault, timeoutSeconds);
    } catch {
      setNotice('保存失败，请检查浏览器存储权限或空间后重试。');
    }
  }
  function loadModels(id: string, force = false) {
    const target = saved.current.channels.find((item) => item.id === id);
    if (target && start.vault) void catalog.load(target, start.vault, timeoutSeconds, force);
  }
  function canLoad(id: string) {
    const target = saved.current.channels.find((item) => item.id === id), current = config.channels.find((item) => item.id === id);
    try { return Boolean(target && current && target.baseUrl === current.baseUrl && target.protocol === current.protocol
      && start.vault?.get(id) && (id !== selectedId || key.trim() === start.vault.get(id))); }
    catch { return false; }
  }
  async function request() {
    if (!channel || !start.vault || dirty || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setNotice('请求进行中…');
    try {
      const client = new AiClient();
      const target = { ...channel, parameters: { ...channel.parameters,
        maxOutputTokens: Math.min(channel.parameters.maxOutputTokens ?? 32, 32) } };
      const snapshot = channelSnapshot(target, start.vault);
      const result = await client.generate(
        snapshot,
        [{ role: 'user', content: '请仅回复 OK。' }],
        {
          signal: controller.signal,
          timeoutSeconds,
        },
      );
      if (active.current !== controller) return;
      setNotice(
        ['连接测试成功，已收到模型文本响应；游戏回合未运行。', ...result.diagnostics].join(' '),
      );
    } catch (error) {
      if (active.current === controller) setNotice(safeAiError(error).message);
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        setBusy(false);
      }
    }
  }
  function destroy() {
    try {
      const next = removeChannel(config, selectedId);
      saveAiConfig(localStorage, next);
      start.vault?.delete(selectedId);
      saved.current = next;
      catalog.remove(selectedId);
      setConfig(next);
      setDirty(false);
      setSelectedId(next.channels[0]?.id ?? '');
      setKey(start.vault?.get(next.channels[0]?.id ?? '') ?? '');
      setRemember(start.vault?.remembered(next.channels[0]?.id ?? '') ?? false);
      setDeleting(false);
      setNotice('渠道及凭证已删除，引用该渠道的路由已重置。');
    } catch {
      setNotice('删除未完成，请检查浏览器存储权限后重试。');
    }
  }
  return (
    <>
      <p className="notice">
        浏览器会直接连接你填写的服务地址，不使用第三方 CORS
        代理。服务及同源脚本可能接触密钥；浏览器存储不是安全密钥库。默认仅本次会话保留，密钥不进入游戏存档、提示词或诊断详情。
      </p>
      <div className="ai-toolbar">
        <ThemedSelect label="当前渠道" value={selectedId} disabled={busy}
          options={config.channels.length ? config.channels.map((item) => ({ value: item.id, label: item.name || '未命名渠道' })) : [{ value: '', label: '尚无渠道' }]}
          onChange={select} />
        <button
          disabled={busy || dirty}
          onClick={() => {
            const created = newChannel();
            update({
              ...config,
              channels: [...config.channels, created],
              routes: {
                ...config.routes,
                story: config.routes.story.channelId
                  ? config.routes.story
                  : { channelId: created.id, modelId: '' },
              },
            });
            setSelectedId(created.id);
            setKey('');
            setRemember(false);
          }}
        >
          新增渠道
        </button>
      </div>
      <fieldset disabled={!channel || busy}>
        <legend>API 渠道</legend>
        <div className="form-grid">
          <label>
            渠道名称
            <input value={channel?.name ?? ''} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <ThemedSelect label="协议" value={channel?.protocol ?? 'openai'} disabled={!channel || busy}
            options={[{ value: 'openai', label: 'OpenAI 兼容' }, { value: 'gemini', label: '原生 Gemini' }, { value: 'anthropic', label: '原生 Anthropic' }]}
            onChange={(value) => {
              if (value !== 'openai' && value !== 'gemini' && value !== 'anthropic') return;
              patch({ protocol: value, baseUrl: defaultUrls[value], defaultModel: '',
                compatibility: { temperature: true, maxOutputTokens: true, jsonMode: false, cotMode: 'confirmation', cotModels: [] } });
            }} />
          <label className="wide-field">
            API Base URL
            <input
              type="url"
              value={channel?.baseUrl ?? ''}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="填写含版本路径的服务根地址"
            />
          </label>
          <label>
            API 密钥
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <ModelPicker key={selectedId} label="默认" value={channel?.defaultModel ?? ''}
            list={canLoad(selectedId) ? lists[selectedId] : undefined} disabled={!channel || busy} canLoad={canLoad(selectedId)}
            onLoad={(refresh) => loadModels(selectedId, refresh)} onChange={(defaultModel) => patch({ defaultModel })} />
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
              setDirty(true);
            }}
          />
          在本机长期记住密钥（非默认，同源脚本可读取）
        </label>
        <details>
          <summary>生成参数与模型兼容</summary>
          <div className="form-grid">
            <label>
              Temperature（留空使用服务默认）
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={channel?.parameters.temperature ?? ''}
                onChange={(e) =>
                  patch({
                    parameters: {
                      ...channel!.parameters,
                      temperature: e.target.value === '' ? undefined : e.target.valueAsNumber,
                    },
                  })
                }
              />
            </label>
            {channel && <OutputTokenLimit key={channel.id} value={channel.parameters.maxOutputTokens}
              onChange={(maxOutputTokens) => patch({ parameters: { ...channel.parameters, maxOutputTokens } })} />}
          </div>
          <p className="muted">
            按当前渠道与模型的文档声明能力。未支持的可选参数会跳过并提供诊断；Anthropic
            必须提供输出上限。
          </p>
          {(['temperature', 'maxOutputTokens', 'jsonMode'] as const).map((field) => (
            <label className="toggle" key={field}>
              <input
                type="checkbox"
                checked={channel?.compatibility[field] ?? false}
                onChange={(e) =>
                  patch({ compatibility: { ...channel!.compatibility, [field]: e.target.checked } })
                }
              />
              {field === 'jsonMode' ? '支持原生 JSON 模式' : `支持 ${field}`}
            </label>
          ))}
          <ThemedSelect label="COT 协议兼容" value={channel?.compatibility.cotMode ?? 'off'} disabled={!channel || busy}
            options={[{ value: 'off', label: '关闭兼容历史（旧配置保留，不关闭叙事规划）' },
              { value: 'confirmation', label: '完整 assistant 格式确认历史（新渠道默认）' },
              { value: 'prefix', label: '旧 Prefix 配置（降级完整历史，不发送扩展）' }]}
            onChange={(value) => { if (channel && (value === 'off' || value === 'confirmation' || value === 'prefix'))
              patch({ compatibility: { ...channel.compatibility, cotMode: value } }); }} />
          <p className="muted">
            三协议使用完整确认历史并以 user 收尾，不依赖尾部预填充。旧 cotModels 数据保留读取兼容，
            不再作为模型白名单。原生协议按已核实型号或服务能力声明自动请求公开思考摘要，不发送未经确认支持的扩展，
            不额外收费探测；项目叙事规划始终启用。
          </p>
        </details>
      </fieldset>
      <button className="primary" disabled={busy || !start.vault} onClick={save}>
        保存 AI 配置
      </button>
      <p className="field-hint">保存有效渠道后自动获取模型列表；列表请求不会生成内容。测试连接会调用模型，可能产生费用。</p>
      <div className="ai-actions">
        <button
          disabled={!channel || dirty || busy || !start.vault || lists[selectedId]?.status === 'loading'}
          onClick={() => loadModels(selectedId, true)}
        >
          刷新渠道模型列表
        </button>
        <button
          disabled={!channel || dirty || busy || !start.vault}
          onClick={() => void request()}
        >
          测试连接（可能产生费用）
        </button>
        {busy && <button onClick={() => active.current?.abort()}>取消请求</button>}
        <button disabled={!channel || busy || dirty} onClick={() => setDeleting(true)}>
          删除渠道
        </button>
      </div>
      {deleting && (
        <div className="notice" role="alert">
          <p>删除渠道会移除其凭证并重置关联路由。</p>
          <button onClick={destroy}>确认删除渠道</button>
          <button onClick={() => setDeleting(false)}>取消删除</button>
        </div>
      )}
      <fieldset disabled={busy}>
        <legend>三阶段与记忆总结模型路由</legend>
        {stages.map(([stage, label]) => {
          const route = config.routes[stage];
          const follows = 'mode' in route && route.mode === 'follow-story';
          const current = 'channelId' in route ? route : config.routes.story;
          const routeChannel = config.channels.find((item) => item.id === current.channelId);
          const changeRoute = (patch: Partial<typeof current>) =>
            update({
              ...config,
              routes: {
                ...config.routes,
                [stage]:
                  stage === 'story'
                    ? { ...current, ...patch }
                    : { mode: 'independent', ...current, ...patch },
              },
            });
          return (
            <section className="card entry" key={stage}>
              <strong>{label}</strong>
              {stage !== 'story' && (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={follows}
                    onChange={(e) =>
                      update({
                        ...config,
                        routes: {
                          ...config.routes,
                          [stage]: e.target.checked
                            ? { mode: 'follow-story' }
                            : {
                                mode: 'independent',
                                channelId: config.routes.story.channelId,
                                modelId: '',
                              },
                        },
                      })
                    }
                  />
                  {label}跟随正文模型
                </label>
              )}
              {follows && <p className="field-hint">继承正文：{routeChannel?.name || '尚未选择渠道'} / {current.modelId || routeChannel?.defaultModel || '尚未选择默认模型'}</p>}
              <ThemedSelect label={`${label}渠道`} disabled={follows} value={current.channelId}
                options={[{ value: '', label: '请选择渠道' }, ...config.channels.map((item) => ({ value: item.id, label: item.name }))]}
                onChange={(channelId) => { changeRoute({ channelId, modelId: '' }); if (canLoad(channelId)) loadModels(channelId); }} />
              <ModelPicker key={`${stage}-${current.channelId}-${follows}`} label={label} value={current.modelId}
                defaultModel={routeChannel?.defaultModel ?? ''} list={canLoad(current.channelId) ? lists[current.channelId] : undefined}
                disabled={follows || !routeChannel} canLoad={canLoad(current.channelId)}
                onLoad={(refresh) => loadModels(current.channelId, refresh)} onChange={(modelId) => changeRoute({ modelId })} />
            </section>
          );
        })}
        <p className="muted">
          请求开始时冻结渠道、模型、参数及凭证。更改配置不影响正在执行的请求，也不改写游戏存档。
        </p>
      </fieldset>
      <div role="status" className="field-hint">
        {notice}
      </div>
    </>
  );
}
