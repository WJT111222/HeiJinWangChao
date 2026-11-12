import { canAcceptNpcView } from '../ui/game/npcManagement';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
import { UnsavedAiChanges } from '../ui/settings/UnsavedAiChanges';
import { SettingsSchema, defaultSettings, settingsKey } from '../ui/settings/model';
import type { Settings } from '../ui/settings/model';
import { HomeScreen } from '../ui/home/HomeScreen';
import { dateTime } from '../ui/panels/playerView';
import { SaveCard } from '../ui/SaveCard';
import { saveKeyText } from '../services/storage/saveManagement';
import { Feedback, useDesktopFeedback } from '../ui/Feedback';
import { ArchivePanel } from '../ui/ArchivePanel';
import { Dialog, Empty } from '../ui/Dialog';
import { PRODUCT_VERSION } from './product';
import { useGameViewport } from './useGameViewport';
import { authorizeOpening } from '../ui/game/openingStart';
import type { OpeningStart } from '../ui/game/openingStart';
import { NoticeDialog, NoticeLinks } from '../ui/notices/Notices';
import { useNotices } from '../ui/notices/useNotices';

const GameScreen = lazy(() =>
  import('../ui/game/GameScreen').then((module) => ({ default: module.GameScreen })),
);

type SaveSummary = Awaited<ReturnType<SaveRepository['list']>>[number];
const selectedKey = 'heijin.selected.v1';
const listFailure = '存档列表暂时无法访问，请检查浏览器存储权限后重试。原始数据未修改。';
const openFailure = '本地存档无法打开，请检查浏览器存储权限后刷新重试。';
const loadFailure = '无法读取此存档。存档可能已删除、版本较新或数据损坏，原始数据未被修改。';
function orderedSaves(items: SaveSummary[]) {
  return [...items].sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0));
}
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
  const desktopUi = useDesktopFeedback();
  const notices = useNotices();
  const [initial] = useState(bootstrap);
  const [repository, setRepository] = useState<SaveRepository>();
  const [route, setRoute] = useState(window.location.hash);
  const gameRoute = route.startsWith('#game/');
  const shell = useGameViewport(gameRoute);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [settings, setSettings] = useState(initial.settings);
  const [form, setForm] = useState(initial.form);
  const [hasDraft, setHasDraft] = useState(initial.hasDraft);
  const [selected, setSelected] = useState(initial.selected);
  const [loaded, setLoaded] = useState<{
    state: GameState;
    draft?: TurnDraft;
    companionProfile?: CompanionProfile;
    undoGeneration?: number;
  }>();
  const [error, setError] = useState(initial.warning);
  const [listError, setListError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const openingStart = useRef<OpeningStart | undefined>(undefined);
  const navigationRevision = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSettingsDirty, setAiSettingsDirty] = useState(false);
  const [summarySettingsDirty, setSummarySettingsDirty] = useState(false);
  const settingsDestination=useRef<(()=>void)|undefined>(undefined);
  const [confirmSettingsClose, setConfirmSettingsClose] = useState(false);
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
          setError(openFailure);
          setListError(openFailure);
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      connection?.close();
    };
  }, []);
  useEffect(() => {
    const changed = (event: HashChangeEvent) => {
      navigationRevision.current++;
      if (new URL(event.newURL).hash !== `#game/${openingStart.current?.saveId}`) {
        openingStart.current?.revoke();
        openingStart.current = undefined;
      }
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
            setError(loadFailure);
            setLoading(false);
          }
        });
    } else {
      repository
        .list()
        .then((items) => {
          if (!disposed) {
            acceptList(items);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!disposed) {
            setError(listFailure); setListError(listFailure);
            setLoading(false);
          }
        });
    }
    return () => {
      disposed = true;
    };
  }, [repository, route]);
  function acceptList(items: SaveSummary[]) {
    setSaves(orderedSaves(items)); setListError('');
    setError(current => [listFailure, openFailure, loadFailure].includes(current) ? '' : current);
  }
  function navigate(hash = '') {
    navigationRevision.current++;
    if (hash !== `game/${openingStart.current?.saveId}`) {
      openingStart.current?.revoke();
      openingStart.current = undefined;
    }
    setLoaded(undefined);
    setLoading(true);
    window.location.hash = hash;
    if (window.location.hash === route) setLoading(false);
  }
  function openSave(id: string, start?: OpeningStart) {
    openingStart.current?.revoke();
    openingStart.current = start;
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
    const creationNavigation = navigationRevision.current;
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
      // 创角保存期间离开过页面，不再持有自动开局授权；存档仍可从首页主动读取。
      if (window.location.hash === '#create' && navigationRevision.current === creationNavigation)
        openSave(state.saveId, authorizeOpening(state));
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
    setDeleteError('');
    try {
      if (deleting.status === 'readable') await repository.delete(deleting.saveId, deleting.revision);
      else await repository.deleteUnreadable(deleting.storageKey);
      try {
        if (typeof deleting.storageKey === 'string') localStorage.removeItem(companionProfileKey(deleting.storageKey));
      } catch {
        // 已删除的正式存档不再读取此 UI 档案。
      }
      setSaves(current => current.filter(item => item !== deleting));
      setDeleting(undefined); setSaveNotice('存档及关联草稿、提交回执已删除。');
      setError(current => [listFailure, openFailure, loadFailure].includes(current) ? '' : current);
      if (selected === deleting.storageKey) {
        setSelected('');
        try {
          localStorage.removeItem(selectedKey);
        } catch {
          /* 无效选择在列表中不会继续使用。 */
        }
      }
      // Deletion has committed. A later refresh failure must not claim it rolled back.
      try { acceptList(await repository.list()); }
      catch { setListError(listFailure); setError(listFailure); }
    } catch {
      setDeleteError('删除失败，存档可能已更新或存储不可用。请刷新列表后重试；本次未删除数据。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const readableSaves = saves.filter(save => save.status === 'readable');
  const active = readableSaves.find((save) => save.saveId === selected) ?? readableSaves[0];
  // 游戏中由原GameScreen提供唯一维护控制器；设置只是展示，不拥有任务生命周期。
  function requestSettingsClose(afterClose?:()=>void){
    settingsDestination.current=afterClose;
    if(aiSettingsDirty||summarySettingsDirty)setConfirmSettingsClose(true);
    else{setSettingsOpen(false);settingsDestination.current=undefined;afterClose?.();}
  }
  const renderSettings = (memoryMaintenance?: ReactNode) => (
    <ArchivePanel title="设置" seal="设" eyebrow="SYSTEM · 系统" subtitle="本地偏好与 AI 渠道"
      settingsHost={{inGame:Boolean(gameRoute&&loaded)}} onClose={()=>requestSettingsClose()}
      returnFocus={()=>document.querySelector<HTMLElement>('[data-settings-open]')}>
      <SettingsPanel settings={settings} onSave={saveSettings} repository={repository}
        activeSaveId={loaded?.state.saveId ?? active?.saveId} memoryMaintenance={memoryMaintenance}
        onAiDirtyChange={setAiSettingsDirty} onSummaryDirtyChange={setSummarySettingsDirty} onOpenNotice={notices.open} />
    </ArchivePanel>
  );
  return (
    <div ref={shell} className={gameRoute ? 'app-shell app-shell-game' : route === '#create' ? 'app-shell' : 'app-shell app-shell-home'}>
      {(gameRoute || route === '#create') && <header className="app-header">
        <a className="brand" href="#" aria-label="黑金王朝首页">
          <span className="brand-mark">黑</span>
          <span>
            黑金王朝<small>HEIJINWANGCHAO</small>
          </span>
        </a>
        <nav className="header-navigation" aria-label="主导航">
          <button onClick={() => navigate()}>游戏首页</button>
          <button onClick={() => setSettingsOpen(true)}>设置</button>
          {gameRoute && <button onClick={() => navigate()}>切换存档</button>}
          <span className="version">{PRODUCT_VERSION}</span>
        </nav>
        {gameRoute && <button className="mobile-menu-toggle" aria-label="打开游戏菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>☰</button>}
      </header>}
      {gameRoute && <div className="game-corner-brand" aria-label={`黑金王朝 ${PRODUCT_VERSION}`}>
        <span className="brand-mark" aria-hidden="true">黑</span>
        <span className="game-corner-name">黑金王朝<small>{PRODUCT_VERSION}</small></span>
      </div>}
      {gameRoute && menuOpen && <Dialog title="游戏菜单" small mobileVariant="actions" className="mobile-game-menu" onClose={() => setMenuOpen(false)}>
        <div className="mobile-menu-card">
        <nav className="game-menu" aria-label="游戏菜单">
          <button onClick={() => { setMenuOpen(false); navigate(); }}>{!desktopUi&&<span className="mobile-seal" aria-hidden="true">首</span>}游戏首页</button>
          <button onClick={() => { setMenuOpen(false); navigate(); }}>{!desktopUi&&<span className="mobile-seal" aria-hidden="true">票</span>}切换存档</button>
          <button onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}>{!desktopUi&&<span className="mobile-seal" aria-hidden="true">设</span>}设置</button>
          <span className="version">{!desktopUi&&'黑金王朝 · '}{PRODUCT_VERSION}</span>
        </nav>
        </div>
        {!desktopUi&&<button className="mobile-menu-close" onClick={()=>setMenuOpen(false)}>关闭</button>}
      </Dialog>}
      {error && (
        <div className={route === '#create' ? 'app-error' : 'app-error feedback l-err'} role="alert">
          {route !== '#create' && <span className="feedback-icon global-feedback-icon" aria-hidden="true">误</span>}<span className="feedback-text">{error}</span>
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
              key={`${loaded.state.saveId}:${loaded.undoGeneration ?? 0}`}
              openingStart={openingStart.current}
              onOpenSettings={() => settingsOpen?requestSettingsClose():setSettingsOpen(true)}
              onCloseSettings={requestSettingsClose}
              state={loaded.state}
              draft={loaded.draft}
              repository={repository!}
              onDraftSaved={(draft) =>
                setLoaded((current) =>
                  current?.state.saveId === draft.saveId && current.state.revision === draft.baseSaveRevision && (!current.draft || current.draft.turnId !== draft.turnId || current.draft.baseSaveRevision !== draft.baseSaveRevision || current.draft.draftRevision <= draft.draftRevision)
                    ? { ...current, draft } : current,
                )
              }
              onCommitted={({ state, draft }) =>
                setLoaded((current) =>
                  current?.state.saveId === state.saveId && current.state.revision <= state.revision
                    ? { ...current, state, draft }
                    : current,
                )
              }
              onNpcManaged={result => setLoaded(current => current && canAcceptNpcView(current, result) ? { ...current, state: result.state, draft: result.draft } : current)}
              onMemorySaved={(state) => setLoaded((current) =>
                current?.state.saveId === state.saveId && current.state.revision === state.revision && (current.state.npcManagementRevision ?? 0) === (state.npcManagementRevision ?? 0)
                  ? { ...current, state } : current)}
              onUndone={({ state, draft }) => setLoaded(current =>
                current?.state.saveId === state.saveId && current.state.revision < state.revision
                  ? { ...current, state, draft, undoGeneration: (current.undoGeneration ?? 0) + 1 } : current)}
              renderSettings={settingsOpen ? renderSettings : undefined}
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
        <HomeScreen count={saves.length} loading={loading} canCreate={!!repository}
          active={active ? `${active.title} · 保存于 ${dateTime(active.updatedAt)}` : undefined}
          hasDraft={hasDraft} notice={saveNotice} notices={<NoticeLinks onOpen={notices.open} />}
          onCreate={() => { changeForm(form); navigate('create'); }} onContinue={() => active && openSave(active.saveId)}
          onSettings={() => setSettingsOpen(true)} onRefresh={() => {
            if (repository) { setLoading(true); repository.list().then(acceptList)
              .catch(() => { setError(listFailure); setListError(listFailure); }).finally(() => setLoading(false)); }
          }}>
          {loading ? <Empty>正在读取本地存档…</Empty> : listError ? <p className="empty err">{listError}</p> : !saves.length ?
            <Empty>还没有开始的人生。<br />创建角色，留下第一份存档。</Empty> : <>
                {saves.map((save, i) => (
                  <SaveCard key={`${typeof save.storageKey}:${saveKeyText(save.storageKey)}`} save={save} index={i}
                    selected={save.status === 'readable' && active?.saveId === save.saveId} repository={repository}
                    onOpen={openSave} onSelect={id => {
                          setSelected(id);
                          try {
                            writeDocument(localStorage, selectedKey, IdSchema, id);
                          } catch {
                            setError('未能保存最近选择');
                          }
                    }} onDelete={() => { setDeleteError(''); setSaveNotice(''); setDeleting(save); }} />
                ))}

          </>}
        </HomeScreen>
      )}
      {notices.kind && <NoticeDialog key={notices.kind} kind={notices.kind} muted={notices.muted}
        onMutedChange={notices.setMuted} onClose={notices.close} />}
      {settingsOpen && !(gameRoute && loaded) && renderSettings()}
      {settingsOpen && confirmSettingsClose && <UnsavedAiChanges subject={summarySettingsDirty ? '记忆设置' : undefined} onContinue={() => {setConfirmSettingsClose(false);settingsDestination.current=undefined;}} onDiscard={() => {
        setConfirmSettingsClose(false);
        setAiSettingsDirty(false); setSummarySettingsDirty(false);
        setSettingsOpen(false);const destination=settingsDestination.current;settingsDestination.current=undefined;destination?.();
      }} />}
      {deleting && (
        <Dialog
          title="删除这份存档？"
          small feedback="err" seal="删"
          onClose={() => {
            if (!busy) setDeleting(undefined);
          }}
        >
          <p>将永久删除「{deleting.title}」及其关联草稿、回合提交回执。此操作无法撤销。</p>
          <p className="save-record-key">存档记录 ID：{saveKeyText(deleting.storageKey)}</p>
          {deleting.status === 'unreadable' && <p>此存档无法读取，建议取消并先导出原始数据。</p>}
          {deleteError && <Feedback role="alert" level="err" mobileAs="p">{deleteError}</Feedback>}
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
    </div>
  );
}
