import { SuggestionFeedback } from '../feedback/FeedbackForms';
import { previewChime } from '../game/completionChime';
import { captureStoryPreset } from '../../presets/library';
import { listenForMode, TavernAssistant } from './TavernAssistant';
import type { FeedbackLevel } from '../Feedback';
import { Feedback,useDesktopFeedback } from '../Feedback';
import { MemorySummarySettings } from './MemorySummarySettings';
import type { CompanionProfile } from '../../services/local/companionProfile';
import { VariableManager } from './VariableManager';
import type { SaveRepository, VariableSnapshot } from '../../services/storage/saveRepository';
import { Fragment, lazy, Suspense, useCallback, useSyncExternalStore, useEffect, useLayoutEffect, useRef, useState, cloneElement, isValidElement } from 'react';
import type { ReactNode, RefObject } from 'react';
import { settingsGroups, draftGroup, type PageInfo, type SettingsPage } from './settingsPages';
import { NetworkSettings } from './NetworkSettings';
import { Segments, PhoneSettings, TheaterSettings } from './ExtensionSettings';
import { AiConnections, useAiSettingsDraft } from './AiConnections';
import { UnsavedAiChanges } from './UnsavedAiChanges';
import { NARRATIVE_LENGTH_TIERS, narrativeLengthTier, narrativeRange, SettingsSchema } from './model';
import type { Settings } from './model';
import { STORY_STYLES } from './storyStyles';
import type { StoryStyle } from './storyStyles';
import { STORY_DIFFICULTIES, storyDifficulty } from './storyDifficulty';
import type { StoryDifficulty } from './storyDifficulty';
import { NoticeLinks } from '../notices/Notices';
import './settings-paper.css';
import type { NoticeKind } from '../notices/useNotices';

const ImageSettings=lazy(()=>import('../images/ImageSettings').then(m=>({default:m.ImageSettings})));
const PromptInspector = lazy(() =>
  import('./PromptInspector').then((module) => ({ default: module.PromptInspector })),
);
const WorldbookLibraryPanel = lazy(() =>
  import('./WorldbookLibrary').then((module) => ({ default: module.WorldbookLibraryPanel })),
);

