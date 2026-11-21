import { useEffect, useMemo, useState } from 'react';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { GameState } from '../../domain/state';
import {
  atPath,
  changesBetween,
  editableVariablePath,
  editAtPath,
  parsePointer,
  pointer,
  validateVariableEdit,
} from '../../domain/playerVariables';
import type { SaveRepository, VariableSnapshot } from '../../services/storage/saveRepository';
import './variable-manager.css';

import { VariableTree } from './VariableTree';
import {
  json,
  registeredPaths,
  revisePath,
  rootsFor,
  sections,
  type Operation,
} from './variableSections';

const modes = ['结构树', '分区 JSON', '路径修订', '变量登记表'] as const;
type Mode = (typeof modes)[number];
type Editor = {
  path: string;
  value: string;
  initial: string;
  format: 'string' | 'number' | 'boolean' | 'json';
};
type Props = {
  repository: SaveRepository;
  saveId: string;
  onSaved: (result: VariableSnapshot) => void;
  onDirtyChange: (dirty: boolean) => void;
  companion?: CompanionProfile;
  instance?: string;
};
export function VariableManager({
  repository,
  saveId,
  onSaved,
  onDirtyChange,
  companion,
  instance,
}: Props) {
  const [base, setBase] = useState<VariableSnapshot>();
  const [working, setWorking] = useState<GameState>();
  const [section, setSection] = useState('主角');
  const [mode, setMode] = useState<Mode>('结构树');
  const [editor, setEditor] = useState<Editor>();
  const [operation, setOperation] = useState<Operation>('set');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    repository
      .loadVariableSnapshot(saveId)
      .then((s) => {
        if (!active) return;
        if (s.instance !== instance) {
          setMessage('此存档已被替换，请重新进入游戏后查看。');
          return;
        }
        setBase(s);
        setWorking(s.state);
        setMode('结构树');
        setEditor(undefined);
      })
      .catch(() => {
        if (active) setMessage('读取存档失败。请检查存档后重新读取。');
      });
    return () => {
      active = false;
    };
  }, [repository, saveId, reload, instance]);
  const changes = useMemo(
    () => (base && working ? changesBetween(base.state, working) : []),
    [base, working],
  );
  const typing = Boolean(editor && editor.value !== editor.initial);
  const dirty = changes.length > 0 || typing;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const registry = useMemo(
    () => (working && mode === '变量登记表' ? registeredPaths(working, query, limit) : []),
    [working, mode, query, limit],
  );
  function canNavigate() {
    if (!typing) return true;
    setMessage('请先加入或取消正在编辑的值。');
    return false;
  }
  function startEditor(path: string, initial: string, format: Editor['format'] = 'json') {
    setEditor({ path, initial, value: initial, format });
    setMessage('');
  }
  function choose(path: string[]) {
    if (!canNavigate()) return;
    const value = atPath(working, path);
    const optionalDirection = path[0] === 'npc' && path.length === 4 && path[2] === 'addressing';
    const kind = optionalDirection ? 'string' : typeof value;
    const format = kind === 'string' || kind === 'number' || kind === 'boolean' ? kind : 'json';
    startEditor(
      pointer(path),
      format === 'json' ? json(value) || '{}' : String(value ?? ''),
      format,
    );
  }
  function navigate(nextSection: string, nextMode: Mode, path?: string) {
    if (!working || !canNavigate()) return;
    setSection(nextSection);
    setMode(nextMode);
    setOperation('set');
    setMessage('');
    const roots = rootsFor(working, nextSection);
    if (nextMode === '分区 JSON') {
      const sectionValue = Object.fromEntries(roots.map((key) => [key, atPath(working, [key])]));
      startEditor('', json(sectionValue));
    } else if (nextMode === '路径修订') {
      const target = path ?? pointer([roots[0]]);
      startEditor(target, json(atPath(working, parsePointer(target))));
    } else setEditor(undefined);
  }
  function stage() {
    if (!working || !editor) return;
    try {
      let value: unknown;
      if (editor.format === 'string') value = editor.value;
      else if (mode !== '路径修订' || operation !== 'delete') {
        try {
          value = JSON.parse(editor.value);
        } catch {
          throw new Error('JSON 格式无效。请检查输入后再加入修改。');
        }
      }
      let next = working;
      if (mode === '分区 JSON') {
        const roots = rootsFor(working, section);
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).length !== roots.length ||
          !roots.every((key) => Object.hasOwn(value, key))
        )
          throw new Error('请保留当前分区的根字段；其他分区请分别编辑。');
        next = { ...working, ...value };
      } else {
        const path = parsePointer(editor.path);
        if (!editableVariablePath(path)) throw new Error('此路径由专用事务维护，仅供查看。');
        if (
          mode === '结构树' &&
          path.length === 4 &&
          path[0] === 'npc' &&
          path[2] === 'addressing' &&
          atPath(working, path.slice(0, 3)) === undefined
        )
          next = editAtPath(working, pointer(path.slice(0, 3)), { [path[3]]: value });
        else
          next = revisePath(working, editor.path, mode === '路径修订' ? operation : 'set', value);
      }
      setWorking(next);
      setEditor(undefined);
      setMode('结构树');
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '路径或数值无效。');
    }
  }
  async function save() {
    if (!working || !base || saving || typing) return;
    setSaving(true);
    try {
      const result = await repository.savePlayerVariables(
        base,
        validateVariableEdit(base.state, working),
      );
      setBase(result);
      setWorking(result.state);
      setMode('结构树');
      setEditor(undefined);
      setMessage('已保存。下一次生成将读取当前变量。');
      onSaved(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。修改仍保留在此页。');
    } finally {
      setSaving(false);
    }
  }
  const readAgain = (
    <button
      disabled={dirty || saving}
      onClick={() => {
        setMessage('');
        setReload((i) => i + 1);
      }}
    >
      重新读取
    </button>
  );
  if (!base || !working)
    return (
      <div>
        <p role="status">{message || '正在读取当前存档…'}</p>
        {readAgain}
      </div>
    );
  const roots = rootsFor(working, section);
  const readOnlySection = mode === '分区 JSON' && !roots.some((key) => editableVariablePath([key]));
  const changeText = (value: string) => editor && setEditor({ ...editor, value });
  const editForm = editor && (
    <div className="variable-editor">
      {mode === '路径修订' ? (
        <>
          <label>
            变量路径
            <input
              disabled={typing}
              value={editor.path}
              onChange={(e) =>
                setEditor({ ...editor, path: e.target.value, value: '', initial: '' })
              }
            />
          </label>
          <label>
            修订操作
            <select
              disabled={typing}
              value={operation}
              onChange={(e) => {
                const op = e.target.value as Operation;
                setOperation(op);
                setEditor({ ...editor, value: '', initial: '' });
              }}
            >
              <option value="set">设置值</option>
              <option value="add">数值增减</option>
              <option value="push">追加数组元素</option>
              <option value="delete">删除字段或元素</option>
            </select>
          </label>
          <button
            disabled={typing || operation !== 'set'}
            onClick={() => {
              try {
                startEditor(editor.path, json(atPath(working, parsePointer(editor.path))));
              } catch {
                setMessage('变量路径无效。');
              }
            }}
          >
            读取路径当前值
          </button>
        </>
      ) : (
        mode === '结构树' && <code>{editor.path}</code>
      )}
      {(mode !== '路径修订' || operation !== 'delete') && (
        <label>
          {mode === '分区 JSON'
            ? '原始分区 JSON'
            : editor.format === 'json'
              ? '变量值（JSON）'
              : '变量值'}
          {editor.format === 'boolean' ? (
            <select value={editor.value} onChange={(e) => changeText(e.target.value)}>
              <option>true</option>
              <option>false</option>
            </select>
          ) : editor.format === 'number' ? (
            <input
              type="number"
              step="any"
              value={editor.value}
              onChange={(e) => changeText(e.target.value)}
            />
          ) : (
            <textarea
              readOnly={readOnlySection}
              rows={mode === '分区 JSON' ? 12 : editor.format === 'json' ? 5 : 2}
              value={editor.value}
              onChange={(e) => changeText(e.target.value)}
            />
          )}
        </label>
      )}
      {editor.path.endsWith('/addressing') && (
        <small>
          playerToNpc 是主角称呼此人，npcToPlayer 是此人称呼主角。省略某个键可取消该方向的固定称呼。
        </small>
      )}
      {readOnlySection && <small>这个分区由专用事务维护，仅供查阅。</small>}
      {message && <p role="status">{message}</p>}
      <div className="vm-actions">
        <button disabled={readOnlySection} onClick={stage}>
          加入待保存修改
        </button>
        <button
          onClick={() => {
            setEditor(undefined);
            setMode('结构树');
            setMessage('');
          }}
        >
          取消编辑
        </button>
      </div>
    </div>
  );
  return (
    <section className="variable-manager">
      <header className="vm-header">
        <strong>{base.state.title}</strong>
        <span>第 {base.state.turnNumber} 回合</span>
      </header>
      <fieldset disabled={saving} className="vm-workspace">
        <nav className="vm-domains" aria-label="变量分区">
          {sections.map((name) => (
            <button key={name} aria-pressed={section === name} onClick={() => navigate(name, mode)}>
              {name}
            </button>
          ))}
        </nav>
        <div className="vm-content">
          <h4>{section}</h4>
          <div className="vm-modes" role="group" aria-label="编辑方式">
            {modes.map((name) => (
              <button
                key={name}
                aria-pressed={mode === name}
                onClick={() => navigate(section, name)}
              >
                {name}
              </button>
            ))}
          </div>
          {mode === '结构树' && (
            <ul className="variable-tree">
              {roots.map((key) => (
                <VariableTree
                  key={key}
                  path={[key]}
                  value={atPath(working, [key])}
                  initialOpen={key === 'protagonist' || key === 'npc'}
                  editor={editForm}
                  editorPath={editor?.path}
                  choose={choose}
                />
              ))}
            </ul>
          )}
          {(mode === '分区 JSON' || mode === '路径修订') && editForm}
          {mode === '变量登记表' && (
            <div className="vm-registry">
              <label>
                检索全档路径
                <input
                  type="search"
                  placeholder="/npc/"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(40);
                  }}
                />
              </label>
              <ul>
                {registry.slice(0, limit).map((row) => {
                  const path = pointer(row.path);
                  return (
                    <li key={path}>
                      <code>{path}</code>
                      <small>{row.type}</small>
                      {editableVariablePath(row.path) ? (
                        <button
                          aria-label={`修订 ${path}`}
                          onClick={() =>
                            navigate(
                              sections.find((name) =>
                                rootsFor(working, name).includes(row.path[0]),
                              )!,
                              '路径修订',
                              path,
                            )
                          }
                        >
                          修订
                        </button>
                      ) : (
                        <small>只读</small>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!registry.length && <p>没有匹配的变量路径。</p>}
              {registry.length > limit && (
                <button onClick={() => setLimit(limit + 40)}>显示更多路径</button>
              )}
            </div>
          )}
          {section === '人物' && companion && (
            <details>
              <summary>初始同伴创角资料（只读）</summary>
              <pre>{json({ name: companion.name, ...companion.profile })}</pre>
            </details>
          )}
        </div>
      </fieldset>
      {changes.length > 0 && (
        <section aria-label="修改差异" className="vm-diff">
          <h4>待保存修改 · {changes.length}</h4>
          {changes.map((c) => (
            <div key={pointer(c.path)}>
              <code>{pointer(c.path)}</code>
              <pre>
                {json(c.before) || '未设置'} → {json(c.after) || '移除'}
              </pre>
            </div>
          ))}
          <p>
            保存后保留本轮行动，清除基于旧变量的未结算正文和候选。撤回或恢复历史节点时，将读取该时点的变量。
          </p>
        </section>
      )}
      {!editor && <p role="status">{message}</p>}
      <footer className="vm-actions">
        <button
          className="primary"
          disabled={!changes.length || typing || saving}
          onClick={() => void save()}
        >
          保存变量修改
        </button>
        <button
          disabled={saving || (!dirty && !editor)}
          onClick={() => {
            setWorking(base.state);
            setEditor(undefined);
            setMode('结构树');
            setMessage('');
          }}
        >
          放弃修改
        </button>
        {readAgain}
      </footer>
    </section>
  );
}
