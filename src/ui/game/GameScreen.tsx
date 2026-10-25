import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { completeTurnDraft } from '../../domain/turnCommit';
import type { TurnCommitResult } from '../../services/storage/saveRepository';
import { DataError } from '../../domain/common';
import { storyError } from '../../workflows/storyStage';
import { assessSummary } from '../../domain/memories/summary';
import { useMemoryMaintenance } from './useMemoryMaintenance';
import { RequestUsage } from './RequestUsage';
import { StoryInspectionPanel } from './StoryInspectionPanel';
import { MemoryMaintenanceControls } from '../panels/MemoryMaintenanceControls';
import type { OpeningStart } from './openingStart';

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
}) {
  const [panel, setPanel] = useState<PanelName | '人物档案' | '经济与资产'>();
  const compactSidebars = useSyncExternalStore(subscribeSidebarSize, () => window.matchMedia(sidebarMedia).matches, () => false);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submitLock = useRef(false),
    submitToken = useRef(0);
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
  } = useStoryGeneration(repository, draft, settings, companionProfile, onDraftSaved);
  const variables = useVariableGeneration(repository, draft, settings, onDraftSaved);
  const world = useWorldGeneration(repository, draft, settings, onDraftSaved);
  const automatic = useTurnGeneration(repository, draft, settings, companionProfile, onDraftSaved);
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
  const memory = useMemoryMaintenance(repository, state.saveId, settings, onMemorySaved);
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
  async function send() {
    if (!draft || !canCommit || busy || submitLock.current || !input.trim()) return;
    submitLock.current = true;
    const token = submitToken.current;
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await repository.commitTurn({
        draft,
        nextAction: input,
        useVariableStage: settings.runtime.useVariableStage,
        useWorldStage: settings.runtime.useWorldStage,
      });
      if (submitToken.current !== token) return;
      onCommitted(result);
      if (!result.replayed) void memory.run(true);
      setInput('');
      setSubmitting(false);
      // 发送明确授权下一轮请求；重复回执只恢复数据库真值，不再次发起付费生成。
      if (!result.replayed) await automatic.generate(result.draft);
    } catch (failure) {
      if (submitToken.current === token)
        setSubmitError(
          failure instanceof DataError && failure.code === 'TURN_TIME_REQUIRED'
            ? '本回合尚未推进时间，未正式结算。请补算变量；正文无需写出时间。'
            : failure instanceof DataError && failure.code === 'MISSING_SUMMARY'
            ? '正文缺少有效摘要，未正式结算。请重新生成正文后重试。'
            : failure instanceof DataError
            ? '结算未完成：候选不完整、版本冲突或存储失败。请重新读取或补齐草稿后重试。'
            : storyError(failure),
        );
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
  const options = draft?.story?.actionOptions;
  const workflowError = error || variables.error || world.error || automatic.error || submitError;
  const failedStage = (['story', 'variables', 'world'] as const).some((stage) => draft?.stageStatus[stage] === 'failed');
  // 仅用于入口展示，与 TurnCoordinator 的 needed 条件保持一致；实际执行仍由协调器重验。
  const storyNeeded = !draft?.story || draft.stageStatus.story !== 'ready';
  const variablesNeeded = settings.runtime.useVariableStage &&
    (draft?.stageStatus.variables !== 'ready' || draft.variables?.validation !== 'validated' || storyNeeded);
  const worldNeeded = settings.runtime.useWorldStage &&
    (!draft?.world || !['ready', 'preview'].includes(draft.stageStatus.world) || variablesNeeded || storyNeeded);
  const canGenerate = Boolean(validDraft && (storyNeeded || variablesNeeded || worldNeeded));
  const disabledGuidance = !settings.runtime.useVariableStage && !settings.runtime.useWorldStage
    ? '变量管理和动态世界阶段已关闭。需要启用并完成必要候选后，才能正式结算本回合。'
    : !settings.runtime.useVariableStage
      ? draft?.world?.validation === 'preview'
        ? '变量阶段未启用，当前世界结果仅为预览。请启用变量阶段并补全必要候选。'
        : '变量阶段已关闭。需要启用该阶段并完成候选后，才能正式结算本回合。'
      : !settings.runtime.useWorldStage
        ? '动态世界阶段已关闭。需要启用该阶段并完成候选后，才能正式结算本回合。'
        : '';
  const workflowGuidance = validDraft && !busy && !canCommit
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

  const workflowLabel = submitting ? '正在正式结算'
    : automatic.running ? automatic.progress
      ? { story: '正在生成正文', variables: '正在整理变量', world: '正在更新世界' }[automatic.progress.stage]
      : '正在检查执行条件'
    : progress ? '正在生成正文'
    : variables.phase ? '正在整理变量'
    : world.phase ? '正在更新世界'
    : workflowError?.includes('取消') ? '已取消 · 可恢复'
    : workflowError || failedStage ? '需要处理'
    : canCommit ? '三阶段候选已完成 · 可发送行动'
    : automatic.outcome && automatic.outcome.draft.draftRevision === draft?.draftRevision && automatic.outcome.status === 'skipped' ? '需要处理 · 已按开关跳过'
    : draft?.stageStatus.world === 'preview' ? '需要处理 · 世界仅为预览'
    : draft?.story ? '等待继续 · 部分候选已保存' : '等待开始';
  return (
    <main className="game-layout">
      <aside className="hero-sidebar" aria-label="主角信息">
        <details className="sidebar-disclosure" open={!compactSidebars}>
          <summary>主角信息 <span>{hero.name}</span></summary>
          <div className="sidebar-body" tabIndex={0} aria-label="主角信息滚动区域">
            <div className="sidebar-heading">
              <p className="eyebrow">YOUR LIFE</p>
              <span className="tag">第 {state.turnNumber} 回合</span>
            </div>
            <p className="game-clock">{dateTime(state.worldClock)}</p>
            <p className="location">⌖ {state.locations[hero.locationId]?.name || '地点未确认'}</p>
            <div className="weather">
              <span>{state.weatherText || '天气待确认'}</span>
              <p>{state.environmentText || '环境将由开局正文确立。'}</p>
            </div>
            <section>
              <div className="hero-identity">
                <span className="avatar large">{hero.name.slice(0, 1)}</span>
                <div>
                  <h2>{hero.name}</h2>
                  <p>
                    {hero.age} 岁 · {hero.gender}
                  </p>
                  <p>{hero.profession}</p>
                </div>
              </div>
              <dl>
                <Detail label="身体">{hero.healthText || '待开局确认'}</Detail>
                <Detail label="情绪">{hero.emotionText || '待开局确认'}</Detail>
              </dl>
            </section>
            <section>
              <h3>流动资金</h3>
              <dl>
                <Detail label="现金">{money(state.economy.cash)}</Detail>
                <Detail label="线上资金">{money(state.economy.onlineBalance)}</Detail>
              </dl>
            </section>
            <section>
              <h3>当前穿戴与装备</h3>
              <dl>
                {equipment.map(([label, value]) => (
                  <Detail key={label} label={label}>
                    {value}
                  </Detail>
                ))}
              </dl>
            </section>
            <div className="sidebar-actions">
              <button onClick={() => setPanel('人物档案')}>查看人物档案 ↗</button>
              <button onClick={() => setPanel('经济与资产')}>经济与资产 ↗</button>
              <button onClick={onSaves}>切换存档</button>
            </div>
          </div>
        </details>
      </aside>
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
              <p className="eyebrow">第 {index + 1} 回合</p>
              <p className="prose">{entry.narrative}</p>
            </article>
          ))}
          {progress ? (
            <article className="story-entry" aria-label="流式正文预览" aria-busy="true">
              <span className="tag">临时预览 · 完整校验前不保存</span>
              <p className="prose">{progress.narrative || '正在等待正文…'}</p>
              {draft?.story && <small>原有效正文仍保留，失败或取消可恢复。</small>}
            </article>
          ) : draft?.story ? (
            <article className="story-entry">
              <span className="tag">正文草稿 · 世界状态尚未确认</span>
              <p className="prose">{draft.story.narrative}</p>
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
                <small>开局未生成时，可使用下方开始入口；配置后需要你主动继续，刷新不会自动请求。</small>
              </div>
            )
          )}
          {settings.prompts.actionOptions &&
            (!progress && options && options.length >= 3 && options.length <= 5 ? (
              <div className="action-options">
                {options.map((option) => (
                  <button key={option} onClick={() => setInput(option)}>
                    {option}
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
            {error && (
              <p className="story-error" role="alert">
                {error} 原有合法草稿已保留，可手动重试。
              </p>
            )}
            {submitError && (
              <p className="story-error" role="alert">
                {submitError}
              </p>
            )}
            {variables.error && (
              <p className="story-error" role="alert">
                {variables.error} 正文已保留，未正式结算。
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
            <section className="workflow" aria-label="三阶段工作流">
              <details className="workflow-disclosure" ref={workflowDetails}>
                <summary>
                  <span>三阶段工作流</span>
                  <strong role="status" aria-live="polite">{workflowLabel}</strong>
                </summary>
                <div className="workflow-details">
                  <p className="field-hint">仅生成候选；瞬时服务错误最多重试一次，可能产生额外 API 费用。</p>
                  <p className="field-hint">
                    {automatic.running
                      ? automatic.progress
                        ? `${{ story: '正文生成', variables: '变量管理', world: '动态世界' }[automatic.progress.stage]} · ${automatic.progress.phase === 'retrying' ? '瞬时服务错误，准备自动重试' : automatic.progress.phase === 'saving' ? '正在原子保存候选' : '正在生成'} · 第 ${automatic.progress.attempt}/2 次`
                        : '正在检查草稿、模型路由与凭证…'
                      : automatic.outcome?.draft.draftRevision === draft?.draftRevision &&
                          automatic.outcome
                        ? automatic.outcome.status === 'complete'
                          ? '三阶段候选已完成，填写下一步行动并发送以正式结算。'
                          : automatic.outcome.status === 'preview'
                            ? '世界仅为预览，缺少合法变量；未完成完整三阶段，未正式结算。'
                            : '已按开关跳过关闭阶段；未完成完整三阶段，未正式结算。'
                        : canCommit
                          ? '三阶段候选已完成，填写下一步行动并发送以正式结算。'
                          : '自动执行会保留已完成阶段，从尚未完成的阶段继续。'}
                  </p>
                  <div className="variable-actions">
                    <button disabled={!validDraft || busy} onClick={() => void generate()}>
                      {draft?.story ? '仅重新生成正文（高级）' : draft?.turnKind === 'regular' ? '生成本回合正文' : '生成开局正文'}
                    </button>
                    <small>高级手动操作：只生成正文，不自动执行后续阶段，可能产生 API 费用。</small>
                  </div>
                  <ol>
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
                            {skipped
                              ? `本次按开关跳过${draft?.[stage] ? ' · 已有候选保留' : ''}`
                              : auto
                                ? `${auto.phase === 'saving' ? '正在保存' : auto.phase === 'retrying' ? '准备重试' : '正在生成'} · 第 ${auto.attempt}/2 次`
                                : stage === 'story'
                                  ? progress
                                    ? progress.phase === 'saving'
                                      ? '完整校验通过 · 正在保存'
                                      : '正在生成 · 临时预览'
                                    : draft?.story
                                      ? '正文已生成 · 未正式结算'
                                      : error || status === 'failed'
                                        ? '本次未完成 · 可手动重试'
                                        : '待生成'
                                  : stage === 'world' && world.phase
                                    ? world.phase === 'saving'
                                      ? '正在保存世界候选'
                                      : '正在生成世界候选'
                                    : stage === 'world' && world.error
                                      ? '本次未完成 · 可手动重试'
                                      : stage === 'variables' && variables.phase
                                        ? variables.phase === 'saving'
                                          ? '校验通过 · 正在保存候选'
                                          : '正在生成变量候选'
                                        : stage === 'variables' && variables.error
                                          ? '本次未完成 · 可手动重试'
                                          : status === 'skipped'
                                            ? '用户跳过'
                                            : status === 'failed'
                                              ? stage === 'variables'
                                                ? '上次变量失败 · 可手动重试'
                                                : '上次世界失败 · 可手动重试'
                                              : status === 'ready' || status === 'preview'
                                                ? stage === 'variables'
                                                  ? '变量已完成 · 候选未正式结算'
                                                  : status === 'preview'
                                                    ? '世界预览 · 变量依赖未完成'
                                                    : '世界已完成 · 候选未正式结算'
                                                : '待执行'}
                          </small>
                        </li>
                      );
                    })}
                  </ol>
                  <details>
                    <summary>重试与变更详情</summary>
                    {summaryQuality && <p className="muted" data-testid="summary-length">
                      本回合摘要：{summaryQuality.hanCharacters} 汉字，目标约 100～200 汉字。
                      {summaryQuality.status === 'empty'
                        ? '缺少有效摘要，无法正式结算。'
                        : summaryQuality.status === 'within_target'
                          ? '符合目标范围。'
                          : '长度偏离建议范围；摘要原文保留，可继续，不会自动追加模型请求。'}
                    </p>}
                    <p className="muted">
                      三阶段结果均只保存在草稿。实际请求和 Token 统计可在设置 → 提示词管理中查看。
                      自动执行会跳过已经合法完成的阶段；填写下一步行动并发送后，当前回合与下一草稿一并原子保存。
                    </p>
                    {draft?.failures
                      .filter((failure) => failure.storyRevision === draft.storyRevision)
                      .slice(-6)
                      .map((failure, index) => (
                        <p className="muted" key={index}>
                          {{ story: '正文生成', variables: '变量管理', world: '动态世界' }[failure.stage]}{' '}
                          · 安全失败码：{failure.errorCode} · 已保存结果未正式结算
                        </p>
                      ))}
                  </details>
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
                    <small>手动启动新尝试；保留正文，使旧变量及世界候选失效，不正式结算。</small>
                  </div>
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
                    <small>保留正文及合法变量；缺少变量时仅作预览。世界候选不会自动发布或结算。</small>
                  </div>
                  {draft && (
                    <details className="bound-input">
                      <summary>本回合已绑定输入（只读）</summary>
                      <p className="prose">{draft.userInput || '未填写开局偏好，按人物资料正常生成。'}</p>
                      <small>生成与重新 Roll 始终使用此输入；下方编辑不会覆盖它。</small>
                    </details>
                  )}
                  <RequestUsage saveId={state.saveId} />
                  {draft && <StoryInspectionPanel key={`${draft.turnId}-${draft.storyRevision}`} draft={draft} />}
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
                    <small>仅保存后续尝试偏好</small>
                  </div>
                </div>
              </details>
              {workflowGuidance && <div className="field-hint" role="note" aria-label="阶段设置提示">
                <p>{workflowGuidance}</p>
                <button onClick={openRuntimeSettings} aria-controls="workflow-runtime-switches">展开高级设置</button>
              </div>}
              {(automatic.running || (!busy && !canCommit && canGenerate)) && <div className="workflow-primary">
                {automatic.running ? (
                  <button disabled={automatic.progress?.phase === 'saving'} onClick={automatic.cancel}>
                    取消自动执行
                  </button>
                ) : (
                  <button className="primary" disabled={!validDraft || busy} onClick={() => void automatic.generate()}>
                    {draft?.story || failedStage || workflowError ? '继续未完成阶段' : draft?.turnKind === 'regular' ? '自动生成本回合' : '自动生成开局'}
                  </button>
                )}
              </div>}
              {automatic.error && <div className="story-error" role="alert">
                {automatic.error} 已保存的合法上游候选仍保留，可继续未完成阶段。
                <button onClick={onOpenSettings}>打开 AI 设置</button>
              </div>}
            </section>
          </div>
          <label className="sr-only" htmlFor="player-input">
            你的行动
          </label>
          <textarea
            id="player-input"
            disabled={submitting}
            value={input}
            onFocus={(event) => {
              if (!compactSidebars) return;
              event.currentTarget.closest('main')?.querySelectorAll<HTMLDetailsElement>('.sidebar-disclosure')
                .forEach((details) => { details.open = false; });
            }}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            placeholder="填写下一步行动；发送将结算当前回合，并生成下一回合"
          />
          <div className="composer-footer">
            <span>正文为未结算草稿；生成可能产生模型费用</span>
            <div>
              {manualProgress ? (
                <button disabled={manualProgress.phase === 'saving'} onClick={cancel}>
                  {manualProgress.phase === 'saving' ? '正在保存…' : '取消生成'}
                </button>
              ) : draft?.story ? (
                <button disabled={!validDraft || busy} onClick={() => void generate()}>
                  重新 Roll
                </button>
              ) : null}
              <button
                className="primary"
                disabled={!canCommit || busy || !input.trim()}
                onClick={() => void send()}
              >
                {submitting ? '正在原子结算…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      </section>
      <aside className="world-sidebar" aria-label="世界资料">
        <details className="sidebar-disclosure" open={!compactSidebars}>
          <summary>世界资料 <span>七项资料</span></summary>
          <div className="sidebar-body" tabIndex={0} aria-label="世界资料滚动区域">
            <p className="eyebrow">WORLD ARCHIVE</p>
            <h2>世界资料</h2>
            <nav>
              {panelNames.map((name, index) => (
                <button key={name} onClick={() => setPanel(name)}>
                  <span className="nav-number">0{index + 1}</span>
                  <span>{name}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </nav>
            <div className="world-note">
              <span className="tiny-dot" />
              当前浏览器本地存档
              <p>
                从身边的人，到更远的城市。
                <br />
                已知的世界会在此留下记录。
              </p>
            </div>
          </div>
        </details>
      </aside>
      {panel && (
        <Dialog title={panel} onClose={() => setPanel(undefined)}>
          {panel === '人物档案' ? (
            <dl className="profile-details">
              {Object.entries({
                姓名: hero.name,
                年龄: hero.age,
                性别: hero.gender,
                职业: hero.profession,
                外貌: hero.appearance,
                性格: hero.personality,
                背景: hero.background,
                技能: hero.skills.join('、'),
                社会状态: hero.publicStatus || '未确认',
                法律状态: hero.legalStatus || '未确认',
              }).map(([label, value]) => (
                <Detail key={label} label={label}>
                  {value}
                </Detail>
              ))}
            </dl>
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
              {panel === '记忆' && <MemoryMaintenanceControls state={state} phase={memory.phase} notice={memory.notice}
                onRun={() => void memory.run()} onNpcRun={() => void memory.run(false, 'npc')} onCancel={memory.cancel} />}
              <Panels name={panel} view={view} />
            </>
          )}
        </Dialog>
      )}
    </main>
  );
}