const chimes = [['background', '切到别处时', '默认。切到其他标签页或窗口时才提醒，看着游戏时不打扰'], ['always', '总是', '每次生成完成都提醒'], ['off', '关闭', '不播放提示音']] as const;
const appearances = [['night', '夜间', '黑金配色，适合夜里或暗处'], ['day', '日间', '浅色纸页，适合白天或光线充足时'], ['system', '跟随系统', '随设备的深浅色自动切换']] as const;
function literarySettingsActive() {
  try { return Boolean(captureStoryPreset()); } catch { return false; }
}
export function SettingsPanel({
  settings,
  onSave,
  repository,
  activeSaveId,
  memoryMaintenance, variableSaveId, variableInstance, companion, onVariablesSaved, onVariablesDirtyChange,
  onAiDirtyChange,
  onLocalDirtyChange,
  onSummaryDirtyChange,
  onWorldbookDirtyChange,
  onOpenNotice,
}: {
  settings: Settings;
  repository?: SaveRepository;
  activeSaveId?: string;
  memoryMaintenance?: ReactNode;
  variableSaveId?: string;
  variableInstance?: string;
  companion?: CompanionProfile;
  onVariablesSaved?: (result: VariableSnapshot) => void;
  onVariablesDirtyChange?: (dirty:boolean) => void;
  onLocalDirtyChange?: (dirty: boolean) => void;
  onAiDirtyChange?: (dirty: boolean) => void;
  onSummaryDirtyChange?: (dirty: boolean) => void;
  onWorldbookDirtyChange?: (dirty: boolean) => void;
  onOpenNotice?: (kind: NoticeKind) => void;
  onSave: (settings: Settings, base?: Settings) => Settings | void;
}) {
  const desktop=useDesktopFeedback();
  const aiWorkspace = useAiSettingsDraft();
  const [channelName, setChannelName] = useState('');
  const [imageDirty, setImageDirty] = useState(false);
  const [literaryDirty, setLiteraryDirty] = useState(false);
  const [mobileHome,setMobileHome]=useState(!desktop);
  const host=useRef<HTMLDivElement>(null),lastCategory=useRef<SettingsPage>('channels'),homeScroll=useRef(0),categoryHeading=useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState<SettingsPage>('channels');
  const [editingChannel, setEditingChannel] = useState(false);
  const channelListScroll = useRef(0);
  const channelScrollPending = useRef(false);
  const mobileBack = useRef<HTMLButtonElement>(null);
  const channelDetail = tab === 'channels' && editingChannel;
  // Once a desktop editor is visible, crossing back to phone must keep that same form mounted.
  useEffect(()=>{if(desktop)setMobileHome(false);},[desktop]);
  useEffect(()=>{if(!desktop&&!mobileHome&&document.querySelector('dialog:modal')===host.current?.closest('dialog')){const body=host.current?.closest<HTMLElement>('.modal-body');if(body)body.scrollTop=0;categoryHeading.current?.focus({preventScroll:true});}},[desktop,mobileHome,tab]);
  useLayoutEffect(() => {
    if (!channelScrollPending.current) return;
    channelScrollPending.current = false;
    if (desktop || mobileHome || tab !== 'channels') return;
    const body = host.current?.closest<HTMLElement>('.modal-body');
    if (body) body.scrollTop = channelDetail ? 0 : channelListScroll.current;
    mobileBack.current?.focus({ preventScroll: true });
  }, [channelDetail, desktop, mobileHome, tab]);
  function changeChannelEditor(open: boolean) {
    if (open === editingChannel) return;
    if (!desktop) {
      if (open) channelListScroll.current = host.current?.closest<HTMLElement>('.modal-body')?.scrollTop ?? 0;
      channelScrollPending.current = true;
    }
    setEditingChannel(open);
  }
  const [editing, setEditing] = useState(settings);
  const [editingBase, setEditingBase] = useState(settings);
  // 玩家点了「自定义」或手动改过数字：即使数字恰好等于某一档，也保持自定义选中。
  const [customLength, setCustomLength] = useState(false);
  const minLengthInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const [noticeLevel, setNoticeLevel] = useState<FeedbackLevel>('info');
  const [aiDirty, setAiDirty] = useState(false);
  const presetOwnsWriting = useSyncExternalStore(listenForMode, literarySettingsActive, () => false);
  const [variablesDirty,setVariablesDirty]=useState(false);
  const variablesDirtyChanged=useCallback((dirty:boolean)=>{setVariablesDirty(dirty);onVariablesDirtyChange?.(dirty);},[onVariablesDirtyChange]);
  const [worldbookDirty, setWorldbookDirty] = useState(false);
  const worldbookDirtyChanged = useCallback((dirty: boolean) => {
    setWorldbookDirty(dirty);
    onWorldbookDirtyChange?.(dirty);
  }, [onWorldbookDirtyChange]);
  const [summaryDirty, setSummaryDirty] = useState(false);
  const summaryDirtyChanged = useCallback((dirty: boolean) => { setSummaryDirty(dirty); onSummaryDirtyChange?.(dirty); }, [onSummaryDirtyChange]);
  const [pendingTab, setPendingTab] = useState<SettingsPage|'home'>();
  const aiDirtyChanged = useCallback((dirty: boolean) => {
    setAiDirty(dirty);
    onAiDirtyChange?.(dirty);
  }, [onAiDirtyChange]);
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const promptKeys = (keys: (keyof Settings['prompts'])[]) => keys.some(k => changed(editing.prompts[k], editingBase.prompts[k]));
  const runtimeKeys = (keys: (keyof Settings['runtime'])[]) => keys.some(k => changed(editing.runtime[k], editingBase.runtime[k]));
  const dirtyPages: Partial<Record<SettingsPage, boolean>> = {
    channels: aiDirty, routing: aiDirty, variables: variablesDirty, worldbooks: worldbookDirty, images: imageDirty, literary: literaryDirty, memory: summaryDirty,
    writing: promptKeys(['perspective','style','difficulty','minNarrativeChars','maxNarrativeChars']),
    prompts: promptKeys(['actionOptions','naturalProse','realWorld','noControl']),
    promptmgr: editing.theaterPrompt !== editingBase.theaterPrompt,
    stages: runtimeKeys(['useEntityStage','useVariableStage','useWorldStage','streamEntities','streamVariables','streamWorld','streamStory']),
    timing: runtimeKeys(['timeoutSeconds','streamTotalSeconds','streamIdleSeconds','failureAutoRetry','maxAutoRetries']),
    phone: changed(editing.phone, editingBase.phone) || runtimeKeys(['phoneChat']),
    theater: changed(editing.theater, editingBase.theater),
  };
  const localDirty = Object.entries(dirtyPages).some(([key, value]) => value && draftGroup(key as SettingsPage) === 'local');
  useLayoutEffect(() => { onLocalDirtyChange?.(localDirty || imageDirty || literaryDirty); }, [localDirty, imageDirty, literaryDirty, onLocalDirtyChange]);
  useEffect(() => () => onLocalDirtyChange?.(false), [onLocalDirtyChange]);
  useEffect(() => {
    if (!localDirty) {
      setEditing(settings);
      setEditingBase(settings);
    }
  }, [localDirty, settings]);
  const prompt = <K extends keyof Settings['prompts']>(key: K, value: Settings['prompts'][K]) => {
    setNotice('');
    setNoticeLevel('info');
    setEditing({ ...editing, prompts: { ...editing.prompts, [key]: value } });
  };
  // 外观点选即生效并立即保存，不受其他分类未保存修改的影响。
  // 提示音同外观：点选即生效并立即保存；切换到会响的选项时顺便试听一次。
  function chooseChime(completionChime: Settings['notifications']['completionChime']) {
    const next = { ...settings, notifications: { completionChime } };
    try {
      onSave(next);
      setEditing({ ...editing, notifications: next.notifications });
      if (completionChime !== 'off') void previewChime('done');
      setNoticeLevel('ok');
      setNotice('提示音设置已保存。');
    } catch {
      setNoticeLevel('err');
      setNotice('提示音设置保存失败，请检查浏览器存储权限后重试。');
    }
  }
  function chooseAppearance(appearance: Settings['display']['appearance']) {
    const next = { ...settings, display: { appearance } };
    try {
      onSave(next);
      setEditing({ ...editing, display: next.display });
      setNoticeLevel('ok');
      setNotice('外观已切换。');
    } catch {
      setNoticeLevel('err');
      setNotice('外观保存失败，请检查浏览器存储权限后重试。');
    }
  }
  // 手动改数字：两个数都写定（老设置没有上限时，先把当前推出的上限固定下来，不随最低字数漂移）。
  function setLength(min: number, max: number) {
    chooseLength(min, max);
    setCustomLength(true);
  }
  function chooseLength(min: number, max: number) {
    setCustomLength(false);
    setNotice('');
    setNoticeLevel('info');
    setEditing({ ...editing, prompts: { ...editing.prompts, minNarrativeChars: min, maxNarrativeChars: max } });
  }
  function save() {
    if ((editing.prompts.maxNarrativeChars ?? Infinity) < editing.prompts.minNarrativeChars) {
      setNoticeLevel('err');
      setNotice('正文建议上限不能低于最低字数。');
      return;
    }
    const checked = SettingsSchema.safeParse({ ...editing, memory: settings.memory, display: settings.display, notifications: settings.notifications });
    if (!checked.success) {
      setNoticeLevel('err');
      setNotice(
        checked.error.issues.some(issue => issue.code === 'custom' && issue.path.includes('streamTotalSeconds'))
          ? '正文流式总时限不能小于无有效输出时限。'
          : '请输入有效的正整数。正文最多 100000 字，即时记忆最多 10000 回合，请求或空闲时限最多 3600 秒，正文流式总时限最多 7200 秒。',
      );
      return;
    }
    try {
      const saved = onSave(checked.data, { ...editingBase, memory: settings.memory, display: settings.display, notifications: settings.notifications }) ?? checked.data;
      setEditing(saved);
      setEditingBase(saved);
      setNoticeLevel('ok');
      setNotice('本地偏好已保存，将用于下一次生成尝试；不会改写进行中的请求或已保存草稿。');
    } catch {
      setNoticeLevel('err');
      setNotice('本地保存失败，请检查浏览器存储权限后重试。');
    }
  }
  function showCategory(name: SettingsPage) {
    const body = host.current?.closest<HTMLElement>('.modal-body');
    if (!desktop && mobileHome) homeScroll.current = body?.scrollTop ?? 0;
    if (name !== tab) setEditingChannel(false);
    setTab(name);
    lastCategory.current = name;
    setMobileHome(false);
    setNotice('');
    if (body) body.scrollTop = 0;
  }
  const group = draftGroup(tab);
  const categoryDirty = group === 'local' ? localDirty : dirtyPages[tab];
  function navigate(next: SettingsPage) {
    if (draftGroup(next) !== group && categoryDirty) setPendingTab(next);
    else showCategory(next);
  }
  const page = (settingsGroups.flatMap(([, items]) => [...items] as PageInfo[])).find(([id]) => id === tab)!;
  const subject = group === 'ai' ? undefined : group === 'local' ? '本地偏好'
    : tab === 'variables' ? '存档变量' : tab === 'memory' ? '记忆设置' : page[2];
  function showMobileHome() {
    setEditingChannel(false);
    setMobileHome(true);
    requestAnimationFrame(() => {
      const body = host.current?.closest<HTMLElement>('.modal-body');
      if (body) body.scrollTop = homeScroll.current;
      host.current?.querySelector<HTMLButtonElement>(`[data-page="${lastCategory.current}"]`)?.focus({ preventScroll: true });
    });
  }
  function back() {
    if (channelDetail) { changeChannelEditor(false); return; }
    if (categoryDirty && group !== 'ai' && group !== 'local') { setPendingTab('home'); return; }
    showMobileHome();
  }
  return (
    <div ref={host} data-tab={tab} className={`settings-layout st-wrap ${tab === 'promptmgr' ? 'prompt-settings-layout' : ''}`}>
      {(!desktop || tab !== 'variables') && <nav aria-label="设置分类" className="settings-nav" hidden={!desktop&&!mobileHome}>
        {settingsGroups.map(([groupName, items]) => <Fragment key={groupName}>
          <div className="settings-group-name">{groupName}</div>
          {items.map(([id, seal, name, description]) => <button key={id} data-page={id} data-settings-category={name} aria-label={name}
            aria-pressed={desktop && tab === id} onClick={() => navigate(id)}>
            <i aria-hidden="true">{seal}</i>{desktop ? <span>{name}</span> : <span className="settings-row-text"><strong>{name}</strong><small>{description}</small></span>}
            {dirtyPages[id] && <span className="dirty" aria-hidden="true" title="有未保存的修改"/>}{!desktop && <span aria-hidden="true">›</span>}
          </button>)}
        </Fragment>)}
        {onOpenNotice && <NoticeLinks onOpen={onOpenNotice} />}
      </nav>}
      {(desktop || !mobileHome || group === 'ai') && <div className="settings-content" hidden={!desktop && mobileHome}>
        {desktop && tab === 'variables' && <button className="vm-back" onClick={() => variablesDirty ? setPendingTab('channels') : showCategory('channels')}>‹ 返回设置分类</button>}
        {!desktop && <button ref={mobileBack} type="button" className={`paper-back${channelDetail ? ' ai-channel-back' : ''}`}
          aria-label={channelDetail ? '返回渠道列表' : '返回设置'} onClick={back}>{channelDetail ? '‹ 渠道列表' : '‹ 设置'}</button>}
        <h3 aria-label={!desktop && channelDetail ? channelName : page[2]} ref={categoryHeading} tabIndex={!desktop?-1:undefined}>{!desktop && channelDetail ? channelName : page[2]}{desktop && <small>{page[3]}</small>}</h3>
        {tab === 'variables' && !variableSaveId && <p>打开存档后可在这里查看并修正变量。</p>}
        {tab === 'variables' && variableSaveId && repository && onVariablesSaved && <VariableManager key={variableSaveId} saveId={variableSaveId} instance={variableInstance} companion={companion} repository={repository} onSaved={onVariablesSaved} onDirtyChange={variablesDirtyChanged}/>}
        {tab === 'feedback' && <SuggestionFeedback />}
        {tab === 'promptmgr' && (
          <Suspense fallback={<p>正在打开提示词管理中心…</p>}>
            <PromptInspector
              settings={editing}
              presetOwnsWriting={presetOwnsWriting}
              repository={repository}
              activeSaveId={activeSaveId}
              onPromptChange={prompt}
              onTheaterPromptChange={value => setEditing({ ...editing, theaterPrompt: value })}
            />
          </Suspense>
        )}
        {tab === 'worldbooks' && (
          <Suspense fallback={<p>正在打开世界书…</p>}>
            <WorldbookLibraryPanel onDirtyChange={worldbookDirtyChanged} />
          </Suspense>
        )}
        {(tab === 'channels' || tab === 'routing') && <AiConnections workspace={aiWorkspace} page={tab} navigate={navigate} onChannelName={setChannelName} timeoutSeconds={settings.runtime.timeoutSeconds} onDirtyChange={aiDirtyChanged}
          editing={editingChannel} onEditingChange={changeChannelEditor} />}
        {tab === 'writing' && (
          <>
            <p className={presetOwnsWriting ? "settings-literary-notice" : "muted"}>{presetOwnsWriting ? '由当前文学预设接管：篇幅、人称和文风可在预设控制台调整。关闭预设后恢复原偏好。' : '这些叙事偏好和剧情难度用于下一次正文请求的提示词与输出校验。'}</p>
            {presetOwnsWriting && <button type="button" onClick={() => window.dispatchEvent(new Event('heijin:open-preset-settings'))}>打开文学预设控制台</button>}
            <div className="settings-fields">
              <div className="settings-form-row"><span>叙事人称</span><Segments label="叙事人称" disabled={presetOwnsWriting} value={editing.prompts.perspective}
                choices={[[ 'first', '第一人称'], ['second', '第二人称'], ['third', '第三人称']]} change={v => prompt('perspective', v)}/></div>
              <LengthField disabled={presetOwnsWriting}
                min={editing.prompts.minNarrativeChars}
                max={editing.prompts.maxNarrativeChars}
                custom={customLength}
                minInput={minLengthInput}
                onTier={chooseLength}
                onCustom={() => { setCustomLength(true); minLengthInput.current?.focus(); }}
                onMin={(value) => setLength(value, editing.prompts.maxNarrativeChars ?? narrativeRange(editing.prompts).max)}
                onMax={(value) => setLength(editing.prompts.minNarrativeChars, value)}
              />
              <fieldset className="style-fieldset" disabled={presetOwnsWriting} style={{border:0,padding:0,margin:0}}><StyleField value={editing.prompts.style} onChange={(value) => prompt('style', value)} /></fieldset>
              <DifficultyField value={storyDifficulty(editing.prompts)} onChange={(value) => prompt('difficulty', value)} />
            </div>
          </>
        )}
        {tab === 'prompts' && <><p>逐项开关正文提示词里的可选模块；每个模块的完整原文可以在 <button className="ai-link" onClick={() => navigate('promptmgr')} aria-label="前往提示词管理">提示词管理</button> 里查看。</p><div className="settings-fields">
              {(
                [
                  ['noControl', '防抢话 NoControl', '不替你说话、不替你做决定'],
                  ['naturalProse', '自然文风修复', '现代中文自然叙事，减少套话和模板化表达'],
                  ['actionOptions', '行动选项', '正文末尾给出 3～5 个可选行动'],
                  ['realWorld', '真实世界模式', '强化经济、法律、交通、专业等现实约束'],
                ] as const
              ).map(([key, label, description]) => (
                <label className="toggle" key={key}>
                  <input
                    type="checkbox"
                    aria-label={label} disabled={presetOwnsWriting && key === 'naturalProse'} checked={editing.prompts[key]}
                    onChange={(e) => prompt(key, e.target.checked)}
                  />
                  <span>{label}<small>{description}</small></span>
                </label>
              ))}
            </div>
          </>
        }
        {tab === 'memory' && (isValidElement<{ onDirtyChange?: (dirty: boolean) => void }>(memoryMaintenance)
          ? cloneElement(memoryMaintenance, { onDirtyChange: summaryDirtyChanged })
          : <MemorySummarySettings settings={settings} onSave={onSave} onDirtyChange={summaryDirtyChanged} />)}
        {tab==='images'&&<Suspense fallback={<p>读取配置…</p>}><ImageSettings repository={repository} openRouting={() => navigate('routing')} onDirtyChange={setImageDirty}/></Suspense>}
        {tab === 'look' && (
          <>
            <div className="appearance-options" role="radiogroup" aria-label="外观">
              {appearances.map(([value, label, hint]) => (
                <label className="appearance-option" key={value} data-checked={settings.display.appearance === value || undefined}>
                  <input type="radio" name="appearance" value={value} checked={settings.display.appearance === value} onChange={() => chooseAppearance(value)} />
                  <span><strong>{label}</strong><small>{hint}</small></span>
                </label>
              ))}
            </div>
            <p className="muted">切换后立即生效，并自动保存在本机。当前先覆盖游戏主界面，其余弹出面板会陆续适配。</p>
            <h3 className="settings-subheading">生成完成提示音</h3>
            <div className="appearance-options" role="radiogroup" aria-label="生成完成提示音">
              {chimes.map(([value, label, hint]) => (
                <label className="appearance-option" key={value} data-checked={settings.notifications.completionChime === value || undefined}>
                  <input type="radio" name="completion-chime" value={value} checked={settings.notifications.completionChime === value} onChange={() => chooseChime(value)} />
                  <span><strong>{label}</strong><small>{hint}</small></span>
                </label>
              ))}
            </div>
            <p className="muted">一回合生成完成时轻响两声；生成失败、需要你处理时换成低一点的提示。手动取消不会响。</p>
            <div className="chime-preview">
              <button type="button" onClick={() => void previewChime('done')}>试听完成提示</button>
              <button type="button" onClick={() => void previewChime('attention')}>试听失败提示</button>
            </div>
          </>
        )}
        {tab === 'network' && <NetworkSettings openTiming={() => navigate('timing')}/>}
        {tab === 'literary' && <TavernAssistant onDirtyChange={setLiteraryDirty} dirty={localDirty || aiDirty || summaryDirty}/>}
        {tab === 'phone' && <PhoneSettings editing={editing} change={setEditing} navigate={navigate}/>}
        {tab === 'theater' && <TheaterSettings editing={editing} change={setEditing} navigate={navigate}/>}
        {tab === 'stages' && (
          <>
            <p>每回合先生成正文，再依次跑三个变量阶段。关闭的阶段会跳过，后面的照常运行。三个变量阶段全部开启时，每回合比旧版多一次模型请求。</p>
            <h4>变量阶段</h4>
            {([
              ['useEntityStage', 'streamEntities', '人物与实体', '记录人物、组织、地点和关系'],
              ['useVariableStage', 'streamVariables', '主角与现场', '记录主角的钱、物、时间和当场事务'],
              ['useWorldStage', 'streamWorld', '场外与网络', '推进你不在场的世界、来信与话题'],
            ] as const).map(([enable, stream, name, hint]) => <div className="settings-form-row" key={enable}>
              <span>{name}<small>{hint}</small></span><div className="settings-segments">
              {([[enable, '启用', name], [stream, '流式传输', name + ' · 流式传输']] as const).map(([key, label, aria]) =>
                <label key={key} className="toggle"><input type="checkbox" aria-label={aria} checked={editing.runtime[key]}
                  onChange={e => setEditing({ ...editing, runtime: { ...editing.runtime, [key]: e.target.checked } })}/>{label}</label>)}</div>
            </div>)}
            <h4>正文</h4><div className="settings-form-row"><span>正文流式传输<small>边生成边显示</small></span>
              <label className="toggle"><input type="checkbox" aria-label="正文生成 · 流式传输" checked={editing.runtime.streamStory}
                onChange={e => setEditing({ ...editing, runtime: { ...editing.runtime, streamStory: e.target.checked } })}/>开启</label></div>
            <p className="muted">开启流式传输后可实时查看模型返回的内容。部分中转服务可能不支持流式传输；不会因流式不兼容自动重试。</p>
            <p className="muted">
              正文和三个变量阶段可分别设置流式传输。关闭正文流式传输后，等待完整响应并在校验保存后展示正文。切换只影响后续尝试，不修改进行中的请求或正式世界状态。
            </p>
            <p>每个阶段用哪个模型，在 <button className="ai-link" onClick={() => navigate('routing')} aria-label="前往模型分配">模型分配</button> 里设置。</p>
          </>)}
        {tab === 'timing' && (<><h4>时限</h4><div className="settings-fields">
              <label>
                请求超时（秒）
                <input type="number" min="1" max="3600" value={Number.isNaN(editing.runtime.timeoutSeconds) ? '' : editing.runtime.timeoutSeconds}
                  onChange={e => setEditing({ ...editing, runtime: { ...editing.runtime, timeoutSeconds: e.target.valueAsNumber } })} />
              </label>
              {([
                ['streamIdleSeconds', '正文流式无有效输出超时（秒）', 3600, editing.runtime.timeoutSeconds],
                ['streamTotalSeconds', '正文流式总时限（秒）', 7200, Math.max(600, editing.runtime.streamIdleSeconds ?? editing.runtime.timeoutSeconds)],
              ] as const).map(([key, label, max, fallback]) => (
                <label key={key}>{label}
                  <input type="number" min={key === 'streamTotalSeconds' ? editing.runtime.streamIdleSeconds ?? editing.runtime.timeoutSeconds : 1}
                    max={max} value={editing.runtime[key] ?? ''} placeholder={String(fallback)}
                    onChange={e => setEditing({ ...editing, runtime: { ...editing.runtime,
                      [key]: e.target.value === '' ? undefined : e.target.valueAsNumber } })} />
                </label>
              ))}
              <small>请求超时适用于请求准备、非流式及其他阶段。正文流式时限留空时，无有效输出时限沿用请求超时，总时限取 600 秒与无有效输出时限中的较大值。</small>
              <h4>失败自动重试</h4><label className="toggle">
                <input
                  type="checkbox"
                  checked={editing.runtime.failureAutoRetry}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      runtime: { ...editing.runtime, failureAutoRetry: e.target.checked },
                    })
                  }
                />
                失败自动重试
              </label>
              <div className="settings-form-row"><span>最大自动重试次数<small>不含第一次请求</small></span>
                <Segments label="最大自动重试次数" choices={[[1, '1 次'], [3, '3 次']] as const} value={editing.runtime.maxAutoRetries}
                  disabled={!editing.runtime.failureAutoRetry} change={maxAutoRetries => setEditing({ ...editing, runtime: { ...editing.runtime, maxAutoRetries } })}/>
              </div>
            </div>
            <p className="muted">开启后，正文或任一变量阶段生成失败就会自动再试，包括模型输出没通过业务校验，不限于 500。网页允许自动中转时，直连已经返回的失败也会重试；真正走了本站中转仍失败的不会自动再试。次数不含第一次请求，最多 3 次，可能产生额外 API 费用。</p>
            <p className="muted">取消、密钥或鉴权、渠道参数配置错误、明确额度不足、输出回显凭证、存档或事务冲突、权限与保存失败不会自动重试。关闭本项时，仍只对没有走本站中转的 500/502/503/504 自动再试一次。</p>
          </>
        )}
        <div className="local-save-bar" hidden={group !== 'local' && !notice}><Feedback role="status" level={noticeLevel} className="field-hint">{notice || (localDirty && group === 'local' ? '本地设置尚未保存。' : '')}</Feedback>
        {group === 'local' && (
          <button className="primary" onClick={save}>
            保存本地设置
          </button>
        )}</div>
      </div>}
      {pendingTab && <UnsavedAiChanges onKeep={group === 'local' && pendingTab !== 'home' ? () => { showCategory(pendingTab); setPendingTab(undefined); } : undefined} subject={subject} onContinue={() => { if (mobileHome) showCategory(tab); setPendingTab(undefined); }} onDiscard={() => {
        if (group === 'local') { setEditing(settings); setEditingBase(settings); setCustomLength(false); }
        if (group === 'ai') { aiWorkspace.setDraft(structuredClone(aiWorkspace.saved)); aiDirtyChanged(false); }
        if (pendingTab === 'home') showMobileHome(); else showCategory(pendingTab);
        setPendingTab(undefined);
        setNotice('');
      }} />}
    </div>
  );
}

