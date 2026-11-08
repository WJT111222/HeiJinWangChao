import { MemorySummarySettings } from './MemorySummarySettings';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { lazy, Suspense, useCallback, useState, cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { AiConnections } from './AiConnections';
import { UnsavedAiChanges } from './UnsavedAiChanges';
import { SettingsSchema } from './model';
import type { Settings } from './model';
import { NoticeLinks } from '../notices/Notices';
import type { NoticeKind } from '../notices/useNotices';

const PromptInspector = lazy(() =>
  import('./PromptInspector').then((module) => ({ default: module.PromptInspector })),
);

const tabs = ['AI 连接', '提示词', '记忆', '记忆总结', '运行', '提示词管理'] as const;
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
  const [tab, setTab] = useState<(typeof tabs)[number]>('AI 连接');
  const [editing, setEditing] = useState(settings);
  const [notice, setNotice] = useState('');
  const [aiDirty, setAiDirty] = useState(false);
  const [summaryDirty, setSummaryDirty] = useState(false);
  const summaryDirtyChanged = useCallback((dirty: boolean) => { setSummaryDirty(dirty); onSummaryDirtyChange?.(dirty); }, [onSummaryDirtyChange]);
  const [pendingTab, setPendingTab] = useState<(typeof tabs)[number]>();
  const aiDirtyChanged = useCallback((dirty: boolean) => {
    setAiDirty(dirty);
    onAiDirtyChange?.(dirty);
  }, [onAiDirtyChange]);
  const prompt = <K extends keyof Settings['prompts']>(key: K, value: Settings['prompts'][K]) =>
    setEditing({ ...editing, prompts: { ...editing.prompts, [key]: value } });
  function save() {
    const checked = SettingsSchema.safeParse({ ...editing, memory: { ...editing.memory, summaries: settings.memory.summaries } });
    if (!checked.success) {
      setNotice(
        '请输入有效的正整数：正文最多 100000 字、即时记忆最多 10000 回合、超时最多 3600 秒。',
      );
      return;
    }
    try {
      onSave(checked.data);
      setNotice('本地偏好已保存，将用于下一次正文请求；不会改写进行中的请求或已保存草稿。');
    } catch {
      setNotice('本地保存失败，请检查浏览器存储权限后重试。');
    }
  }
  return (
    <div className={`settings-layout ${tab === '提示词管理' ? 'prompt-settings-layout' : ''}`}>
      <nav aria-label="设置分类" className="settings-nav">
        {tabs.map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => {
              if (name !== tab && ((tab === 'AI 连接' && aiDirty) || (tab === '记忆总结' && summaryDirty))) { setPendingTab(name); return; }
              setTab(name);
              setNotice('');
            }}
          >
            {name}
          </button>
        ))}
        {onOpenNotice && <NoticeLinks onOpen={onOpenNotice} />}
      </nav>
      <div className="settings-content">
        <h3>{tab}</h3>
        {tab === '提示词管理' && (
          <Suspense fallback={<p>正在打开提示词管理中心…</p>}>
            <PromptInspector
              settings={editing}
              repository={repository}
              activeSaveId={activeSaveId}
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
        {tab === '记忆' && (
          <>
            <label>
              即时记忆完整回合数
              <input
                type="number"
                min="1"
                max="10000"
                value={
                  Number.isNaN(editing.memory.immediateWindowSize)
                    ? ''
                    : editing.memory.immediateWindowSize
                }
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    memory: { ...editing.memory, immediateWindowSize: e.target.valueAsNumber },
                  })
                }
              />
            </label>
            <p className="muted">
              默认 10
              回合。这里保存的数字决定下一次正文请求的完整回合窗口，不改变正式存档版本或删除原文。
              更早的相关历史可通过独立的有界本地检索重新引用。整理记忆会使用记忆总结模型，可能产生额外API费用。
            </p>
          </>
        )}
        {tab === '记忆总结' && (isValidElement<{ onDirtyChange?: (dirty: boolean) => void }>(memoryMaintenance)
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
            <fieldset disabled>
              <legend>校验与失败恢复（后续接入）</legend>
              <label className="toggle">
                <input type="checkbox" defaultChecked />
                输出协议校验
              </label>
              <label>
                自动重试
                <input readOnly value="首次 + 2 次，共 3 次" />
              </label>
              <button>失败阶段重新加载（后续开放）</button>
            </fieldset>
          </>
        )}
        <div role="status" className="field-hint">
          {notice}
        </div>
        {tab !== 'AI 连接' && tab !== '提示词管理' && tab !== '记忆总结' && (
          <button className="primary" onClick={save}>
            保存本地设置
          </button>
        )}
      </div>
      {pendingTab && <UnsavedAiChanges subject={tab === '记忆总结' ? '记忆总结设置' : undefined} onContinue={() => setPendingTab(undefined)} onDiscard={() => {
        aiDirtyChanged(false);
        setTab(pendingTab);
        setPendingTab(undefined);
        setNotice('');
      }} />}
    </div>
  );
}
