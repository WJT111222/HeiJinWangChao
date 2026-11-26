import type { ContinuationRoute } from '../../services/ai/corsRelay';
import { canRelayLegacyStory, prepareLegacyContinuation } from '../../workflows/legacyContinuation';
import { readDocument } from '../../services/local/documents';
import { continuationMinimum } from '../../domain/storyWriting';
import { FeedbackCorrelation, linkMemoryFeedback } from '../../services/feedback/report';
import { assistantView, bindTavernPage, enterTavernChat } from '../../presets/tavern/hostState';
import { ScriptButtons } from '../settings/TavernAssistant';
import { stageResponses } from '../../services/ai/stageResponses';
import { MobileWorkflowDrawer } from './MobileWorkflowDrawer';
import {MobileDiagnostics} from './MobileDiagnostics';
import { useNpcManagement } from './useNpcManagement';
import type { NpcManagementResult } from './npcManagement';
import { ArchivePanel } from '../ArchivePanel';
import { HaremPanel } from '../panels/HaremPanel';
import { NpcPanel } from '../panels/NpcPanel';
import { OrganizationPanel } from '../panels/OrganizationPanel';
import { FactionPanel } from '../panels/FactionPanel';
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
import { SettlementNotice } from './SettlementNotice';
import { TurnChanges } from './TurnChangesView';
import { useTurnComparison } from './useTurnComparison';
import { turnChangeBadges } from './turnChangeBadges';
import type { ChangeTarget } from './turnChanges';
import { mapProjection } from '../panels/mapView';
import { PlayerStatus } from './PlayerStatus';
import { TurnUndoControl } from './TurnUndoControl';
import type { TurnUndoResult } from '../../services/storage/saveRepository';
import { ProfessionProfile } from '../components/ProfessionProfile';
import { TalentProfile } from '../components/TalentProfile';
import { StoryReading } from './StoryReadingView';
import { TheaterPanel } from './TheaterPanel';
import type { TheaterLeaveGuard } from './TheaterPanel';
import { StoryStreamReading } from './StoryStreamReading';
import { openingTimeSelection } from '../../domain/openingTime';
import { storyRuleNames } from '../../domain/storyDiagnostics';
import { openingSettlementIssue } from '../../services/validation/turnCommit';
import { configureTurnStages } from '../../domain/drafts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { GameState } from '../../domain/state';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { TurnDraft } from '../../domain/drafts';
import type { Settings } from '../settings/model';
import { Dialog, Detail } from '../Dialog';
import { Panels, panelNames } from '../panels/Panels';
import type { PanelName } from '../panels/Panels';
import { playerView, dateTime } from '../panels/playerView';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { useStoryGeneration } from './useStoryGeneration';
import { useVariableGeneration } from './useVariableGeneration';
import { useWorldGeneration } from './useWorldGeneration';
import { useTurnGeneration } from './useTurnGeneration';
import { completeTurnDraft, awaitingPlayerAction, rebindableAfterStoryStop, settlementDraft } from '../../domain/turnCommit';
import type { TurnCommitResult } from '../../services/storage/saveRepository';
import { DataError } from '../../domain/common';
import { storyError } from '../../workflows/storyStage';
import { AiError } from '../../services/ai/errors';
import { assessSummary } from '../../domain/memories/summary';
import { useMemoryMaintenance } from './useMemoryMaintenance';
import { MemorySummarySettings } from '../settings/MemorySummarySettings';
import { fingerprint } from '../../domain/commands';
import { SettingsSchema, settingsKey } from '../settings/model';
import { summaryFailureTitle } from '../../workflows/memorySummaryQueue';
import type { OpeningStart } from './openingStart';
import { currentRuntimeLogs, markRecoveredFailures, memoryRuntimeLogEvent, runtimeLogEvent } from './runtimeLog';
import { errorBannerKey } from './errorBanner';
import { DesktopWorkflowPanel } from './WorkflowPanel';

import type { StageAction, WorkflowStage, WorkflowTab, WorkflowView } from './WorkflowPanel';
import type { MemoryFailureObservation } from '../../services/ai/memoryObservation';
import { MemoryIssueDetails } from './MemoryResponses';
import type { RuntimeLogEntry, RuntimeLogReporter } from './runtimeLog';
import { CityAtmosphere, CityBar, CityChapter } from './CityNight';
import { deriveAtmosphere } from './atmosphere';
import './city-night.css';
import './workflow-feedback.css';
import './mobile-game.css';
import './day-appearance.css';
import '../city-art.css';
import {MobileCityBar,MobileStatus,mobileCitySeal} from './MobileCity';
import {MobileActions} from './MobileActions';
import {ComposerTools} from './ComposerTools';
import { legacyNotificationRecoveryOptions } from '../../domain/legacyNotificationRecovery';
import { LegacyNotificationRecoveryDialog } from './LegacyNotificationRecoveryDialog';
import { mayStartStory } from './storyGenerationPolicy';
import { canContinueStory, continuationBlock, discardStoryPartial, partialNarrative as countPartialNarrative, STORY_CONTINUATION_LIMIT, storyPartialVisible } from '../../domain/storyContinuation';
import { StoryStream } from '../../workflows/storyStream';
import { actionSuggestions } from './actionSuggestions';
import { appendActionOption, includesActionOption } from './actionOptions';

const sidebarMedia = '(max-width: 900px)';
function subscribeSidebarSize(changed: () => void) {
  const media = window.matchMedia(sidebarMedia);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}

