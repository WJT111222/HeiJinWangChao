import { useNpcManagement } from './useNpcManagement';
import type { NpcManagementResult } from './npcManagement';
import { ArchivePanel } from '../ArchivePanel';
import { NpcPanel } from '../panels/NpcPanel';
import { OrganizationPanel } from '../panels/OrganizationPanel';
import { ProfilePanel } from '../panels/ProfilePanel';
import { InventoryPanel } from '../panels/InventoryPanel';
import { EconomyPanel } from '../panels/EconomyPanel';
import { WorldEventsPanel } from '../panels/WorldEventsPanel';
import type { WorldEventsUiState } from '../panels/WorldEventsPanel';
import { HistoryPanel } from '../panels/HistoryPanel';
import type { HistoryUiState } from '../panels/HistoryPanel';
import { MapPanel } from '../panels/MapPanel';
import type { MapUiState } from '../panels/mapView';
import { MemoryPanel } from '../panels/MemoryPanel';
import type { MemoryUiState } from '../panels/MemoryPanel';
import { TurnChanges } from './TurnChanges';
import type { ChangeTarget } from './turnChanges';
import { mapProjection } from '../panels/mapView';
import { PlayerStatus } from './PlayerStatus';
import { TurnUndoControl } from './TurnUndoControl';
import type { TurnUndoResult } from '../../services/storage/saveRepository';
import { ProfessionProfile } from '../components/ProfessionProfile';
import { StoryReading } from './StoryReading';
import { openingTimeSelection } from '../../domain/openingTime';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { GameState } from '../../domain/state';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { TurnDraft } from '../../domain/drafts';
import type { Settings } from '../settings/model';
import { Dialog, Detail, Empty } from '../Dialog';
import { Panels, panelNames } from '../panels/Panels';
import type { PanelName } from '../panels/Panels';
import { playerView, money, dateTime } from '../panels/playerView';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { mayStartStory } from './storyGenerationPolicy';
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
import { DesktopWorkflowPanel, stepState } from './WorkflowPanel';
import type { StageAction, WorkflowStage, WorkflowTab, WorkflowView } from './WorkflowPanel';
import type { RuntimeLogEntry, RuntimeLogReporter } from './runtimeLog';
import { CityAtmosphere, CityBar, CityChapter } from './CityNight';
import { deriveAtmosphere } from './atmosphere';
import './city-night.css';
import './workflow-feedback.css';
import './mobile-game.css';
import {MobileCityBar,MobileStatus,mobileCitySeal} from './MobileCity';
import {MobileActions} from './MobileActions';
import {ComposerTools} from './ComposerTools';
import { Feedback } from '../Feedback';

const sidebarMedia = '(max-width: 900px)';
function subscribeSidebarSize(changed: () => void) {
  const media = window.matchMedia(sidebarMedia);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}