/**
 * 正文篇幅：低 / 中 / 高三档一键填好两个数字，「自定义」或手动改数字即为自定义。
 * 最低字数是程序硬性检查；建议上限只写进提示词，写多了照常通过。
 */
function LengthField({ disabled, min, max, custom, minInput, onTier, onCustom, onMin, onMax }: {
  disabled: boolean; min: number; max: number | undefined; custom: boolean; minInput: RefObject<HTMLInputElement | null>;
  onTier: (min: number, max: number) => void; onCustom: () => void; onMin: (value: number) => void; onMax: (value: number) => void;
}) {
  const tier = custom ? 'custom' : Number.isNaN(min) || Number.isNaN(max) ? 'custom' : narrativeLengthTier({ minNarrativeChars: min, maxNarrativeChars: max });
  // 推算值仅供输入框显示，不参与旧设置的档位识别或自动保存。
  const displayMax = max ?? narrativeRange({ minNarrativeChars: min }).max;
  const shown = (value: number) => Number.isNaN(value) ? '' : value;
  const inverted = !Number.isNaN(min) && !Number.isNaN(displayMax) && displayMax < min;
  return (
    <fieldset style={{border:0,margin:0,minWidth:0}} disabled={disabled} className="length-field" role="group" aria-labelledby="length-field-title">
      <span id="length-field-title" className="length-field-title">正文篇幅</span>
      <div className="length-field-body">
        <div className="length-tiers" role="radiogroup" aria-label="正文篇幅档位">
          {NARRATIVE_LENGTH_TIERS.map((item) => (
            <label key={item.id} className="length-tier" data-checked={tier === item.id || undefined}>
              <input type="radio" name="length-tier" value={item.id} checked={tier === item.id} onChange={() => onTier(item.min, item.max)} />
              <strong>{item.label}</strong>
              <small>{item.min.toLocaleString('en-US')}～{item.max.toLocaleString('en-US')} 字</small>
            </label>
          ))}
          <label className="length-tier" data-checked={tier === 'custom' || undefined}>
            <input type="radio" name="length-tier" value="custom" checked={tier === 'custom'} onChange={onCustom} />
            <strong>自定义</strong>
            <small>自己填写</small>
          </label>
        </div>
        <div className="length-inputs">
          <label>
            正文最低字数
            <input ref={minInput} type="number" min="1" max="100000" value={shown(min)} onChange={(e) => onMin(e.target.valueAsNumber)} />
          </label>
          <label>
            正文建议上限
            <input type="number" min="1" max="100000" value={shown(displayMax)} aria-invalid={inverted || undefined} onChange={(e) => onMax(e.target.valueAsNumber)} />
          </label>
        </div>
        {disabled ? <p className="field-hint">关闭文学预设后沿用此篇幅。</p> : inverted
          ? <p className="field-hint length-warn" role="alert">建议上限不能低于最低字数。</p>
          : <p className="field-hint">最低字数由程序硬性检查，不够会判失败并重写；建议上限只告诉模型写到这里收尾，写多了也照常通过。</p>}
        {!disabled && tier === 'high' && <p className="field-hint length-warn">高档每回合要写 8000 字以上：需要模型单次输出足够长（建议在「渠道与密钥」把最大输出调到 16k 以上），生成更慢、更耗额度；正文写到一半被截断时，可以用「续写正文」接着写。</p>}
      </div>
    </fieldset>
  );
}

