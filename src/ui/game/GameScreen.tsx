import { PlayerStatus } from './PlayerStatus';
import { ProfessionProfile } from '../components/ProfessionProfile';
import { StoryReading } from './StoryReading';
import { openingTimeSelection } from '../../domain/openingTime';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { GameState } from '../../domain/state';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { TurnDraft } from '../../domain/drafts';
import type { Settings } from '../settings/model';
import { Dialog, Detail, Empty } from '../Dialog';
import { Panels, panelNames } from '../panels/Panels';
import type { PanelName } from '../panels/Panels';
import { playerView, money, dateTime } from '../panels/playerView';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { useStoryGeneration } from './useStoryGeneration';
import { useVariableGeneration } from './useVariableGeneration';
import { VariableCandidates } from './VariableCandidates';
import { useWorldGeneration } from './useWorldGeneration';
import { WorldCandidates } from './WorldCandidates';
import { useTurnGeneration } from './useTurnGeneration';
import { completeTurnDraft, awaitingPlayerAction } from '../../domain/turnCommit';
import type { TurnCommitResult } from '../../services/storage/saveRepository';
import { DataError } from '../../domain/common';
import { storyError } from '../../workflows/storyStage';
import { assessSummary } from '../../domain/memories/summary';
import { useMemoryMaintenance } from './useMemoryMaintenance';
import { RequestUsage } from './RequestUsage';
import { StoryInspectionPanel } from './StoryInspectionPanel';
import { MemorySummarySettings } from '../settings/MemorySummarySettings';
import { fingerprint } from '../../domain/commands';
import { SettingsSchema, settingsKey } from '../settings/model';
import { summaryFailureTitle } from '../../workflows/memorySummaryQueue';
import type { OpeningStart } from './openingStart';
import { RuntimeLogPanel } from './RuntimeLogPanel';
import { runtimeLogEvent } from './runtimeLog';
import { StageResponsesPanel } from './StageResponsesPanel';
import type { RuntimeLogEntry, RuntimeLogReporter } from './runtimeLog';

const sidebarMedia = '(max-width: 900px)';
function subscribeSidebarSize(changed: () => void) {
  const media = window.matchMedia(sidebarMedia);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}

