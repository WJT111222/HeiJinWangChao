import { SaveRepository } from '../../../services/storage/saveRepository';
import { useEffect, useState, useSyncExternalStore } from 'react';
import isEqual from 'lodash/isEqual';
import { useDesktopFeedback } from '../../Feedback';
import { Dialog } from '../../Dialog';
import { oracleDefinition, oracleId } from '../../../presets/meowssiah/definition';
import { checkOracle, defaults, directionId, menu, oracleEdits } from '../../../presets/meowssiah/config';
import { loadPreset, type LoadedPreset, type PackageOverride } from '../../../presets/package';
import { readEditorOverride, storeEditorOverride } from '../../../presets/tavern/hostState';
import { resolveStoryPreset } from '../../../presets/library';
import { samplingFields } from '../../../presets/peintureSettings';
import { requestInspections } from '../../../services/ai/inspection';
import { estimateTokens } from '../../../prompts/statistics';
import { OracleSchemes } from './OracleSchemes';
import './oracle.css';

export default function OracleConsole({ close, saveId }: { close(): void; saveId?: string }) {
  const desktop = useDesktopFeedback();
  const [leaving, setLeaving] = useState(false);
  const [base, setBase] = useState(() => readEditorOverride(oracleId));
  const [edits, edit] = useState<PackageOverride>(() => base ?? defaults());
  const [pack, setPack] = useState<LoadedPreset>();
  const [message, notify] = useState(''),
    [tab, setTab] = useState('创作菜单');
  const [selected, select] = useState<string>();
  const [noteState, setNoteState] = useState<Awaited<ReturnType<SaveRepository['readOracleNote']>>>();
  const note = noteState?.note;
  useEffect(() => {
    if (!saveId) return;
    let live = true;
    void (async () => {
      const repo = await SaveRepository.open();
      try {
        const value = await repo.readOracleNote(saveId);
        if (live) {
          setNoteState(value);
          write(value.note?.text ?? '');
          setOnce(value.note?.once ?? true);
        }
      } finally {
        repo.close();
      }
    })().catch((error) => {
      if (live) notify(String(error));
    });
    return () => {
      live = false;
    };
  }, [saveId]);
  const [paper, write] = useState(note?.text ?? ''),
    [once, setOnce] = useState(note?.once ?? true);
  const inspections = useSyncExternalStore(requestInspections.subscribe, requestInspections.getSnapshot);
  const recent = inspections.find(
    (i) =>
      i.stage === 'story' &&
      i.scope?.saveId === saveId &&
      JSON.stringify(i.body.tools ?? []).includes('soliumbra_reply'),
  );
  useEffect(() => {
    let live = true;
    resolveStoryPreset({ definition: oracleDefinition })
      .then((p) => {
        if (live) setPack(p);
      })
      .catch((error) => {
        if (live) notify(String(error));
      });
    return () => {
      live = false;
    };
  }, []);
  function apply(next: PackageOverride) {
    if (!pack) return;
    checkOracle(loadPreset(pack.raw, oracleDefinition, oracleEdits(next)));
    edit(next);
    notify('');
  }
  const effective = pack && loadPreset(pack.raw, oracleDefinition, edits);
  const entry = (id: string) => effective?.entries.find((e) => e.identifier === id);
  function setEntry(id: string, value: { enabled?: boolean; content?: string }) {
    const entries = { ...edits.entries };
    const row = menu.find((r) => r.id === id);
    if (row?.kind === 'radio' && value.enabled)
      for (const other of menu.filter((r) => r.group === row.group))
        entries[other.id] = { ...entries[other.id], enabled: false };
    entries[id] = { ...entries[id], ...value };
    apply({ ...edits, entries });
  }
  async function save() {
    try {
      if (!pack) return;
      checkOracle(loadPreset(pack.raw, oracleDefinition, oracleEdits(edits)));
      const store = () => storeEditorOverride(oracleId, base, edits);
      if (navigator.locks) await navigator.locks.request('heijin.story-presets.mode', store);
      else store();
      setBase(edits);
      notify('文学配置已保存');
    } catch (error) {
      notify(String(error));
    }
  }
  const groups = [...new Set(menu.map((row) => row.group))];
  const dirty =
    !isEqual(edits, base ?? defaults()) || paper !== (note?.text ?? '') || once !== (note?.once ?? true);
  const leave = () => (dirty ? setLeaving(true) : close());
  const footer = (
    <div className="oracle-footer">
      <span role="status">{message}</span>
      {leaving ? (
        <>
          <span>放弃尚未保存的更改？</span>
          <button onClick={() => setLeaving(false)}>继续编辑</button>
          <button onClick={close}>放弃更改</button>
        </>
      ) : (
        <>
          <button onClick={leave}>关闭</button>
          <button disabled={!pack} onClick={() => void save()}>
            保存文学配置
          </button>
        </>
      )}
    </div>
  );
  return (
    <Dialog
      title="神域控制台"
      subtitle="小猫之神 · SoliUmbra"
      seal="喵"
      className="oracle-console"
      mobileVariant="sheet"
      sheetFull
      onClose={leave}
      footer={footer}
    >
      <nav aria-label="神域分区">
        {['创作菜单', '场外小纸条', '采样与用量', '我的方案'].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {tab === '创作菜单' && (
        <>
          {groups.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              <div className="oracle-options">
                {menu
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <div key={r.id}>
                      <button
                        aria-pressed={entry(r.id)?.enabled ?? false}
                        onClick={() => setEntry(r.id, { enabled: !entry(r.id)?.enabled })}
                      >
                        {r.label}
                      </button>
                      <button
                        aria-label={'编辑' + r.label}
                        onClick={() => select(selected === r.id ? undefined : r.id)}
                      >
                        ✎
                      </button>
                      {selected === r.id && (
                        <label>
                          条目原文
                          <textarea
                            value={entry(r.id)?.content ?? ''}
                            onChange={(e) => setEntry(r.id, { content: e.target.value })}
                          />
                        </label>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          ))}
          <label>
            自定义创作要求
            <textarea
              value={entry(directionId)?.content ?? ''}
              onChange={(e) => setEntry(directionId, { content: e.target.value })}
            />
          </label>
          <button onClick={() => apply(defaults())}>恢复发行默认值</button>
        </>
      )}
      {tab === '场外小纸条' && (
        <section>
          <h3>导演便签</h3>
          {saveId ? (
            <>
              <label>
                本档下次正文的附加要求
                <textarea
                  maxLength={100000}
                  disabled={!noteState}
                  value={paper}
                  onChange={(e) => write(e.target.value)}
                />
              </label>
              <label>
                <input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />
                候选保存后清空
              </label>
              <button
                disabled={!noteState}
                onClick={async () => {
                  if (!noteState) return;
                  try {
                    const repo = await SaveRepository.open();
                    try {
                      setNoteState(
                        await repo.writeOracleNote(
                          saveId,
                          { instance: noteState.instance, noteId: note?.id },
                          paper,
                          once,
                        ),
                      );
                    } finally {
                      repo.close();
                    }
                    notify('场外小纸条已保存');
                  } catch (error) {
                    notify(String(error));
                  }
                }}
              >
                保存小纸条
              </button>
            </>
          ) : (
            <p>载入存档后可填写场外小纸条。</p>
          )}
        </section>
      )}
      {tab === '采样与用量' && (
        <section>
          <h3>生成设置</h3>
          {samplingFields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                step="0.01"
                min={f.min}
                max={f.max}
                value={effective?.sampling[f.key] ?? ''}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  if (Number.isFinite(value) && value >= f.min && value <= f.max)
                    apply({ ...edits, sampling: { ...edits.sampling, [f.key]: value } });
                }}
              />
            </label>
          ))}
          <p>
            已启用文学条目本地估算{' '}
            {
              estimateTokens(
                effective?.entries
                  .filter((e) => e.enabled)
                  .map((e) => e.content)
                  .join('\n') ?? '',
              ).estimatedTokens
            }{' '}
            Token
          </p>
          {recent ? (
            <>
              <p>
                {recent.route.protocol} · {recent.route.model} · 最大输出 {recent.outputTokenLimit ?? '未知'}
              </p>
              <p>
                供应商输入 {recent.statistics.actual.inputTokens ?? '未返回'} · 输出{' '}
                {recent.statistics.actual.outputTokens ?? '未返回'} · 缓存读取{' '}
                {recent.statistics.actual.cacheReadTokens ?? '未返回'}
              </p>
              <pre>{JSON.stringify(recent.presetSampling, null, 2)}</pre>
            </>
          ) : (
            <p>暂无本档实发请求记录。</p>
          )}
        </section>
      )}
      {tab === '我的方案' && <OracleSchemes edits={edits} apply={apply} />}
      <details className="oracle-credits">
        <summary>SoliUmbra · 来源及许可</summary>
        <p>
          3.0-Preview-01 · 301。下载四份 .mjs 源码，使用 Node 24 执行 <code>node build.mjs --standalone</code>{' '}
          可重建本版隔离处理器。
        </p>
        {['AUTHOR.txt', 'COPYING', 'SOURCES.json', 'frame.mjs', 'pipeline.mjs', 'worker.mjs', 'build.mjs'].map(
          (name) => (
            <a key={name} href={'/literature/meowssiah/source/' + name} download={name}>
              {name}
            </a>
          ),
        )}
      </details>
      {desktop && footer}
    </Dialog>
  );
}
