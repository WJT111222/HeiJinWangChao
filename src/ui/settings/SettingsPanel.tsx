import type { FeedbackLevel } from '../Feedback';
import { Feedback,useDesktopFeedback } from '../Feedback';
import { MemorySummarySettings } from './MemorySummarySettings';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { AiConnections } from './AiConnections';
import { UnsavedAiChanges } from './UnsavedAiChanges';
import { SettingsSchema } from './model';
import type { Settings } from './model';
import { NoticeLinks } from '../notices/Notices';
import './settings-paper.css';
import type { NoticeKind } from '../notices/useNotices';

const PromptInspector = lazy(() =>
  import('./PromptInspector').then((module) => ({ default: module.PromptInspector })),
);

const descriptions={'AI 连接':'渠道、密钥与模型路由','提示词':'叙事人称、风格与开关','记忆':'即时记忆与记忆总结','运行':'阶段开关与超时','提示词管理':'查看与编辑提示词'};
const tabs = ['AI 连接', '提示词', '记忆', '运行', '提示词管理'] as const;
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
  function save() {
    const checked = SettingsSchema.safeParse({ ...editing, memory: settings.memory });
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
      setNotice('本地偏好已保存，将用于下一次正文请求；不会改写进行中的请求或已保存草稿。');
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
            <i aria-hidden="true">{{'AI 连接':'连','提示词':'词','记忆':'忆','运行':'运','提示词管理':'管'}[name]}</i>{desktop?<span>{name}</span>:<span className="settings-row-text"><strong>{name}</strong><small>{descriptions[name]}</small></span>}{((name==='AI 连接'&&aiDirty)||(name==='记忆'&&summaryDirty)||((name==='提示词'||name==='运行')&&localDirty))&&<span className="dirty" aria-hidden="true" title="有未保存的修改"/>}{!desktop&&<span aria-hidden="true">›</span>}
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
              <label>
                剧情风格
                <select value="general" onChange={() => undefined}>
                  <option value="general">一般</option>
                </select>
              </label>
              <label>
                正文最低字数
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={
                    Number.isNaN(editing.prompts.minNarrativeChars)
                      ? ''
                      : editing.prompts.minNarrativeChars
                  }
                  onChange={(e) => prompt('minNarrativeChars', e.target.valueAsNumber)}
                />
              </label>
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
        {tab === '运行' && (
          <>
            <div className="settings-fields">
              {(
                [
                  ['useVariableStage', '变量管理'],
                  ['useWorldStage', '动态世界'],
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
            <p className="muted">
              两个阶段独立控制。切换只保存后续尝试的偏好，不修改进行中尝试或正式世界状态。
            </p>
          </>
        )}
        <div className="local-save-bar"><Feedback role="status" level={noticeLevel} className="field-hint">{notice||(localDirty&&(tab==='提示词管理'||(desktop&&(tab==='提示词'||tab==='运行')))?'本地设置尚未保存。':'')}</Feedback>
        {tab !== 'AI 连接' && tab !== '记忆' && (
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
