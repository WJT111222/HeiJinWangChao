import type { FeedbackLevel } from '../Feedback';
import { Feedback,useDesktopFeedback } from '../Feedback';
import { MemorySummarySettings } from './MemorySummarySettings';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, cloneElement, isValidElement } from 'react';
import type { ReactNode, RefObject } from 'react';
import { AiConnections } from './AiConnections';
import { UnsavedAiChanges } from './UnsavedAiChanges';
import { NARRATIVE_LENGTH_TIERS, narrativeLengthTier, narrativeRange, SettingsSchema } from './model';
import type { Settings } from './model';
import { STORY_STYLES } from './storyStyles';
import type { StoryStyle } from './storyStyles';
import { NoticeLinks } from '../notices/Notices';
import './settings-paper.css';
import type { NoticeKind } from '../notices/useNotices';

const PromptInspector = lazy(() =>
  import('./PromptInspector').then((module) => ({ default: module.PromptInspector })),
);

const descriptions={'AI 连接':'渠道、密钥与模型路由','提示词':'叙事人称、风格与开关','记忆':'即时记忆与记忆总结','运行':'阶段开关与超时','外观':'日间 / 夜间配色','提示词管理':'查看与编辑提示词'};
const tabs = ['AI 连接', '提示词', '记忆', '运行', '外观', '提示词管理'] as const;
const appearances = [['night', '夜间', '黑金配色，适合夜里或暗处'], ['day', '日间', '浅色纸页，适合白天或光线充足时'], ['system', '跟随系统', '随设备的深浅色自动切换']] as const;
export function SettingsPanel({
  settings,
  onSave,
  repository,
  activeSaveId,
  memoryMaintenance,
  onAiDirtyChange,
  onSummaryDirtyChange,
  onOpenNotice,
}: {
  settings: Settings;
  repository?: SaveRepository;
  activeSaveId?: string;
  memoryMaintenance?: ReactNode;
  onAiDirtyChange?: (dirty: boolean) => void;
  onSummaryDirtyChange?: (dirty: boolean) => void;
  onOpenNotice?: (kind: NoticeKind) => void;
  onSave: (settings: Settings) => void;
}) {
  const desktop=useDesktopFeedback();
  const [mobileHome,setMobileHome]=useState(!desktop);
  const host=useRef<HTMLDivElement>(null),lastCategory=useRef<(typeof tabs)[number]>('AI 连接'),homeScroll=useRef(0),categoryHeading=useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>('AI 连接');
  // Once a desktop editor is visible, crossing back to phone must keep that same form mounted.
  useEffect(()=>{if(desktop)setMobileHome(false);},[desktop]);
  useEffect(()=>{if(!desktop&&!mobileHome&&document.querySelector('dialog:modal')===host.current?.closest('dialog')){const body=host.current?.closest<HTMLElement>('.modal-body');if(body)body.scrollTop=0;categoryHeading.current?.focus({preventScroll:true});}},[desktop,mobileHome,tab]);
  const [editing, setEditing] = useState(settings);
  // 玩家点了「自定义」或手动改过数字：即使数字恰好等于某一档，也保持自定义选中。
  const [customLength, setCustomLength] = useState(false);
  const minLengthInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const [noticeLevel, setNoticeLevel] = useState<FeedbackLevel>('info');
  const [aiDirty, setAiDirty] = useState(false);
  const [summaryDirty, setSummaryDirty] = useState(false);
  const summaryDirtyChanged = useCallback((dirty: boolean) => { setSummaryDirty(dirty); onSummaryDirtyChange?.(dirty); }, [onSummaryDirtyChange]);
  const [pendingTab, setPendingTab] = useState<(typeof tabs)[number]|'home'>();
  const aiDirtyChanged = useCallback((dirty: boolean) => {
    setAiDirty(dirty);
    onAiDirtyChange?.(dirty);
  }, [onAiDirtyChange]);
  const localDirty=JSON.stringify(editing.prompts)!==JSON.stringify(settings.prompts)||JSON.stringify(editing.runtime)!==JSON.stringify(settings.runtime);
  const prompt = <K extends keyof Settings['prompts']>(key: K, value: Settings['prompts'][K]) => {
    setNotice('');
    setNoticeLevel('info');
    setEditing({ ...editing, prompts: { ...editing.prompts, [key]: value } });
  };
  // 外观点选即生效并立即保存，不受其他分类未保存修改的影响。
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
    const checked = SettingsSchema.safeParse({ ...editing, memory: settings.memory, display: settings.display });
    if (!checked.success) {
      setNoticeLevel('err');
      setNotice(
        '请输入有效的正整数：正文最多 100000 字、即时记忆最多 10000 回合、超时最多 3600 秒。',
      );
      return;
    }
    try {
      onSave(checked.data);
      setNoticeLevel('ok');
      setNotice('本地偏好已保存，将用于下一次生成尝试；不会改写进行中的请求或已保存草稿。');
    } catch {
      setNoticeLevel('err');
      setNotice('本地保存失败，请检查浏览器存储权限后重试。');
    }
  }
  function showCategory(name:(typeof tabs)[number]){if(!desktop&&mobileHome)homeScroll.current=host.current?.closest<HTMLElement>('.modal-body')?.scrollTop??0;setTab(name);lastCategory.current=name;setMobileHome(false);setNotice('');const body=host.current?.closest<HTMLElement>('.modal-body');if(body)body.scrollTop=0;}
  function back(){if((tab==='AI 连接'&&aiDirty)||(tab==='记忆'&&summaryDirty)){setPendingTab('home');return;}setMobileHome(true);requestAnimationFrame(()=>{const body=host.current?.closest<HTMLElement>('.modal-body');if(body)body.scrollTop=homeScroll.current;host.current?.querySelector<HTMLButtonElement>(`[data-settings-category="${lastCategory.current}"]`)?.focus({preventScroll:true});});}
  return (
    <div ref={host} data-tab={tab} className={`settings-layout st-wrap ${tab === '提示词管理' ? 'prompt-settings-layout' : ''}`}>
      <nav aria-label="设置分类" className="settings-nav" hidden={!desktop&&!mobileHome}>
        {!desktop&&<p className="muted">本地偏好与 AI 渠道</p>}
        {tabs.map((name) => (
          <button
            key={name} data-settings-category={name} aria-label={name}
            aria-pressed={desktop?tab === name:false}
            onClick={() => {
              if (name !== tab && ((tab === 'AI 连接' && aiDirty) || (tab === '记忆' && summaryDirty))) { setPendingTab(name); return; }
              showCategory(name);
            }}
          >
            <i aria-hidden="true">{{'AI 连接':'连','提示词':'词','记忆':'忆','运行':'运','外观':'色','提示词管理':'管'}[name]}</i>{desktop?<span>{name}</span>:<span className="settings-row-text"><strong>{name}</strong><small>{descriptions[name]}</small></span>}{((name==='AI 连接'&&aiDirty)||(name==='记忆'&&summaryDirty)||((name==='提示词'||name==='运行')&&localDirty))&&<span className="dirty" aria-hidden="true" title="有未保存的修改"/>}{!desktop&&<span aria-hidden="true">›</span>}
          </button>
        ))}
        {onOpenNotice && <NoticeLinks onOpen={onOpenNotice} />}
      </nav>
      {(desktop||!mobileHome)&&<div className="settings-content">
        {!desktop&&<button className="paper-back" aria-label="返回设置" onClick={back}>‹ 设置</button>}
        <h3 ref={categoryHeading} tabIndex={!desktop?-1:undefined}>{tab}</h3>
        {tab === '提示词管理' && (
          <Suspense fallback={<p>正在打开提示词管理中心…</p>}>
            <PromptInspector
              settings={editing}
              repository={repository}
              activeSaveId={activeSaveId}
              onPromptChange={prompt}
            />
          </Suspense>
        )}
        {tab === 'AI 连接' && <AiConnections timeoutSeconds={settings.runtime.timeoutSeconds} onDirtyChange={aiDirtyChanged} />}
        {tab === '提示词' && (
          <>
            <p className="muted">七项叙事偏好用于下一次正文请求的提示词与输出校验。</p>
            <div className="settings-fields">
              <label>
                叙事人称
                <select
                  value={editing.prompts.perspective}
                  onChange={(e) =>
                    prompt('perspective', e.target.value as Settings['prompts']['perspective'])
                  }
                >
                  <option value="first">第一人称</option>
                  <option value="second">第二人称</option>
                  <option value="third">第三人称</option>
                </select>
              </label>
              <StyleField value={editing.prompts.style} onChange={(value) => prompt('style', value)} />
              <LengthField
                min={editing.prompts.minNarrativeChars}
                max={editing.prompts.maxNarrativeChars}
                custom={customLength}
                minInput={minLengthInput}
                onTier={chooseLength}
                onCustom={() => { setCustomLength(true); minLengthInput.current?.focus(); }}
                onMin={(value) => setLength(value, editing.prompts.maxNarrativeChars ?? narrativeRange(editing.prompts).max)}
                onMax={(value) => setLength(editing.prompts.minNarrativeChars, value)}
              />
              {(
                [
                  ['noControl', 'NoControl（防抢话）'],
                  ['naturalProse', '自然文风修复'],
                  ['actionOptions', '行动选项'],
                  ['realWorld', '真实世界模式'],
                ] as const
              ).map(([key, label]) => (
                <label className="toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={editing.prompts[key]}
                    onChange={(e) => prompt(key, e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </>
        )}
        {tab === '记忆' && (isValidElement<{ onDirtyChange?: (dirty: boolean) => void }>(memoryMaintenance)
          ? cloneElement(memoryMaintenance, { onDirtyChange: summaryDirtyChanged })
          : <MemorySummarySettings settings={settings} onSave={onSave} onDirtyChange={summaryDirtyChanged} />)}
        {tab === '外观' && (
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
          </>
        )}
        {tab === '运行' && (
          <>
            <div className="settings-fields">
              {(
                [
                  ['useVariableStage', '变量管理'],
                  ['useWorldStage', '动态世界'],
                  ['streamStory', '正文生成 · 流式传输'],
                  ['streamVariables', '变量管理 · 流式传输'],
                  ['streamWorld', '动态世界 · 流式传输'],
                ] as const
              ).map(([key, label]) => (
                <label className="toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={editing.runtime[key]}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        runtime: { ...editing.runtime, [key]: e.target.checked },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
              <label>
                请求超时（秒）
                <input
                  type="number"
                  min="1"
                  max="3600"
                  value={
                    Number.isNaN(editing.runtime.timeoutSeconds)
                      ? ''
                      : editing.runtime.timeoutSeconds
                  }
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      runtime: { ...editing.runtime, timeoutSeconds: e.target.valueAsNumber },
                    })
                  }
                />
              </label>
            </div>
            <p className="muted">开启流式传输后可实时查看模型返回的内容。部分中转服务可能不支持流式传输；不会因流式不兼容自动重试。</p>
            <p className="muted">
              三个阶段的流式传输分别控制。关闭正文流式传输后，等待完整响应并在校验保存后展示正文。切换只影响后续尝试，不修改进行中的请求或正式世界状态。
            </p>
          </>
        )}
        <div className="local-save-bar"><Feedback role="status" level={noticeLevel} className="field-hint">{notice||(localDirty&&(tab==='提示词管理'||(desktop&&(tab==='提示词'||tab==='运行')))?'本地设置尚未保存。':'')}</Feedback>
        {tab !== 'AI 连接' && tab !== '记忆' && tab !== '外观' && (
          <button className="primary" onClick={save}>
            保存本地设置
          </button>
        )}</div>
      </div>}
      {pendingTab && <UnsavedAiChanges subject={tab === '记忆' ? '记忆设置' : undefined} onContinue={() => setPendingTab(undefined)} onDiscard={() => {
        aiDirtyChanged(false);
        if(pendingTab==='home'){setMobileHome(true);requestAnimationFrame(()=>{const body=host.current?.closest<HTMLElement>('.modal-body');if(body)body.scrollTop=homeScroll.current;host.current?.querySelector<HTMLButtonElement>(`[data-settings-category="${lastCategory.current}"]`)?.focus({preventScroll:true});});}else showCategory(pendingTab);
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
function LengthField({ min, max, custom, minInput, onTier, onCustom, onMin, onMax }: {
  min: number; max: number | undefined; custom: boolean; minInput: RefObject<HTMLInputElement | null>;
  onTier: (min: number, max: number) => void; onCustom: () => void; onMin: (value: number) => void; onMax: (value: number) => void;
}) {
  const tier = custom ? 'custom' : Number.isNaN(min) || Number.isNaN(max) ? 'custom' : narrativeLengthTier({ minNarrativeChars: min, maxNarrativeChars: max });
  // 推算值仅供输入框显示，不参与旧设置的档位识别或自动保存。
  const displayMax = max ?? narrativeRange({ minNarrativeChars: min }).max;
  const shown = (value: number) => Number.isNaN(value) ? '' : value;
  const inverted = !Number.isNaN(min) && !Number.isNaN(displayMax) && displayMax < min;
  return (
    <div className="length-field" role="group" aria-labelledby="length-field-title">
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
        {inverted
          ? <p className="field-hint length-warn" role="alert">建议上限不能低于最低字数。</p>
          : <p className="field-hint">最低字数由程序硬性检查，不够会判失败并重写；建议上限只告诉模型写到这里收尾，写多了也照常通过。</p>}
        {tier === 'high' && <p className="field-hint length-warn">高档每回合要写 8000 字以上：需要模型单次输出足够长（建议在「AI 连接」把最大输出调到 16k 以上），生成更慢、更耗额度；正文写到一半被截断时，可以用「续写正文」接着写。</p>}
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
