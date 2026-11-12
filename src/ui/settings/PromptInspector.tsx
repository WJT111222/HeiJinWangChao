import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { promptManifest } from '../../prompts/manifest';
import { moduleActivation, selectPromptModules, comparePromptModes } from '../../prompts/selection';
import {
  browserPromptOrder,
  movePromptOrder,
  projectPromptOrder,
  savePromptOrder,
} from '../../prompts/order';
import { estimateTokens } from '../../prompts/statistics';
import { readPromptResource } from '../../prompts/loader';
import { buildStagePreviews, inspectionStages, previewRoute } from '../../prompts/preview';
import type { StagePreview } from '../../prompts/preview';
import { requestInspections, redactInspection } from '../../services/ai/inspection';
import { browserCredentials } from '../../services/ai/credentials';
import { defaultAiConfig, readAiConfig } from '../../services/ai/configuration';
import type { AiStage, AiTask } from '../../services/ai/configuration';
import { safeAiError } from '../../services/ai/errors';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { loadCompanionProfile } from '../../services/local/companionProfile';
import type { Settings } from './model';
import { ContextInspection, TokenStatistics } from './ContextInspection';
import type { PromptModule } from '../../prompts/manifest';
import './prompt-manager.css';

const stages: Record<AiTask, string> = {
  story: '正文生成',
  variables: '变量管理',
  world: '动态世界',
  memory: '记忆维护（独立任务）',
};
const categories: Record<string, string> = {
  identity: '身份',
  worldbook: '世界书',
  shared: '共享规则',
  narrative_core: '核心叙事',
  planning: '叙事规划',
  writing: '写作规则',
  stage: '阶段模板',
  output: '输出协议',
  variable_group: '变量域',
  memory: '记忆模块',
  compatibility: '兼容模块',
  documentation: '文档',
  example: '示例',
  reference: '参考',
};
/* 列表只做界面分组：manifest 的 category 不变。 */
const groups = [
  { key: 'core', label: '核心设定', categories: ['identity', 'worldbook', 'shared', 'narrative_core'], note: '身份、世界观和每个阶段都会用到的共享规则' },
  { key: 'writing', label: '写作设定', categories: ['writing'], note: '正文怎么写：人称、风格和几项可开关的写法' },
  { key: 'flow', label: '流程与输出', categories: ['planning', 'stage', 'output', 'compatibility'], note: '每一回合的规划、各阶段主提示词和输出格式' },
  { key: 'variables', label: '变量规则', categories: ['variable_group'], note: '涉及哪类对象，就带上哪组规则' },
  { key: 'memory', label: '记忆', categories: ['memory'], note: '只在记忆维护任务里使用' },
  { key: 'reference', label: '参考资料', categories: ['documentation', 'example', 'reference'], note: '说明文档和示例，不会发给模型' },
] as const;
type GroupKey = (typeof groups)[number]['key'];
const groupOf = (item: PromptModule) => groups.find((group) => (group.categories as readonly string[]).includes(item.category))!;
const stageNames: Record<string, string> = { story: '正文', variables: '变量', world: '世界', memory: '记忆' };
const domainNames: Record<string, string> = {
  protagonist: '主角', npc_ordinary: '普通NPC', npc_special: '特殊NPC', items: '重要物品', economy: '经济与资产',
  org_gang: '黑帮势力', org_government: '官方势力', org_civil: '民间组织', org_business: '企业与资本势力',
};
const variableParts = [['init', '初始化'], ['update', '常规更新'], ['offscreen', '场外规则']] as const;
type VariablePart = (typeof variableParts)[number][0];
const switchFields = ['noControl', 'naturalProse', 'actionOptions', 'realWorld'] as const;
type SwitchField = (typeof switchFields)[number];
type PromptSettings = Settings['prompts'];
/* 状态只看 manifest 和当前写作偏好，不依赖「高级」里选的阶段与模式。 */
function moduleState(item: PromptModule, prompts: PromptSettings): { kind: 'switch'; field: SwitchField } | { kind: 'always' | 'ondemand' | 'never' | 'current' | 'unused'; label: string } {
  if (item.toggle) {
    const [field, value] = item.toggle.split(':');
    if ((switchFields as readonly string[]).includes(field)) return { kind: 'switch', field: field as SwitchField };
    if (field === 'minNarrativeChars') return { kind: 'always', label: `≥${prompts.minNarrativeChars} 字` };
    return String(prompts[field as keyof PromptSettings]) === value ? { kind: 'current', label: '当前' } : { kind: 'unused', label: '未选用' };
  }
  if (item.activation === 'relevant-domain') return { kind: 'ondemand', label: '按需' };
  if (item.activation === 'memory-task') return { kind: 'ondemand', label: '记忆任务' };
  if (item.activation === 'protocol-compatibility') return { kind: 'ondemand', label: '兼容时' };
  if (item.activation === 'never') return { kind: 'never', label: '不注入' };
  return { kind: 'always', label: '常驻' };
}
function usage(item: PromptModule) {
  const used = item.applicableStages.map((value) => stageNames[value]).join('、');
  if (item.toggle && (switchFields as readonly string[]).includes(item.toggle.split(':')[0]))
    return `打开时，每次${used}请求都会带上；关闭后不发送。和「提示词」页的同名开关是同一个设置。`;
  if (item.toggle?.startsWith('perspective') || item.toggle?.startsWith('style'))
    return `只在「提示词」页选中这一项时发送给${used}阶段。`;
  return {
    always: `每次${used}请求都会带上。`,
    setting: `随设置开关，发送给${used}阶段。`,
    'relevant-domain': `本回合涉及「${domainNames[item.domain ?? ''] ?? item.domain}」时，才会加进${used}请求。`,
    'memory-task': '只在记忆维护任务里使用。',
    'protocol-compatibility': '模型协议需要兼容处理时才会带上。',
    never: '只是参考资料，不会发送给模型。',
  }[item.activation];
}
function variableModule(domain: string, part: VariablePart, format: 'json' | 'text') {
  const id = `variableGroups.${domain}.${part}`;
  const modules = promptManifest.modules;
  return (format === 'text' && modules.find((item) => item.id === `${id}.text`)) || modules.find((item) => item.id === id);
}
function initialOrder() {
  try {
    return { orders: browserPromptOrder(), error: '' };
  } catch {
    return {
      orders: {},
      error: '排序配置损坏或无法读取；未覆盖原数据，请主动恢复默认或重新保存合法排序。',
    };
  }
}
function configuration() {
  try {
    return readAiConfig(localStorage);
  } catch {
    return defaultAiConfig();
  }
}
export function PromptInspector({
  settings,
  repository,
  activeSaveId,
  onPromptChange,
}: {
  settings: Settings;
  repository?: SaveRepository;
  activeSaveId?: string;
  onPromptChange?: <K extends keyof PromptSettings>(key: K, value: PromptSettings[K]) => void;
}) {
  const [initial] = useState(initialOrder);
  const [orders, setOrders] = useState(initial.orders);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState(initial.error);
  const [stage, setStage] = useState<AiStage>('story');
  const [mode, setMode] = useState<'opening' | 'regular'>('opening');
  const [domains, setDomains] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<'list' | 'read' | 'advanced'>('list');
  const [group, setGroup] = useState<GroupKey | 'all'>('all');
  const [variable, setVariable] = useState<{ domain: string; part: VariablePart; format: 'json' | 'text' } | null>(null);
  const [moduleId, setModuleId] = useState('');
  const [source, setSource] = useState('');
  const [sourceModuleId, setSourceModuleId] = useState('');
  const [saves, setSaves] = useState<Awaited<ReturnType<SaveRepository['list']>>>([]);
  const [saveId, setSaveId] = useState(activeSaveId ?? '');
  const [previews, setPreviews] = useState<Partial<Record<AiStage, StagePreview>>>({});
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('preview');
  const [requestId, setRequestId] = useState('');
  const generation = useRef(0);
  const records = useSyncExternalStore(
    requestInspections.subscribe,
    requestInspections.getSnapshot,
  );
  const secrets = browserCredentials();
  const config = configuration();
  const route = previewRoute(config, stage);
  const selectionInput = { stage, mode, settings, domains, cotAllowed: route.cotAllowed };
  const selected = selectPromptModules(selectionInput);
  const modeDifference = comparePromptModes(selectionInput);
  const effective = projectPromptOrder(orders, selected);
  const ordered = [...selected].sort(
    (a, b) => (effective[a.id] ?? a.defaultOrder) - (effective[b.id] ?? b.defaultOrder),
  );
  const module = promptManifest.modules.find((item) => item.id === moduleId);
  const preview = previews[stage];
  const stageRecords = records.filter(
    (record) =>
      record.scope?.kind === 'stage' &&
      record.stage === stage &&
      record.scope.mode === mode &&
      (!saveId || record.scope.saveId === saveId),
  );
  const connectionRecords = records.filter((record) => !record.scope);
  const memoryRecords = records.filter((record) => record.scope?.kind === 'memory' && (!saveId || record.scope.saveId === saveId));
  const availableRecords = [...stageRecords, ...memoryRecords, ...connectionRecords];
  const actual = availableRecords.find((record) => record.id === requestId) ?? stageRecords[0];
  const safe = <T,>(value: T) => redactInspection(value, secrets);
  useEffect(() => {
    let disposed = false;
    if (repository)
      repository
        .list()
        .then((list) => {
          if (!disposed) {
            const readable = list.filter(save => save.status === 'readable');
            setSaves(readable);
            setSaveId((current) => current || readable[0]?.saveId || '');
          }
        })
        .catch(() => {
          if (!disposed) setNotice('存档列表读取失败，未修改任何存档。');
        });
    return () => {
      disposed = true;
      generation.current++;
    };
  }, [repository]);
  useEffect(() => {
    let disposed = false;
    if (!moduleId) return;
    setSourceModuleId('');
    setSource('正在读取真实资源…');
    readPromptResource(moduleId)
      .then((text) => {
        if (!disposed) {
          setSource(text);
          setSourceModuleId(moduleId);
        }
      })
      .catch((error) => {
        if (!disposed) setSource(safeAiError(error).message);
      });
    return () => {
      disposed = true;
    };
  }, [moduleId]);
  function invalidate() {
    generation.current++;
    setPreviews({});
    setBusy(false);
    setRequestId('');
  }
  async function assemble() {
    if (!repository || !saveId) {
      setNotice('没有已选存档，无法组装游戏上下文。仍可浏览模块原文与固定顺序。');
      return;
    }
    const ticket = ++generation.current;
    setPreviews({});
    setBusy(true);
    setNotice('正在读取存档并组装预览，不发送模型请求。');
    const captured = structuredClone({ settings, mode, domains, orders, config });
    try {
      const [state, draft] = await Promise.all([
        repository.load(saveId),
        repository.loadDraft(saveId),
      ]);
      const companionProfile = loadCompanionProfile(localStorage, state);
      const result = await buildStagePreviews(
        {
          state,
          draft,
          settings: captured.settings,
          mode: captured.mode,
          domains: captured.domains,
          orderPreferences: captured.orders,
          userInput: draft?.userInput ?? '',
          companionProfile,
        },
        captured.config,
      );
      if (ticket !== generation.current) return;
      const safeResult = redactInspection(result, secrets);
      for (const value of inspectionStages) {
        const original = result[value], safePreview = safeResult[value];
        if (original.ok && safePreview.ok) safePreview.contentRedacted = safePreview.prompt.messages.some((message, index) => message.content !== original.prompt.messages[index].content);
      }
      setPreviews(safeResult);
      setNotice('预览已组装；未发送 API 请求、未执行回合、未写入正式存档。');
    } catch {
      if (ticket === generation.current) setNotice('预览无法读取合法存档或设置；原数据未被修改。');
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  function move(id: string, direction: number) {
    const item = ordered.find((entry) => entry.id === id)!;
    const peers = ordered.filter(
      (entry) => entry.reorderable && entry.orderGroup === item.orderGroup,
    );
    const other = peers[peers.findIndex((entry) => entry.id === id) + direction];
    if (!other) return;
    try {
      setOrders(movePromptOrder(orders, id, other.id));
      setDirty(true);
      invalidate();
      setNotice('合法排序尚未保存；切换阶段/模式会保留此编辑。');
    } catch {
      setNotice('排序不合法，固定模块和跨组交换已拒绝。');
    }
  }
  function saveOrder(reset = false) {
    try {
      const next = reset ? {} : orders;
      savePromptOrder(localStorage, next);
      setOrders(next);
      setDirty(false);
      invalidate();
      setNotice(
        reset ? '已恢复并保存默认排序。' : '排序已独立保存，后续阶段请求及重新预览会应用。',
      );
    } catch {
      setNotice('排序保存失败，原配置未被覆盖。');
    }
  }
  const text = query.trim().toLowerCase();
  const matches = (item: PromptModule) =>
    !text || `${item.id} ${item.title} ${item.path}`.toLowerCase().includes(text);
  const visibleGroups = groups
    .filter((entry) => group === 'all' || entry.key === group)
    .map((entry) => ({
      ...entry,
      items: promptManifest.modules.filter((item) => groupOf(item).key === entry.key && matches(item)),
    }))
    .filter((entry) => entry.items.length > 0);
  const count = (key: GroupKey | 'all') =>
    key === 'all'
      ? promptManifest.modules.length
      : promptManifest.modules.filter((item) => groupOf(item).key === key).length;
  function openModule(id: string) {
    setVariable(null);
    setModuleId(id);
    setPage('read');
  }
  function openVariable(domain: string, part: VariablePart, format: 'json' | 'text' = 'text') {
    const target = variableModule(domain, part, format);
    if (!target) return;
    setVariable({ domain, part, format: target.id.endsWith('.text') ? 'text' : 'json' });
    setModuleId(target.id);
    setPage('read');
  }
  function control(item: PromptModule) {
    const state = moduleState(item, settings.prompts);
    if (state.kind === 'switch') {
      const checked = settings.prompts[state.field];
      return (
        <input
          type="checkbox"
          className="pm-switch"
          checked={checked}
          disabled={!onPromptChange}
          onChange={(event) => onPromptChange?.(state.field, event.target.checked)}
          aria-label={`${checked ? '关闭' : '打开'}提示词 ${item.title}`}
        />
      );
    }
    return <span className={`pm-state ${state.kind}`}>{state.label}</span>;
  }
  const effectiveOn = (item: PromptModule) => {
    const state = moduleState(item, settings.prompts);
    return state.kind === 'switch' ? settings.prompts[state.field] : state.kind !== 'never' && state.kind !== 'unused';
  };
  const meta = (item: PromptModule) =>
    [
      groupOf(item).label,
      `${item.characters.toLocaleString()} 字`,
      item.applicableStages.map((value) => stageNames[value]).join(' / '),
    ]
      .filter(Boolean)
      .join(' · ');
  const currentState = module ? moduleState(module, settings.prompts) : undefined;
  const variableFormats = variable
    ? (['json', 'text'] as const).filter((format) => {
        const target = variableModule(variable.domain, variable.part, format);
        return target && (format === 'json' ? !target.id.endsWith('.text') : target.id.endsWith('.text'));
      })
    : [];
  return (
    <div className="prompt-inspector pm">
      {/* 列表 */}
      <section aria-label="模块库" className="pm-page pm-library" hidden={page !== 'list'}>
        <div className="pm-pagebar">
          <p className="pm-sub">游戏实际发给模型的提示词 · 原文只读</p>
          <button className="pm-advanced" onClick={() => setPage('advanced')}>
            <span aria-hidden="true">⚙</span>高级
          </button>
        </div>
        {initial.error && notice === initial.error && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        <div className="pm-bar">
          <div className="pm-groups" role="group" aria-label="提示词分类">
            {(['all', ...groups.map((entry) => entry.key)] as const).map((key) => (
              <button key={key} aria-pressed={group === key} onClick={() => setGroup(key)}>
                {key === 'all' ? '全部' : groups.find((entry) => entry.key === key)!.label}
                <small>{count(key)}</small>
              </button>
            ))}
          </div>
          <label className="pm-search">
            <input
              aria-label="搜索模块"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称"
            />
          </label>
        </div>
        {visibleGroups.map((entry) => (
          <div key={entry.key} className="pm-group">
            <h5 className="pm-group-title">
              {entry.label}
              <small>{entry.items.length}</small>
              <span>{entry.note}</span>
            </h5>
            <ul className="pm-list">
              {entry.key === 'variables'
                ? [...new Set(entry.items.map((item) => item.domain ?? ''))].map((domain) => {
                    const items = entry.items.filter((item) => item.domain === domain);
                    const name = domainNames[domain] ?? domain;
                    return (
                      <li key={domain} className="pm-row pm-domain" data-domain={domain}>
                        <span className="pm-slot">
                          <span className="pm-state ondemand">按需</span>
                        </span>
                        <span className="pm-text">
                          <strong>{name}</strong>
                          <small>
                            {items.length} 段规则 ·{' '}
                            {items.reduce((sum, item) => sum + item.characters, 0).toLocaleString()} 字 · 涉及{name}时才带上
                          </small>
                        </span>
                        <span className="pm-parts">
                          {variableParts.map(([part, label]) => (
                            <button
                              key={part}
                              aria-label={`查看${name}${label}规则`}
                              onClick={() => openVariable(domain, part)}
                            >
                              {label}
                            </button>
                          ))}
                        </span>
                      </li>
                    );
                  })
                : entry.items.map((item) => (
                    <li
                      key={item.id}
                      data-prompt-id={item.id}
                      className={`pm-row${effectiveOn(item) ? ' on' : ''}${item.activation === 'never' ? ' off' : ''}`}
                    >
                      <span className="pm-slot">{control(item)}</span>
                      <button className="pm-open" onClick={() => openModule(item.id)}>
                        <span className="pm-text">
                          <strong>{item.title}</strong>
                          <small>{meta(item)}</small>
                        </span>
                        <span className="pm-view" aria-hidden="true">
                          查看
                        </span>
                      </button>
                    </li>
                  ))}
            </ul>
          </div>
        ))}
        {!visibleGroups.length && <p className="pm-empty">没有匹配的提示词</p>}
      </section>

      {/* 原文 */}
      <section aria-label="模块原文" className="pm-page pm-read" hidden={page !== 'read'}>
        <div className="pm-pagebar">
          <button className="pm-back" onClick={() => setPage('list')}>
            ‹ 返回列表
          </button>
          <button className="pm-advanced" onClick={() => setPage('advanced')}>
            <span aria-hidden="true">⚙</span>高级
          </button>
        </div>
        {module ? (
          <>
            <h4 className="pm-title">
              {variable ? `${domainNames[variable.domain] ?? variable.domain} · 变量规则` : module.title}
            </h4>
            <p className="pm-chips">
              <span>{groupOf(module).label}</span>
              <span>{module.characters.toLocaleString()} 字</span>
              <span>{module.applicableStages.map((value) => stageNames[value]).join(' / ') || '不注入'}</span>
              <span>{currentState?.kind === 'switch' ? '可开关' : currentState?.label}</span>
            </p>
            {variable && (
              <div className="pm-variants">
                <div className="pm-seg" role="group" aria-label="规则阶段">
                  {variableParts.map(([part, label]) => (
                    <button
                      key={part}
                      aria-pressed={variable.part === part}
                      onClick={() => openVariable(variable.domain, part, variable.format)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {variableFormats.length > 1 && (
                  <div className="pm-seg" role="group" aria-label="变量格式">
                    {variableFormats.map((format) => (
                      <button
                        key={format}
                        aria-pressed={variable.format === format}
                        onClick={() => openVariable(variable.domain, variable.part, format)}
                      >
                        {format === 'json' ? 'JSON 变量' : '文本变量'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="pm-when">
              <b>什么时候用</b>
              <span>{usage(module)}</span>
            </p>
            {currentState?.kind === 'switch' && (
              <label className="pm-when pm-toggle">
                <b>开关</b>
                <span>{settings.prompts[currentState.field] ? '已打开' : '已关闭'}</span>
                <input
                  type="checkbox"
                  className="pm-switch"
                  checked={settings.prompts[currentState.field]}
                  disabled={!onPromptChange}
                  onChange={(event) => onPromptChange?.(currentState.field, event.target.checked)}
                />
              </label>
            )}
            <pre tabIndex={0} aria-label="模块完整原文">
              {safe(source)}
            </pre>
            <p className="pm-foot">
              <span>
                {sourceModuleId === module.id
                  ? `约 ${estimateTokens(source).estimatedTokens} Token（估算，非真实消耗）`
                  : '尚未读取'}
              </span>
              <span>原文只读</span>
            </p>
            <details className="pm-tech">
              <summary>技术信息</summary>
              <dl className="module-metadata">
                <dt>ID</dt>
                <dd>{module.id}</dd>
                <dt>名称 / 版本</dt>
                <dd>
                  {module.title} / {module.version}
                </dd>
                <dt>来源文件</dt>
                <dd>prompts/{module.path}</dd>
                <dt>类别 / 角色</dt>
                <dd>
                  {categories[module.category]} / {module.messageRole ?? '无消息角色'}
                </dd>
                <dt>阶段 / 模式</dt>
                <dd>
                  {module.applicableStages.join('、') || '非注入'} /{' '}
                  {module.modes.join('、') || '非注入'}
                </dd>
                <dt>激活条件</dt>
                <dd>{moduleActivation(module, selectionInput).reason}</dd>
                <dt>顺序 / 字符</dt>
                <dd>
                  注册 {module.defaultOrder} · 当前 {effective[module.id] ?? module.defaultOrder} ·
                  原文 {module.characters} 字符
                </dd>
                <dt>原文 Token 估算</dt>
                <dd>
                  {sourceModuleId === module.id
                    ? `≈ ${estimateTokens(source).estimatedTokens}（启发式，非真实消耗）`
                    : '尚未读取'}
                </dd>
                <dt>约束</dt>
                <dd>
                  {module.permanent ? '所属阶段常驻 · 不可关闭' : module.activation}
                  {module.reorderable ? ' · 仅同组重排' : ' · 固定顺序'}
                </dd>
              </dl>
            </details>
          </>
        ) : (
          <p className="pm-empty">选择模块，读取并查看其完整注册原文。</p>
        )}
      </section>

      {/* 高级：原有的检查、预览、排序与统计，全部保留 */}
      <section aria-label="高级" className="pm-page pm-advanced-page" hidden={page !== 'advanced'}>
        <div className="pm-pagebar">
          <button className="pm-back" onClick={() => setPage('list')}>
            ‹ 返回列表
          </button>
          <h4 className="pm-title">高级</h4>
        </div>
        <p className="muted">
          真实注册资源 · 只读原文 · 无网络组装预览 ·
          仅内存请求记录。当前使用本窗口编辑的七项写作偏好；排序独立保存。
        </p>
        <div className="inspector-toolbar">
          <label>
            检查阶段
            <select
              value={stage}
              onChange={(event) => {
                setStage(event.target.value as AiStage);
                setRequestId('');
              }}
            >
              {inspectionStages.map((value) => (
                <option value={value} key={value}>
                  {stages[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            回合模式
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as typeof mode);
                invalidate();
              }}
            >
              <option value="opening">开局回合</option>
              <option value="regular">普通回合</option>
            </select>
          </label>
          <label>
            预览存档
            <select
              value={saveId}
              onChange={(event) => {
                setSaveId(event.target.value);
                invalidate();
              }}
            >
              <option value="">请选择真实存档</option>
              {saves.map((save) => (
                <option value={save.saveId} key={save.saveId}>
                  {safe(save.title)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="pm-primary"
            disabled={!repository || !saveId || busy}
            onClick={() => void assemble()}
          >
            {busy ? '组装中…' : '生成三阶段组装预览（不联网）'}
          </button>
        </div>
        {!saveId && <p className="notice">没有已选存档，无法组装游戏上下文。模块资源仍可浏览。</p>}
        <div role="status" className="field-hint">
          {notice}
        </div>
        <div className="stage-stat-cards">
          {inspectionStages.map((value) => {
            const result = previews[value];
            return (
              <section key={value}>
                <strong>{stages[value]}</strong>
                <p>
                  {result?.ok
                    ? `离线预览：${result.statistics.characters} 字符 · 估算 ≈ ${result.statistics.estimatedTokens} Token；主要来源待按需详细分析；窗口未知`
                    : result
                      ? result.reason
                      : '尚未组装；统计未知'}
                </p>
              </section>
            );
          })}
        </div>
        <details className="mode-differences">
          <summary>开局与普通回合的模块差异</summary>
          <section aria-label="回合模式差异">
            <p>
              以下为真实注册作用域对比，共有 {modeDifference.shared.length} 个模块；不代表已执行请求。
            </p>
            <p>仅开局：{modeDifference.openingOnly.map((item) => item.id).join('、') || '无'}</p>
            <p>仅普通：{modeDifference.regularOnly.map((item) => item.id).join('、') || '无'}</p>
            {[...modeDifference.openingOnly, ...modeDifference.regularOnly].map((item) => (
              <button key={item.id} onClick={() => openModule(item.id)}>
                读取 {item.id} 原文
              </button>
            ))}
          </section>
        </details>
        <details>
          <summary>本次预览的相关变量域（不新增写作设置）</summary>
          <div className="domain-choices">
            {[
              ...new Set(
                promptManifest.modules.flatMap((item) => (item.domain ? [item.domain] : [])),
              ),
            ].map((domain) => (
              <label className="toggle" key={domain}>
                <input
                  type="checkbox"
                  checked={domains.includes(domain)}
                  onChange={(event) => {
                    setDomains(
                      event.target.checked
                        ? [...domains, domain]
                        : domains.filter((value) => value !== domain),
                    );
                    invalidate();
                  }}
                />
                {domain}
              </label>
            ))}
          </div>
        </details>
        <div className="pm-columns">
          <section aria-label="发送顺序" className="pm-order">
            <h5>发送顺序</h5>
            <p className="muted">
              {preview?.ok
                ? '已按此配置组装预览，尚未发送。'
                : '以下为真实选择器的模块顺序；游戏资料尚未成功组装。'}
            </p>
            <ol className="prompt-order-list">
              {ordered.map((item) => {
                const peers = ordered.filter(
                  (entry) => entry.reorderable && entry.orderGroup === item.orderGroup,
                );
                const position = peers.indexOf(item);
                return (
                  <li key={item.id} data-module-id={item.id}>
                    <span>
                      <b>
                        {effective[item.id] ?? item.defaultOrder} · {item.title}
                      </b>
                      <small>
                        {item.id} · {item.messageRole} · {item.orderGroup} ·{' '}
                        {preview?.ok
                          ? (preview.prompt.modules.find((m) => m.id === item.id)?.characters ??
                            item.characters)
                          : item.characters}{' '}
                        字符 · 估算 Token{' '}
                        {preview?.ok
                          ? `≈ ${preview.prompt.modules.find((m) => m.id === item.id)?.estimatedTokens ?? '未知'}`
                          : '待组装'}
                      </small>
                    </span>
                    {item.reorderable ? (
                      <div>
                        <button
                          aria-label={`上移 ${item.id}`}
                          disabled={position <= 0}
                          onClick={() => move(item.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`下移 ${item.id}`}
                          disabled={position >= peers.length - 1}
                          onClick={() => move(item.id, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    ) : (
                      <em>固定</em>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="inspector-actions">
              <button onClick={() => saveOrder(true)}>恢复默认顺序</button>
              <button className="pm-primary" disabled={!dirty} onClick={() => saveOrder()}>
                保存提示词排序
              </button>
            </div>
          </section>
          <section aria-label="上下文与统计" className="inspector-context">
            <h5>上下文与统计</h5>
            <label>
              数据来源
              <select value={view} onChange={(event) => setView(event.target.value)}>
                <option value="preview">组装预览（未发送）</option>
                <option value="actual">实际请求快照</option>
              </select>
            </label>
            {view === 'preview' ? (
              <>
                <p>
                  模型路由：{safe(route.channelName)} / {safe(route.model)} {route.protocol}
                </p>
                <p>组装预览不会调用 API；没有实际使用量。</p>
                <TokenStatistics statistics={preview?.ok ? preview.statistics : undefined} />
                {preview?.ok ? (
                  <ContextInspection
                    key={`preview-${generation.current}-${stage}`}
                    messages={preview.prompt.messages}
                    modules={preview.prompt.modules}
                    statistics={preview.statistics}
                    contentRedacted={preview.contentRedacted}
                  />
                ) : (
                  <p className="notice">
                    {preview
                      ? preview.reason
                      : '请先选择真实存档并主动组装预览；变量/世界需要合法已选正文草稿。'}
                  </p>
                )}
              </>
            ) : (
              <>
                <p>
                  只记录客户端真实发送尝试的脱敏副本，不代表服务已收到或游戏已结算。最多保留本会话内存中的
                  12 条，刷新即清空。
                </p>
                {!stageRecords.length && (
                  <p className="notice">
                    此阶段/模式没有实际请求快照。正文、变量和世界支持手动生成；不会用组装预览冒充发送。
                  </p>
                )}
                <p>记忆维护快照在选择请求中独立标识，不属于三阶段或开局/普通回合预览。</p>
                <label>
                  选择请求
                  <select
                    value={actual?.id ?? ''}
                    onChange={(event) => setRequestId(event.target.value)}
                  >
                    <option value="">选择真实请求</option>
                    {availableRecords.map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.scope
                          ? record.scope.kind === 'memory' ? `记忆维护 ${record.scope.memoryTask}` : `${record.scope.mode} ${stages[record.stage]}`
                          : '连接测试（非游戏阶段）'}{' '}
                        · {record.createdAt} · {record.status}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => {
                    requestInspections.clear();
                    setRequestId('');
                  }}
                >
                  清空内存请求记录
                </button>
                <TokenStatistics statistics={actual?.statistics} />
                {actual && (
                  <div>
                    <p>
                      路由：{safe(actual.route.channelName)} / {safe(actual.route.model)} /{' '}
                      {actual.route.protocol}
                    </p>
                    <p>
                      {actual.scope
                        ? actual.scope.kind === 'memory' ? `记忆维护 / ${actual.scope.memoryTask} / 存档版本 ${actual.scope.revision}` : `${actual.scope.mode} / ${stages[actual.stage]} / 存档版本 ${actual.scope.revision}`
                        : '连接测试；没有游戏阶段或模块组装'}
                    </p>
                    <p>
                      状态：
                      {actual.status === 'received'
                        ? '收到完整文本响应（不代表候选校验或正式提交）'
                        : actual.status === 'pending'
                          ? '发送尝试进行中'
                          : `请求失败：${actual.errorCode}`}
                    </p>
                    <ol>
                      {actual.scope?.modules.map((item) => (
                        <li key={item.id}>
                          {item.order} · {item.id} · {item.role} · {item.characters} 字符 · 估算 ≈{' '}
                          {item.estimatedTokens} Token
                        </li>
                      ))}
                    </ol>
                    {actual.scope?.memoryTask === 'memory.npc_summarize' ? <p className="notice">NPC私人维护仅展示模块结构与用量，不在此界面开放人物身份或私人请求正文。</p> : <ContextInspection
                      key={actual.id}
                      messages={actual.messages}
                      body={actual.body}
                      modules={actual.scope?.modules ?? []}
                      statistics={actual.statistics}
                      contentRedacted={actual.contentRedacted}
                    />}
                  </div>
                )}
              </>
            )}
          </section>
      </div>
      </section>
    </div>
  );
}
