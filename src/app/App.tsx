import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { IdSchema } from '../domain/common';
import type { GameState } from '../domain/state';
import type { TurnDraft } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { readDocument, writeDocument } from '../services/local/documents';
import { loadCompanionProfile, companionProfileKey } from '../services/local/companionProfile';
import type { CompanionProfile } from '../services/local/companionProfile';
import { CreationWizard } from '../ui/creation/CreationWizard';
import { CreationSchema, creationKey, newCreation, createProfileSave } from '../ui/creation/model';
import type { Creation } from '../ui/creation/model';
import { SettingsPanel } from '../ui/settings/SettingsPanel';
import { SettingsSchema, defaultSettings, settingsKey } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { dateTime } from '../ui/panels/playerView';
import { Dialog, Empty } from '../ui/Dialog';

const GameScreen = lazy(() =>
  import('../ui/game/GameScreen').then((module) => ({ default: module.GameScreen })),
);

type SaveSummary = Awaited<ReturnType<SaveRepository['list']>>[number];
const selectedKey = 'heijin.selected.v1';
function bootstrap() {
  const warnings: string[] = [];
  let settings = defaultSettings();
  let form = newCreation();
  let hasDraft = false;
  let selected = '';
  try {
    settings = readDocument(localStorage, settingsKey, SettingsSchema) ?? settings;
  } catch {
    warnings.push('本地设置无法读取，当前使用默认偏好；原数据未被覆盖。');
  }
  try {
    const saved = readDocument(localStorage, creationKey, CreationSchema);
    if (saved) {
      form = saved;
      hasDraft = true;
    }
  } catch {
    warnings.push('创角草稿无法读取；开始新游戏会建立新的填写草稿。');
  }
  try {
    selected = readDocument(localStorage, selectedKey, IdSchema) ?? '';
  } catch {
    /* 可重新选择存档。 */
  }
  return { settings, form, hasDraft, selected, warning: warnings.join(' ') };
}
export function App() {
  const [initial] = useState(bootstrap);
  const [repository, setRepository] = useState<SaveRepository>();
  const [route, setRoute] = useState(window.location.hash);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [settings, setSettings] = useState(initial.settings);
  const [form, setForm] = useState(initial.form);
  const [hasDraft, setHasDraft] = useState(initial.hasDraft);
  const [selected, setSelected] = useState(initial.selected);
  const [loaded, setLoaded] = useState<{
    state: GameState;
    draft?: TurnDraft;
    companionProfile?: CompanionProfile;
  }>();
  const [error, setError] = useState(initial.warning);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState<SaveSummary>();
  useEffect(() => {
    let disposed = false;
    let connection: SaveRepository | undefined;
    SaveRepository.open()
      .then((repo) => {
        connection = repo;
        if (disposed) repo.close();
        else setRepository(repo);
      })
      .catch(() => {
        if (!disposed) {
          setError('本地存档无法打开，请检查浏览器存储权限后刷新重试。');
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      connection?.close();
    };
  }, []);
  useEffect(() => {
    const changed = () => {
      setLoaded(undefined);
      setLoading(true);
      setRoute(window.location.hash);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (!repository) return;
    let disposed = false;
    if (route.startsWith('#game/')) {
      const id = route.slice(6);
      repository
        .loadGame(id)
        .then(({ state, draft }) => {
          if (!disposed) {
            let companionProfile: CompanionProfile | undefined;
            try {
              companionProfile = loadCompanionProfile(localStorage, state);
            } catch {
              setError('同伴创角档案无法读取，已隐藏无法确认来源的资料；正式存档未被修改。');
            }
            setLoaded({ state, draft, companionProfile });
            setLoading(false);
          }
        })
        .catch(() => {
          if (!disposed) {
            setLoaded(undefined);
            setError('无法读取此存档。存档可能已删除、版本较新或数据损坏，原始数据未被修改。');
            setLoading(false);
          }
        });
    } else {
      repository
        .list()
        .then((items) => {
          if (!disposed) {
            setSaves([...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
            setLoading(false);
          }
        })
        .catch(() => {
          if (!disposed) {
            setError('存档列表读取失败，可能存在不支持或损坏的记录。原始数据已保留。');
            setLoading(false);
          }
        });
    }
    return () => {
      disposed = true;
    };
  }, [repository, route]);
  function navigate(hash = '') {
    setLoaded(undefined);
    setLoading(true);
    window.location.hash = hash;
    if (window.location.hash === route) setLoading(false);
  }
  function openSave(id: string) {
    setSelected(id);
    setError('');
    try {
      writeDocument(localStorage, selectedKey, IdSchema, id);
    } catch {
      setError('已选择存档，但浏览器未能保存最近选择。');
    }
    navigate(`game/${id}`);
  }
  function changeForm(next: Creation) {
    if (lock.current) return;
    setForm(next);
    setHasDraft(true);
    try {
      writeDocument(localStorage, creationKey, CreationSchema, next);
    } catch {
      setError('填写内容暂未保存，刷新可能丢失。请检查浏览器存储空间或权限。');
    }
  }
  function saveSettings(next: Settings) {
    writeDocument(localStorage, settingsKey, SettingsSchema, next);
    setSettings(next);
  }
  async function create() {
    if (!repository || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const state = await createProfileSave(repository, form, settings, localStorage);
      try {
        localStorage.removeItem(creationKey);
      } catch {
        /* 存档已成功，原草稿仍可安全重试。 */
      }
      setHasDraft(false);
      setForm(newCreation());
      openSave(state.saveId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function deleteSave() {
    if (!repository || !deleting || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await repository.delete(deleting.saveId, deleting.revision);
      try {
        localStorage.removeItem(companionProfileKey(deleting.saveId));
      } catch {
        // 已删除的正式存档不再读取此 UI 档案。
      }
      setSaves(await repository.list());
      if (selected === deleting.saveId) {
        setSelected('');
        try {
          localStorage.removeItem(selectedKey);
        } catch {
          /* 无效选择在列表中不会继续使用。 */
        }
      }
      setDeleting(undefined);
    } catch {
      setError('删除失败，存档可能已更新。请刷新列表后重试；原数据已保留。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const active = saves.find((save) => save.saveId === selected) ?? saves[0];
  return (
    <>
      <header className="app-header">
        <a className="brand" href="#" aria-label="黑金王朝首页">
          <span className="brand-mark">黑</span>
          <span>
            黑金王朝<small>HEIJINWANGCHAO</small>
          </span>
        </a>
        <nav>
          <button onClick={() => navigate()}>游戏首页</button>
          <button onClick={() => setSettingsOpen(true)}>设置</button>
          <span className="version">V0.1 · M5-P2</span>
        </nav>
      </header>
      {error && (
        <div className="app-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
      {route === '#create' ? (
        <CreationWizard
          form={form}
          onChange={changeForm}
          onCreate={() => void create()}
          busy={busy || !repository}
          onExit={() => navigate()}
        />
      ) : route.startsWith('#game/') ? (
        loaded ? (
          <Suspense
            fallback={
              <main className="page">
                <Empty>正在打开游戏界面…</Empty>
              </main>
            }
          >
            <GameScreen
              key={loaded.state.saveId}
              state={loaded.state}
              draft={loaded.draft}
              repository={repository!}
              onDraftSaved={(draft) =>
                setLoaded((current) =>
                  current?.state.saveId === draft.saveId ? { ...current, draft } : current,
                )
              }
              onCommitted={({ state, draft }) =>
                setLoaded((current) =>
                  current?.state.saveId === state.saveId && current.state.revision <= state.revision
                    ? { ...current, state, draft }
                    : current,
                )
              }
              onMemorySaved={(state) => setLoaded((current) =>
                current?.state.saveId === state.saveId && current.state.revision === state.revision
                  ? { ...current, state } : current)}
              companionProfile={loaded.companionProfile}
              settings={settings}
              onSettings={(next) => {
                try {
                  saveSettings(next);
                } catch {
                  setError('运行偏好保存失败，请检查浏览器存储权限。');
                }
              }}
              onSaves={() => navigate()}
            />
          </Suspense>
        ) : (
          <main className="page">
            <Empty>{loading ? '正在读取存档…' : '未能打开存档，请返回首页重新选择。'}</Empty>
            <button onClick={() => navigate()}>返回存档列表</button>
          </main>
        )
      ) : (
        <main className="home-page">
          <section className="home-hero">
            <p className="eyebrow">MODERN CITY / OPEN WORLD</p>
            <h1>
              黑金王朝
              <span>
                起点有冲突，
                <br />
                人生不预设结局。
              </span>
            </h1>
            <p className="home-description">
              一款 AI 驱动的现代都市开放世界文字角色扮演游戏。
              <br />
              在熟悉的城市里，写下属于你的人生。
            </p>
            <div className="home-actions">
              <button
                className="primary"
                disabled={!repository}
                onClick={() => {
                  changeForm(form);
                  navigate('create');
                }}
              >
                开始新游戏 <span aria-hidden="true">↗</span>
              </button>
              <button
                disabled={!active || loading}
                onClick={() => active && openSave(active.saveId)}
              >
                继续游戏 →
              </button>
            </div>
            {hasDraft && <p className="field-hint">有尚未完成的创角资料，开始新游戏可继续填写。</p>}
            <div className="skyline" aria-hidden="true">
              {[38, 62, 42, 84, 55, 100, 68, 48, 74, 40, 58].map((height, i) => (
                <i key={i} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="home-footnote">
              <span>四座城市 · 自由职业 · 开放人生</span>
              <span>三阶段生成 · 原子结算 · 连续回合</span>
            </div>
          </section>
          <section className="save-library" aria-label="已有存档">
            <div className="section-heading">
              <div>
                <p className="eyebrow">YOUR STORIES</p>
                <h2>
                  已有存档 <span className="count">{saves.length.toString().padStart(2, '0')}</span>
                </h2>
              </div>
              <button
                disabled={!repository || loading}
                onClick={() => {
                  if (repository) {
                    setLoading(true);
                    repository
                      .list()
                      .then(setSaves)
                      .catch(() => setError('列表读取失败，请重试。'))
                      .finally(() => setLoading(false));
                  }
                }}
              >
                刷新列表
              </button>
            </div>
            <p className="muted">每份存档都是一段独立的人生，保存在当前浏览器。</p>
            {loading ? (
              <Empty>正在读取本地存档…</Empty>
            ) : !saves.length ? (
              <Empty>
                还没有开始的人生。
                <br />
                创建角色，留下第一份存档。
              </Empty>
            ) : (
              <div className="save-list">
                {saves.map((save, i) => (
                  <article
                    className={`save-card ${active?.saveId === save.saveId ? 'selected' : ''}`}
                    key={save.saveId}
                  >
                    <div className="save-card-top">
                      <span className="eyebrow">ARCHIVE {String(i + 1).padStart(2, '0')}</span>
                      <span className="tag">
                        {active?.saveId === save.saveId ? '已选择' : '本地存档'}
                      </span>
                    </div>
                    <h3>{save.title}</h3>
                    <p className="muted">保存于 {dateTime(save.updatedAt)}</p>
                    <div className="save-card-actions">
                      <button onClick={() => openSave(save.saveId)}>读取存档 ↗</button>
                      <button
                        onClick={() => {
                          setSelected(save.saveId);
                          try {
                            writeDocument(localStorage, selectedKey, IdSchema, save.saveId);
                          } catch {
                            setError('未能保存最近选择');
                          }
                        }}
                      >
                        选择
                      </button>
                      <button className="danger-text" onClick={() => setDeleting(save)}>
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <footer className="library-footer">
              <span className="tiny-dot" />
              本地保存 · 无需账号 <button onClick={() => setSettingsOpen(true)}>打开设置 ↗</button>
            </footer>
          </section>
        </main>
      )}
      {settingsOpen && (
        <Dialog title="设置" onClose={() => setSettingsOpen(false)}>
          <SettingsPanel
            settings={settings}
            onSave={saveSettings}
            repository={repository}
            activeSaveId={loaded?.state.saveId ?? active?.saveId}
          />
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title="删除这份存档？"
          small
          onClose={() => {
            if (!busy) setDeleting(undefined);
          }}
        >
          <p>将永久删除「{deleting.title}」及其正文草稿。此操作无法撤销。</p>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setDeleting(undefined)}>
              取消
            </button>
            <button className="danger" disabled={busy} onClick={() => void deleteSave()}>
              {busy ? '正在删除…' : '确认删除'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