export function GameScreen({
  openingStart,
  onOpenSettings,
  onCloseSettings,
  state,
  draft,
  companionProfile,
  settings,
  onSettings,
  onSaves,
  repository,
  onDraftSaved,
  onCommitted,
  onUndone,
  onMemorySaved,
  onNpcManaged,
  renderSettings,
}: {
  openingStart?: OpeningStart;
  onOpenSettings: () => void;
  onCloseSettings?: (afterClose?:()=>void)=>void;
  state: GameState;
  draft?: TurnDraft;
  companionProfile?: CompanionProfile;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onSaves: () => void;
  repository: SaveRepository;
  onDraftSaved: (draft: TurnDraft) => void;
  onCommitted: (result: TurnCommitResult) => void;
  onUndone: (result: TurnUndoResult) => void;
  onMemorySaved: (state: GameState) => void;
  onNpcManaged: (result: NpcManagementResult) => void;
  renderSettings?: (maintenance: ReactNode) => ReactNode;
}) {
  const openingTime = useMemo(() => {
    try { return draft && openingTimeSelection(state, draft); } catch { return undefined; }
  }, [state, draft]);
  const [archiveTarget, setArchiveTarget] = useState<{panel: 'NPC' | '势力组织' | '世界事件' | '地图'; id: string}>();
  const archiveReading=useRef<{events?:WorldEventsUiState;history?:HistoryUiState;memory?:MemoryUiState;map?:MapUiState}>({});
  const changeOpener=useRef<HTMLElement|null>(null);
  const archiveSelection = useRef<Partial<Record<'NPC' | '势力组织' | '物品栏', string>>>({});
  const openArchive = (panel: 'NPC' | '势力组织' | '世界事件', id: string) => {
    if (panel !== '世界事件') archiveSelection.current[panel] = id;
    setArchiveTarget({panel,id}); setPanel(panel);
  };
  const [panel, setPanel] = useState<PanelName | '人物档案' | '经济与资产'>();
  const compactSidebars = useSyncExternalStore(subscribeSidebarSize, () => window.matchMedia(sidebarMedia).matches, () => false);
  const desktopSettings=!compactSidebars&&Boolean(renderSettings);
  useEffect(()=>{if(desktopSettings)setPanel(undefined);},[desktopSettings]);
  function outsideSettings(action:()=>void){if(desktopSettings&&onCloseSettings)onCloseSettings(action);else action();}
  const desktopArchive = !compactSidebars && !desktopSettings && (panel === 'NPC' || panel === '势力组织' || panel === '人物档案' || panel === '物品栏' || panel === '经济与资产' || panel === '世界事件' || panel === '历史时间轴' || panel === '记忆' || panel === '地图') ? panel : undefined;
  function openChange(target:ChangeTarget){
    changeOpener.current=document.activeElement as HTMLElement|null;
    if(target.panel==='NPC'||target.panel==='势力组织'||target.panel==='世界事件'){
      if(target.id){openArchive(target.panel,target.id);return;}
      if(target.panel==='世界事件')archiveReading.current.events=undefined;
      if(target.panel==='NPC')archiveSelection.current.NPC=undefined;
      setArchiveTarget(undefined);setPanel(target.panel);return;
    }
    setArchiveTarget(undefined);
    if(target.panel==='物品栏')archiveSelection.current['物品栏']=target.id;
    if(target.panel==='地图'&&target.id){
      const projection=mapProjection(view.locations,hero.locationId),path=projection.path(target.id),limits:Record<string,number>={};
      for(const place of path){const up=projection.parent.get(place.id),siblings=up?projection.children.get(up)??[]:projection.roots;limits[up??'__roots__']=Math.max(50,siblings.findIndex(p=>p.id===place.id)+1);}
      archiveReading.current.map={selected:target.id,expanded:path.map(p=>p.id),query:'',limits};setArchiveTarget({panel:'地图',id:target.id});
    }
    if(target.panel==='历史时间轴')archiveReading.current.history={tab:target.id?'chronicles':'records',selected:target.id,query:'',year:'all',page:0,groupPages:{}};
    if(target.panel==='记忆')archiveReading.current.memory={level:target.level??'immediate',query:'',memoryQuery:'',page:0,sourceIds:[],sourcePage:0};
    setPanel(target.panel);
  }
  const [worldDirectoryOpen, setWorldDirectoryOpen] = useState(false);
  const [mobileStatusOpen,setMobileStatusOpen]=useState(false),[mobileMini,setMobileMini]=useState(false);
  const readerY=useRef(0),inputElement=useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [undoNotice, setUndoNotice] = useState('');
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
  const workflowBusy = Boolean(
    submitting || automatic.running || progress || variables.phase || world.phase,
  );
  const npcManagement = useNpcManagement(repository, state, draft, workflowBusy, onNpcManaged);
  const busy = workflowBusy || Boolean(npcManagement.pendingId);
  const reader = useRef<HTMLDivElement>(null);
  const runtimeSwitches = useRef<HTMLOListElement | HTMLDivElement>(null);
  const workflowToggle = useRef<HTMLButtonElement>(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  // PC 面板当前视图：未手动选择时跟随运行中/失败/待生成的阶段；收起后恢复自动。
  const [workflowView, setWorkflowView] = useState<WorkflowView>();
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>("overview");
  useLayoutEffect(()=>{
    const element=inputElement.current;if(!element)return;
    if(!compactSidebars){element.style.removeProperty('height');return;}
    const grow=()=>{element.style.height='auto';element.style.height=`${Math.min(120,element.scrollHeight)}px`;};grow();
    let width=element.clientWidth;const observer=new ResizeObserver(()=>{if(element.clientWidth!==width){width=element.clientWidth;grow();}});observer.observe(element);return()=>observer.disconnect();
  },[input,compactSidebars]);
  useEffect(()=>{if(!compactSidebars){setMobileStatusOpen(false);setWorldDirectoryOpen(false);}},[compactSidebars]);
  const mobileReturnFocus=(tab:'hero'|'world')=>window.matchMedia(sidebarMedia).matches
    ?document.querySelector<HTMLElement>(`[data-mobile-tab="${tab}"]`)
    :document.querySelector<HTMLElement>(`[data-archive-panel="${tab==='hero'?'人物档案':'NPC'}"]`);
  const closeWorkflow = () => {
    setWorkflowOpen(false);
    setWorkflowView(undefined);
    setWorkflowTab("overview");
    workflowToggle.current?.focus({ preventScroll: true });
  };
  const openWorkflowView = (view: WorkflowView) => {
    setWorkflowView(view);
    setWorkflowTab("overview");
    setWorkflowOpen(true);
  };
  useEffect(() => {
    if (!workflowOpen || compactSidebars) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        document.querySelector("dialog[open], .archive") ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      setWorkflowOpen(false);
      setWorkflowView(undefined);
      setWorkflowTab("overview");
      workflowToggle.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [workflowOpen, compactSidebars]);
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
  const canStartStory = mayStartStory(draft);
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
    if (!compactSidebars) {
      // PC：选中提示所指的阶段，并聚焦该阶段自己的开关（而非列表中第一个未勾选项）。
      const target = !settings.runtime.useVariableStage ? "variables" : "world";
      openWorkflowView(target);
      requestAnimationFrame(() => {
        const toggle = runtimeSwitches.current?.querySelector<HTMLInputElement>(`input[data-stage="${target}"]`);
        toggle?.scrollIntoView({ block: "nearest" });
        toggle?.focus({ preventScroll: true });
      });
      return;
    }
    setWorkflowOpen(true);
    requestAnimationFrame(() => {
      runtimeSwitches.current?.scrollIntoView({ block: "nearest" });
      (
        runtimeSwitches.current?.querySelector<HTMLInputElement>(
          "input:not(:checked)",
        ) ?? runtimeSwitches.current?.querySelector<HTMLInputElement>("input")
      )?.focus({ preventScroll: true });
    });
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
  const atmosphere = deriveAtmosphere(state);
  const draftScene = state.openingTimePending
    ? openingTime ? { worldClock: openingTime.startAt, locationId: state.protagonist.locationId } : undefined
    : { worldClock: state.worldClock, locationId: state.protagonist.locationId };
  const progressSteps = (['story', 'variables', 'world'] as const).map((stage, i) => {
    const status = draft?.stageStatus[stage];
    const auto = automatic.progress?.stage === stage ? automatic.progress : undefined;
    const skipped = automatic.outcome?.draft.draftRevision === draft?.draftRevision && automatic.outcome?.skipped.includes(stage);
    const text = awaitingAction ? '已结算'
      : auto ? auto.phase === 'saving' ? '保存中' : auto.phase === 'retrying' ? '重试中' : '生成中'
      : activeStage === stage ? activePhase === 'saving' ? '保存中' : '生成中'
      : (stage === 'variables' && !settings.runtime.useVariableStage) || (stage === 'world' && !settings.runtime.useWorldStage) ? '已关闭'
      : skipped || status === 'skipped' ? '已跳过'
      : status === 'failed' || errorStage === stage && hasWorkflowError ? '失败 · 可重试'
      : status === 'preview' ? '仅预览' : status === 'ready' ? '已完成' : '待生成';
    return { stage, name: ['正文', '变量', '动态世界'][i], text,
      visual: awaitingAction ? 'done' : auto || activeStage === stage ? 'run' : text === '失败 · 可重试' ? 'fail' : status === 'ready' ? 'done' : 'idle' };
  });
  const worldNavigation = <aside className="world-sidebar" aria-label="世界资料">
    <h2>世界资料</h2>
    <nav aria-label="世界资料分类">
      {panelNames.map((name, index) => <button key={name} data-archive-panel={name} aria-current={!compactSidebars && !desktopSettings && panel === name ? 'true' : undefined} onClick={() => outsideSettings(()=>{ changeOpener.current=null;setArchiveTarget(undefined);if(compactSidebars)setWorldDirectoryOpen(false); setPanel(!compactSidebars && panel === name ? undefined : name); })}>
        <span className="dock-seal" aria-hidden="true">{['人', '势', '图', '物', '事', '史', '忆'][index]}</span>
        <span>{name}</span>
      </button>)}
    </nav>
    {!compactSidebars && <nav className="dock-system" aria-label="系统操作">
      <button data-settings-open aria-current={desktopSettings?'true':undefined} onClick={onOpenSettings}><span className="dock-seal" aria-hidden="true">设</span><span>设置</span></button>
      <button onClick={()=>outsideSettings(onSaves)}><span className="dock-seal" aria-hidden="true">归</span><span>返回首页</span></button>
    </nav>}
  </aside>;
  const autoWorkflowView: WorkflowStage =
    (activeStage === 'story' || activeStage === 'variables' || activeStage === 'world' ? activeStage : undefined)
    ?? progressSteps.find((step) => step.visual === 'fail')?.stage
    ?? progressSteps.find((step) => step.text === '待生成' || step.text === '仅预览')?.stage
    ?? (disabledGuidance ? (!settings.runtime.useVariableStage ? 'variables' : 'world') : undefined)
    ?? 'story';
  const rawTurnId = awaitingAction ? state.journal.at(-1)?.turnId : draft?.turnId;
  const staleDraftMessage = draft ? '当前草稿已过期，请重新读取存档。' : '没有可执行的回合草稿。请重新读取存档；暂时无法生成或结算。';
  const setStageEnabled = (key: 'useVariableStage' | 'useWorldStage', checked: boolean) =>
    onSettings({ ...settings, runtime: { ...settings.runtime, [key]: checked } });
  const followLatest = () => {
    follow.current = true;
    setFollowing(true);
    if (reader.current) reader.current.scrollTop = reader.current.scrollHeight;
  };
  const stageActions: Record<'variables' | 'world', StageAction> = {
    variables: variables.phase
      ? { label: '取消变量生成', cancel: true, disabled: variables.phase === 'saving', onClick: variables.cancel }
      : {
          label: draft?.variables ? '重新生成变量候选' : draft?.useVariableStage === false ? '启用并补算变量' : '生成变量候选',
          cancel: false,
          disabled: !validDraft || !draft?.story || draft.stageStatus.story !== 'ready' || !settings.runtime.useVariableStage || busy,
          onClick: () => void variables.generate(),
        },
    world: world.phase
      ? { label: '取消世界生成', cancel: true, disabled: world.phase === 'saving', onClick: world.cancel }
      : {
          label: draft?.world ? '重新生成世界候选' : draft?.useWorldStage === false ? '启用并补算世界' : '生成世界候选',
          cancel: false,
          disabled: !validDraft || !draft?.story || draft.stageStatus.story !== 'ready' || !settings.runtime.useWorldStage || busy,
          onClick: () => void world.generate(),
        },
  };
  const workflowPrimaryButton = automatic.running ? (
    <button
      disabled={automatic.settling || automatic.progress?.phase === "saving"}
      onClick={automatic.cancel}
    >
      取消自动执行
    </button>
  ) : (
    <button
      className="primary"
      disabled={!validDraft || busy}
      onClick={() => void automatic.generate()}
    >
      {canCommit
        ? "完成本回合结算"
        : draft?.story || failedStage || workflowError
          ? "继续未完成阶段"
          : draft?.turnKind === "regular"
            ? "自动生成本回合"
            : "自动生成开局"}
    </button>
  );
  const workflowState = hasWorkflowError
    ? "error"
    : busy
      ? "busy"
      : awaitingAction
        ? "settled"
        : canCommit
          ? "ready"
          : workflowGuidance
            ? "off"
            : "pending";
  // 移动端沿用原有折叠布局；PC 使用 DesktopWorkflowPanel（左侧阶段、右侧分页详情）。
  const workflowBody = (
    <div className="workflow-details" id="workflow-pop">
      <div className="wf-body">
        {workflowGuidance && (
          <div className="field-hint" role="note" aria-label="阶段设置提示">
            <p>{workflowGuidance}</p>
            <button onClick={openRuntimeSettings} aria-controls="workflow-runtime-switches">
              展开高级设置
            </button>
          </div>
        )}
        {(automatic.running || (!busy && (canCommit || canGenerate))) && (
          <div className="workflow-primary">{workflowPrimaryButton}</div>
        )}
        {automatic.error && (
          <div className="story-error" role="alert">
            {automatic.error}
            <button onClick={onOpenSettings}>打开 AI 设置</button>
          </div>
        )}
        {[error, submitError, variables.error, world.error].map((message, i) => message && (
          <p className="story-error" role="alert" key={i}>{message}</p>
        ))}
        {!validDraft && (
          <Feedback className="field-hint" level="warn" mobileAs="p">{staleDraftMessage}</Feedback>
        )}
        <p className="workflow-fee">生成可能产生第三方 API 费用。</p>
        <div className="runtime-switches mobile-stage-switches" id="workflow-runtime-switches" ref={runtimeSwitches as RefObject<HTMLDivElement>}>
        <ol className="workflow-stages">
          {progressSteps.map((step, i) => (
            <li key={step.stage} data-s={stepState(step) === "off" ? "off" : step.visual}>
              <span className="stage-number">0{i + 1}</span>
              <strong>{["正文生成", "变量管理", "动态世界"][i]}</strong>
              <small>{step.text}</small>
              {step.stage === "story" ? (
                <p className="stage-action-hint">正文生成位于行动输入旁。</p>
              ) : (
                <div className="variable-actions">
                  <label className="toggle"><input type="checkbox" aria-label={step.stage==='variables'?'变量管理':'动态世界'} checked={settings.runtime[step.stage==='variables'?'useVariableStage':'useWorldStage']} onChange={e=>setStageEnabled(step.stage==='variables'?'useVariableStage':'useWorldStage',e.target.checked)}/>启用</label>
                  <button
                    disabled={stageActions[step.stage].disabled}
                    onClick={stageActions[step.stage].onClick}
                  >
                    {stageActions[step.stage].label}
                  </button>
                  {step.stage === "variables" && draft?.variables && (
                    <VariableCandidates key={`${draft.turnId}-${draft.draftRevision}`} draft={draft} />
                  )}
                  {step.stage === "world" && draft?.world && (
                    <WorldCandidates key={`${draft.turnId}-${draft.draftRevision}`} draft={draft} />
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
        </div>
      </div>
      <div className="wf-more">
        <details className="workflow-diagnostics" id="workflow-diagnostics">
          <summary>重试与变更详情</summary>
          {summaryQuality && (
            <p className="muted" data-testid="summary-length">
              本回合摘要：{summaryQuality.hanCharacters} 汉字。
              {summaryQuality.status === "empty"
                ? "缺少有效摘要，无法正式结算。"
                : summaryQuality.status === "within_target"
                  ? "符合目标范围。"
                  : "可继续。"}
            </p>
          )}
          {draft?.failures
            .filter((failure) => failure.storyRevision === draft.storyRevision)
            .slice(-6)
            .map((failure, index) => (
              <p className="muted" key={index}>
                {{ story: "正文生成", variables: "变量管理", world: "动态世界" }[failure.stage]}{" "}
                · 安全失败码：{failure.errorCode}
              </p>
            ))}
          {runtimeLogs.some((entry) => entry.kind === "failed") && (
            <RuntimeLogPanel entries={runtimeLogs} onClear={() => setRuntimeLogs([])} />
          )}
          <StageResponsesPanel saveId={state.saveId} turnId={rawTurnId} />
          <RequestUsage saveId={state.saveId} />
          {draft && (
            <StoryInspectionPanel key={`${draft.turnId}-${draft.storyRevision}`} draft={draft} />
          )}
        </details>
        {draft && (
          <details className="bound-input" id="workflow-bound-input">
            <summary>本回合已绑定输入（只读）</summary>
            <p className="prose">{draft.userInput || "未填写开局偏好，按人物资料正常生成。"}</p>
          </details>
        )}

      </div>
    </div>
  );
  const desktopNotices = (
    <>
      {workflowError && (
        <div className="wf-banner workflow-errors" data-level="err" role="alert">
          <span className="wf-banner-tag" aria-hidden="true">误</span>
          <div className="wf-banner-msg">
            {[automatic.error, error, submitError, variables.error, world.error]
              .filter(Boolean)
              .map((message, i) => <p key={i}>{message}</p>)}
            {draft?.failures.filter(failure => failure.storyRevision === draft.storyRevision).slice(-6).map((failure, i) => <small key={`code-${i}`}>{stageLabels[failure.stage]} · 安全失败码：{failure.errorCode} · {failure.attempt} 次尝试</small>)}
          </div>
          {automatic.error && <button onClick={onOpenSettings}>打开 AI 设置</button>}
        </div>
      )}
      {workflowGuidance && (
        <div className="wf-banner" data-level="warn" role="note" aria-label="阶段设置提示">
          <span className="wf-banner-tag" aria-hidden="true">注</span>
          <div className="wf-banner-msg"><p>{workflowGuidance}</p></div>
          <button onClick={openRuntimeSettings} aria-controls="workflow-runtime-switches">前往阶段开关</button>
        </div>
      )}
      {!validDraft && (
        <div className="wf-banner" data-level="warn" role="note">
          <span className="wf-banner-tag" aria-hidden="true">注</span>
          <div className="wf-banner-msg"><p>{staleDraftMessage}</p></div>
        </div>
      )}
    </>
  );
  const desktopPrimary = (automatic.running || (!busy && (canCommit || canGenerate))) ? (
    <div className="workflow-primary">
      {workflowPrimaryButton}
      <small>
        {automatic.running
          ? "正在依次执行三个阶段"
          : canCommit
            ? "三个阶段的候选均已通过校验"
            : "从第一个未完成的阶段继续"}
      </small>
    </div>
  ) : (
    <small className="wf-idle">{awaitingAction ? "发送新行动后开始下一回合" : busy ? "正在处理，请稍候" : "当前没有可执行的自动操作"}</small>
  );
  return (
    <main className="game-layout city-night" data-city={atmosphere.city} data-time={atmosphere.time} data-wx={atmosphere.weather}
      onKeyDown={event => {
        if (compactSidebars || desktopArchive || desktopSettings || event.nativeEvent.isComposing || event.repeat || (event.target as HTMLElement).closest('dialog, .archive')) return;
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
          event.preventDefault(); void send(); return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          (event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
        if (/^[1-5]$/.test(event.key) && settings.prompts.actionOptions && !progress && options && options.length >= 3 && options.length <= 5) {
          const option = options[Number(event.key) - 1];
          if (option) { event.preventDefault(); setInput(option); document.getElementById('player-input')?.focus(); }
        }
      }}>
      <CityAtmosphere state={state} />
      {compactSidebars?<MobileCityBar state={state} mini={mobileMini} onStatus={()=>setMobileStatusOpen(true)}/>:<CityBar state={state} />}
      {!compactSidebars&&<PlayerStatus state={state} equipment={equipment} activePanel={compactSidebars || desktopSettings ? undefined : panel} onProfile={() => outsideSettings(()=>{ changeOpener.current=null;setArchiveTarget(undefined); setPanel(desktopArchive === '人物档案' ? undefined : '人物档案'); })} onEconomy={() => outsideSettings(()=>{ changeOpener.current=null;setArchiveTarget(undefined);setPanel(desktopArchive === '经济与资产' ? undefined : '经济与资产'); })} />}
      <section inert={Boolean(desktopArchive||desktopSettings)} className="story-column" aria-label="剧情与行动">
        <div
          className={`reader ${!view.journal.length && !draft?.story && !progress ? 'reader-empty' : ''}`}
          ref={reader}
          onScroll={() => {
            const element = reader.current!;
            if(compactSidebars){setMobileMini(element.scrollTop>60&&element.scrollTop>=readerY.current-2);readerY.current=element.scrollTop;}
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
            <article className={`story-entry glass ${index < view.journal.length - 1 || draft?.story || progress ? 'past' : 'latest'}`} key={entry.turnId}>
              <CityChapter number={index + 1} state={state} scene={state.journal[index]?.scene} desktop={!compactSidebars} />
              <StoryReading narrative={entry.narrative} protagonistName={hero.name} />
              {!compactSidebars&&index===view.journal.length-1&&!workflowBusy&&!draft?.story&&(!draft||awaitingAction)&&<TurnChanges state={state} repository={repository} onOpen={openChange}/>}
            </article>
          ))}
          {progress ? (
            <article className="story-entry glass latest" aria-label="流式正文预览" aria-busy="true">
              <CityChapter number={state.turnNumber + 1} state={state} scene={draftScene} status="preview" desktop={!compactSidebars} />
              <span className="tag preview-tag">临时预览 · 完整校验前不保存</span>
              <p className="prose">{progress.narrative || '正在等待正文…'}{!compactSidebars && <span className="caret" aria-hidden="true" />}</p>
            </article>
          ) : draft?.story ? (
            <article className="story-entry glass latest">
              <CityChapter number={state.turnNumber + 1} state={state} scene={draftScene} status="draft" desktop={!compactSidebars} />
              <span className="tag preview-tag">正文草稿 · 世界状态尚未确认</span>
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
              compactSidebars?<MobileActions options={options} value={input} onChoose={setInput}/>:<div className="action-options" aria-label="行动建议">
                <p>接下来你想做什么</p>
                {options.map((option, index) => (
                  <button key={option} aria-pressed={input === option} onClick={() => setInput(option)}>
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
            {progress && !following && (compactSidebars || !workflowOpen) && (
              <button className="follow"
                onClick={() => {
                  follow.current = true;
                  setFollowing(true);
                  if (reader.current) reader.current.scrollTop = reader.current.scrollHeight;
                }}
              >
                跟随最新正文 ↓
              </button>
            )}
            <section
              className="workflow"
              aria-label="三阶段工作流"
              data-state={workflowState}
            >
              {compactSidebars ? (
                <div className="workflow-disclosure mobile-workflow-line" data-open={workflowOpen} {...(workflowOpen?{open:true}:{})}>
                  <div className="workflow-summary"><button type="button" className="workflow-toggle" ref={workflowToggle} aria-label="三阶段工作流详情" aria-expanded={workflowOpen} aria-controls="workflow-pop" onClick={()=>setWorkflowOpen(true)}>
                    <span className="mobile-progress-segments" aria-hidden="true">{progressSteps.map(step=><i key={step.stage} data-s={step.visual}/>)}</span>
                    <strong role="status" aria-live="polite"><span className="sr-only">三阶段 · </span>{workflowLabel}</strong><span className="more">详情 ›</span>
                  </button></div>
                  {workflowOpen&&<Dialog title="三阶段工作流" mobileVariant="sheet" sheetFull seal="阶" eyebrow="WORKFLOW" className="mobile-workflow-sheet" onClose={closeWorkflow}>{workflowBody}</Dialog>}
                </div>
              ) : (
                <div
                  className="workflow-disclosure"
                  data-open={workflowOpen}
                  {...(workflowOpen ? { open: true } : {})}
                >
                  <div className="workflow-summary">
                    <strong role="status" aria-live="polite">
                      <span className="workflow-prefix">三阶段 · </span>
                      {workflowLabel}
                    </strong>
                    <span className="rail">
                      {progressSteps.map((step, i) => (
                        <button
                          key={step.stage}
                          type="button"
                          data-s={step.visual}
                          title={`查看${step.name}阶段详情`}
                          aria-controls="workflow-pop"
                          onClick={() => openWorkflowView(step.stage)}
                        >
                          <span className="bar-seg" aria-hidden="true" />
                          <span className="lbl">
                            <b>0{i + 1}</b> {step.name}
                            <em> · {step.text}</em>
                          </span>
                        </button>
                      ))}
                    </span>
                    <button
                      className="workflow-toggle"
                      ref={workflowToggle}
                      aria-expanded={workflowOpen}
                      aria-controls="workflow-pop"
                      onClick={() =>
                        workflowOpen ? closeWorkflow() : setWorkflowOpen(true)
                      }
                    >
                      详情
                    </button>
                  </div>
                  <div hidden={!workflowOpen} className="workflow-pop-host">
                    {(
                      <DesktopWorkflowPanel
                        label={workflowLabel}
                        state={workflowState}
                        onClose={closeWorkflow}
                        onFollow={progress && !following ? followLatest : undefined}
                        notices={desktopNotices}
                        primary={desktopPrimary}
                        steps={progressSteps}
                        view={workflowView ?? autoWorkflowView}
                        onView={(view) => { setWorkflowView(view); setWorkflowTab("overview"); }}
                        tab={workflowTab}
                        onTab={setWorkflowTab}
                        switches={{
                          variables: { checked: settings.runtime.useVariableStage, onChange: (checked) => setStageEnabled("useVariableStage", checked) },
                          world: { checked: settings.runtime.useWorldStage, onChange: (checked) => setStageEnabled("useWorldStage", checked) },
                        }}
                        switchesRef={runtimeSwitches as RefObject<HTMLOListElement>}
                        actions={stageActions}
                        draft={draft}
                        saveId={state.saveId}
                        rawTurnId={rawTurnId}
                        summary={summaryQuality}
                        runtimeLogs={runtimeLogs}
                        onClearLogs={() => setRuntimeLogs([])}
                      />
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
          {undoNotice && <p role="status" className="undo-feedback">{undoNotice}</p>}
          <div className="composer-action-row">
            <ComposerTools compact={compactSidebars} menu={Boolean(automatic.running||manualProgress||((!draft||canStartStory)&&!awaitingAction))}>
              <TurnUndoControl compact={compactSidebars&&!(automatic.running||manualProgress||((!draft||canStartStory)&&!awaitingAction))}
                repository={repository}
                state={state}
                draft={draft}
                busy={busy}
                input={input}
                onInput={setInput}
                onUndone={onUndone}
                cancelMemory={memory.cancel}
                onNotice={setUndoNotice}
              />
              {automatic.running ? (
                <button
                  disabled={
                    automatic.settling || automatic.progress?.phase === "saving"
                  }
                  onClick={automatic.cancel}
                >
                  取消生成
                </button>
              ) : manualProgress ? (
                <button
                  disabled={manualProgress.phase === "saving"}
                  onClick={cancel}
                >
                  {manualProgress.phase === "saving" ? "正在保存…" : "取消生成"}
                </button>
              ) : (!draft || canStartStory) && !awaitingAction ? (
                <button
                  disabled={!validDraft || busy}
                  title={
                    awaitingAction
                      ? "本回合已结算；发送新行动后继续"
                      : undefined
                  }
                  onClick={() => {
                    if (canStartStory) void generate();
                  }}
                >
                  {draft?.turnKind === "regular"
                    ? "生成本回合正文"
                    : "生成开局正文"}
                </button>
              ) : null}
            </ComposerTools>
            <label className="sr-only" htmlFor="player-input">你的行动</label>
            <textarea id="player-input" ref={inputElement} disabled={submitting} value={input}
              onChange={(e) => setInput(e.target.value)} rows={compactSidebars?1:2}
              placeholder={compactSidebars ? '填写你的行动' : '填写你的行动；发送后生成三阶段并自动结算'} />
            <div className="composer-footer">
              <button className="primary" disabled={(!canCommit && !awaitingAction) || busy || !input.trim()}
                onClick={() => void send()}>{submitting ? '正在结算…' : '发送'}</button>
              {!compactSidebars && <span className="kbd">Ctrl + Enter</span>}
            </div>
          </div>
        </div>
      </section>
      {!compactSidebars && worldNavigation}
      <nav className="mobile-game-nav" aria-label="底部导航">
        <button aria-current={!panel && !mobileStatusOpen && !worldDirectoryOpen && !renderSettings ? 'page' : undefined}
          onClick={() => { reader.current?.focus({ preventScroll: true }); }}><span className="mobile-seal" aria-hidden="true">文</span>故事</button>
        <button data-mobile-tab="hero" aria-current={mobileStatusOpen||panel==='人物档案'||panel==='经济与资产'?'page':undefined} onClick={() => setMobileStatusOpen(true)}><span className="mobile-seal" aria-hidden="true">我</span>人物</button>
        <button data-mobile-tab="world" aria-current={worldDirectoryOpen||(panel&&panel!=='人物档案'&&panel!=='经济与资产')?'page':undefined} onClick={() => setWorldDirectoryOpen(true)}><span className="mobile-seal" aria-hidden="true">世</span>世界资料</button>
        <button data-settings-open aria-current={renderSettings?'page':undefined} onClick={onOpenSettings}><span className="mobile-seal" aria-hidden="true">设</span>设置</button>
      </nav>
      {compactSidebars && mobileStatusOpen && <Dialog title="此时此地" mobileVariant="sheet" seal={mobileCitySeal(state)} eyebrow="NOW · HERE" className="mobile-status-sheet" onClose={()=>setMobileStatusOpen(false)} returnFocus={()=>document.querySelector<HTMLElement>('[data-mobile-status]')??mobileReturnFocus('hero')}>
        <MobileStatus state={state} equipment={equipment} onProfile={()=>{setMobileStatusOpen(false);setPanel('人物档案');}} onEconomy={()=>{setMobileStatusOpen(false);setPanel('经济与资产');}}/>
      </Dialog>}
      {compactSidebars && worldDirectoryOpen && <Dialog title="世界资料" mobileVariant="sheet" seal="世" eyebrow="WORLD ARCHIVE" className="world-directory" onClose={() => setWorldDirectoryOpen(false)} returnFocus={()=>mobileReturnFocus('world')}>
        {worldNavigation}
        <p className="muted mobile-world-hint">从身边的人，到更远的城市。</p>
      </Dialog>}
      {desktopArchive && <ArchivePanel key={desktopArchive} title={desktopArchive} className={desktopArchive === '世界事件' ? 'world-events-dialog' : desktopArchive === '历史时间轴' ? 'history-dialog' : undefined} seal={desktopArchive === 'NPC' ? '人' : desktopArchive === '势力组织' ? '势' : desktopArchive === '物品栏' ? '物' : desktopArchive === '经济与资产' ? '财' : desktopArchive === '世界事件' ? '事' : desktopArchive === '历史时间轴' ? '史' : desktopArchive === '记忆' ? '忆' : desktopArchive === '地图' ? '图' : '档'} index={desktopArchive === '势力组织' ? 2 : desktopArchive === '物品栏' ? 4 : desktopArchive === '世界事件' ? 5 : desktopArchive === '历史时间轴' ? 6 : desktopArchive === '记忆' ? 7 : desktopArchive === '地图' ? 3 : 1}
        eyebrow={desktopArchive === '人物档案' || desktopArchive === '经济与资产' ? 'PROTAGONIST · 主角档案' : undefined}
        subtitle={desktopArchive === '人物档案' ? `主角 · ${hero.name}` : desktopArchive === 'NPC' ? '人物名录' : desktopArchive === '物品栏' ? '随身与仓储' : desktopArchive === '经济与资产' ? '现金、收入与资产' : desktopArchive === '世界事件' ? '进行中的事' : desktopArchive === '历史时间轴' ? '已发生的事' : desktopArchive === '记忆' ? '主角的记忆' : desktopArchive === '地图' ? '地点层级' : '势力与机构'}
        onClose={() => { setPanel(undefined); setArchiveTarget(undefined); }} returnFocus={() => changeOpener.current?.isConnected?changeOpener.current:document.querySelector<HTMLButtonElement>(`[data-archive-panel="${desktopArchive}"]`)}>
        {desktopArchive === '人物档案' ? <ProfilePanel state={state} equipment={equipment} candidateTime={openingTime?.endAt} onEconomy={() => setPanel('经济与资产')} onNpc={() => { setArchiveTarget(undefined); setPanel('NPC'); }} onSaves={onSaves} />
          : desktopArchive === 'NPC' ? <NpcPanel view={view} management={npcManagement} initialId={archiveTarget?.panel === 'NPC' ? archiveTarget.id : archiveSelection.current.NPC} onOpenOrganization={id => openArchive('势力组织', id)} onSelect={id => { archiveSelection.current.NPC = id; }} desktop />
          : desktopArchive === '物品栏' ? <InventoryPanel view={view} desktop initialId={archiveSelection.current['物品栏']} onSelect={id=>{archiveSelection.current['物品栏']=id;}} onOpenProfile={id=>{if(id===hero.id){setArchiveTarget(undefined);setPanel('人物档案');}}} />
          : desktopArchive === '经济与资产' ? <EconomyPanel view={view} />
          : desktopArchive === '世界事件' ? <WorldEventsPanel view={view} desktop initialId={archiveTarget?.panel === '世界事件' ? archiveTarget.id : undefined} uiState={archiveReading.current.events} onUiStateChange={value=>{archiveReading.current.events=value;}} onOpenHistory={()=>{archiveReading.current.history=undefined;setArchiveTarget(undefined);setPanel('历史时间轴');}} />
          : desktopArchive === '历史时间轴' ? <HistoryPanel view={view} desktop uiState={archiveReading.current.history} onUiStateChange={value=>{archiveReading.current.history=value;}} />
          : desktopArchive === '地图' ? <MapPanel view={view} initialId={archiveTarget?.panel==='地图'?archiveTarget.id:undefined} uiState={archiveReading.current.map} onUiStateChange={value=>{archiveReading.current.map=value;}} onNpc={id=>openArchive('NPC',id)} onEvent={id=>openArchive('世界事件',id)}/>
          : desktopArchive === '记忆' ? <MemoryPanel view={view} desktop uiState={archiveReading.current.memory} onUiStateChange={value=>{archiveReading.current.memory=value;}} />
          : <OrganizationPanel view={view} initialId={archiveTarget?.panel === '势力组织' ? archiveTarget.id : archiveSelection.current['势力组织']} links={{npc:id=>openArchive('NPC',id), organization:id=>openArchive('势力组织',id), event:id=>openArchive('世界事件',id)}} onSelect={id => { archiveSelection.current['势力组织'] = id; }} desktop />}
      </ArchivePanel>}
      {panel && !desktopArchive && !desktopSettings && (
        <Dialog title={panel} mobileVariant="sheet" sheetFull returnFocus={()=>mobileReturnFocus(panel==='人物档案'||panel==='经济与资产'?'hero':'world')} className={panel === 'NPC' ? 'npc-dialog' : panel === '物品栏' ? 'inventory-dialog' : panel === '历史时间轴' ? 'history-dialog' : panel === '世界事件' ? 'world-events-dialog' : panel === '势力组织' ? 'organization-dialog' : ''} onClose={() => { setPanel(undefined); setArchiveTarget(undefined); }}>
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
              <Panels name={panel} view={view} initialId={archiveTarget?.panel === panel ? archiveTarget.id : undefined} links={{npc:id=>openArchive('NPC',id), organization:id=>openArchive('势力组织',id), event:id=>openArchive('世界事件',id)}} npcManagement={npcManagement} onOpenHistory={()=>setPanel('历史时间轴')} />
            </>
          )}
        </Dialog>
      )}
      {renderSettings?.(<MemorySummarySettings state={state} settings={settings} onSave={next => {
        onSettings(next);
        const saved = SettingsSchema.parse(JSON.parse(localStorage.getItem(settingsKey) || 'null'));
        if (fingerprint(saved.memory) !== fingerprint(next.memory)) throw new Error('memory settings not saved');
      }} phase={memory.phase} activeKind={memory.activeKind} notice={memory.notice}
        onRun={(kind, npcId) => void memory.run(false, kind, npcId)} onCancel={memory.cancel} />)}
      {memory.failures[0] && (
        <Dialog
          title={summaryFailureTitle(memory.failures[0])}
          small
          feedback={
            summaryFailureTitle(memory.failures[0]).includes("待确认")
              ? "warn"
              : "err"
          }
          seal="忆"
          onClose={() => memory.closeFailure(memory.failures[0].kind)}
        >
          <p>{memory.failures[0].message}</p>
          <p>原始记忆仍保留；重新生成可能产生 API 费用。</p>
          <div className="feedback-dialog-actions memory-feedback-actions">
            {memory.failures[0].kind === "npc" && !memory.failures[0].npcId ? (
              <button
                className={!compactSidebars ? "primary" : undefined}
                disabled={Boolean(memory.phase)}
                onClick={() => {
                  memory.closeFailure("npc");
                  onOpenSettings();
                }}
              >
                前往设置选择人物
              </button>
            ) : (
              <button
                className={!compactSidebars ? "primary" : undefined}
                disabled={Boolean(memory.phase)}
                onClick={() =>
                  void memory.run(
                    false,
                    memory.failures[0].kind,
                    memory.failures[0].npcId,
                  )
                }
              >
                重新生成
              </button>
            )}
            <button
              disabled={Boolean(memory.phase)}
              onClick={() => memory.pause(memory.failures[0].kind)}
            >
              暂停自动总结
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