export function GameScreen({
  openingStart,
  onOpenSettings,
  state,
  draft,
  companionProfile,
  settings,
  onSettings,
  onSaves,
  repository,
  onDraftSaved,
  onCommitted,
  onMemorySaved,
  renderSettings,
}: {
  openingStart?: OpeningStart;
  onOpenSettings: () => void;
  state: GameState;
  draft?: TurnDraft;
  companionProfile?: CompanionProfile;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onSaves: () => void;
  repository: SaveRepository;
  onDraftSaved: (draft: TurnDraft) => void;
  onCommitted: (result: TurnCommitResult) => void;
  onMemorySaved: (state: GameState) => void;
  renderSettings?: (maintenance: ReactNode) => ReactNode;
}) {
  const openingTime = useMemo(() => {
    try { return draft && openingTimeSelection(state, draft); } catch { return undefined; }
  }, [state, draft]);
  const [panel, setPanel] = useState<PanelName | '人物档案' | '经济与资产'>();
  const compactSidebars = useSyncExternalStore(subscribeSidebarSize, () => window.matchMedia(sidebarMedia).matches, () => false);
  const [worldDirectoryOpen, setWorldDirectoryOpen] = useState(false);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submitLock = useRef(false),
    submitToken = useRef(0);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogEntry[]>([]);
  const runtimeLogId = useRef(0);
  const reportRuntimeEvent = useCallback<RuntimeLogReporter>((stage, kind, failure) => {
    const entry = runtimeLogEvent(++runtimeLogId.current, stage, kind, failure);
    setRuntimeLogs((current) => [...current.slice(-49), entry]);
  }, []);
  useEffect(
    () => () => {
      submitToken.current++;
    },
    [],
  );
  const {
    generate,
    cancel,
    progress: manualProgress,
    error,
  } = useStoryGeneration(repository, draft, settings, companionProfile, onDraftSaved, reportRuntimeEvent);
  const variables = useVariableGeneration(repository, draft, settings, onDraftSaved, reportRuntimeEvent);
  const world = useWorldGeneration(repository, draft, settings, onDraftSaved, reportRuntimeEvent);
  const automatic = useTurnGeneration(repository, draft, settings, companionProfile, onDraftSaved, reportRuntimeEvent, handleSettled);
  // 延后一微任务，让 StrictMode 的首次 effect 清理先完成。消费的是创角事件授权，
  // 而不是“草稿没有正文”；刷新、读档和重新挂载没有新的授权。
  useEffect(() => {
    if (!openingStart) return;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      if (window.location.hash !== `#game/${state.saveId}`) { openingStart.revoke(); return; }
      if (openingStart.claim(state, draft)) void automatic.generate(draft);
    });
    return () => { disposed = true; };
  }, [openingStart, state, draft, automatic.generate]);
  const memory = useMemoryMaintenance(repository, state.saveId, settings, onMemorySaved, onSettings);
  function handleSettled(result: TurnCommitResult) {
    onCommitted(result);
    if (!result.replayed) void memory.run(true);
  }
  const progress =
    automatic.progress?.stage === 'story' && automatic.progress.phase !== 'retrying'
      ? { phase: automatic.progress.phase, narrative: automatic.progress.narrative ?? '' }
      : manualProgress;
  const busy = Boolean(
    submitting || automatic.running || progress || variables.phase || world.phase,
  );
  const reader = useRef<HTMLDivElement>(null);
  const workflowDetails = useRef<HTMLDetailsElement>(null);
  const runtimeSwitches = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const validDraft =
    draft &&
    draft.baseSaveRevision === state.revision &&
    !state.journal.some((entry) => entry.turnId === draft.turnId) &&
    (draft.turnKind !== 'opening' || state.turnNumber === 0);
  const canCommit = Boolean(validDraft && draft && completeTurnDraft(draft));
  const awaitingAction = awaitingPlayerAction(state, draft);
  async function send() {
    if (!draft || (!canCommit && !awaitingAction) || busy || submitLock.current || !input.trim()) return;
    submitLock.current = true;
    const token = submitToken.current;
    setSubmitting(true);
    setSubmitError('');
    try {
      if (awaitingAction) {
        const bound = await repository.bindTurnAction(draft, input, settings.runtime.useVariableStage, settings.runtime.useWorldStage);
        if (submitToken.current !== token) return;
        onDraftSaved(bound); setInput(''); setSubmitting(false);
        await automatic.generate(bound);
        return;
      }
      // 兼容升级前尚未结算的完整候选；用户本次输入仅绑定一次。
      reportRuntimeEvent('commit', 'started');
      const result = await repository.commitTurn({
        draft,
        nextAction: input,
        useVariableStage: settings.runtime.useVariableStage,
        useWorldStage: settings.runtime.useWorldStage,
      });
      if (submitToken.current !== token) return;
      reportRuntimeEvent('commit', 'completed');
      onCommitted(result);
      if (!result.replayed) void memory.run(true);
      setInput('');
      setSubmitting(false);
      // 发送明确授权下一轮请求；重复回执只恢复数据库真值，不再次发起付费生成。
      if (!result.replayed) await automatic.generate(result.draft);
    } catch (failure) {
      if (submitToken.current === token) {
        reportRuntimeEvent(awaitingAction ? 'workflow' : 'commit', 'failed', failure);
        setSubmitError(
          awaitingAction
            ? '行动未发送：草稿版本冲突或存储失败。输入仍保留，请重新读取存档后重试。'
            : failure instanceof DataError && failure.code === 'TURN_TIME_REQUIRED'
            ? '本回合尚未推进时间，未正式结算。请补算变量；正文无需写出时间。'
            : failure instanceof DataError && failure.code === 'MISSING_SUMMARY'
            ? '正文缺少有效摘要，未正式结算。请重新生成正文后重试。'
            : failure instanceof DataError
            ? '结算未完成：候选不完整、版本冲突或存储失败。请重新读取或补齐草稿后重试。'
            : storyError(failure),
        );
      }
    } finally {
      if (submitToken.current === token) {
        submitLock.current = false;
        setSubmitting(false);
      }
    }
  }
  useEffect(() => {
    if (follow.current && reader.current) reader.current.scrollTop = reader.current.scrollHeight;
  }, [progress?.narrative, draft?.storyRevision]);
  const view = useMemo(() => playerView(state, companionProfile, settings.memory.immediateWindowSize), [state, companionProfile, settings.memory.immediateWindowSize]);
  const summaryQuality = draft?.story ? assessSummary(draft.story.summary) : undefined;
  const hero = state.protagonist;
  const itemName = (id?: string) => (id ? state.items[id]?.name || '无' : '无');
  const equipment: [string, string][] = [
    ['上衣', itemName(hero.currentWear.topItemId)],
    ['下装', itemName(hero.currentWear.bottomItemId)],
    ['鞋子', itemName(hero.currentWear.shoesItemId)],
    ['饰品', hero.currentWear.accessoryItemIds.map(itemName).join('、') || '无'],
    ['主武器', itemName(hero.currentWear.primaryWeaponItemId)],
    ['副武器', itemName(hero.currentWear.secondaryWeaponItemId)],
    [
      '载具',
      hero.currentWear.currentVehicleAssetId
        ? state.economy.vehicles[hero.currentWear.currentVehicleAssetId]?.name || '无'
        : '无',
    ],
  ];
  const ownedAssets = [
    ...Object.values(state.economy.properties),
    ...Object.values(state.economy.vehicles),
    ...Object.values(state.economy.otherAssets),
  ].filter((asset) => asset.ownerRef.kind === 'protagonist' && asset.ownerRef.id === hero.id);
  const options = draft?.story?.actionOptions ?? (awaitingAction ? state.journal.at(-1)?.story.actionOptions : undefined);
  const workflowError = error || variables.error || world.error || automatic.error || submitError;
  const failedStage = (['story', 'variables', 'world'] as const).some((stage) => draft?.stageStatus[stage] === 'failed');
  // 仅用于入口展示，与 TurnCoordinator 的 needed 条件保持一致；实际执行仍由协调器重验。
  const storyNeeded = !draft?.story || draft.stageStatus.story !== 'ready';
  const variablesNeeded = settings.runtime.useVariableStage &&
    (draft?.stageStatus.variables !== 'ready' || draft.variables?.validation !== 'validated' || storyNeeded);
  const worldNeeded = settings.runtime.useWorldStage &&
    (!draft?.world || !['ready', 'preview'].includes(draft.stageStatus.world) || variablesNeeded || storyNeeded);
  const canGenerate = Boolean(validDraft && !awaitingAction && (storyNeeded || variablesNeeded || worldNeeded));
  const disabledGuidance = !settings.runtime.useVariableStage && !settings.runtime.useWorldStage
    ? '变量管理和动态世界阶段已关闭。需要启用并完成必要候选后，才能正式结算本回合。'
    : !settings.runtime.useVariableStage
      ? draft?.world?.validation === 'preview'
        ? '变量阶段未启用，当前世界结果仅为预览。请启用变量阶段并补全必要候选。'
        : '变量阶段已关闭。需要启用该阶段并完成候选后，才能正式结算本回合。'
      : !settings.runtime.useWorldStage
        ? '动态世界阶段已关闭。需要启用该阶段并完成候选后，才能正式结算本回合。'
        : '';
  const workflowGuidance = validDraft && !awaitingAction && !busy && !canCommit
    ? disabledGuidance || (!canGenerate
      ? draft?.world?.validation === 'preview'
        ? '当前世界结果仅为预览。请在高级操作中补算世界候选，完成后才能正式结算。'
        : '当前候选尚不满足正式结算条件。请展开高级设置检查并补算必要候选。'
      : '')
    : '';
  function openRuntimeSettings() {
    if (workflowDetails.current) workflowDetails.current.open = true;
    runtimeSwitches.current?.scrollIntoView({ block: 'nearest' });
    (runtimeSwitches.current?.querySelector<HTMLInputElement>('input:not(:checked)') ??
      runtimeSwitches.current?.querySelector<HTMLInputElement>('input'))?.focus({ preventScroll: true });
  }

  const stageLabels = { story: '正文', variables: '变量', world: '动态世界' };
  const activeStage = automatic.running ? automatic.progress?.stage
    : progress ? 'story' : variables.phase ? 'variables' : world.phase ? 'world' : undefined;
  const activePhase = automatic.running ? automatic.progress?.phase
    : progress?.phase || variables.phase || world.phase;
  // Hook 错误可能在其他入口恢复成功后仍保留；展示优先使用最新运行结果。
  const latestResult = [...runtimeLogs].reverse().find((entry) => entry.kind !== 'started');
  const currentFailure = latestResult && latestResult.kind !== 'completed' ? latestResult : undefined;
  const hasWorkflowError = Boolean(failedStage || (workflowError && (!latestResult || currentFailure)));
  const errorStage = currentFailure?.stage
    ?? (['story', 'variables', 'world'] as const).find((stage) => draft?.stageStatus[stage] === 'failed')
    ?? (error ? 'story' : variables.error ? 'variables' : world.error ? 'world' : undefined);
  const errorLabel = errorStage && errorStage in stageLabels ? stageLabels[errorStage as keyof typeof stageLabels]
    : errorStage === 'commit' ? '结算' : '';
  const workflowLabel = submitting ? (awaitingAction ? '正在发送行动' : '正在正式结算')
    : automatic.settling ? '正在正式结算'
    : activeStage ? `${stageLabels[activeStage]}${activePhase === 'saving' ? '保存中' : activePhase === 'retrying' ? '重试中' : '生成中'} · ${{ story: 1, variables: 2, world: 3 }[activeStage]}/3`
    : automatic.running ? '正在准备生成'
    : hasWorkflowError && submitError ? `${awaitingAction ? '行动发送' : '结算'}失败 · 查看详情`
    : hasWorkflowError && (currentFailure?.kind === 'cancelled' || currentFailure?.code === 'cancelled') ? '已取消 · 可恢复'
    : hasWorkflowError ? `${errorLabel}${errorStage === 'commit' ? '' : '生成'}失败 · 查看详情`
    : awaitingAction ? '本回合已结算 · 等待行动'
    : !validDraft ? '草稿不可用 · 查看详情'
    : canCommit ? '候选已完成 · 等待结算'
    : workflowGuidance ? draft?.stageStatus.world === 'preview' ? '世界仅为预览 · 查看详情' : disabledGuidance ? '阶段已关闭 · 查看详情' : '候选未就绪 · 查看详情'
    : draft?.story ? '等待继续 · 部分已完成' : '等待开始';
  const worldNavigation = <aside className="world-sidebar" aria-label="世界资料">
    <h2>世界资料</h2>
    <nav aria-label="世界资料分类">
      {panelNames.map((name, index) => <button key={name} onClick={() => setPanel(name)}>
        <span className="dock-seal" aria-hidden="true">{['人', '势', '图', '物', '事', '史', '忆'][index]}</span>
        <span>{name}</span>
      </button>)}
    </nav>
    {!compactSidebars && <nav className="dock-system" aria-label="系统操作">
      <button onClick={onOpenSettings}><span className="dock-seal" aria-hidden="true">设</span><span>设置</span></button>
      <button onClick={onSaves}><span className="dock-seal" aria-hidden="true">归</span><span>返回首页</span></button>
    </nav>}
  </aside>;
  return (
    <main className="game-layout">
      <PlayerStatus state={state} onProfile={() => setPanel('人物档案')} onEconomy={() => setPanel('经济与资产')} />
      <section className="story-column" aria-label="剧情与行动">
        <div
          className={`reader ${!view.journal.length && !draft?.story && !progress ? 'reader-empty' : ''}`}
          ref={reader}
          onScroll={() => {
            const element = reader.current!;
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
            setFollowing(follow.current);
          }}
          data-testid="story-reader"
          tabIndex={0}
          aria-label="正文阅读区域"
        >
          <div className="reader-heading">
            <span className="eyebrow">THE STORY</span>
            <span className="tag">
              {progress
                ? '生成预览 · 尚未保存'
                : draft?.story
                  ? '已保存草稿'
                  : state.journal.length
                    ? '已结算历史'
                    : '等待开局'}
            </span>
          </div>
          {view.journal.map((entry, index) => (
            <article className="story-entry" key={entry.turnId}>
              <h2 className="chapter-heading">第 {index + 1} 回合</h2>
              <StoryReading narrative={entry.narrative} protagonistName={hero.name} />
            </article>
          ))}
          {progress ? (
            <article className="story-entry" aria-label="流式正文预览" aria-busy="true">
              <h2 className="chapter-heading">第 {state.turnNumber + 1} 回合</h2>
              <span className="tag">临时预览 · 完整校验前不保存</span>
              <p className="prose">{progress.narrative || '正在等待正文…'}</p>
            </article>
          ) : draft?.story ? (
            <article className="story-entry">
              <h2 className="chapter-heading">第 {state.turnNumber + 1} 回合</h2>
              <span className="tag">正文草稿 · 世界状态尚未确认</span>
              <StoryReading narrative={draft.story.narrative} protagonistName={hero.name} />
            </article>
          ) : (
            !view.journal.length && (
              <div className="opening-empty">
                <span className="opening-mark" aria-hidden="true">
                  序
                </span>
                <p className="eyebrow">A CITY. A TURNING POINT.</p>
                <h1>故事，尚未落笔。</h1>
                <p>
                  你的资料已保存。
                  <br />
                  配置 AI 渠道后，即可生成这座城市中的第一幕。
                </p>
              </div>
            )
          )}
          {settings.prompts.actionOptions &&
            (!progress && options && options.length >= 3 && options.length <= 5 ? (
              <div className="action-options" aria-label="行动建议">
                <p>接下来你想做什么</p>
                {options.map((option, index) => (
                  <button key={option} onClick={() => setInput(option)}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span>{option}</span><span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="field-hint">行动建议将在正文生成后显示。</p>
            ))}
        </div>
        <div className="composer">
          <div className="composer-tools">
            {progress && !following && (
              <button
                onClick={() => {
                  follow.current = true;
                  setFollowing(true);
                  if (reader.current) reader.current.scrollTop = reader.current.scrollHeight;
                }}
              >
                跟随最新正文 ↓
              </button>
            )}
            <section className="workflow" aria-label="三阶段工作流" data-state={hasWorkflowError ? 'error' : busy ? 'busy' : awaitingAction ? 'settled' : 'pending'}>
              <details className="workflow-disclosure" ref={workflowDetails}>
                <summary>
                  <strong role="status" aria-live="polite"><span className="workflow-prefix">三阶段 · </span>{workflowLabel}</strong>
                  <span className="workflow-toggle">详情</span>
                </summary>
                <div className="workflow-details">
                  {workflowGuidance && <div className="field-hint" role="note" aria-label="阶段设置提示">
                    <p>{workflowGuidance}</p>
                    <button onClick={openRuntimeSettings} aria-controls="workflow-runtime-switches">展开高级设置</button>
                  </div>}
                  {(automatic.running || (!busy && (canCommit || canGenerate))) && <div className="workflow-primary">
                    {automatic.running ? (
                      <button disabled={automatic.settling || automatic.progress?.phase === 'saving'} onClick={automatic.cancel}>
                        取消自动执行
                      </button>
                    ) : (
                      <button className="primary" disabled={!validDraft || busy} onClick={() => void automatic.generate()}>
                        {canCommit ? '完成本回合结算' : draft?.story || failedStage || workflowError ? '继续未完成阶段' : draft?.turnKind === 'regular' ? '自动生成本回合' : '自动生成开局'}
                      </button>
                    )}
                  </div>}
                  {automatic.error && <div className="story-error" role="alert">
                    {automatic.error}
                    <button onClick={onOpenSettings}>打开 AI 设置</button>
                  </div>}
                  {error && (
                    <p className="story-error" role="alert">
                      {error}
                    </p>
                  )}
                  {submitError && (
                    <p className="story-error" role="alert">
                      {submitError}
                    </p>
                  )}
                  {variables.error && (
                    <p className="story-error" role="alert">
                      {variables.error}
                    </p>
                  )}
                  {world.error && <p className="story-error" role="alert">{world.error}</p>}
                  {!validDraft && (
                    <p className="field-hint">
                      {draft
                        ? '当前草稿已过期，请重新读取存档。'
                        : '没有可执行的回合草稿。请重新读取存档；暂时无法生成或结算。'}
                    </p>
                  )}
                  <p className="workflow-fee">生成可能产生第三方 API 费用。</p>
                  <ol className="workflow-stages">
                    {(['story', 'variables', 'world'] as const).map((stage, i) => {
                      const status = draft?.stageStatus[stage];
                      const auto = automatic.progress?.stage === stage ? automatic.progress : undefined;
                      const skipped =
                        automatic.outcome?.draft.draftRevision === draft?.draftRevision &&
                        automatic.outcome?.skipped.includes(stage);
                      return (
                        <li key={stage}>
                          <span className="stage-number">0{i + 1}</span>
                          <strong>{['正文生成', '变量管理', '动态世界'][i]}</strong>
                          <small>
                            {awaitingAction ? '已结算'
                              : auto ? auto.phase === 'saving' ? '保存中' : auto.phase === 'retrying' ? '重试中' : '生成中'
                              : activeStage === stage ? activePhase === 'saving' ? '保存中' : '生成中'
                              : (stage === 'variables' && !settings.runtime.useVariableStage) || (stage === 'world' && !settings.runtime.useWorldStage) ? '已关闭'
                              : skipped || status === 'skipped' ? '已跳过'
                              : status === 'failed' || errorStage === stage && hasWorkflowError ? '失败 · 可重试'
                              : status === 'preview' ? '仅预览'
                              : status === 'ready' ? '已完成' : '待生成'}
                          </small>
                          {stage === 'story' ? (
                            <p className="stage-action-hint">正文生成与重新 Roll 位于行动输入旁。</p>
                          ) : stage === 'variables' ? (
                            <div className="variable-actions">
                              {variables.phase ? (
                                <button disabled={variables.phase === 'saving'} onClick={variables.cancel}>
                                  取消变量生成
                                </button>
                              ) : (
                                <button
                                  disabled={
                                    !validDraft ||
                                    !draft?.story ||
                                    draft.stageStatus.story !== 'ready' ||
                                    !settings.runtime.useVariableStage ||
                                    busy
                                  }
                                  onClick={() => void variables.generate()}
                                >
                                  {draft?.variables
                                    ? '重新生成变量候选'
                                    : draft?.useVariableStage === false
                                      ? '启用并补算变量'
                                      : '生成变量候选'}
                                </button>
                              )}
                              {draft?.variables && (
                                <VariableCandidates key={`${draft.turnId}-${draft.draftRevision}`} draft={draft} />
                              )}
                            </div>
                          ) : (
                            <div className="variable-actions">
                              {world.phase ? (
                                <button disabled={world.phase === 'saving'} onClick={world.cancel}>
                                  取消世界生成
                                </button>
                              ) : (
                                <button
                                  disabled={
                                    !validDraft ||
                                    !draft?.story ||
                                    draft.stageStatus.story !== 'ready' ||
                                    !settings.runtime.useWorldStage ||
                                    busy
                                  }
                                  onClick={() => void world.generate()}
                                >
                                  {draft?.world
                                    ? '重新生成世界候选'
                                    : draft?.useWorldStage === false
                                      ? '启用并补算世界'
                                      : '生成世界候选'}
                                </button>
                              )}
                              {draft?.world && (
                                <WorldCandidates key={`${draft.turnId}-${draft.draftRevision}`} draft={draft} />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <details className="workflow-diagnostics">
                    <summary>重试与变更详情</summary>
                    {summaryQuality && <p className="muted" data-testid="summary-length">
                      本回合摘要：{summaryQuality.hanCharacters} 汉字。
                      {summaryQuality.status === 'empty'
                        ? '缺少有效摘要，无法正式结算。'
                        : summaryQuality.status === 'within_target'
                          ? '符合目标范围。'
                          : '可继续。'}
                    </p>}
                    {draft?.failures
                      .filter((failure) => failure.storyRevision === draft.storyRevision)
                      .slice(-6)
                      .map((failure, index) => (
                        <p className="muted" key={index}>
                          {{ story: '正文生成', variables: '变量管理', world: '动态世界' }[failure.stage]}{' '}
                          · 安全失败码：{failure.errorCode}
                        </p>
                      ))}
                    {runtimeLogs.some((entry) => entry.kind === 'failed') && (
                      <RuntimeLogPanel entries={runtimeLogs} onClear={() => setRuntimeLogs([])} />
                    )}
                    <StageResponsesPanel saveId={state.saveId} turnId={awaitingAction ? state.journal.at(-1)?.turnId : draft?.turnId} />
                    <RequestUsage saveId={state.saveId} />
                    {draft && <StoryInspectionPanel key={`${draft.turnId}-${draft.storyRevision}`} draft={draft} />}
                  </details>
                  {draft && (
                    <details className="bound-input">
                      <summary>本回合已绑定输入（只读）</summary>
                      <p className="prose">{draft.userInput || '未填写开局偏好，按人物资料正常生成。'}</p>
                    </details>
                  )}
                  <div className="runtime-switches" id="workflow-runtime-switches" ref={runtimeSwitches}>
                    {(
                      [
                        ['useVariableStage', '变量管理'],
                        ['useWorldStage', '动态世界'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="toggle" key={key}>
                        <input
                          type="checkbox"
                          checked={settings.runtime[key]}
                          onChange={(e) =>
                            onSettings({
                              ...settings,
                              runtime: { ...settings.runtime, [key]: e.target.checked },
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            </section>
          </div>
          <div className="composer-action-row">
            <div className="composer-roll">
              {manualProgress ? (
                <button disabled={manualProgress.phase === 'saving'} onClick={cancel}>
                  {manualProgress.phase === 'saving' ? '正在保存…' : '取消生成'}
                </button>
              ) : (
                <button disabled={!validDraft || awaitingAction || busy}
                  title={awaitingAction ? '本回合已结算；发送新行动后继续' : undefined}
                  onClick={() => void generate()}>
                  {awaitingAction || draft?.story ? '重新 Roll' : draft?.turnKind === 'regular' ? '生成本回合正文' : '生成开局正文'}
                </button>
              )}
            </div>
            <label className="sr-only" htmlFor="player-input">你的行动</label>
            <textarea id="player-input" disabled={submitting} value={input}
              onChange={(e) => setInput(e.target.value)} rows={2}
              placeholder={compactSidebars ? '填写你的行动' : '填写你的行动；发送后生成三阶段并自动结算'} />
            <div className="composer-footer">
              <button className="primary" disabled={(!canCommit && !awaitingAction) || busy || !input.trim()}
                onClick={() => void send()}>{submitting ? '正在结算…' : '发送'}</button>
            </div>
          </div>
        </div>
      </section>
      {!compactSidebars && worldNavigation}
      <nav className="mobile-game-nav" aria-label="底部导航">
        <button aria-current={!panel && !worldDirectoryOpen && !renderSettings ? 'page' : undefined}
          onClick={() => { reader.current?.focus({ preventScroll: true }); }}>故事</button>
        <button onClick={() => setPanel('人物档案')}>人物</button>
        <button onClick={() => setWorldDirectoryOpen(true)}>世界资料</button>
        <button onClick={onOpenSettings}>设置</button>
      </nav>
      {compactSidebars && worldDirectoryOpen && <Dialog title="世界资料" className="world-directory" onClose={() => setWorldDirectoryOpen(false)}>
        <p className="muted">从身边的人，到更远的城市。</p>
        {worldNavigation}
      </Dialog>}
      {panel && (
        <Dialog title={panel} className={panel === '物品栏' ? 'inventory-dialog' : ''} onClose={() => setPanel(undefined)}>
          {panel === '人物档案' ? (
            <>
            <dl className="profile-details">
              {Object.entries({
                姓名: hero.name,
                年龄: hero.age,
                性别: hero.gender,
                外貌: hero.appearance,
                性格: hero.personality,
                背景: hero.background,
                职业: hero.profession,
                当前时间: state.openingTimePending ? '开局时间待确认' : dateTime(state.worldClock),
                候选时间: openingTime ? `${dateTime(openingTime.endAt)}（未正式结算）` : undefined,
                地点: state.locations[hero.locationId]?.name || '地点未确认',
                天气: state.weatherText || '天气待确认',
                环境: state.environmentText || '环境将由开局正文确立。',
                身体: hero.healthText || '待开局确认',
                情绪: hero.emotionText || '待开局确认',
                社会状态: hero.publicStatus || '未确认',
                法律状态: hero.legalStatus || '未确认',
              }).map(([label, value]) => (
                <Detail key={label} label={label}>
                  {value}
                </Detail>
              ))}
            </dl>
            <ProfessionProfile hero={hero} />
            <h3>当前穿戴与装备</h3>
            <dl>{equipment.map(([label, value]) => <Detail key={label} label={label}>{value}</Detail>)}</dl>
            <div className="profile-entrypoints">
              <button onClick={() => setPanel('经济与资产')}>经济与资产</button>
              <button onClick={() => setPanel('NPC')}>NPC 人物资料</button>
              <button onClick={onSaves}>切换存档</button>
            </div>
            </>
          ) : panel === '经济与资产' ? (
            <>
              <div className="metric-row">
                <span>现金 {money(state.economy.cash)}</span>
                <span>线上资金 {money(state.economy.onlineBalance)}</span>
              </div>
              <h3>收入</h3>
              {Object.values(state.economy.incomes).map((income) => (
                <article className="card entry" key={income.id}>
                  <h4>{income.source}</h4>
                  <p>
                    {money(income.amount)} ·{' '}
                    {income.status === 'received'
                      ? '已到账'
                      : income.status === 'expected'
                        ? '待确认收入'
                        : '已取消'}
                  </p>
                  <p>{income.scheduleText}</p>
                </article>
              ))}
              {!Object.keys(state.economy.incomes).length && <Empty>暂无收入记录</Empty>}
              <h3>债务</h3>
              {Object.values(state.economy.debts).map((debt) => (
                <article className="card entry" key={debt.id}>
                  <h4>{debt.creditor}</h4>
                  <p>
                    本金 {money(debt.principal)} · 未偿本金 {money(debt.outstanding)}
                  </p>
                  <p>{debt.repaymentTerms}</p>
                </article>
              ))}
              {!Object.keys(state.economy.debts).length && <Empty>暂无债务记录</Empty>}
              {(['property', 'vehicle', 'other'] as const).map((kind, i) => (
                <section key={kind}>
                  <h3>{['房产', '车辆', '其他资产'][i]}</h3>
                  {ownedAssets
                    .filter((a) => a.kind === kind)
                    .map((asset) => (
                      <article className="card entry" key={asset.id}>
                        <h4>{asset.name}</h4>
                        <p>
                          估值 {money(asset.estimatedValue)} · {asset.statusText}
                        </p>
                        <p>来源：{asset.source}</p>
                      </article>
                    ))}
                  {!ownedAssets.some((a) => a.kind === kind) && <Empty>暂无记录</Empty>}
                </section>
              ))}
            </>
          ) : (
            <>
              <Panels name={panel} view={view} />
            </>
          )}
        </Dialog>
      )}
      {renderSettings?.(<MemorySummarySettings state={state} settings={settings} onSave={next => {
        onSettings(next);
        const saved = SettingsSchema.parse(JSON.parse(localStorage.getItem(settingsKey) || 'null'));
        if (fingerprint(saved.memory.summaries) !== fingerprint(next.memory.summaries)) throw new Error('summary settings not saved');
      }} phase={memory.phase} activeKind={memory.activeKind} notice={memory.notice}
        onRun={(kind, npcId) => void memory.run(false, kind, npcId)} onCancel={memory.cancel} />)}
      {memory.failures[0] && <Dialog title={summaryFailureTitle(memory.failures[0])} small onClose={() => memory.closeFailure(memory.failures[0].kind)}>
        <p>{memory.failures[0].message}</p><p>原始记忆仍保留；重新生成可能产生 API 费用。</p>
        <button disabled={Boolean(memory.phase)} onClick={() => void memory.run(false, memory.failures[0].kind, memory.failures[0].npcId)}>重新生成</button>
        <button disabled={Boolean(memory.phase)} onClick={() => memory.pause(memory.failures[0].kind)}>暂停本项总结</button>
      </Dialog>}
    </main>
  );
}
