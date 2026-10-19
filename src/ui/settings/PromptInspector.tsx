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
import type { AiStage } from '../../services/ai/configuration';
import { safeAiError } from '../../services/ai/errors';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { loadCompanionProfile } from '../../services/local/companionProfile';
import type { Settings } from './model';
import { ContextInspection, TokenStatistics } from './ContextInspection';

const stages: Record<AiStage, string> = {
  story: '正文生成',
  variables: '变量管理',
  world: '动态世界',
};
const statusNames = { enabled: '当前启用', disabled: '未启用', 'not-applicable': '不适用' };
const categories: Record<string, string> = {
  identity: '身份',
  worldbook: '世界书',
  shared: '共享规则',
  narrative_core: '核心叙事',
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
}: {
  settings: Settings;
  repository?: SaveRepository;
  activeSaveId?: string;
}) {
  const [initial] = useState(initialOrder);
  const [orders, setOrders] = useState(initial.orders);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState(initial.error);
  const [stage, setStage] = useState<AiStage>('story');
  const [mode, setMode] = useState<'opening' | 'regular'>('opening');
  const [domains, setDomains] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
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
  const availableRecords = [...stageRecords, ...connectionRecords];
  const actual = availableRecords.find((record) => record.id === requestId) ?? stageRecords[0];
  const safe = <T,>(value: T) => redactInspection(value, secrets);
  useEffect(() => {
    let disposed = false;
    if (repository)
      repository
        .list()
        .then((list) => {
          if (!disposed) {
            setSaves(list);
            setSaveId((current) => current || list[0]?.saveId || '');
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
      setPreviews(redactInspection(result, secrets));
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
  const filtered = promptManifest.modules.filter((item) => {
    const activation = moduleActivation(item, selectionInput);
    return (
      (!category || item.category === category) &&
      (!filterStage || item.applicableStages.includes(filterStage as AiStage)) &&
      (!filterStatus || activation.status === filterStatus) &&
      `${item.id} ${item.title} ${item.path}`.toLowerCase().includes(query.toLowerCase())
    );
  });
  return (
    <div className="prompt-inspector">
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
            <button key={item.id} onClick={() => setModuleId(item.id)}>
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
      <div className="inspector-actions">
        <button disabled={!repository || !saveId || busy} onClick={() => void assemble()}>
          {busy ? '组装中…' : '生成三阶段组装预览（不联网）'}
        </button>
        <button disabled={!dirty} onClick={() => saveOrder()}>
          保存提示词排序
        </button>
        <button onClick={() => saveOrder(true)}>恢复默认顺序</button>
      </div>
      {!saveId && <p className="notice">没有已选存档，无法组装游戏上下文。模块资源仍可浏览。</p>}
      <div className="stage-stat-cards">
        {inspectionStages.map((value) => {
          const result = previews[value];
          return (
            <section key={value}>
              <strong>{stages[value]}</strong>
              <p>
                {result?.ok
                  ? `${result.statistics.characters} 字符 · 估算 ≈ ${result.statistics.estimatedTokens} Token`
                  : result
                    ? result.reason
                    : '尚未组装；统计未知'}
              </p>
            </section>
          );
        })}
      </div>
      <div role="status" className="field-hint">
        {notice}
      </div>
      <div className="inspector-columns">
        <section aria-label="模块库" className="inspector-library">
          <h4>
            模块库 · {filtered.length}/{promptManifest.modules.length}
          </h4>
          <label>
            搜索模块
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称、ID 或路径"
            />
          </label>
          <label>
            模块类型
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">全部类型</option>
              {Object.entries(categories).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            适用阶段筛选
            <select value={filterStage} onChange={(event) => setFilterStage(event.target.value)}>
              <option value="">全部阶段及非注入资料</option>
              {inspectionStages.map((value) => (
                <option key={value} value={value}>
                  {stages[value]}
                </option>
              ))}
              <option value="memory">记忆维护</option>
            </select>
          </label>
          <label>
            激活状态
            <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
              <option value="">全部状态</option>
              {Object.entries(statusNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="module-library-list">
            {filtered.map((item) => (
              <button
                aria-pressed={item.id === moduleId}
                key={item.id}
                onClick={() => setModuleId(item.id)}
              >
                <strong>{item.title}</strong>
                <small>{item.id}</small>
                <span>
                  {statusNames[moduleActivation(item, selectionInput).status]} · {item.characters}{' '}
                  字符
                </span>
              </button>
            ))}
            {!filtered.length && <p>没有匹配模块。</p>}
          </div>
        </section>
        <section aria-label="模块原文与排序" className="inspector-module">
          <h4>模块原文</h4>
          {module ? (
            <>
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
              <pre tabIndex={0} aria-label="模块完整原文">
                {safe(source)}
              </pre>
            </>
          ) : (
            <p className="empty">选择模块，读取并查看其完整注册原文。</p>
          )}
          <h4>当前选取顺序</h4>
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
                    {effective[item.id] ?? item.defaultOrder} · {item.id}
                    <small>
                      {item.messageRole} · {item.orderGroup} ·{' '}
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
        </section>
        <section aria-label="上下文与统计" className="inspector-context">
          <h4>上下文与统计</h4>
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
                  secrets={secrets}
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
                  此阶段/模式没有实际请求快照。M4 工作流尚未接入，不会用预览冒充发送。
                </p>
              )}
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
                        ? `${record.scope.mode} ${stages[record.stage]}`
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
                      ? `${actual.scope.mode} / ${stages[actual.stage]} / 存档版本 ${actual.scope.revision}`
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
                  <ContextInspection
                    key={actual.id}
                    messages={actual.messages}
                    body={actual.body}
                    modules={actual.scope?.modules ?? []}
                    secrets={secrets}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