/** 剧情难度：三档，独立于风格；使用文学预设时同样生效，因此不放进被预设禁用的分组。 */
function DifficultyField({ value, onChange }: { value: StoryDifficulty; onChange: (value: StoryDifficulty) => void }) {
  const current = STORY_DIFFICULTIES.find((item) => item.id === value) ?? STORY_DIFFICULTIES[0]!;
  return (
    <div className="style-field difficulty-field" role="group" aria-labelledby="difficulty-field-title">
      <span id="difficulty-field-title" className="style-field-title">剧情难度</span>
      <div className="style-field-body">
        <div className="style-options" role="radiogroup" aria-label="剧情难度">
          {STORY_DIFFICULTIES.map((item) => (
            <div key={item.id} className="style-item" data-checked={item.id === value || undefined}>
              <label className="style-option">
                <input type="radio" name="story-difficulty" value={item.id} checked={item.id === value} onChange={() => onChange(item.id)} />
                <span>{item.name}</span>
                <i className="style-dot" aria-hidden="true" />
              </label>
              {item.id === value && <p className="style-item-desc">{item.text}</p>}
            </div>
          ))}
        </div>
        <p className="style-explain" aria-live="polite"><b>{current.name}</b>{current.text}</p>
        <p className="field-hint">所有存档共用这一档；新开局最后一步选的难度也会改这里，下一回合起生效。</p>
      </div>
    </div>
  );
}