export function GameScreen({
  openingStart,
  onOpenSettings,
  theaterLeave,
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
  instance,
  renderSettings,
}: {
  openingStart?: OpeningStart;
  onOpenSettings: () => void;
  theaterLeave: RefObject<TheaterLeaveGuard | null>;
  onCloseSettings?: (afterClose?:()=>void)=>void;
  state: GameState;
  draft?: TurnDraft;
  companionProfile?: CompanionProfile;
  settings: Settings;
  onSettings: (settings: Settings, base?: Settings) => void;
  onSaves: () => void;
  repository: SaveRepository;
  onDraftSaved: (draft: TurnDraft) => void;
  onCommitted: (result: TurnCommitResult) => void;
  onUndone: (result: TurnUndoResult) => void;
  onMemorySaved: (state: GameState) => void;
  onNpcManaged: (result: NpcManagementResult) => void;
  /** 读档时的存档实例身份，人物管理时原样传回。 */
  instance?: string;
  renderSettings?: (maintenance: ReactNode) => ReactNode;
}) {
  const [archiveTarget, setArchiveTarget] = useState<{panel: 'NPC' | '势力组织' | '世界事件' | '地图' | '物品栏'; id: string}>();
  const archiveReading=useRef<{events?:WorldEventsUiState;history?:HistoryUiState;memory?:MemoryUiState;map?:MapUiState}>({});
  const changeOpener=useRef<HTMLElement|null>(null);
  const archiveSelection = useRef<Partial<Record<'NPC' | '势力组织' | '物品栏', string>>>({});
  const openArchive = (panel: 'NPC' | '势力组织' | '世界事件', id: string) => {
    if (panel !== '世界事件') archiveSelection.current[panel] = id;
    setArchiveTarget({panel,id}); setPanel(panel);
  };
  const [panel, setPanel] = useState<PanelName | '人物档案' | '经济与资产' | '小剧场'>();
  useEffect(() => () => stageResponses.clearSave(state.saveId), [state.saveId]);
  const compactSidebars = useSyncExternalStore(subscribeSidebarSize, () => window.matchMedia(sidebarMedia).matches, () => false);
  const desktopSettings=!compactSidebars&&Boolean(renderSettings);
  useEffect(()=>{if(desktopSettings)setPanel(undefined);},[desktopSettings]);
  function outsideTheater(action: () => void) {
    if (theaterLeave.current) theaterLeave.current(action);
    else action();
  }
  function outsideSettings(action: () => void) {
    if (desktopSettings && onCloseSettings) onCloseSettings(action);
    else outsideTheater(action);
  }
  const theaterActive = panel === '小剧场' && !desktopSettings;
  const desktopArchive = !compactSidebars && !desktopSettings && (panel === 'NPC' || panel === '势力组织' || panel === '我的势力' || panel === '人物档案' || panel === '物品栏' || panel === '经济与资产' || panel === '世界事件' || panel === '历史时间轴' || panel === '记忆' || panel === '地图' || panel === '后宫') ? panel : undefined;
  function openChange(target:ChangeTarget){
    changeOpener.current=compactSidebars?document.querySelector<HTMLButtonElement>('.chg-btn'):document.activeElement as HTMLElement|null;
    if(target.panel==='NPC'||target.panel==='势力组织'||target.panel==='世界事件'){
      if(target.id){openArchive(target.panel,target.id);return;}
      if(target.panel==='世界事件')archiveReading.current.events=undefined;
      if(target.panel==='NPC')archiveSelection.current.NPC=undefined;
      setArchiveTarget(undefined);setPanel(target.panel);return;
    }
    setArchiveTarget(undefined);
    if(target.panel==='物品栏'){archiveSelection.current['物品栏']=target.id;if(target.id)setArchiveTarget({panel:'物品栏',id:target.id});}
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
  const [diagnosticsOpen,setDiagnosticsOpen]=useState(false);
  const [legacyRecoveryDialog,setLegacyRecoveryDialog] = useState<string>();
  const legacyRecoveryOptions = useMemo(() => legacyNotificationRecoveryOptions(state,draft),[state,draft]);
  const [confirmationError, setConfirmationError] = useState<{ draft: TurnDraft; message: string }>();
  const confirmation = useRef<symbol | undefined>(undefined);
  useLayoutEffect(() => {
    const revoke = () => { confirmation.current = undefined; };
    window.addEventListener('hashchange', revoke);
    window.addEventListener('pagehide', revoke);
    return () => {
      revoke();
      window.removeEventListener('hashchange', revoke);
      window.removeEventListener('pagehide', revoke);
    };
  }, [instance, state.saveId, state.revision, draft]);
  const recoveryDraftKey = draft && `${draft.saveId}:${draft.turnId}:${draft.draftRevision}`;
  // 玩家关掉的错误横幅：只记住当时那组错误，出现新的错误时会重新显示。
  const [dismissedError, setDismissedError] = useState('');
  const [mobileStatusOpen,setMobileStatusOpen]=useState(false),[mobileMini,setMobileMini]=useState(false);
  const readerY=useRef(0),inputElement=useRef<HTMLTextAreaElement>(null);
  const inputKey = JSON.stringify(['tavern-reload-input', state.saveId, instance, state.revision, draft?.turnId, draft?.draftRevision]);
  const [input, setInput] = useState(() => { try { return sessionStorage.getItem(inputKey) ?? ''; } catch { return ''; } });
  useEffect(() => { try { sessionStorage.removeItem(inputKey); } catch { /* storage may be unavailable */ } }, [inputKey]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [concurrencyBlocked, setConcurrencyBlocked] = useState(false);
  const [undoNotice, setUndoNotice] = useState('');
  const submitLock = useRef(false),
    submitToken = useRef(0);
  const [runtimeEntries, setRuntimeLogs] = useState<RuntimeLogEntry[]>([]);
  const diagnosticSaveRef = useRef(crypto.randomUUID());
  const diagnosticScope = useMemo(() => ({ saveRef: diagnosticSaveRef.current, turnRef: crypto.randomUUID() }), [draft?.turnId]);
  const runtimeLogs = currentRuntimeLogs(runtimeEntries, diagnosticScope);
  const runtimeLogId = useRef(0);
  const feedbackCorrelation = useMemo(() => new FeedbackCorrelation(), [diagnosticScope]);
  // 失败事件序号：用于判断错误横幅是否是「新的一次失败」；清空日志不回退。
  const [failureSeq, setFailureSeq] = useState(0);
  const reportRuntimeEvent = useCallback<RuntimeLogReporter>((stage, kind, failure, turnId = draft?.turnId, options) => {
    // The callback captures the request's turn, not whatever turn is current when it finishes.
    const entry = runtimeLogEvent(++runtimeLogId.current, stage, kind, failure, diagnosticScope, options);
    feedbackCorrelation.record(entry, state.saveId, turnId);
    setRuntimeLogs((current) => [...markRecoveredFailures(current, entry).slice(-49), entry]);
    if (entry.kind === 'failed') setFailureSeq((current) => current + 1);
  }, [diagnosticScope, feedbackCorrelation, state.saveId, draft?.turnId]);
  useEffect(
    () => () => {
      submitToken.current++;
    },
    [],
  );
  const {
    generate: generateStory,
    cancel,
    progress: manualProgress,
    error,
    retry: storyRetry,
  } = useStoryGeneration(repository, draft, settings, companionProfile, onDraftSaved, reportRuntimeEvent);
  const entities = useVariableGeneration(repository, draft, settings, onDraftSaved, reportRuntimeEvent, 'entities');
  const variables = useVariableGeneration(repository, draft, settings, onDraftSaved, reportRuntimeEvent);
  const world = useWorldGeneration(repository, draft, settings, onDraftSaved, reportRuntimeEvent);
  const automatic = useTurnGeneration(repository, draft, settings, companionProfile, onDraftSaved, reportRuntimeEvent, handleSettled);
  // 延后一微任务，让 StrictMode 的首次 effect 清理先完成。消费的是创角或历史覆盖确认的单次事件授权，
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
  const reportMemoryFailure = useCallback((failure: MemoryFailureObservation) => {
    const entry = memoryRuntimeLogEvent(++runtimeLogId.current, diagnosticSaveRef.current, failure);
    linkMemoryFeedback(entry, failure.responseId);
    setRuntimeLogs(current => [...current.slice(-49), entry]);
  }, []);
  const memory = useMemoryMaintenance(repository, state.saveId, settings, onMemorySaved, onSettings, reportMemoryFailure);
  const summaryFailure = memory.popup;
  const memoryState = memory.snapshot.state;
  const settingsMemoryState = memoryState?.saveId === state.saveId && memoryState.createdAt === state.createdAt &&
    memoryState.revision >= state.revision ? memoryState : state;
  function handleSettled(result: TurnCommitResult) {
    onCommitted(result);
    if (!result.replayed) void memory.run(true);
  }
  const progress =
    automatic.progress?.stage === 'story' && automatic.progress.phase !== 'retrying'
      ? { ...automatic.progress, phase: automatic.progress.phase, narrative: automatic.progress.narrative ?? '' }
      : manualProgress;
  const streamingPreview = progress && progress.phase !== 'retrying' ? progress : undefined;
  const storyRetryWait = Boolean(
    progress?.phase === 'retrying' || (automatic.progress?.stage === 'story' && automatic.progress.phase === 'retrying'),
  );
  const workflowBusy = Boolean(
    submitting || automatic.running || progress || storyRetry || entities.phase || variables.phase || world.phase,
  );
  const npcManagement = useNpcManagement(repository, state, draft, workflowBusy, onNpcManaged, instance);
  const busy = workflowBusy || Boolean(npcManagement.pendingId);
  useEffect(() => { enterTavernChat(state.saveId, instance); }, [state.saveId, instance]);
  const recentActions = useRef<{ state: GameState; actions: Record<string, string> }>(undefined);
  useEffect(() => {
    if (!assistantView.snapshot().length || !state.journal.length) return;
    let alive = true;
    void repository.recentStoryActions(state, settings.memory.immediateWindowSize).then(actions => {
      if (alive) recentActions.current = { state, actions };
    }).catch(() => { /* A concurrent timeline change invalidates this optional preview. */ });
    return () => { alive = false; };
  }, [repository, state, settings.memory.immediateWindowSize]);
  useEffect(() => bindTavernPage(() => ({
    stage: 'story', saveInstance: instance, historyActions: recentActions.current?.state === state ? recentActions.current.actions : undefined, mode: draft?.turnKind ?? 'regular', state, draft, userInput: input || draft?.userInput || '', settings, companionProfile,
  }), () => {
    if (busy) throw new Error('请先完成或取消当前操作。');
    if (input) {
      sessionStorage.setItem(inputKey, input);
      return () => sessionStorage.removeItem(inputKey);
    }
  }), [state,draft,input,settings,companionProfile,busy,inputKey,instance]);
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
  const stageSettingsChanged = Boolean(draft && (draft.useEntityStage !== settings.runtime.useEntityStage || draft.useVariableStage !== settings.runtime.useVariableStage || draft.useWorldStage !== settings.runtime.useWorldStage));
  const { useEntityStage, useVariableStage, useWorldStage } = settings.runtime;
  const effectiveOpening = useMemo(() => {
    if (!state.openingTimePending || !validDraft || !draft?.story || draft.legacyNotificationRecovery) return undefined;
    return settlementDraft(configureTurnStages(draft, { useEntityStage, useVariableStage, useWorldStage }));
  }, [state.openingTimePending, validDraft, draft, useEntityStage, useVariableStage, useWorldStage]);
  const openingIssue = useMemo(() => {
    if (!effectiveOpening || (useVariableStage && effectiveOpening.variables?.validation !== 'validated')) return undefined;
    return openingSettlementIssue(state, effectiveOpening)?.diagnostic;
  }, [state, effectiveOpening, useVariableStage]);
  const openingTime = useMemo(() => {
    if (!effectiveOpening || openingIssue) return undefined;
    try { return openingTimeSelection(state, effectiveOpening); } catch { return undefined; }
  }, [state, effectiveOpening, openingIssue]);
  const canCommit = Boolean(validDraft && draft && !stageSettingsChanged && !openingIssue && completeTurnDraft(draft));
  const retainedOpeningVariables = draft?.variables?.validation === 'validated';
  const openingGuidance = openingIssue && `${storyRuleNames[openingIssue.reason]}，正文已保留。可重新 Roll 开局正文，或${useVariableStage
    ? '在主角与现场重新生成候选。'
    : retainedOpeningVariables ? '重新启用主角与现场，继续时重新校验并尝试复用已有候选。' : '启用主角与现场后主动补算时间。'}`;
  const openingReuse = Boolean(openingTime && useVariableStage && retainedOpeningVariables);
  const awaitingAction = awaitingPlayerAction(state, draft);
  // 正文失败或被取消、尚无候选时：原行动放回输入框，玩家可原样或修改后直接重新发送。
  const rebindAction = !busy && rebindableAfterStoryStop(state, draft);
  // 正文被截断：显示已写出的部分（只取正文，不显示规划和尾部标签）；续写次数用完后仍显示，只是不能再续写。
  // 「正文已闭合但字数不足」也不能续写（续写只能补 </正文> 之后的标签）；按本次设置的最低字数判断。
  const minNarrativeChars = settings.prompts.minNarrativeChars;
  const partialMinimum = continuationMinimum(draft?.storyPartial?.writing, minNarrativeChars);
  const storyContinuable = !busy && canContinueStory(draft, minNarrativeChars);
  const partialBlock = continuationBlock(draft, minNarrativeChars);
  const partialText = (!busy || storyRetryWait) && storyPartialVisible(draft) ? draft?.storyPartial?.text : undefined;
  const partialNarrative = useMemo(() => partialText === undefined ? undefined : new StoryStream().push(partialText).trim(), [partialText]);
  const partialCount = useMemo(() => partialText === undefined ? undefined : countPartialNarrative(partialText), [partialText]);
  const [partialCopy, setPartialCopy] = useState<{ text: string; ok: boolean }>();
  async function copyPartial(text: string) {
    try { await navigator.clipboard.writeText(text); setPartialCopy({ text, ok: true }); }
    catch { setPartialCopy({ text, ok: false }); }
  }
  const restoredInputFor = useRef('');
  const restoredText = useRef<{ turnId: string; text: string }>(undefined);
  useEffect(() => {
    if (!rebindAction || !draft) return;
    const key = `${draft.saveId}:${draft.turnId}:${draft.draftRevision}`;
    if (restoredInputFor.current === key) return;
    restoredInputFor.current = key;
    setInput((current) => {
      if (current.trim()) return current;
      restoredText.current = { turnId: draft.turnId, text: draft.userInput };
      return draft.userInput;
    });
  }, [rebindAction, draft]);
  // 玩家没改回填文字、直接用按钮重试正文且已成功：清掉这份重复文字，避免下一回合误发同一行动。
  useEffect(() => {
    const restored = restoredText.current;
    if (!restored || !draft) return;
    if (draft.turnId !== restored.turnId || awaitingAction) { restoredText.current = undefined; return; }
    if (draft.stageStatus.story !== 'ready') return;
    restoredText.current = undefined;
    setInput((current) => (current.trim() === restored.text.trim() ? '' : current));
  }, [draft, awaitingAction]);
  async function send() {
    const bindAction = awaitingAction || rebindAction;
    if (!draft || (!canCommit && !bindAction) || busy || submitLock.current || !input.trim()) return;
    submitLock.current = true;
    const token = submitToken.current;
    setSubmitting(true);
    setSubmitError('');
    setConcurrencyBlocked(false);
    try {
      if (bindAction) {
        const bound = await repository.bindTurnAction(draft, input, settings.runtime.useVariableStage, settings.runtime.useWorldStage, settings.runtime.useEntityStage);
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
        useEntityStage: settings.runtime.useEntityStage, useVariableStage: settings.runtime.useVariableStage,
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
        reportRuntimeEvent(bindAction ? 'workflow' : 'commit', 'failed', failure);
        setConcurrencyBlocked(failure instanceof AiError && failure.code === 'concurrency_unavailable');
        setSubmitError(
          bindAction && failure instanceof AiError && failure.code === 'concurrency_unavailable'
            ? storyError(failure)
            : bindAction
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
  // 「放弃这段」：只清掉没写完的正文，不调用 AI，也不撤回上一回合；原行动留在输入框里。
  async function discardPartial() {
    confirmation.current = undefined;
    if (!draft?.storyPartial || busy || submitLock.current) return;
    submitLock.current = true;
    const token = submitToken.current;
    setSubmitting(true);
    setSubmitError('');
    try {
      const saved = await repository.saveDraft(discardStoryPartial(draft), draft.draftRevision, undefined, draft);
      if (submitToken.current === token) onDraftSaved(saved);
    } catch (failure) {
      if (submitToken.current === token) {
        reportRuntimeEvent('workflow', 'failed', failure);
        setSubmitError('未能放弃这段正文：草稿版本冲突或存储失败。请重新读取存档后重试。');
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
  }, [progress?.narrative, progress?.nativeReasoning, progress?.compatibilityReasoning, progress?.planning, progress?.readingPhase, draft?.storyRevision]);
  const view = useMemo(() => playerView(state, companionProfile, settings.memory.immediateWindowSize), [state, companionProfile, settings.memory.immediateWindowSize]);
  const showChanges=Boolean(view.journal.length)&&!workflowBusy&&!draft?.story&&(!draft||awaitingAction);
  const turnComparison=useTurnComparison(state,repository,showChanges);
  const changeBadges=useMemo(()=>turnChangeBadges(turnComparison.groups),[turnComparison.groups]);
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
  const suggestions = actionSuggestions(state, validDraft ? draft?.story : undefined);
  const options = suggestions?.options;
  // Old suggestions are references until the existing binding/commit rules allow an action.
  const referenceOptions = Boolean(suggestions?.previous && !canCommit && !awaitingAction && !rebindAction);
  const workflowError = error || entities.error || variables.error || world.error || automatic.error || submitError;
  const failedStage = (['story', 'entities', 'variables', 'world'] as const).some((stage) => draft?.stageStatus[stage] === 'failed');
  // 仅用于入口展示，与 TurnCoordinator 的 needed 条件保持一致；实际执行仍由协调器重验。
  const storyNeeded = !draft?.story || draft.stageStatus.story !== 'ready';
  const entitiesNeeded = settings.runtime.useEntityStage && (storyNeeded || !draft?.entities);
  const variablesNeeded = settings.runtime.useVariableStage &&
    (draft?.stageStatus.variables !== 'ready' || draft.variables?.validation !== 'validated' || entitiesNeeded || storyNeeded);
  const worldNeeded = settings.runtime.useWorldStage &&
    (!draft?.world || !['ready', 'preview'].includes(draft.stageStatus.world) || entitiesNeeded || variablesNeeded || storyNeeded);
  const retryWorldOnly = Boolean(validDraft && !stageSettingsChanged && !storyNeeded && !entitiesNeeded && !variablesNeeded && worldNeeded
    && draft?.useVariableStage && draft.stageStatus.variables === 'ready' && draft.variables?.validation === 'validated'
    && (draft.stageStatus.world === 'failed' || draft.failures.some(failure =>
      failure.stage === 'world' && failure.storyRevision === draft.storyRevision)));
  const worldRetryHint = '本次仅重试场外与网络，保留已通过的正文和变量。重新请求可能产生模型费用。';
  const canGenerate = Boolean(validDraft && !awaitingAction && !openingIssue && (storyNeeded || entitiesNeeded || variablesNeeded || worldNeeded || stageSettingsChanged));
  const recoveryStagesOff = Boolean(draft?.legacyNotificationRecovery
    && ( !settings.runtime.useVariableStage || !settings.runtime.useWorldStage));
  const disabledGuidance = recoveryStagesOff
    ? '结算旧通知需要启用主角与现场和场外与网络。'
    : !useEntityStage || !useVariableStage || !useWorldStage
      ? '已关闭的阶段将跳过。其余阶段生成成功后一起结算。' : '';
  const workflowGuidance = validDraft && !awaitingAction && !busy && !canCommit
    ? openingGuidance || disabledGuidance || (!canGenerate
      ? draft?.world?.validation === 'preview'
        ? '当前世界结果仅为预览。请在高级操作中补算世界候选，完成后才能正式结算。'
        : '当前候选尚不满足正式结算条件。请展开高级设置检查并补算必要候选。'
      : '')
    : '';
  const disabledStage = !useEntityStage && !recoveryStagesOff ? 'entities' : !useVariableStage ? 'variables' : 'world';
  function openRuntimeSettings(target: 'entities' | 'variables' | 'world' = disabledStage) {
    if (!compactSidebars) {
      // PC：选中提示所指的阶段，并聚焦该阶段自己的开关。

      openWorkflowView(target);
      requestAnimationFrame(() => {
        const toggle = runtimeSwitches.current?.querySelector<HTMLInputElement>(`input[data-stage="${target}"]`);
        toggle?.scrollIntoView({ block: "nearest" });
        toggle?.focus({ preventScroll: true });
      });
      return;
    }
    setWorkflowView('home');
    setWorkflowOpen(true);
    requestAnimationFrame(() => {
      runtimeSwitches.current?.scrollIntoView({ block: "nearest" });
      (
        runtimeSwitches.current?.querySelector<HTMLInputElement>(
          `input[data-stage="${target}"]`,
        ) ?? runtimeSwitches.current?.querySelector<HTMLInputElement>("input")
      )?.focus({ preventScroll: true });
    });
  }

  const stageLabels = { story: '正文', entities: '人物与实体', variables: '主角与现场', world: '场外与网络' };
  const activeStage = automatic.running ? automatic.progress?.stage
    : progress ? 'story' : entities.phase ? 'entities' : variables.phase ? 'variables' : world.phase ? 'world' : undefined;
  const activePhase = automatic.running ? automatic.progress?.phase
    : progress?.phase || entities.phase || variables.phase || world.phase;
  // Hook 错误可能在其他入口恢复成功后仍保留；展示优先使用最新运行结果。
  const latestResult = [...runtimeLogs].reverse().find((entry) => entry.stage !== 'memory' && entry.kind !== 'started');
  const currentFailure = latestResult && latestResult.kind !== 'completed' ? latestResult : undefined;
  const hasWorkflowError = Boolean(failedStage || (workflowError && (!latestResult || currentFailure)));
  const errorStage = currentFailure?.stage
    ?? (['story', 'entities', 'variables', 'world'] as const).find((stage) => draft?.stageStatus[stage] === 'failed')
    ?? (error ? 'story' : entities.error ? 'entities' : variables.error ? 'variables' : world.error ? 'world' : undefined);
  const errorLabel = errorStage && errorStage in stageLabels ? stageLabels[errorStage as keyof typeof stageLabels]
    : errorStage === 'commit' ? '结算' : '';
  const retryNotice = automatic.progress?.retry ?? entities.retry ?? variables.retry ?? world.retry ?? storyRetry;
  const retrySeconds = retryNotice ? Math.max(0, Math.ceil(retryNotice.remainingMs / 1000)) : 0;
  const retryIndex = retryNotice?.count;
  // 手机诊断页会在失败时自动弹出。自动重试进行中先让出，避免挡住次数、等待和取消。
  useEffect(() => { if (retryIndex !== undefined) setDiagnosticsOpen(false); }, [retryIndex, activeStage]);
  const workflowLabel = submitting ? (awaitingAction ? '正在发送行动' : '正在正式结算')
    : automatic.settling ? '正在正式结算'
    : activeStage ? `${stageLabels[activeStage]}${activePhase === 'saving' ? '保存中' : activePhase === 'retrying' ? `自动重试 ${retryNotice?.count ?? ''}/${retryNotice?.max ?? ''}` : '生成中'} · ${{ story: 1, entities: 2, variables: 3, world: 4 }[activeStage]}/4`
    : automatic.running ? '正在准备生成'
    : openingIssue ? '开局时间待补齐'
    : hasWorkflowError && submitError ? `${awaitingAction || rebindAction ? '行动发送' : '结算'}失败 · 查看详情`
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
  const progressSteps = (['story', 'entities', 'variables', 'world'] as const).map((stage, i) => {
    const status = draft?.stageStatus[stage];
    const auto = automatic.progress?.stage === stage ? automatic.progress : undefined;
    const skipped = automatic.outcome?.draft.draftRevision === draft?.draftRevision && automatic.outcome?.skipped.includes(stage);
    const enabled = stage === 'story' || (busy && draft ? stage === 'entities' ? draft.useEntityStage : stage === 'variables' ? draft.useVariableStage : draft.useWorldStage : stage === 'entities' ? settings.runtime.useEntityStage : stage === 'variables' ? settings.runtime.useVariableStage : settings.runtime.useWorldStage);
    const text = !enabled ? '已跳过' : awaitingAction ? '已结算'
      : auto ? auto.phase === 'saving' ? '保存中' : auto.phase === 'retrying' ? `重试 ${auto.retry?.count ?? ''}/${auto.retry?.max ?? ''}` : '生成中'
      : activeStage === stage ? activePhase === 'saving' ? '保存中' : activePhase === 'retrying' ? `重试 ${retryNotice?.count ?? ''}/${retryNotice?.max ?? ''}` : '生成中'
      : skipped || status === 'skipped' ? '已跳过'
      : status === 'failed' || errorStage === stage && hasWorkflowError ? '失败 · 可重试'
      : status === 'preview' ? '仅预览' : status === 'ready' ? '已完成' : '待生成';
    return { stage, name: ['正文', '人物与实体', '主角与现场', '场外与网络'][i], text,
      visual: !enabled ? 'off' : awaitingAction ? 'done' : auto || activeStage === stage ? 'run' : text === '失败 · 可重试' ? 'fail' : status === 'ready' ? 'done' : 'idle' };
  });
  const worldNavigation = <aside className="world-sidebar" aria-label="世界资料">
    <h2>世界资料</h2>
    <nav aria-label="世界资料分类">
      {panelNames.map((name, index) => <button key={name} aria-description={compactSidebars&&changeBadges[name]?`本回合变化 ${changeBadges[name]} 项`:undefined} data-archive-panel={name} aria-current={!compactSidebars && !desktopSettings && panel === name ? 'true' : undefined} onClick={() => outsideSettings(()=>{ changeOpener.current=null;setArchiveTarget(undefined);if(compactSidebars)setWorldDirectoryOpen(false); setPanel(!compactSidebars && panel === name ? undefined : name); })}>
        <span className="dock-seal" aria-hidden="true">{['人', '势', '盟', '图', '物', '事', '史', '忆', '家'][index]}{compactSidebars&&Boolean(changeBadges[name])&&<span className="turn-change-badge" data-change-panel={name} aria-hidden="true">{changeBadges[name]}</span>}</span>
        <span>{name}</span>
      </button>)}
      <button data-archive-panel="小剧场" aria-current={!compactSidebars && panel === '小剧场' ? 'true' : undefined} onClick={() => outsideSettings(() => {
        changeOpener.current = null;
        setArchiveTarget(undefined);
        if (compactSidebars) setWorldDirectoryOpen(false);
        setPanel(!compactSidebars && panel === '小剧场' ? undefined : '小剧场');
      })}><span className="dock-seal" aria-hidden="true">剧</span><span>小剧场</span></button>
    </nav>
    {!compactSidebars && <nav className="dock-system" aria-label="系统操作">
      <button data-settings-open aria-current={desktopSettings?'true':undefined} onClick={onOpenSettings}><span className="dock-seal" aria-hidden="true">设</span><span>设置</span></button>
      <button onClick={()=>outsideSettings(onSaves)}><span className="dock-seal" aria-hidden="true">归</span><span>返回首页</span></button>
    </nav>}
  </aside>;
  const autoWorkflowView: WorkflowStage =
    (activeStage === 'story' || activeStage === 'entities' || activeStage === 'variables' || activeStage === 'world' ? activeStage : undefined)
    ?? progressSteps.find((step) => step.visual === 'fail')?.stage
    ?? progressSteps.find((step) => step.text === '待生成' || step.text === '仅预览')?.stage
    ?? (disabledGuidance ? disabledStage : undefined)
    ?? 'story';
  const rawTurnId = awaitingAction ? state.journal.at(-1)?.turnId : draft?.turnId;
  const staleDraftMessage = draft ? '当前草稿已过期，请重新读取存档。' : '没有可执行的回合草稿。请重新读取存档；暂时无法生成或结算。';
  const setStageEnabled = (key: 'useEntityStage' | 'useVariableStage' | 'useWorldStage', checked: boolean) =>
    onSettings({ ...settings, runtime: { ...settings.runtime, [key]: checked } });
  const followLatest = () => {
    follow.current = true;
    setFollowing(true);
    if (reader.current) reader.current.scrollTop = reader.current.scrollHeight;
  };
  const stageActions: Record<'entities' | 'variables' | 'world', StageAction> = {
    entities: { label: entities.phase ? '取消人物与实体生成' : draft?.entities ? '重新生成人物与实体' : '生成人物与实体',
      cancel: Boolean(entities.phase), disabled: entities.phase ? entities.phase === 'saving' : !validDraft || !draft?.story || !useEntityStage || busy,
      onClick: entities.phase ? entities.cancel : () => void entities.generate() },
    variables: variables.phase
      ? { label: '取消变量生成', cancel: true, disabled: variables.phase === 'saving', onClick: variables.cancel }
      : {
          label: draft?.variables ? '重新生成变量候选' : draft?.useVariableStage === false ? '启用并补算变量' : '生成变量候选',
          cancel: false,
          disabled: !validDraft || !draft?.story || draft.stageStatus.story !== 'ready' || !settings.runtime.useVariableStage || entitiesNeeded || busy,
          onClick: () => void variables.generate(),
        },
    world: world.phase
      ? { label: '取消世界生成', cancel: true, disabled: world.phase === 'saving', onClick: world.cancel }
      : {
          label: draft?.world ? '重新生成世界候选' : draft?.useWorldStage === false ? '启用并补算世界' : '生成世界候选',
          cancel: false,
          disabled: !validDraft || !draft?.story || draft.stageStatus.story !== 'ready' || entitiesNeeded || !settings.runtime.useWorldStage || busy,
          onClick: () => void world.generate(),
        },
  };
  function generate(...args: Parameters<typeof generateStory>) {
    confirmation.current = undefined;
    return generateStory(...args);
  }
  async function continueWorkflow(transport: ContinuationRoute = 'direct') {
    if (!draft || busy) return;
    if (storyContinuable && !draft.storyPartial?.writing) {
      if (confirmation.current) return;
      const operation = Symbol('legacy continuation');
      confirmation.current = operation;
      setConfirmationError(undefined);
      const route = location.hash;
      const active = () => confirmation.current === operation && location.hash === route;
      try {
        const offer = await prepareLegacyContinuation(draft, repository,
          () => (readDocument(localStorage, settingsKey, SettingsSchema) ?? settings).prompts, active);
        if (!active()) return;
        const writing = offer.writing;
        const label = writing.source === 'native' ? '王朝原生文学设置' : `${writing.id}（${writing.version}）`;
        const path = transport === 'relay' ? '通过本站中转' : '直连模型服务';
        if (!window.confirm(`旧版断点没有记录文学来源。保留已写内容，使用${label}续写？本次${path}，游戏只发起一次请求。仅新续写部分使用此来源。取消可继续阅读、复制或重新生成。`)) return;
        const failure = await automatic.generate(draft, offer.confirm(transport));
        if (active() && failure) setConfirmationError({draft, message:failure});
      } catch (error) {
        if (active()) setConfirmationError({draft, message:storyError(error)});
      } finally {
        if (active()) confirmation.current = undefined;
      }
      return;
    }
    await automatic.generate(draft);
  }
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
      onClick={() => void continueWorkflow()}
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
  // 输入栏常驻的多功能按钮：运行中=取消；某环节停下=继续当前环节；已结算=留在原位不可点。
  // 全阶段模式沿用原来的独立正文入口；关闭阶段时自动完成已启用阶段并结算。均使用已绑定行动。
  // 变量、世界与结算环节等同详情里的「继续未完成阶段」。
  const nextStage = storyNeeded ? 'story' : entitiesNeeded ? 'entities' : variablesNeeded ? 'variables' : worldNeeded ? 'world' : undefined;
  const runningCancel = automatic.running ? { onClick: automatic.cancel, saving: automatic.settling || automatic.progress?.phase === 'saving' }
    : manualProgress ? { onClick: cancel, saving: manualProgress.phase === 'saving' }
    : entities.phase ? { onClick: entities.cancel, saving: entities.phase === 'saving' }
    : variables.phase ? { onClick: variables.cancel, saving: variables.phase === 'saving' }
    : world.phase ? { onClick: world.cancel, saving: world.phase === 'saving' }
    : undefined;
  const storyLabel = draft?.turnKind === 'regular' ? '生成本回合正文' : '生成开局正文';
  const continueStory = () => {
    if (!draft || busy || !mayStartStory(draft)) return;
    if (!settings.runtime.useEntityStage || !settings.runtime.useVariableStage || !settings.runtime.useWorldStage) void automatic.generate();
    else void generate();
  };
  const workflowAction: { kind: 'cancel' | 'continue' | 'idle'; label: string; short: string; title?: string; disabled: boolean; onClick?: () => void } =
    runningCancel ? { kind: 'cancel', label: runningCancel.saving ? '正在保存…' : '取消生成', short: '停', disabled: runningCancel.saving,
      title: runningCancel.saving ? '正在保存，稍候即可' : '取消正在进行的生成', onClick: runningCancel.onClick }
    : awaitingAction ? { kind: 'idle', label: '本回合已完成', short: '完', disabled: true, title: '本回合已结算；发送新行动后继续' }
    : nextStage === 'story' && storyContinuable ? { kind: 'continue', label: '续写正文', short: '续', disabled: !validDraft || busy,
        title: !validDraft ? staleDraftMessage : '从中断处接着写正文，写完后完成已启用阶段并正式结算', onClick: () => void continueWorkflow() }
    : nextStage === 'story' ? { kind: 'continue', label: storyLabel, short: '续', disabled: !validDraft || busy || !mayStartStory(draft),
        title: !validDraft ? staleDraftMessage : '生成本回合正文（使用已绑定的行动）', onClick: continueStory }
    : !validDraft ? { kind: 'idle', label: '继续', short: '续', disabled: true, title: staleDraftMessage }
    : openingIssue ? { kind: 'continue', label: '重新 Roll 开局正文', short: '重', disabled: busy,
        title: '重新生成开局正文。当前正文保留到新正文保存成功。', onClick: () => void generate(undefined, true) }
    : canCommit && !nextStage ? { kind: 'continue', label: '完成本回合结算', short: '结', disabled: busy, title: '候选已完成，保存本回合结果', onClick: () => void continueWorkflow() }
    : stageSettingsChanged && !nextStage ? { kind: 'continue', label: '应用阶段设置并继续', short: '续', disabled: busy, title: '在执行锁内保存本次阶段选择，再校验并结算', onClick: () => void continueWorkflow() }
    : nextStage && canGenerate ? { kind: 'continue', label: '继续生成' + stageLabels[nextStage], short: '续', disabled: busy,
        title: '从当前环节继续，完成后自动结算', onClick: () => void continueWorkflow() }
    : { kind: 'idle', label: '继续', short: '续', disabled: true, title: workflowGuidance || '当前没有可继续的环节' };
  const actionGuidance = submitting || automatic.settling || runningCancel?.saving
    ? '正在保存，请稍候；保存期间不能取消或发送新行动。'
    : busy ? `${activeStage ? stageLabels[activeStage] : '当前操作'}正在处理，请等待完成或使用原有取消按钮。`
    : !validDraft ? staleDraftMessage
    : !navigator.locks ? '当前浏览器缺少 Web Locks，不能安全启动请求。输入仍保留，请使用支持的浏览器重新读档。'
    : openingIssue ? undefined
    : openingReuse ? '继续时会重新校验已有变量候选，通过后直接复用。'
    : workflowGuidance || (awaitingAction ? undefined
      : canCommit ? '候选已完成，可点击左侧按钮完成本回合结算；发送新行动将先结算，再绑定下一回合。'
      : nextStage === 'entities' || nextStage === 'variables' || nextStage === 'world'
        ? `本回合尚未结算，请点击输入框左侧${compactSidebars ? `“续”（${workflowAction.label}）` : `“${workflowAction.label}”`}。${retryWorldOnly ? worldRetryHint : '输入仅本页暂存，不会替换已绑定行动。'}`
        : rebindAction ? `尚无正文候选。可修改回填行动后尝试发送；左侧“${compactSidebars ? '续' : workflowAction.label}”使用原已绑定行动。请求前仍会检查运行锁。`
        : '请先使用左侧按钮生成本回合正文，再继续必要阶段。');
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

  const errorMessages = [automatic.error, error, submitError, entities.error, variables.error, world.error].filter((message): message is string => Boolean(message));
  const diagnosticRecovery = busy ? '当前仍在处理，请等待结束或使用原有取消操作。'
    : !validDraft ? '当前草稿版本不可继续，请重新读取存档后检查。'
    : !navigator.locks ? '当前浏览器缺少 Web Locks，不能安全启动请求；请更换支持的浏览器并重新读档。'
    : openingGuidance ? openingGuidance
    : retryWorldOnly ? `点击「继续未完成阶段」恢复本回合。${worldRetryHint}`
    : workflowAction.kind === 'continue' && !workflowAction.disabled ? `当前可主动${workflowAction.label}；生成可能产生费用，查看诊断不会发起请求。`
    : '当前暂不可继续，请检查阶段开关与现有操作按钮。';
  const errorFailures = draft?.failures.filter(failure => failure.storyRevision === draft.storyRevision).slice(-6) ?? [];
  const errorSignature = hasWorkflowError && workflowError
    ? errorBannerKey({ saveId: state.saveId, turnId: draft?.turnId, storyRevision: draft?.storyRevision, failureSeq }, errorMessages, errorFailures)
    : '';
  const desktopNotices = (
    <>
      {hasWorkflowError && workflowError && errorSignature !== dismissedError && (
        <div className="wf-banner workflow-errors" data-level="err" role="alert">
          <span className="wf-banner-tag" aria-hidden="true">误</span>
          <div className="wf-banner-msg">
            {errorMessages.map((message, i) => <p key={i}>{message}</p>)}
            {errorFailures.map((failure, i) => <small key={`code-${i}`}>{stageLabels[failure.stage]} · 安全失败码：{failure.errorCode} · {failure.attempt} 次尝试</small>)}
          </div>
          {automatic.error && <button onClick={onOpenSettings}>打开 AI 设置</button>}
          <button type="button" className="wf-banner-close" aria-label="关闭错误提示" title="关闭提示（运行诊断里仍保留完整记录）"
            onClick={() => setDismissedError(errorSignature)}>×</button>
        </div>
      )}
      {legacyRecoveryOptions.length > 0 && (
        <div className="wf-banner" data-level="warn" role="note">
          <span className="wf-banner-tag" aria-hidden="true">复</span>
          <div className="wf-banner-msg"><p>发现到期的旧入场。纯通知可主动恢复，待决请求继续保留。</p></div>
          <button type="button" disabled={busy || !navigator.locks || !settings.runtime.useVariableStage || !settings.runtime.useWorldStage}
            onClick={() => setLegacyRecoveryDialog(recoveryDraftKey)}>修复旧通知回合</button>
        </div>
      )}
      {draft?.legacyNotificationRecovery && !busy && !recoveryStagesOff && (
        <p role="status" className="field-hint">修复正文已保存。可继续未完成阶段验证收悉并结算。</p>
      )}
      {workflowGuidance && (
        <div className="wf-banner" data-level="warn" role="note" aria-label="阶段设置提示">
          <span className="wf-banner-tag" aria-hidden="true">注</span>
          <div className="wf-banner-msg"><p>{workflowGuidance}</p></div>
          <button onClick={() => openRuntimeSettings()} aria-controls="workflow-runtime-switches">前往阶段开关</button>
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
          ? "正在执行本次已启用阶段"
          : canCommit
            ? "正文及已启用阶段的候选均已通过校验"
            : retryWorldOnly ? worldRetryHint : "从第一个未完成的阶段继续"}
      </small>
    </div>
  ) : (
    <small className="wf-idle">{awaitingAction ? "发送新行动后开始下一回合" : busy ? "正在处理，请稍候" : "当前没有可执行的自动操作"}</small>
  );
  const renderWorkflow = (layout: 'desktop' | 'sheet') => (
                      <DesktopWorkflowPanel layout={layout}
                        label={workflowLabel}
                        state={workflowState}
                        onClose={closeWorkflow}
                        onFollow={progress && !following ? followLatest : undefined}
                        notices={layout === 'sheet' && workflowView === 'diagnostics' ? <>{desktopNotices}<button type="button" onClick={() => setDiagnosticsOpen(true)}>重试与变更详情</button></> : desktopNotices}
                        primary={desktopPrimary}
                        feeHint={layout === 'sheet' && retryWorldOnly && !busy ? worldRetryHint : undefined}
                        steps={progressSteps}
                        view={layout === 'desktop' && workflowView === 'home' ? autoWorkflowView : workflowView ?? (layout === 'sheet' ? 'home' : autoWorkflowView)}
                        onView={(view) => { setWorkflowView(view); setWorkflowTab("overview"); }}
                        tab={workflowTab}
                        onTab={setWorkflowTab}
                        switches={{
                          entities: { checked: useEntityStage, onChange: checked => setStageEnabled("useEntityStage", checked) },
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
                        feedbackLogs={layout === 'desktop' ? runtimeEntries : undefined}
                        recovery={diagnosticRecovery}
                        onClearLogs={() => setRuntimeLogs([])}
                      />
  );
  return (
    <main className="game-layout city-night" data-city={atmosphere.city} data-time={atmosphere.time} data-wx={atmosphere.weather}
      onKeyDown={event => {
        if (compactSidebars || desktopArchive || desktopSettings || theaterActive || event.nativeEvent.isComposing || event.repeat || (event.target as HTMLElement).closest('dialog, .archive')) return;
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
          event.preventDefault(); void send(); return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          (event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
        if (/^[1-5]$/.test(event.key) && settings.prompts.actionOptions && !busy && !progress && !referenceOptions && options && options.length >= 3 && options.length <= 5) {
          const option = options[Number(event.key) - 1];
          if (option) { event.preventDefault(); setInput((current) => appendActionOption(current, option)); document.getElementById('player-input')?.focus(); }
        }
      }}>
      <CityAtmosphere state={state} />
      {compactSidebars?<MobileCityBar state={state} mini={mobileMini} onStatus={()=>setMobileStatusOpen(true)}/>:<CityBar state={state} />}
      {!compactSidebars&&<PlayerStatus state={state} equipment={equipment} activePanel={compactSidebars || desktopSettings ? undefined : panel} onProfile={() => outsideSettings(()=>{ changeOpener.current=null;setArchiveTarget(undefined); setPanel(desktopArchive === '人物档案' ? undefined : '人物档案'); })} onEconomy={() => outsideSettings(()=>{ changeOpener.current=null;setArchiveTarget(undefined);setPanel(desktopArchive === '经济与资产' ? undefined : '经济与资产'); })} />}
      <section inert={Boolean(desktopArchive || desktopSettings || theaterActive)} className="story-column" aria-label="剧情与行动">
        <div
          className={`reader ${!view.journal.length && !draft?.story && !streamingPreview && !storyRetryWait ? 'reader-empty' : ''}`}
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
            {!compactSidebars && <ScriptButtons/>}
            <span className="tag">
              {streamingPreview
                ? streamingPreview.readingPhase === 'waiting' ? '完整响应 · 尚未保存' : '生成预览 · 尚未保存'
                : storyRetryWait
                  ? '自动重试 · 已写内容保留'
                  : draft?.story
                  ? '已保存草稿'
                  : state.journal.length
                    ? '已结算历史'
                    : '等待开局'}
            </span>
          </div>
          {view.journal.map((entry, index) => (
            <article className={`story-entry glass ${index < view.journal.length - 1 || draft?.story || streamingPreview || storyRetryWait ? 'past' : 'latest'}`} key={entry.turnId}>
              <CityChapter number={index + 1} state={state} scene={state.journal[index]?.scene} desktop={!compactSidebars} />
              <StoryReading narrative={entry.narrative} protagonistName={hero.name} />
              <SettlementNotice settlement={state.journal[index]?.settlement} />
              {index===view.journal.length-1&&showChanges&&<TurnChanges state={state} comparison={turnComparison} mobile={compactSidebars} onOpen={openChange}/>}
            </article>
          ))}
          {streamingPreview ? (
            <article className="story-entry glass latest" aria-label={streamingPreview.readingPhase === 'waiting' ? '完整正文等待' : '流式正文预览'} aria-busy="true">
              <CityChapter number={state.turnNumber + 1} state={state} scene={draftScene} status="preview" desktop={!compactSidebars} />
              <span className="tag preview-tag">{streamingPreview.readingPhase === 'waiting' ? '完整响应模式 · 校验保存后展示' : '临时预览 · 完整校验前不保存'}</span>
              <StoryStreamReading progress={streamingPreview} caret={!compactSidebars} />
            </article>
          ) : partialNarrative !== undefined ? (
            <article className="story-entry glass latest story-partial">
              <CityChapter number={state.turnNumber + 1} state={state} scene={draftScene} status="draft" desktop={!compactSidebars} />
              <span className="tag preview-tag">{storyRetryWait
                ? '正在自动重试 · 已写出的内容先留在这里'
                : partialBlock === 'used_up'
                ? `正文未写完 · 已续写 ${STORY_CONTINUATION_LIMIT} 次，不能再续写；可复制已写内容，按「发送」重新生成`
                : partialBlock === 'closed_short'
                  ? `正文已结束但只有 ${partialCount?.chars ?? 0} 字，低于最低 ${partialMinimum} 字，续写无法补足 · 可复制已写内容，按「发送」重新生成`
                  : !draft?.storyPartial?.writing
                    ? (confirmationError && confirmationError.draft === draft ? confirmationError.message : undefined) ?? '旧版断点的文学来源未知。点「续写正文」确认新续写的来源，也可保留行动并重新生成正文。'
                  : partialCount?.closed
                    ? '正文已写完，只差结尾的记录标签 · 点「续写正文」补齐，或按「发送」重新生成'
                    : '正文未写完 · 点「续写正文」从断点接着写，或按「发送」重新生成'}</span>
              {partialNarrative ? <StoryReading narrative={partialNarrative} protagonistName={hero.name} />
                : <p className="field-hint">模型还在写创作提纲时就中断了，{storyContinuable ? '续写会从提纲处接着往下写。' : '没有可阅读的正文。'}</p>}
              {!partialCount?.closed && <p className="story-partial-end" aria-hidden="true">……</p>}
              <div className="story-partial-actions" role="group" aria-label="未写完的正文">
                <span className="story-partial-meta">已写 <b>{partialCount?.chars ?? 0}</b> 字{partialMinimum !== undefined && ` · 最低 ${partialMinimum} 字`}</span>
                {partialNarrative && <button type="button" className={`partial-action partial-copy${partialCopy?.text === partialNarrative ? (partialCopy.ok ? ' is-done' : ' is-failed') : ''}`}
                  onClick={() => void copyPartial(partialNarrative)} title="把已写出的正文复制到剪贴板">
                  <span className="partial-seal" aria-hidden="true">{partialCopy?.text === partialNarrative && partialCopy.ok ? '✓' : '抄'}</span>
                  {partialCopy?.text !== partialNarrative ? '复制已写内容' : partialCopy.ok ? '已复制' : '复制失败，请手动选中'}</button>}
                {storyContinuable && !draft?.storyPartial?.writing && canRelayLegacyStory() &&
                  <button type="button" className="partial-action" disabled={busy}
                    onClick={() => void continueWorkflow('relay')}>通过本站中转续写</button>}
                {!draft?.storyPartial?.writing && <button type="button" className="partial-action" disabled={busy}
                  onClick={() => void generate()} title="使用当前文学设置重新生成；成功前保留旧片段">重新生成正文</button>}
                <button type="button" className="partial-action partial-discard" disabled={busy} onClick={() => void discardPartial()}
                  title="只丢掉这段没写完的正文，不调用 AI，也不会撤回上一回合；原行动留在输入框里">
                  <span className="partial-seal" aria-hidden="true">弃</span>放弃这段</button>
              </div>
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
              compactSidebars?<MobileActions options={options} value={input} onChoose={(option) => setInput((current) => appendActionOption(current, option))} source={suggestions!.label} referenceOnly={referenceOptions}/>:<div className="action-options" aria-label="行动建议">
                <p>{suggestions!.label}</p>
                {referenceOptions && <p className="field-hint">仅供参考；请先完成当前回合，不能替换已绑定行动。</p>}
                {options.map((option, index) => (
                  <button key={option} disabled={referenceOptions} aria-pressed={includesActionOption(input, option)} onClick={() => setInput((current) => appendActionOption(current, option))}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span>{option}</span><span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="field-hint">{progress ? '正文生成中暂时隐藏行动建议；停止后可查看已有建议。' : '行动建议将在正文生成后显示。'}</p>
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
              aria-label="四阶段工作流"
              data-state={workflowState}
            >
              {retryNotice && (
                <p className="retry-status" role="status">
                  <span>{activeStage ? stageLabels[activeStage] : '当前阶段'} · 第 {retryNotice.count}/{retryNotice.max} 次自动重试</span>
                  <span>上次失败：{retryNotice.reason}</span>
                  <span>{retrySeconds > 0 ? `${retrySeconds} 秒后重试` : '即将重试'}</span>
                  <button type="button" onClick={() => (automatic.running ? automatic.cancel() : entities.phase ? entities.cancel() : variables.phase ? variables.cancel() : world.phase ? world.cancel() : cancel())}>取消</button>
                </p>
              )}
              {compactSidebars ? (
                <div className="workflow-disclosure mobile-workflow-line" data-open={workflowOpen} {...(workflowOpen?{open:true}:{})}>
                  <div className="workflow-summary"><button type="button" className="workflow-toggle" ref={workflowToggle} aria-label="四阶段工作流详情" aria-expanded={workflowOpen} aria-controls="workflow-pop" onClick={()=>setWorkflowOpen(true)}>
                    <span className="mobile-progress-segments" aria-hidden="true">{progressSteps.map(step=><i key={step.stage} data-s={step.visual}/>)}</span>
                    <strong role="status" aria-live="polite"><span className="sr-only">四阶段 · </span>{workflowLabel}</strong><span className="more">详情 ›</span>
                  </button></div>
                  {workflowOpen&&<MobileWorkflowDrawer inputRef={inputElement} onClose={closeWorkflow}><ScriptButtons/>{renderWorkflow('sheet')}</MobileWorkflowDrawer>}
                </div>
              ) : (
                <div
                  className="workflow-disclosure"
                  data-open={workflowOpen}
                  {...(workflowOpen ? { open: true } : {})}
                >
                  <div className="workflow-summary">
                    <strong role="status" aria-live="polite">
                      <span className="workflow-prefix">四阶段 · </span>
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
                    {renderWorkflow('desktop')}
                  </div>
                </div>
              )}
            </section>
          </div>
          {undoNotice && <p role="status" className="undo-feedback">{undoNotice}</p>}
          {concurrencyBlocked && <p id="action-concurrency-error" role="alert" className="undo-feedback">{submitError}</p>}
          <div className="composer-action-row">
            <ComposerTools compact={compactSidebars} menu={false}>
              <TurnUndoControl compact={compactSidebars}
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
              <button className="composer-workflow-action" data-kind={workflowAction.kind} disabled={workflowAction.disabled}
                title={workflowAction.title} aria-label={compactSidebars ? workflowAction.label : undefined} onClick={workflowAction.onClick}>
                {compactSidebars ? <span aria-hidden="true">{workflowAction.short}</span> : workflowAction.label}
              </button>
            </ComposerTools>
            <label className="sr-only" htmlFor="player-input">你的行动</label>
            <textarea id="player-input" ref={inputElement} aria-describedby={[concurrencyBlocked && 'action-concurrency-error', (actionGuidance || openingIssue) && 'action-recovery-guidance'].filter(Boolean).join(' ') || undefined} disabled={submitting} value={input}
              onChange={(e) => setInput(e.target.value)} rows={compactSidebars?1:2}
              placeholder={compactSidebars ? '填写你的行动' : !settings.runtime.useEntityStage || !settings.runtime.useVariableStage || !settings.runtime.useWorldStage
                ? '填写你的行动；发送后完成已启用阶段并自动结算' : '填写你的行动；发送后生成四阶段并自动结算'} />
            <div className="composer-footer">
              <button className="primary" disabled={(!canCommit && !awaitingAction && !rebindAction) || busy || !input.trim()}
                onClick={() => void send()}>{submitting ? '正在结算…' : '发送'}</button>
              {!compactSidebars && <span className="kbd">Ctrl + Enter</span>}
            </div>
          </div>
          {!busy && openingGuidance && <div id="action-recovery-guidance" className="wf-banner" data-level="warn" role="note" aria-label="开局时间恢复">
            <div className="wf-banner-msg"><p>{openingGuidance}</p></div>
            <button type="button" onClick={() => useVariableStage ? openWorkflowView('variables') : openRuntimeSettings('variables')}>{useVariableStage ? '查看变量阶段' : '前往变量开关'}</button>
          </div>}
          {actionGuidance && <p id="action-recovery-guidance" className="field-hint" role="status">{actionGuidance}</p>}
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
      {legacyRecoveryDialog && legacyRecoveryDialog === recoveryDraftKey && draft?.story && legacyRecoveryOptions.length > 0 && (
        <LegacyNotificationRecoveryDialog options={legacyRecoveryOptions} narrative={draft.story.narrative}
          onClose={() => setLegacyRecoveryDialog(undefined)} onConfirm={selection => {
            setLegacyRecoveryDialog(undefined);
            if (!busy) void generate(selection);
          }} />
      )}
      {compactSidebars&&<MobileDiagnostics saveId={state.saveId} turnId={rawTurnId} draft={draft} entries={runtimeLogs} feedbackLogs={runtimeEntries} recovery={diagnosticRecovery} onClear={()=>setRuntimeLogs([])} open={diagnosticsOpen} onOpen={()=>setDiagnosticsOpen(true)} onClose={()=>setDiagnosticsOpen(false)} retrying={Boolean(retryNotice)}/>}
      {compactSidebars && mobileStatusOpen && <Dialog title="此时此地" mobileVariant="sheet" sheetExpandable seal={mobileCitySeal(state)} eyebrow="NOW · HERE" className="mobile-status-sheet" onClose={()=>setMobileStatusOpen(false)} returnFocus={()=>document.querySelector<HTMLElement>('[data-mobile-status]')??mobileReturnFocus('hero')}>
        <MobileStatus state={state} equipment={equipment} onProfile={()=>{setMobileStatusOpen(false);setPanel('人物档案');}} onEconomy={()=>{setMobileStatusOpen(false);setPanel('经济与资产');}}/>
      </Dialog>}
      {compactSidebars && worldDirectoryOpen && <Dialog title="世界资料" mobileVariant="sheet" sheetExpandable seal="世" eyebrow="WORLD ARCHIVE" className="world-directory" onClose={() => setWorldDirectoryOpen(false)} returnFocus={()=>mobileReturnFocus('world')}>
        {worldNavigation}
        <p className="muted mobile-world-hint">从身边的人，到更远的城市。</p>
      </Dialog>}
      {desktopArchive && <ArchivePanel key={desktopArchive} title={desktopArchive} className={desktopArchive === '世界事件' ? 'world-events-dialog' : desktopArchive === '历史时间轴' ? 'history-dialog' : undefined} seal={desktopArchive === 'NPC' ? '人' : desktopArchive === '势力组织' ? '势' : desktopArchive === '我的势力' ? '盟' : desktopArchive === '物品栏' ? '物' : desktopArchive === '经济与资产' ? '财' : desktopArchive === '世界事件' ? '事' : desktopArchive === '历史时间轴' ? '史' : desktopArchive === '记忆' ? '忆' : desktopArchive === '地图' ? '图' : desktopArchive === '后宫' ? '家' : '档'} total={panelNames.length + 1} index={(panelNames as readonly string[]).indexOf(desktopArchive) + 1 || 1}
        eyebrow={desktopArchive === '人物档案' || desktopArchive === '经济与资产' ? 'PROTAGONIST · 主角档案' : undefined}
        subtitle={desktopArchive === '人物档案' ? `主角 · ${hero.name}` : desktopArchive === 'NPC' ? '人物名录' : desktopArchive === '物品栏' ? '随身与仓储' : desktopArchive === '经济与资产' ? '现金、收入与资产' : desktopArchive === '世界事件' ? '进行中的事' : desktopArchive === '历史时间轴' ? '已发生的事' : desktopArchive === '记忆' ? '主角的记忆' : desktopArchive === '地图' ? '地点层级' : desktopArchive === '我的势力' ? '主角的主势力' : desktopArchive === '后宫' ? '成员与家庭' : '势力与机构'}
        onClose={() => { setPanel(undefined); setArchiveTarget(undefined); }} returnFocus={() => changeOpener.current?.isConnected?changeOpener.current:document.querySelector<HTMLButtonElement>(`[data-archive-panel="${desktopArchive}"]`)}>
        {desktopArchive === '人物档案' ? <ProfilePanel state={state} equipment={equipment} candidateTime={openingTime?.endAt} onEconomy={() => setPanel('经济与资产')} onNpc={() => { setArchiveTarget(undefined); setPanel('NPC'); }} onSaves={onSaves} />
          : desktopArchive === '后宫' ? <HaremPanel view={view} management={npcManagement}/>
          : desktopArchive === 'NPC' ? <NpcPanel view={view} management={npcManagement} initialId={archiveTarget?.panel === 'NPC' ? archiveTarget.id : archiveSelection.current.NPC} onOpenOrganization={id => openArchive('势力组织', id)} onSelect={id => { archiveSelection.current.NPC = id; }} desktop />
          : desktopArchive === '物品栏' ? <InventoryPanel view={view} desktop initialId={archiveSelection.current['物品栏']} onSelect={id=>{archiveSelection.current['物品栏']=id;}} onOpenProfile={id=>{if(id===hero.id){setArchiveTarget(undefined);setPanel('人物档案');}}} />
          : desktopArchive === '经济与资产' ? <EconomyPanel view={view} />
          : desktopArchive === '世界事件' ? <WorldEventsPanel view={view} desktop initialId={archiveTarget?.panel === '世界事件' ? archiveTarget.id : undefined} uiState={archiveReading.current.events} onUiStateChange={value=>{archiveReading.current.events=value;}} onOpenHistory={()=>{archiveReading.current.history=undefined;setArchiveTarget(undefined);setPanel('历史时间轴');}} />
          : desktopArchive === '历史时间轴' ? <HistoryPanel view={view} desktop uiState={archiveReading.current.history} onUiStateChange={value=>{archiveReading.current.history=value;}} />
          : desktopArchive === '地图' ? <MapPanel view={view} initialId={archiveTarget?.panel==='地图'?archiveTarget.id:undefined} uiState={archiveReading.current.map} onUiStateChange={value=>{archiveReading.current.map=value;}} onNpc={id=>openArchive('NPC',id)} onEvent={id=>openArchive('世界事件',id)}/>
          : desktopArchive === '记忆' ? <MemoryPanel view={view} desktop uiState={archiveReading.current.memory} onUiStateChange={value=>{archiveReading.current.memory=value;}} />
          : desktopArchive === '我的势力' ? <FactionPanel view={view} links={{npc:id=>openArchive('NPC',id), organization:id=>openArchive('势力组织',id), event:id=>openArchive('世界事件',id)}} desktop />
          : <OrganizationPanel view={view} initialId={archiveTarget?.panel === '势力组织' ? archiveTarget.id : archiveSelection.current['势力组织']} links={{npc:id=>openArchive('NPC',id), organization:id=>openArchive('势力组织',id), event:id=>openArchive('世界事件',id)}} onSelect={id => { archiveSelection.current['势力组织'] = id; }} desktop />}
      </ArchivePanel>}
      {theaterActive && <Dialog title="王朝小剧场" mobileVariant="sheet" sheetFull fitVisualViewport
        nonmodal={!compactSidebars} className={compactSidebars ? 'mobile-archive theater-archive' : 'theater-archive'}
        seal="剧" eyebrow="WORLD · ARCHIVE"
        archiveHeading={compactSidebars ? undefined : { title: '王朝小剧场', seal: '剧', subtitle: '非正史创作', index: panelNames.length + 1, total: panelNames.length + 1 }}
        returnFocus={() => compactSidebars ? mobileReturnFocus('world') : document.querySelector<HTMLButtonElement>('[data-archive-panel="小剧场"]')}
        onClose={() => outsideTheater(() => { setPanel(undefined); setArchiveTarget(undefined); })}>
        <TheaterPanel key={state.saveId + ':' + (instance ?? '')} leaveGuard={theaterLeave}
          repository={repository.theaters} owner={{ saveId: state.saveId, createdAt: state.createdAt, instance: instance ?? null }} settings={settings}
          latest={{ turn: state.turnNumber, time: state.openingTimePending ? null : state.worldClock }} />
      </Dialog>}
      {panel && panel !== '小剧场' && !desktopArchive && !desktopSettings && (
        <Dialog title={panel} mobileVariant="sheet" sheetFull seal={{NPC:'人',势力组织:'势',我的势力:'盟',地图:'图',物品栏:'物',世界事件:'事',历史时间轴:'史',记忆:'忆',后宫:'家',人物档案:'人',经济与资产:'财'}[panel]} eyebrow="WORLD · ARCHIVE" returnFocus={()=>changeOpener.current?.isConnected?changeOpener.current:mobileReturnFocus(panel==='人物档案'||panel==='经济与资产'?'hero':'world')} className={`mobile-archive ${panel === 'NPC' ? 'npc-dialog' : panel === '物品栏' ? 'inventory-dialog' : panel === '历史时间轴' ? 'history-dialog' : panel === '世界事件' ? 'world-events-dialog' : panel === '势力组织' ? 'organization-dialog' : panel === '我的势力' ? 'faction-dialog' : ''}`} onClose={() => { setPanel(undefined); setArchiveTarget(undefined); }}>
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
            <TalentProfile talentId={hero.talentId} />
            <h3>当前穿戴与装备</h3>
            <dl>{equipment.map(([label, value]) => <Detail key={label} label={label}>{value}</Detail>)}</dl>
            <div className="profile-entrypoints">
              <button onClick={() => setPanel('经济与资产')}>经济与资产</button>
              <button onClick={() => setPanel('NPC')}>NPC 人物资料</button>
              <button onClick={onSaves}>切换存档</button>
            </div>
            </>
          ) : panel === '经济与资产' ? (
            <EconomyPanel view={view} mobile />
          ) : panel === '历史时间轴' ? (
            <HistoryPanel view={view} uiState={archiveReading.current.history} onUiStateChange={value=>{archiveReading.current.history=value;}} />
          ) : panel === '记忆' ? (
            <MemoryPanel view={view} uiState={archiveReading.current.memory} onUiStateChange={value=>{archiveReading.current.memory=value;}} />
          ) : panel === '地图' ? (
            <MapPanel view={view} mobile initialId={archiveTarget?.panel==='地图'?archiveTarget.id:undefined} uiState={archiveReading.current.map} onUiStateChange={value=>{archiveReading.current.map=value;}} onNpc={id=>openArchive('NPC',id)} onEvent={id=>openArchive('世界事件',id)} />
          ) : (
            <>
              <Panels name={panel} view={view} initialId={archiveTarget?.panel === panel ? archiveTarget.id : undefined} links={{location:id=>{setArchiveTarget({panel:'地图',id});setPanel('地图');},npc:id=>openArchive('NPC',id), organization:id=>openArchive('势力组织',id), event:id=>openArchive('世界事件',id)}} npcManagement={npcManagement} onOpenHistory={()=>setPanel('历史时间轴')} />
            </>
          )}
        </Dialog>
      )}
      {renderSettings?.(<MemorySummarySettings state={settingsMemoryState} settings={settings} onSave={(next, base) => {
        onSettings(next, base);
        const saved = SettingsSchema.parse(JSON.parse(localStorage.getItem(settingsKey) || 'null'));
        if (fingerprint(saved.memory) !== fingerprint(next.memory)) throw new Error('memory settings not saved');
      }} phase={memory.phase} activity={memory.activity} notice={memory.notice}
        failures={memory.snapshot.failures} paused={memory.snapshot.paused} busy={memory.snapshot.busy}
        onRun={(kind, npcId, retryId) => void memory.run(false, kind, npcId, retryId)} onCancel={memory.cancel} />)}
      {summaryFailure && (
        <Dialog
          title={summaryFailureTitle(summaryFailure)}
          small
          feedback={summaryFailure.pending ? 'warn' : 'err'}
          seal="忆" mobileVariant="confirm"
          footer={<button onClick={() => memory.closeFailure(summaryFailure)}>关闭</button>}
          onClose={() => memory.closeFailure(summaryFailure)}
        >
          {summaryFailure.npcId && <p>{state.npc[summaryFailure.npcId]?.name ?? '原人物'}</p>}
          <p>{summaryFailure.message}</p>
          <MemoryIssueDetails issue={summaryFailure} saveId={state.saveId} />
          {summaryFailure.pending && !summaryFailure.legacy && <p>本次请求可能已计费。选择重新生成会再发一次请求。</p>}
          <div className="feedback-dialog-actions memory-feedback-actions">
            {summaryFailure.retryId && !summaryFailure.legacy && (summaryFailure.kind !== 'npc' || summaryFailure.npcId) ? (
              <button className="primary" disabled={Boolean(memory.phase) || memory.snapshot.busy}
                onClick={() => {
                  const failure = summaryFailure;
                  void memory.run(false, failure.kind, failure.npcId, failure.retryId);
                }}>
                重新生成
              </button>
            ) : (
              <button className="primary" onClick={() => {
                memory.closeFailure(summaryFailure);
                onOpenSettings();
              }}>前往记忆设置</button>
            )}
            <button disabled={Boolean(memory.phase)} onClick={() => memory.pause(summaryFailure)}>
              暂停自动总结
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
