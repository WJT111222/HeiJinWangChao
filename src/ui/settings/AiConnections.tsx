import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AiConfigSchema,
  defaultAiConfig,
  newChannel,
  readAiConfig,
  saveAiConfig,
} from '../../services/ai/configuration';
import type { AiConfig, AiTask, Channel, Protocol } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import type { VaultSnapshot } from '../../services/ai/credentials';
import { channelSnapshot } from '../../services/ai/snapshot';
import { AiClient } from '../../services/ai/client';
import { safeAiError } from '../../services/ai/errors';
import { ThemedSelect } from '../components/ThemedSelect';
import { ModelCatalog } from './modelCatalog';
import { Feedback, useDesktopFeedback } from '../Feedback';
import type { FeedbackLevel } from '../Feedback';
import { Dialog } from '../Dialog';
import { OutputTokenLimit } from './OutputTokenLimit';
import { detectPreset, presetById, presets, protocolNames, validEndpoint } from './aiPresets';
import type { PresetId } from './aiPresets';
import './ai-connections.css';

const stages: [AiTask, string, string][] = [
  ['story', '正文生成', '写剧情，最需要好模型'],
  ['variables', '变量管理', '整理金钱、物品、关系'],
  ['world', '动态世界', '推进你不在场的世界'],
  ['memory', '记忆维护', '定期整理长期记忆'],
];
const short: Record<AiTask, string> = { story: '正文', variables: '变量', world: '动态世界', memory: '记忆' };
type Optional = Exclude<AiTask, 'story'>;
interface Draft { config: AiConfig; keys: Record<string, string>; remember: Record<string, boolean>; presets: Record<string, PresetId | ''> }
type TestState = { status: 'loading' | 'ok' | 'err'; text: string };

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function initial(): { draft: Draft; vault?: CredentialVault; notice: string } {
  try {
    const config = readAiConfig(localStorage);
    const vault = new CredentialVault(sessionStorage, localStorage);
    const keys: Record<string, string> = {}, remember: Record<string, boolean> = {}, chosen: Record<string, PresetId> = {};
    for (const channel of config.channels) {
      keys[channel.id] = vault.get(channel.id);
      // 已有密钥沿用原来的保存方式；还没有密钥的渠道默认记住。
      remember[channel.id] = keys[channel.id] ? vault.remembered(channel.id) : true;
      chosen[channel.id] = detectPreset(channel);
    }
    return { draft: { config, keys, remember, presets: chosen }, vault, notice: '' };
  } catch {
    return { draft: { config: defaultAiConfig(), keys: {}, remember: {}, presets: {} }, notice: 'AI 配置或浏览器存储无法读取；原始数据未被覆盖。' };
  }
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function AiConnections({ timeoutSeconds, onDirtyChange }: { timeoutSeconds: number; onDirtyChange?: (dirty: boolean) => void }) {
  const desktop = useDesktopFeedback();
  const [start] = useState(initial);
  const [saved, setSaved] = useState<Draft>(() => clone(start.draft));
  const [draft, setDraft] = useState<Draft>(() => clone(start.draft));
  const [selectedId, setSelectedId] = useState(start.draft.config.channels[0]?.id ?? '');
  const [editing, setEditing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [urlEditing, setUrlEditing] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<Partial<Record<AiTask, boolean>>>({});
  const [spinStage, setSpinStage] = useState<AiTask>();
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [confirm, setConfirm] = useState<{ kind: 'delete'; id: string } | { kind: 'preset'; id: string; preset: PresetId }>();
  const [secOpen, setSecOpen] = useState(false);
  const [notice, setNoticeText] = useState(start.notice);
  const [noticeLevel, setNoticeLevel] = useState<FeedbackLevel>(start.notice ? 'err' : 'info');
  const [catalog] = useState(() => new ModelCatalog());
  const lists = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const active = useRef<AbortController | undefined>(undefined);
  const { config } = draft;
  const channel = config.channels.find((item) => item.id === selectedId);
  function setNotice(message: string, level: FeedbackLevel = 'err') { setNoticeText(message); setNoticeLevel(level); }

  // —— 未保存修改计数 ——
  const changeCount = useMemo(() => {
    let count = 0;
    const ids = new Set([...saved.config.channels.map((item) => item.id), ...config.channels.map((item) => item.id)]);
    for (const id of ids) {
      const before = saved.config.channels.find((item) => item.id === id), after = config.channels.find((item) => item.id === id);
      if (!before || !after) { count++; continue; }
      for (const field of ['name', 'protocol', 'baseUrl', 'defaultModel', 'parameters', 'compatibility'] as const)
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) count++;
      if ((saved.keys[id] ?? '') !== (draft.keys[id] ?? '')) count++;
      if (Boolean(saved.remember[id]) !== Boolean(draft.remember[id])) count++;
    }
    for (const [stage] of stages) if (JSON.stringify(saved.config.routes[stage]) !== JSON.stringify(config.routes[stage])) count++;
    return count;
  }, [saved, draft, config]);
  const dirty = changeCount > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => () => { active.current?.abort(); catalog.dispose(); }, [catalog]);

  // —— 路由工具 ——
  const routeOf = (stage: AiTask) => {
    const route = config.routes[stage];
    return 'channelId' in route ? route : config.routes.story;
  };
  const follows = (stage: AiTask) => stage !== 'story' && config.routes[stage as Optional].mode === 'follow-story';
  const effectiveModel = (route: { channelId: string; modelId: string }) =>
    route.modelId || config.channels.find((item) => item.id === route.channelId)?.defaultModel || '';
  const usedBy = (id: string) => stages.filter(([stage]) => (follows(stage) ? config.routes.story : routeOf(stage)).channelId === id).map(([stage]) => short[stage]);

  // —— 阻止保存的问题（缺密钥只提醒，不阻止） ——
  const problems = useMemo(() => {
    const list: string[] = [];
    for (const item of config.channels) {
      const name = item.name.trim() || '未命名渠道';
      if (!draft.presets[item.id]) list.push(`「${name}」还没选服务商`);
      else if (!validEndpoint(item.baseUrl)) list.push(`「${name}」的服务地址无效`);
      if (!item.name.trim()) list.push('渠道名称不能为空');
    }
    const story = config.routes.story;
    if (config.channels.length && (!story.channelId || !effectiveModel(story))) list.push('正文生成还没选模型');
    for (const [stage, label] of stages.slice(1)) {
      const route = config.routes[stage as Optional];
      if (route.mode === 'independent' && (!route.channelId || !effectiveModel(route))) list.push(`${label}选了「单独指定」但还没选模型`);
    }
    return list;
  }, [config, draft.presets]);
  const warnings = config.channels.filter((item) => draft.presets[item.id] && !draft.keys[item.id]?.trim()).map((item) => `「${item.name}」还没填密钥`);

  // —— 修改草稿 ——
  function update(mutator: (next: Draft) => void) {
    setDraft((current) => { const next = clone(current); mutator(next); return next; });
    if (noticeLevel === 'ok') setNotice('', 'info');
  }
  function patchChannel(id: string, values: Partial<Channel>) {
    update((next) => { next.config.channels = next.config.channels.map((item) => item.id === id ? { ...item, ...values } : item); });
  }
  function draftVault(id: string) {
    const vault = new CredentialVault(memoryStore(), memoryStore());
    vault.set(id, draft.keys[id] ?? '');
    return vault;
  }
  function canLoad(id: string) {
    const target = config.channels.find((item) => item.id === id);
    return Boolean(target && draft.presets[id] && validEndpoint(target.baseUrl) && draft.keys[id]?.trim());
  }
  function loadModels(id: string, force = false, stage?: AiTask) {
    const target = config.channels.find((item) => item.id === id);
    if (!target || !canLoad(id)) return;
    if (stage) setSpinStage(stage);
    void catalog.load(target, draftVault(id), timeoutSeconds, force).finally(() => setSpinStage((current) => current === stage ? undefined : current));
  }
  // 编辑地址或密钥后自动获取模型列表（只读列表，不产生费用）。
  const selectedKey = channel ? `${channel.protocol}|${channel.baseUrl}|${draft.keys[channel.id] ?? ''}|${draft.presets[channel.id] ?? ''}` : '';
  const savedKey = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!channel) return;
    const previous = savedKey.current[channel.id];
    savedKey.current[channel.id] = selectedKey;
    if (previous === undefined || previous === selectedKey) return;
    catalog.remove(channel.id);
    if (!canLoad(channel.id)) return;
    const timer = setTimeout(() => loadModels(channel.id), 600);
    return () => clearTimeout(timer);
  }, [selectedKey]);

  // 打开设置本身不联网：只有改了地址或密钥、点开模型下拉、或点「获取模型」「刷新」时才读取模型列表。

  function addChannel() {
    const created = { ...newChannel(), name: '新渠道', baseUrl: '' };
    update((next) => {
      next.config.channels.push(created);
      next.keys[created.id] = ''; next.remember[created.id] = true; next.presets[created.id] = '';
      if (!next.config.routes.story.channelId) next.config.routes.story = { channelId: created.id, modelId: '' };
    });
    setSelectedId(created.id); setEditing(true); setShowKey(false);
  }
  function applyPreset(id: string, preset: PresetId) {
    const target = config.channels.find((item) => item.id === id);
    if (!target) return;
    const before = draft.presets[id], chosen = presetById(preset), previous = before ? presetById(before) : undefined;
    const autoName = !target.name.trim() || target.name === '新渠道' || (previous && target.name === previous.name);
    const baseUrl = preset === 'compat' ? (before === 'compat' ? target.baseUrl : '') : chosen.url;
    update((next) => {
      next.presets[id] = preset;
      next.config.channels = next.config.channels.map((item) => item.id !== id ? item : {
        ...item, protocol: chosen.protocol, baseUrl, defaultModel: '', ...(autoName ? { name: chosen.name } : {}),
        ...(item.protocol !== chosen.protocol ? { compatibility: { temperature: true, maxOutputTokens: true, jsonMode: false, cotMode: 'confirmation' as const, cotModels: [] } } : {}),
      });
      // 换了服务商，原先在这个渠道上选的模型不再适用。
      for (const [stage] of stages) {
        const route = next.config.routes[stage];
        if ('channelId' in route && route.channelId === id) route.modelId = '';
        // 跟随正文时保留着的「上次单独指定」也一样：只清掉指向这个渠道的旧模型，渠道本身和其他阶段不动。
        if ('independent' in route && route.independent?.channelId === id) route.independent = { channelId: id, modelId: '' };
      }
    });
    catalog.remove(id);
    setTests((current) => { const next = { ...current }; delete next[id]; return next; });
    setUrlEditing((current) => ({ ...current, [id]: false }));
  }
  function choosePreset(id: string, preset: PresetId) {
    const target = config.channels.find((item) => item.id === id);
    if (!target || draft.presets[id] === preset) return;
    if (draft.presets[id] === 'compat' && target.baseUrl.trim() && preset !== 'compat') { setConfirm({ kind: 'preset', id, preset }); return; }
    applyPreset(id, preset);
  }
  function removeDraftChannel(id: string) {
    update((next) => {
      next.config.channels = next.config.channels.filter((item) => item.id !== id);
      delete next.keys[id]; delete next.remember[id]; delete next.presets[id];
      if (next.config.routes.story.channelId === id) next.config.routes.story = { channelId: '', modelId: '' };
      for (const [stage] of stages.slice(1)) {
        const route = next.config.routes[stage as Optional];
        const uses = route.mode === 'independent' ? route.channelId === id : route.independent?.channelId === id;
        if (uses) next.config.routes[stage as Optional] = { mode: 'follow-story' };
      }
    });
    const rest = config.channels.filter((item) => item.id !== id);
    setSelectedId(rest[0]?.id ?? ''); setEditing(false);
  }
  function setRoute(stage: AiTask, values: { channelId?: string; modelId?: string }) {
    update((next) => {
      if (stage === 'story') next.config.routes.story = { ...next.config.routes.story, ...values };
      else {
        const route = next.config.routes[stage as Optional];
        const current = route.mode === 'independent' ? route : route.independent ?? { channelId: '', modelId: '' };
        next.config.routes[stage as Optional] = { mode: 'independent', channelId: current.channelId, modelId: current.modelId, ...values };
      }
    });
  }
  function setFollow(stage: Optional, follow: boolean) {
    update((next) => {
      const route = next.config.routes[stage];
      if ((route.mode === 'follow-story') === follow) return;
      if (follow) next.config.routes[stage] = route.mode === 'independent'
        ? { mode: 'follow-story', ...(route.channelId ? { independent: { channelId: route.channelId, modelId: route.modelId } } : {}) }
        : route;
      else {
        // 恢复上次单独指定的渠道和模型；没有的话留空，让玩家先选渠道再选模型，不默默沿用正文的。
        const kept = route.mode === 'follow-story' ? route.independent : undefined;
        next.config.routes[stage] = { mode: 'independent', ...(kept?.channelId ? kept : { channelId: '', modelId: '' }) };
      }
    });
  }

  // —— 保存 / 放弃 ——
  function save() {
    if (problems.length) { setNotice(problems[0], 'warn'); return; }
    const checked = AiConfigSchema.safeParse(config);
    if (!checked.success) { setNotice('配置无效：请核对名称、HTTPS 地址、模型 ID 和生成参数；地址不能含密钥或查询参数。'); return; }
    const vault = start.vault;
    if (!vault) { setNotice('保存失败，请检查浏览器存储权限或空间后重试。'); return; }
    const removed = saved.config.channels.filter((item) => !config.channels.some((next) => next.id === item.id)).map((item) => item.id);
    // 快照只在本次调用的内存中持有；读取失败时，不开始任何密钥或配置写入。
    let before: VaultSnapshot | undefined;
    try {
      before = vault.snapshot([...removed, ...checked.data.channels.map((item) => item.id)]);
      for (const id of removed) vault.delete(id);
      for (const item of checked.data.channels) vault.set(item.id, draft.keys[item.id] ?? '', draft.remember[item.id] ?? true);
      saveAiConfig(localStorage, checked.data);
    } catch {
      if (!before) {
        setNotice('保存失败：无法读取密钥存储，尚未写入密钥或配置。请检查浏览器存储权限后重试。');
        return;
      }
      const result = vault.restore(before);
      if (result.restored) setNotice('保存失败，请检查浏览器存储权限或空间后重试。已核对密钥值和存放位置与保存前一致，修改仍未保存。');
      else {
        const affected = result.failedIds.map(id => saved.config.channels.find(item => item.id === id)?.name
          || checked.data.channels.find(item => item.id === id)?.name || '未命名渠道');
        setNotice(`保存失败：密钥未能完全恢复或核验，请检查密钥存储状态（${affected.join('、')}）。保存未完成，编辑仍未保存。`);
      }
      return;
    }
    for (const id of removed) catalog.remove(id);
    const next = { ...clone(draft), config: checked.data };
    setSaved(next); setDraft(clone(next));
    setNotice(warnings.length ? `已保存。${warnings[0]}，这个渠道暂时不能使用。` : '已保存，下一次生成开始生效。', warnings.length ? 'warn' : 'ok');
  }
  function discard() {
    setDraft(clone(saved));
    if (!saved.config.channels.some((item) => item.id === selectedId)) { setSelectedId(saved.config.channels[0]?.id ?? ''); setEditing(false); }
    setNotice('已放弃未保存的修改。', 'info');
  }

  // —— 测试回复（真实调用一次模型） ——
  async function testReply(id: string) {
    const target = config.channels.find((item) => item.id === id);
    if (!target || active.current) return;
    const routed = stages.map(([stage]) => (follows(stage) ? config.routes.story : routeOf(stage))).find((route) => route.channelId === id && effectiveModel(route));
    const model = (routed && effectiveModel(routed)) || target.defaultModel || lists[id]?.models[0] || '';
    if (!model) { setTests((current) => ({ ...current, [id]: { status: 'err', text: '还没有可用的模型：先让模型列表出现，或在上方为某个阶段选好模型。' } })); return; }
    const controller = new AbortController();
    active.current = controller;
    setTests((current) => ({ ...current, [id]: { status: 'loading', text: `正在用 ${model} 发一条测试消息…` } }));
    try {
      const probe = { ...target, defaultModel: model, parameters: { ...target.parameters, maxOutputTokens: Math.min(target.parameters.maxOutputTokens ?? 32, 32) } };
      const result = await new AiClient().generate(channelSnapshot(probe, draftVault(id)), [{ role: 'user', content: '请仅回复 OK。' }], { signal: controller.signal, timeoutSeconds });
      if (active.current !== controller) return;
      setTests((current) => ({ ...current, [id]: { status: 'ok', text: [`用 ${model} 收到了回复，游戏回合未运行。`, ...result.diagnostics].join(' ') } }));
    } catch (error) {
      if (active.current === controller) setTests((current) => ({ ...current, [id]: { status: 'err', text: safeAiError(error).message } }));
    } finally {
      if (active.current === controller) active.current = undefined;
    }
  }

  // —— 渲染 ——
  // 列表错误信息较长（含尝试过的地址等），卡片里只显示原因，完整内容放在悬停提示里。
  const brief = (message: string) => message.replace(/^本次获取失败：(保留的错误（可能来自此前候选）：)?/, '').split(' 最后尝试')[0];
  function channelStatus(id: string): { tone: 'ok' | 'err' | 'loading' | 'idle'; title: string; text: string; detail?: string } {
    const test = tests[id], list = lists[id];
    if (test?.status === 'loading') return { tone: 'loading', title: '正在测试…', text: test.text };
    if (list?.status === 'loading') return { tone: 'loading', title: '正在连接…', text: '正在获取模型列表（不产生费用）…' };
    if (test?.status === 'err') return { tone: 'err', title: '测试失败', text: test.text };
    if (list?.status === 'error') return { tone: 'err', title: '连接失败', text: brief(list.message), detail: list.message };
    if (test?.status === 'ok') return { tone: 'ok', title: '连接正常', text: test.text };
    if (list && (list.status === 'ready' || list.status === 'empty')) return { tone: 'ok', title: '连接正常', text: list.message };
    if (!draft.presets[id]) return { tone: 'idle', title: '未完成', text: '先选一个服务商。' };
    if (!draft.keys[id]?.trim()) return { tone: 'idle', title: '尚未连接', text: '粘贴密钥后会自动获取模型（不产生费用）。' };
    return { tone: 'idle', title: '尚未检查连接', text: '点「获取模型」检查连接并读取模型列表（不产生费用）。' };
  }
  const listCount = (id: string) => lists[id]?.models.length ?? 0;

  function stageRow([stage, label, hint]: [AiTask, string, string]) {
    const follow = follows(stage);
    const route = follow ? config.routes.story : routeOf(stage);
    const routeChannel = config.channels.find((item) => item.id === route.channelId);
    const model = effectiveModel(route);
    const list = routeChannel ? lists[routeChannel.id] : undefined;
    const loading = list?.status === 'loading';
    const options = (list?.models ?? []).map((item) => ({ value: item, label: item }));
    if (model && !options.some((option) => option.value === model)) options.unshift({ value: model, label: list?.models.length ? `${model}（手动）` : model });
    return <div className={`ai-use ${follow ? 'is-follow' : ''}`} key={stage}>
      <div className="ai-use-name"><strong>{label}</strong><small>{hint}</small></div>
      {stage === 'story' ? <div className="ai-use-seg" /> : <div className="ai-seg" role="group" aria-label={`${label}模型来源`}>
        <button type="button" aria-pressed={follow} onClick={() => setFollow(stage as Optional, true)}>跟随正文</button>
        <button type="button" aria-pressed={!follow} onClick={() => setFollow(stage as Optional, false)}>单独指定</button>
      </div>}
      {follow ? <p className="ai-inherit">同正文 · {routeChannel?.name || '未设置'} / {model || '未选模型'}</p> : <div className="ai-route-pick">
        <div className="ai-route-channel">
          <ThemedSelect label={`${label}渠道`} value={route.channelId}
            options={[{ value: '', label: '① 选择渠道' }, ...config.channels.map((item) => ({ value: item.id, label: `${item.name || '未命名渠道'}` }))]}
            onChange={(channelId) => { if (channelId !== route.channelId) setRoute(stage, { channelId, modelId: '' }); if (channelId && !lists[channelId]) loadModels(channelId, false, stage); }} />
        </div>
        <div className={`ai-route-model ${routeChannel && !model ? 'is-missing' : ''}`}>
          <ThemedSelect label={`${label}模型`} value={model} searchable disabled={!routeChannel}
            options={options.length ? options : [{ value: '', label: routeChannel ? '② 选择模型' : '先选渠道' }]}
            onOpen={() => { if (routeChannel && !list) loadModels(routeChannel.id, false, stage); }}
            onChange={(modelId) => { if (modelId) setRoute(stage, { modelId }); }} />
        </div>
        <button type="button" className={`ai-refresh ${loading && spinStage === stage ? 'is-spinning' : ''}`} aria-label={`刷新${label}模型`}
          title="刷新这个渠道的模型列表（不产生费用）" disabled={!routeChannel || loading || !canLoad(routeChannel.id)}
          onClick={() => routeChannel && loadModels(routeChannel.id, true, stage)}>↻</button>
        <div className="ai-route-foot">
          {routeChannel && !canLoad(routeChannel.id) && <span className="ai-hint warn">这个渠道还没填好地址或密钥，先在下方补全。</span>}
          {routeChannel && list?.status === 'error' && <span className="ai-hint err" role="status">{list.message}</span>}
          <button type="button" className="ai-link" disabled={!routeChannel} aria-expanded={Boolean(manual[stage])}
            onClick={() => setManual((current) => ({ ...current, [stage]: !current[stage] }))}>列表里没有？手动填写{label}模型 ID</button>
          {manual[stage] && routeChannel && <input className="ai-manual" aria-label={`${label}模型 ID`} value={route.modelId} spellCheck={false}
            placeholder="例如 deepseek-chat" onChange={(event) => setRoute(stage, { modelId: event.target.value.trim() })} />}
        </div>
      </div>}
    </div>;
  }

  function editor() {
    if (!channel) return <section className="ai-card ai-editor"><p className="ai-hint">还没有渠道。点「＋ 添加渠道」开始。</p></section>;
    const preset = draft.presets[channel.id];
    const chosen = preset ? presetById(preset) : undefined;
    const status = channelStatus(channel.id);
    const locked = Boolean(chosen?.official) && !urlEditing[channel.id];
    const urlOk = validEndpoint(channel.baseUrl);
    return <section className="ai-card ai-editor" aria-label={`编辑渠道：${channel.name || '未命名渠道'}`}>
      {!desktop && <button type="button" className="ai-back" onClick={() => setEditing(false)}>‹ 返回渠道列表</button>}
      <div className="ai-ed-hd">
        <input className="ai-name" aria-label="渠道名称" value={channel.name} onChange={(event) => patchChannel(channel.id, { name: event.target.value })} />
        <button type="button" className="ai-del" onClick={() => setConfirm({ kind: 'delete', id: channel.id })}>删除渠道</button>
      </div>
      <div className="ai-lbl">服务商 <em>选好后地址和接口格式自动填写</em></div>
      <div className="ai-presets" role="group" aria-label="服务商">
        {presets.map((item) => <button type="button" key={item.id} className="ai-preset" aria-pressed={preset === item.id} aria-label={item.label} title={`${item.label}（${item.sub}）`}
          onClick={() => choosePreset(channel.id, item.id)}><b>{item.label}</b>{item.sub}</button>)}
      </div>
      {!preset ? <p className="ai-first">先选一个服务商。用中转站或其他第三方服务，选「OpenAI 兼容」。</p> : <>
        <div className="ai-grid2">
          <div>
            <div className="ai-lbl">服务地址</div>
            <div className={`ai-field ${channel.baseUrl && !urlOk ? 'is-bad' : ''}`}>
              <input aria-label="服务地址" type="url" value={channel.baseUrl} readOnly={locked} spellCheck={false}
                placeholder={preset === 'compat' ? 'https://…/v1' : chosen?.url} onChange={(event) => patchChannel(channel.id, { baseUrl: event.target.value.trim() })} />
            </div>
            {!channel.baseUrl ? <p className="ai-hint warn">填写服务商提供的地址，一般以 /v1 结尾。</p>
              : !urlOk ? <p className="ai-hint err">地址需要以 https:// 开头（本机地址可以用 http://localhost），不能带「?」后面的参数。</p>
              : chosen?.official ? (locked ? <p className="ai-hint">官方地址已自动填写 · <button type="button" className="ai-link" onClick={() => setUrlEditing((current) => ({ ...current, [channel.id]: true }))}>需要改地址？</button></p>
                : <p className="ai-hint">正在使用自定义地址。</p>)
              : preset === 'compat' ? <div className="ai-hint ai-format"><ThemedSelect label="接口格式" value={channel.protocol}
                  options={(['openai', 'anthropic', 'gemini', 'deepseek'] as Protocol[]).map((value) => ({ value, label: protocolNames[value] }))}
                  onChange={(value) => { if (value !== channel.protocol) patchChannel(channel.id, { protocol: value as Protocol, defaultModel: '',
                    compatibility: { temperature: true, maxOutputTokens: true, jsonMode: false, cotMode: 'confirmation', cotModels: [] } }); }} />
                  <span>服务商说明里没提就保持「OpenAI 兼容」</span></div>
              : <p className="ai-hint">本机运行的模型服务（如 Ollama、LM Studio）。</p>}
          </div>
          <div>
            <div className="ai-lbl">API 密钥</div>
            <div className="ai-field">
              <input aria-label="API 密钥" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={draft.keys[channel.id] ?? ''}
                placeholder={preset === 'local' ? '本地服务一般不校验，可填 ollama' : '粘贴密钥后自动获取模型'} onChange={(event) => { const value = event.target.value; update((next) => { next.keys[channel.id] = value.trim(); }); }} />
              <button type="button" className="ai-show" onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
            </div>
            {preset === 'local' && <p className="ai-hint">本地服务一般不需要真实密钥，填一个占位值（如 ollama）就能连接，它只会发给你本机的服务。</p>}
            <label className="ai-switch">
              <input type="checkbox" role="switch" checked={draft.remember[channel.id] ?? true}
                onChange={(event) => { const checked = event.target.checked; update((next) => { next.remember[channel.id] = checked; }); }} />
              <span className="ai-sw" aria-hidden="true" />记住密钥
            </label>
            <p className="ai-hint">{draft.remember[channel.id] ?? true ? '关闭浏览器后仍保留。公共电脑请关闭。' : '只在本次打开期间保留，关闭浏览器后需要重新填写。'}</p>
          </div>
        </div>
        <div className={`ai-connect is-${status.tone}`} role="status">
          <span className="ai-dot" aria-hidden="true" />
          <div className="ai-connect-txt"><b>{status.title}</b><span>{status.text}</span>
            {status.detail && status.detail !== status.text && <details className="ai-connect-more"><summary>详细信息</summary><p>{status.detail}</p></details>}</div>
          <div className="ai-connect-acts">
            {status.tone !== 'loading' && <button type="button" className="ai-btn" disabled={!canLoad(channel.id)} onClick={() => loadModels(channel.id, true)}>{lists[channel.id] ? '重新获取模型' : '获取模型'}</button>}
            {tests[channel.id]?.status === 'loading'
              ? <button type="button" className="ai-btn" onClick={() => { active.current?.abort(); active.current = undefined; setTests((current) => ({ ...current, [channel.id]: { status: 'err', text: '已取消测试，未提交任何游戏状态。' } })); }}>取消</button>
              : <button type="button" className="ai-btn" disabled={!canLoad(channel.id) || Boolean(active.current)} title="会真实调用一次模型，可能产生少量费用"
                onClick={() => void testReply(channel.id)}>测试回复（可能产生少量费用）</button>}
          </div>
        </div>
        <div className="ai-lbl">最大输出 <em>每次回复最多多少 Token；推理模型的思考也算在内，正文被截断时调大</em></div>
        <OutputTokenLimit key={channel.id} value={channel.parameters.maxOutputTokens}
          onChange={(maxOutputTokens) => patchChannel(channel.id, { parameters: { ...channel.parameters, maxOutputTokens } })} />
        {(channel.protocol === 'anthropic') && !channel.compatibility.maxOutputTokens && <p className="ai-hint warn">Claude 格式必须发送最大输出上限，请在高级设置里打开「发送最大输出上限」。</p>}
        <details className="ai-adv">
          <summary>高级设置（一般不用改）</summary>
          <div className="ai-adv-grid">
            <div>
              <div className="ai-lbl">Temperature <em>留空用服务默认，0～2</em></div>
              <input className="ai-temp" aria-label="Temperature" type="number" step="0.1" min="0" max="2" placeholder="服务默认"
                value={channel.parameters.temperature ?? ''} onChange={(event) => patchChannel(channel.id, { parameters: { ...channel.parameters,
                  temperature: event.target.value === '' ? undefined : event.target.valueAsNumber } })} />
            </div>
            <div className="ai-adv-toggles">
              {([['maxOutputTokens', '发送最大输出上限'], ['temperature', '发送 Temperature'], ['jsonMode', '使用原生 JSON 模式（动态世界、记忆）']] as const).map(([field, text]) =>
                <label className="ai-switch" key={field}>
                  <input type="checkbox" role="switch" checked={channel.compatibility[field]}
                    onChange={(event) => patchChannel(channel.id, { compatibility: { ...channel.compatibility, [field]: event.target.checked } })} />
                  <span className="ai-sw" aria-hidden="true" />{text}
                </label>)}
            </div>
            <div className="ai-adv-wide">
              <div className="ai-lbl">历史消息兼容 <em>个别服务报「消息格式错误」时再改</em></div>
              <div className="ai-chips" role="group" aria-label="历史消息兼容">
                {([['confirmation', '完整确认历史（推荐）'], ['off', '关闭'], ...(channel.compatibility.cotMode === 'prefix' ? [['prefix', '旧 Prefix 配置']] : [])] as [Channel['compatibility']['cotMode'], string][]).map(([value, text]) =>
                  <button type="button" key={value} className="ai-chip" aria-pressed={channel.compatibility.cotMode === value}
                    onClick={() => patchChannel(channel.id, { compatibility: { ...channel.compatibility, cotMode: value } })}>{text}</button>)}
              </div>
              <p className="ai-hint">项目自己的叙事规划始终启用；原生协议只在已确认支持时请求公开的思考摘要，不额外发送探测请求。</p>
            </div>
          </div>
        </details>
      </>}
    </section>;
  }

  const blocked = problems[0];
  const confirmChannel = confirm ? config.channels.find((item) => item.id === confirm.id) : undefined;
  return (
    <div className={`ai-conn ${desktop ? 'is-desktop' : 'is-mobile'} ${!desktop && editing ? 'is-editing' : ''}`}>
      {!(!desktop && editing) && <>
        <p className="ai-lede">游戏直接从浏览器连接你填写的服务，密钥只存在这台设备上，不进存档。{' '}
          <button type="button" className="ai-link" aria-expanded={secOpen} onClick={() => setSecOpen(!secOpen)}>{secOpen ? '收起' : '安全说明'}</button></p>
        {secOpen && <Feedback className="notice ai-sec" level="info" mobileAs="p">
          浏览器会直接连接你填写的服务地址，不使用额外的 CORS 代理；服务方和同一网站的脚本可能接触到密钥。浏览器存储不是安全的密钥库，在公共电脑上请关闭「记住密钥」。密钥不会进入游戏存档、提示词或诊断详情。请求开始时会冻结渠道、模型、参数和密钥，更改配置不影响正在执行的请求。
        </Feedback>}
        <section className="ai-card ai-uses" aria-label="各阶段使用的模型">
          <div className="ai-uses-hd"><h4>各阶段使用的模型</h4><span>先选渠道，再从这个渠道的模型里选；变量、动态世界、记忆默认跟随正文</span></div>
          {stages.map(stageRow)}
        </section>
      </>}
      <div className="ai-chan-wrap">
        {(desktop || !editing) && <section className="ai-chlist" aria-label="API 渠道列表">
          <h4>我的渠道{!desktop && ' · 点开编辑'}</h4>
          {config.channels.map((item) => {
            const status = channelStatus(item.id), used = usedBy(item.id);
            return <button type="button" key={item.id} className="ai-chi" aria-pressed={desktop && selectedId === item.id}
              aria-label={`编辑渠道：${item.name || '未命名渠道'}`} onClick={() => { setSelectedId(item.id); setShowKey(false); setEditing(true); }}>
              <span className="ai-chi-t"><span className="ai-chi-nm">{item.name || '未命名渠道'}</span>
                {draft.presets[item.id] && <span className="ai-pill">{protocolNames[item.protocol]}</span>}{!desktop && <span className="ai-arrow" aria-hidden="true">›</span>}</span>
              <span className="ai-chi-s"><span className={`ai-dot is-${status.tone}`} aria-hidden="true" />
                {status.tone === 'ok' ? `连接正常${listCount(item.id) ? ` · ${listCount(item.id)} 个模型` : ''}` : status.tone === 'err' ? '连接失败' : status.tone === 'loading' ? '正在连接…'
                  : !draft.presets[item.id] ? '未完成：先选服务商' : !draft.keys[item.id] ? '还没填密钥' : '尚未连接'}</span>
              <span className="ai-chi-s">{used.length ? `用于：${used.join(' · ')}` : '暂未被任何阶段使用'}</span>
            </button>;
          })}
          <button type="button" className="ai-chi ai-add" onClick={addChannel}>＋ 添加渠道</button>
        </section>}
        {(desktop || editing) && editor()}
      </div>
      <div className="ai-save-bar">
        <Feedback role="status" level={notice ? noticeLevel : dirty ? 'warn' : 'info'} className="ai-save-msg" mobileAs="p">
          {notice || (dirty ? `有 ${changeCount} 处修改尚未保存${blocked ? `；${blocked}` : ''}` : desktop ? '设置本身不会发起生成请求。' : '')}
        </Feedback>
        <button type="button" className="ai-btn ghost" disabled={!dirty} onClick={discard}>放弃修改</button>
        <button type="button" className="primary" disabled={!dirty || Boolean(blocked) || !start.vault} title={blocked} onClick={save}>保存 AI 配置</button>
      </div>
      {confirm && confirmChannel && <Dialog small title={confirm.kind === 'delete' ? `删除「${confirmChannel.name || '未命名渠道'}」？` : '替换服务地址？'}
        feedback="warn" seal={confirm.kind === 'delete' ? '删' : '换'} mobileVariant="confirm" onClose={() => setConfirm(undefined)}>
        <p>{confirm.kind === 'delete'
          ? <>{usedBy(confirmChannel.id).length ? `它正被「${usedBy(confirmChannel.id).join('、')}」使用。删除后正文需要重新选择模型，其他阶段改回跟随正文。` : '这个渠道没有被任何阶段使用。'}密钥会一并删除。点「保存 AI 配置」后才真正生效，在那之前可以「放弃修改」。</>
          : '切换到官方服务商会把你填写的地址换成官方地址。'}</p>
        <div className="dialog-actions feedback-dialog-actions">
          <button type="button" onClick={() => setConfirm(undefined)}>取消</button>
          <button type="button" className="feedback-danger" onClick={() => {
            if (confirm.kind === 'delete') removeDraftChannel(confirm.id); else applyPreset(confirm.id, confirm.preset);
            setConfirm(undefined);
          }}>{confirm.kind === 'delete' ? '确认删除渠道' : '替换地址'}</button>
        </div>
      </Dialog>}
    </div>
  );
}