/** 剧情风格：七枚风格按钮，下方只显示当前风格的一段说明（笔法要点与示例只在提示词里）。 */
function StyleField({ value, onChange }: { value: StoryStyle; onChange: (value: StoryStyle) => void }) {
  const current = STORY_STYLES.find((style) => style.id === value) ?? STORY_STYLES[0]!;
  return (
    <div className="style-field" role="group" aria-labelledby="style-field-title">
      <span id="style-field-title" className="style-field-title">剧情风格</span>
      <div className="style-field-body">
        <div className="style-options" role="radiogroup" aria-label="剧情风格">
          {STORY_STYLES.map((style) => (
            <div key={style.id} className="style-item" data-checked={style.id === value || undefined}>
              <label className="style-option">
                <input type="radio" name="story-style" value={style.id} checked={style.id === value} onChange={() => onChange(style.id)} />
                <span>{style.name}</span>
                <i className="style-dot" aria-hidden="true" />
              </label>
              {style.id === value && <p className="style-item-desc">{style.text}</p>}
            </div>
          ))}
        </div>
        <p className="style-explain" aria-live="polite"><b>{current.name}</b>{current.text}</p>
        <p className="field-hint">风格只影响笔法与节奏；城市、年代和世界规则一律以当前存档为准。</p>
      </div>
    </div>
  );
}
