import './mobile-workflow-content.css';
import { useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { storyRuleNames } from '../../domain/storyDiagnostics';
import { stageResponses } from '../../services/ai/stageResponses';
import { redactInspection } from '../../services/ai/inspection';
import { browserCredentials } from '../../services/ai/credentials';
import { worldRuleNames } from '../../services/validation/worldDiagnostics';
import { RequestUsage } from './RequestUsage';
import { RuntimeLogPanel } from './RuntimeLogPanel';
import { StoryInspectionPanel } from './StoryInspectionPanel';
import type { RuntimeLogEntry } from './runtimeLog';

// 三阶段详情：只重排展示，不新增数据或请求。
// - desktop（>900px）：左侧选阶段，右侧分页查看该阶段全部内容。
// - sheet（≤900px）：底部抽屉两层——第一层（home）为阶段列表与本回合入口，第二层为同一套分页详情。
export type WorkflowStage = 'story' | 'variables' | 'world';
export type WorkflowView = WorkflowStage | 'diagnostics' | 'input' | 'home';
export type WorkflowLayout = 'desktop' | 'sheet';
export type WorkflowTab = 'overview' | 'candidates' | 'raw' | 'plan' | 'normalized';
export type WorkflowStep = { stage: WorkflowStage; name: string; text: string; visual: string };
export type StageAction = { label: string; cancel: boolean; disabled: boolean; onClick: () => void };
export type StageSwitch = { checked: boolean; onChange: (checked: boolean) => void };

const stageNames = { story: '正文生成', variables: '变量管理', world: '动态世界' } as const;
const rawLabels = { story: '正文', variables: '变量', world: '动态世界' } as const;
const stageEyebrows = { story: 'STAGE 01 · STORY', variables: 'STAGE 02 · VARIABLES', world: 'STAGE 03 · WORLD' } as const;
const viewTitles = { ...stageNames, diagnostics: '运行诊断', input: '本回合已绑定输入' } as const;
const viewEyebrows = { ...stageEyebrows, diagnostics: 'DIAGNOSTICS', input: 'BOUND INPUT · 只读' } as const;
const glyphs: Record<string, string> = { done: '✓', fail: '!', run: '', off: '–', idle: '' };
const credentials = () => browserCredentials();

/** 与旧卡片一致：关闭的阶段单独标为 off，其余沿用进度视觉。 */
export const stepState = (step: WorkflowStep) => (step.visual === 'idle' && step.text === '已关闭' ? 'off' : step.text === '仅预览' ? 'preview' : step.visual);

export function DesktopWorkflowPanel(props: {
  layout?: WorkflowLayout;
  label: string;
  state: string;
  onClose: () => void;
  onFollow?: () => void;
  notices: ReactNode;
  primary: ReactNode;
  steps: readonly WorkflowStep[];
  view: WorkflowView;
  onView: (view: WorkflowView) => void;
  tab: WorkflowTab;
  onTab: (tab: WorkflowTab) => void;
  switches: Record<'variables' | 'world', StageSwitch>;
  switchesRef: RefObject<HTMLOListElement | null>;
  actions: Record<'variables' | 'world', StageAction>;
  draft?: TurnDraft;
  saveId: string;
  rawTurnId?: string;
  summary?: { hanCharacters: number; status: string };
  runtimeLogs: RuntimeLogEntry[];
  onClearLogs: () => void;
}) {
  const { steps, view, draft } = props;
  const sheet = props.layout === 'sheet';
  // 抽屉第二层：标题区显示当前视图，左侧“三阶段”返回第一层；状态文案仍在下方收起条。
  const inner = sheet && view !== 'home';
  const returnHome = () => {
    const index = Math.max(0, steps.findIndex(step => step.stage === view));
    props.onView('home');
    requestAnimationFrame(() => props.switchesRef.current?.querySelector<HTMLButtonElement>(`li:nth-child(${index + 1}) > button`)?.focus({ preventScroll: true }));
  };
  const failedLogs = props.runtimeLogs.filter((entry) => entry.kind === 'failed').length;
  return (
    <div
      className={`workflow-details wf-v2${sheet ? ' wf-mobile-content' : ''}`}
      id="workflow-pop"
      role="region"
      aria-label="三阶段详情"
      data-level={sheet ? (inner ? 'detail' : 'home') : undefined}
    >
      <header className="wf-hd" data-state={props.state}>
        {inner
          ? <button className="wf-back" onClick={returnHome} aria-label="返回三阶段列表">三阶段</button>
          : <span className="dot" aria-hidden="true" />}
        <div className="wf-hd-title">
          <span className="wf-eyebrow">{inner ? viewEyebrows[view as Exclude<WorkflowView, 'home'>] : 'THREE STAGES · 三阶段'}</span>
          <h3>{inner ? viewTitles[view as Exclude<WorkflowView, 'home'>] : props.label}</h3>
        </div>
        {props.onFollow && <button className="wf-follow" onClick={props.onFollow}>跟随最新正文 ↓</button>}
        <button className="wf-close" onClick={props.onClose} aria-label="收起三阶段详情">×</button>
      </header>
      <div className="wf-notices">{props.notices}</div>
      <div className="wf-main">
        <nav className="wf-rail" aria-label="三阶段导航" hidden={inner}>
          <p className="wf-rail-h">STAGES</p>
          <ol className={sheet ? 'workflow-stages mobile-stage-switches' : 'workflow-stages'} id="workflow-runtime-switches" ref={props.switchesRef}>
            {steps.map((step, i) => {
              const state = stepState(step);
              return (
                <li key={step.stage} data-s={state}>
                  <button className="wf-ri" aria-current={view === step.stage ? 'true' : undefined} aria-controls="wf-detail" onClick={() => props.onView(step.stage)}>
                    <span className="wf-node" aria-hidden="true">{glyphs[state] ?? ''}</span>
                    <strong><span className="stage-number">0{i + 1}</span>{stageNames[step.stage]}</strong>
                    <small>{step.text}</small>
                  </button>
                  {step.stage !== 'story' && (
                    <label className="wf-sw" title={`${stageNames[step.stage]}阶段开关`}>
                      {/* 开关与左侧导航按钮是兄弟元素：切换只改启用设置，不切换阶段视图。 */}
                      <input
                        type="checkbox"
                        data-stage={step.stage}
                        aria-label={stageNames[step.stage]}
                        checked={props.switches[step.stage].checked}
                        onChange={(event) => props.switches[step.stage as 'variables' | 'world'].onChange(event.target.checked)}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="wf-rail-h">本回合</p>
          <ul className="wf-aux">
            <li>
              <button className="wf-ri" aria-current={view === 'diagnostics' ? 'true' : undefined} aria-controls="wf-detail" onClick={() => props.onView('diagnostics')}>
                <span className="wf-node" aria-hidden="true">诊</span>
                <strong>运行诊断</strong>
                <small>错误与用量</small>
                {failedLogs > 0 && <span className="wf-count" aria-label={`错误 ${failedLogs} 条`}>{failedLogs}</span>}
              </button>
            </li>
            {draft && (
              <li>
                <button className="wf-ri" aria-current={view === 'input' ? 'true' : undefined} aria-controls="wf-detail" onClick={() => props.onView('input')}>
                  <span className="wf-node" aria-hidden="true">述</span>
                  <strong>已绑定输入</strong>
                  <small>只读</small>
                </button>
              </li>
            )}
          </ul>
        </nav>
        <div className="wf-detail" id="wf-detail" hidden={sheet && !inner}>
          {view === 'story' || view === 'variables' || view === 'world'
            ? <StageDetail {...props} stage={view} step={steps.find((step) => step.stage === view)!} compact={sheet} />
            : view === 'input' && draft
              ? <BoundInput draft={draft} compact={sheet} />
              : null}
          {/* 诊断视图常驻 DOM：新错误进入日志时无需切换视图即可保留并累计。 */}
          <Diagnostics hidden={view !== 'diagnostics'} {...props} failedLogs={failedLogs} compact={sheet} />
        </div>
      </div>
      <footer className="wf-ft">
        {props.primary}
        <span className="workflow-fee">生成可能产生第三方 API 费用。</span>
      </footer>
    </div>
  );
}

// compact（抽屉第二层）：视图名称已在抽屉标题区，这里只保留状态标签与操作。
function DetailHead({ eyebrow, title, badges, actions, compact = false }: { eyebrow: string; title: string; badges?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className="wf-dt-hd">
      <div className="wf-dt-title">
        {compact ? (badges && <div className="wf-badges">{badges}</div>) : <>
          <span className="wf-eyebrow">{eyebrow}</span>
          <h4>{title}{badges}</h4>
        </>}
      </div>
      {actions && <div className="wf-dt-act">{actions}</div>}
    </div>
  );
}

function StageDetail(props: Parameters<typeof DesktopWorkflowPanel>[0] & { stage: WorkflowStage; step: WorkflowStep; compact: boolean }) {
  const { stage, step, draft } = props;
  const state = stepState(step);
  const variables = draft?.variables?.result;
  const world = draft?.world;
  const count = stage === 'variables' && variables
    ? variables.commands.length + variables.rejectedSuggestions.length + variables.unresolved.length
    : stage === 'world' && world
      ? world.result.worldCommands.length + world.result.taskCommands.length + world.result.eventCommands.length + world.result.unresolved.length
      : undefined;
  const tabs: [WorkflowTab, string, number?][] = stage === 'story'
    ? [['overview', '概览'], ['raw', '模型原文'], ['plan', '叙事规划'], ['normalized', '校验结果']]
    : [['overview', '概览'], ['candidates', '候选', count], ['raw', '模型原文'], ['normalized', '校验结果']];
  const tab = tabs.some(([key]) => key === props.tab) ? props.tab : 'overview';
  // WAI-ARIA Tabs：只有选中的页签在 Tab 顺序中；←/→ 循环、Home/End 首尾，切换即激活并移动焦点。
  const tabRefs = useRef<Partial<Record<WorkflowTab, HTMLButtonElement | null>>>({});
  const tabId = (key: WorkflowTab) => `wf-tab-${stage}-${key}`;
  const panelId = `wf-panel-${stage}`;
  const selectTab = (key: WorkflowTab, focus = true) => {
    props.onTab(key);
    if (focus) tabRefs.current[key]?.focus();
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = tabs.map(([key]) => key);
    const index = keys.indexOf(tab);
    const next = event.key === 'ArrowRight' ? keys[(index + 1) % keys.length]
      : event.key === 'ArrowLeft' ? keys[(index - 1 + keys.length) % keys.length]
        : event.key === 'Home' ? keys[0]
          : event.key === 'End' ? keys[keys.length - 1]
            : undefined;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
  };
  const action = stage === 'story' ? undefined : props.actions[stage];
  const badges = <>
    <span className="wf-pill" data-s={state}>{step.text}</span>
    {stage === 'variables' && variables && <span className="wf-pill" data-s="preview">未正式结算</span>}
    {stage === 'world' && world && (world.validation === 'preview'
      ? <span className="wf-pill" data-s="preview">预览 · 变量依赖未完成，不能正式结算</span>
      : <span className="wf-pill" data-s="ok">程序校验通过 · 仍未正式结算</span>)}
  </>;
  return (
    <section className="wf-stage" data-stage={stage} aria-label={`${stageNames[stage]}详情`}>
      <DetailHead
        eyebrow={stageEyebrows[stage]}
        title={stageNames[stage]}
        compact={props.compact}
        badges={badges}
        actions={action
          ? <button className={action.cancel ? 'wf-cancel' : undefined} disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
          : <span className="stage-action-hint">正文生成位于行动输入旁。</span>}
      />
      <div className="wf-tabs" role="tablist" aria-label={`${stageNames[stage]}内容`} aria-orientation="horizontal" onKeyDown={onTabKey}>
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            ref={(element) => { tabRefs.current[key] = element; }}
            id={tabId(key)}
            role="tab"
            type="button"
            aria-selected={tab === key}
            aria-controls={panelId}
            tabIndex={tab === key ? 0 : -1}
            className="wf-tab"
            onClick={() => selectTab(key, false)}
          >
            {label}{n !== undefined && <sup>{n}</sup>}
          </button>
        ))}
      </div>
      <div className="wf-dt-body" role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} tabIndex={0}>
        {tab === 'raw' ? <StageRaw saveId={props.saveId} turnId={props.rawTurnId} stage={stage} />
          : tab === 'normalized' ? <StageNormalized saveId={props.saveId} turnId={props.rawTurnId} stage={stage} />
            : tab === 'plan' ? (draft ? <StoryInspectionPanel key={`${draft.turnId}-${draft.storyRevision}`} draft={draft} inline /> : <Empty>没有可执行的回合草稿。</Empty>)
              : stage === 'story' ? <StoryOverview {...props} state={state} step={step} />
                : stage === 'variables' ? (draft && variables ? (tab === 'candidates' ? <VariableList draft={draft} /> : <VariableOverview draft={draft} onAll={() => selectTab('candidates')} saveId={props.saveId} />) : <StageEmpty step={step} state={state} />)
                  : draft && world ? (tab === 'candidates' ? <WorldList draft={draft} /> : <WorldOverview draft={draft} onAll={() => selectTab('candidates')} saveId={props.saveId} />)
                    : <StageEmpty step={step} state={state} />}
      </div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="wf-empty">{children}</p>;
}

function StageEmpty({ step, state }: { step: WorkflowStep; state: string }) {
  return <Empty>{
    step.text === '已结算' ? '本回合已结算，等待发送新的行动。'
      : state === 'run' ? `${step.text}…完成后显示在这里；“模型原文”页可查看已返回的内容。`
        : state === 'off' ? '该阶段已关闭，尚无候选。打开左侧开关后可补算。'
          : state === 'fail' ? '本阶段没有通过验收的候选。可重新生成，失败原因见上方提示和运行诊断。'
            : step.text === '已跳过' ? '本阶段已跳过，尚无候选。'
              : '尚未生成候选。'
  }</Empty>;
}

function Stats({ items }: { items: [string, ReactNode, string?][] }) {
  return <div className="wf-stats">{items.map(([label, value, level]) => (
    <p key={label} className={level ? `l-${level}` : undefined}><b>{value}</b><span>{label}</span></p>
  ))}</div>;
}

function Meta({ items }: { items: [string, ReactNode][] }) {
  return <dl className="wf-meta">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h5 className="wf-sec">{children}</h5>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="wf-note">{children}</p>;
}

function StoryOverview(props: Parameters<typeof StageDetail>[0] & { state: string }) {
  const { draft, step, state } = props;
  const failures = draft?.failures.filter((failure) => failure.stage === 'story' && failure.storyRevision === draft.storyRevision).slice(-6) ?? [];
  return <>
    {draft?.story ? <>
      <Stats items={[
        ['本回合摘要（汉字）', props.summary?.hanCharacters ?? 0, props.summary?.status === 'empty' ? 'err' : undefined],
        ['行动建议', draft.story.actionOptions?.length ?? 0],
        ['正文版本', draft.storyRevision],
      ]} />
      {props.summary && <Note>{props.summary.status === 'empty' ? '缺少有效摘要，无法正式结算。' : props.summary.status === 'within_target' ? '摘要符合目标范围。' : '摘要可继续。'}</Note>}
    </> : <StageEmpty step={step} state={state} />}
    {failures.length > 0 && <>
      <SectionTitle>安全失败码</SectionTitle>
      <ul className="wf-codes">{failures.map((failure, i) => <li key={i}>正文生成 · 安全失败码：{failure.errorCode} · {failure.attempt} 次尝试</li>)}</ul>
    </>}
    <StageUsage saveId={props.saveId} stage="story" />
  </>;
}

function StageUsage({ saveId, stage }: { saveId: string; stage: WorkflowStage }) {
  return <RequestUsage saveId={saveId} stage={stage} />;
}

type VariableResult = NonNullable<NonNullable<TurnDraft['variables']>['result']>;
type WorldResult = NonNullable<TurnDraft['world']>['result'];

function VariableRows({ result }: { result: VariableResult }) {
  return (
    <ul className="wf-cmds">
      {result.commands.map((command) => (
        <li key={command.commandId}>
          <code>{command.type}</code>
          <span>{redactInspection(command.evidence, credentials())}</span>
          <small>{redactInspection(command.commandId, credentials())}</small>
        </li>
      ))}
      {result.rejectedSuggestions.map((item, i) => (
        <li className="l-err" key={`rejected-${i}`}>
          <code>拒绝</code>
          <span>{redactInspection(item.reason, credentials())}</span>
          {item.reference && <small>{redactInspection(item.reference, credentials())}</small>}
        </li>
      ))}
      {result.unresolved.map((item, i) => (
        <li className="l-warn" key={`unresolved-${i}`}>
          <code>未解决</code>
          <span>{redactInspection(item, credentials())}</span>
        </li>
      ))}
    </ul>
  );
}

// 候选明细（含 NPC 内部资料）仅在玩家主动切到“候选”页时渲染，与旧版“查看…候选（未结算）”一致。
function CandidateLink({ onAll }: { onAll: () => void }) {
  return <p className="wf-candidate-link"><button className="wf-link" onClick={onAll}>查看候选明细 →</button></p>;
}

const variableNotice = '候选尚未改变任何正式资金、人物或时间。完整候选可能包含 NPC 内部资料；查看不会更新主角认知或普通历史。';
const worldNotice = '此处为只读候选。未改变正式人物、经济、任务、时间或历史；线索尚未发布。查看内部结果不会更新任何人物认知。';

function VariableOverview({ draft, onAll, saveId }: { draft: TurnDraft; onAll: () => void; saveId: string }) {
  const result = draft.variables!.result!;
  return <>
    <Stats items={[['合法命令', result.commands.length, 'ok'], ['拒绝建议', result.rejectedSuggestions.length, 'err'], ['未解决事项', result.unresolved.length, 'warn']]} />
    <Meta items={[['正文版本', draft.storyRevision], ['执行版本', draft.executionRevision], ['候选版本', draft.variables?.candidateRevision]]} />
    <CandidateLink onAll={onAll} />
    <StageUsage saveId={saveId} stage="variables" />
    <Note>{variableNotice}</Note>
  </>;
}

function RevealJson({ value, name }: { value: unknown; name: '变量' | '世界' }) {
  // 与旧弹窗一致：切换阶段或页签后需重新主动展开完整候选。
  const [revealed, setRevealed] = useState(false);
  return <>
    <button className="raw-toggle" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
      {revealed ? `隐藏完整${name}候选` : `主动查看完整${name}候选`}
    </button>
    {revealed && (
      <pre className="candidate-json" tabIndex={0} aria-label={`完整${name}候选`}>
        {JSON.stringify(redactInspection(value, credentials()), null, 2)}
      </pre>
    )}
  </>;
}

function VariableList({ draft }: { draft: TurnDraft }) {
  const result = draft.variables!.result!;
  return <>
    <SectionTitle>程序编译和校验后的候选</SectionTitle>
    <VariableRows result={result} />
    <SectionTitle>完整候选</SectionTitle>
    <RevealJson value={result} name="变量" />
    <Note>{variableNotice}</Note>
  </>;
}

function WorldRows({ result }: { result: WorldResult }) {
  return (
    <ul className="wf-cmds">
      {[...result.worldCommands, ...result.taskCommands, ...result.eventCommands].map((command, i) => (
        <li key={i}>
          <code>{command.type}</code>
          <span>{redactInspection(command.evidence, credentials())}</span>
          <small>{redactInspection(command.commandId, credentials())}</small>
        </li>
      ))}
      {result.unresolved.map((item, i) => (
        <li className="l-warn" key={`unresolved-${i}`}>
          <code>未解决</code>
          <span>{redactInspection(item, credentials())}</span>
        </li>
      ))}
    </ul>
  );
}

function WorldOverview({ draft, onAll, saveId }: { draft: TurnDraft; onAll: () => void; saveId: string }) {
  const candidate = draft.world!;
  const result = candidate.result;
  const planned = result.eventCommands.filter((command) => command.type === 'SaveEvent' && command.event.status === 'scheduled').length;
  const history = result.worldCommands.filter((command) => command.type === 'RecordHistory').length;
  return <>
    <Stats items={[['场外命令', result.worldCommands.length, 'ok'], ['任务', result.taskCommands.length, 'info'], ['事件', result.eventCommands.length, 'info'], ['未解决事项', result.unresolved.length, 'warn']]} />
    <Meta items={[
      ['未来计划', planned], ['线索候选', result.visibleHooks.length], ['时间轴候选', history],
      ['正文版本', candidate.storyRevision], ['变量候选版本', candidate.basedOnVariableRevision ?? '缺失'], ['世界候选版本', candidate.candidateRevision],
    ]} />
    <CandidateLink onAll={onAll} />
    <StageUsage saveId={saveId} stage="world" />
    <Note>{worldNotice}</Note>
  </>;
}

function WorldList({ draft }: { draft: TurnDraft }) {
  const result = draft.world!.result;
  return <>
    <SectionTitle>程序校验后的候选</SectionTitle>
    <WorldRows result={result} />
    <SectionTitle>完整候选</SectionTitle>
    <RevealJson value={result} name="世界" />
    <Note>{worldNotice}</Note>
  </>;
}

function useStageRecord(saveId: string, turnId: string | undefined, stage: WorkflowStage) {
  const records = useSyncExternalStore(stageResponses.subscribe, stageResponses.getSnapshot);
  return records.find((item) => item.saveId === saveId && item.turnId === turnId && item.stage === stage);
}

function StageRaw({ saveId, turnId, stage }: { saveId: string; turnId?: string; stage: WorkflowStage }) {
  const record = useStageRecord(saveId, turnId, stage);
  const label = rawLabels[stage];
  return (
    <section className="stage-responses wf-raw" aria-label="模型原文">
      <h5 className="wf-sec">
        {label}模型原文（临时响应）
        {record?.status === 'failed' && <span className="wf-pill" data-s="fail">未通过验收</span>}
        {record?.status === 'pending' && <span className="wf-pill" data-s="run">请求中</span>}
      </h5>
      {!record?.text
        ? <Empty>{record?.status === 'pending' ? '请求尚未返回完整内容。' : '本页面没有可恢复的模型原文；已保存的候选不是模型原文，刷新后请查看规范化记录。'}</Empty>
        : <pre className="candidate-json" tabIndex={0} aria-label={`${label}模型完整原文`}>{record.text}</pre>}
      {record?.error && <p className="wf-raw-error" role="note">{record.error.message}{'details' in record.error && record.error.details?.worldRule ? ` · ${worldRuleNames[record.error.details.worldRule]}` : ''}</p>}
      {record?.error && 'details' in record.error && record.error.details?.storyRule && <small className="wf-raw-error">正文失败类型：{record.error.details.storyRule} · {storyRuleNames[record.error.details.storyRule]}</small>}
      <Note>仅本页面临时保存，刷新或淘汰后无法恢复；模型原文不等于已执行结果。不会写入正式世界或剧情历史，不会发起请求。系统凭证会隐藏。</Note>
    </section>
  );
}

function StageNormalized({ saveId, turnId, stage }: { saveId: string; turnId?: string; stage: WorkflowStage }) {
  const record = useStageRecord(saveId, turnId, stage);
  const label = rawLabels[stage];
  return <>
    <h5 className="wf-sec">{label}程序校验后的结果</h5>
    {record?.normalized
      ? <pre className="candidate-json" tabIndex={0} aria-label={`${label}规范化结果`}>{record.normalized}</pre>
      : <Empty>本页面没有可显示的程序校验结果；刷新后不保留。</Empty>}
    <Note>规范化结果是程序校验后的内容，不等于模型原文，也不等于已正式结算。</Note>
  </>;
}

function BoundInput({ draft, compact }: { draft: TurnDraft; compact: boolean }) {
  return (
    <section className="bound-input wf-bound" aria-label="本回合已绑定输入">
      <DetailHead eyebrow="BOUND INPUT" title="本回合已绑定输入" compact={compact} badges={<span className="wf-pill" data-s="idle">只读</span>} />
      <div className="wf-dt-body">
        <p className="prose">{draft.userInput || '未填写开局偏好，按人物资料正常生成。'}</p>
      </div>
    </section>
  );
}

function Diagnostics(props: Parameters<typeof DesktopWorkflowPanel>[0] & { hidden: boolean; failedLogs: number; compact: boolean }) {
  const { draft } = props;
  const failures = draft?.failures.filter((failure) => failure.storyRevision === draft.storyRevision).slice(-6) ?? [];
  return (
    <section className="workflow-diagnostics wf-diag" hidden={props.hidden} aria-label="运行诊断">
      <DetailHead
        eyebrow="DIAGNOSTICS"
        title="运行诊断"
        compact={props.compact}
        badges={props.failedLogs > 0 ? <span className="wf-pill" data-s="fail">错误 {props.failedLogs} 条</span> : undefined}
      />
      <div className="wf-dt-body">
        {props.summary && (
          <p className="muted" data-testid="summary-length">
            本回合摘要：{props.summary.hanCharacters} 汉字。
            {props.summary.status === 'empty' ? '缺少有效摘要，无法正式结算。' : props.summary.status === 'within_target' ? '符合目标范围。' : '可继续。'}
          </p>
        )}
        {failures.map((failure, index) => (
          <p className="muted" key={index}>{stageNames[failure.stage]} · 安全失败码：{failure.errorCode}</p>
        ))}
        {props.runtimeLogs.some((entry) => entry.kind === 'failed')
          ? <RuntimeLogPanel entries={props.runtimeLogs} onClear={props.onClearLogs} />
          : <Empty>本次页面尚无错误。</Empty>}
        <RequestUsage saveId={props.saveId} />
      </div>
    </section>
  );
}
