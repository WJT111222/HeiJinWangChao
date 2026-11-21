import { useState, type ReactNode } from 'react';
import { editableVariablePath, pointer } from '../../domain/playerVariables';
import { labels, typeName } from './variableSections';

type Props = {
  path: string[];
  value: unknown;
  editorPath?: string;
  editor: ReactNode;
  choose: (path: string[]) => void;
  initialOpen?: boolean;
};

export function VariableTree({
  path,
  value,
  editorPath,
  editor,
  choose,
  initialOpen = false,
}: Props) {
  const [open, setOpen] = useState(initialOpen);
  const [limit, setLimit] = useState(24);
  const id = pointer(path);
  const key = path.at(-1)!;
  const editable = editableVariablePath(path);
  const title = labels[key] ?? key;
  const kind = typeName(value);
  const optionalAddress = path[0] === 'npc' && path.length === 3 && key === 'addressing';
  if ((value !== null && typeof value === 'object') || optionalAddress) {
    const fields = value as Record<string, unknown> | undefined;
    const actualKeys = Object.keys(fields ?? {});
    const keys = optionalAddress ? ['playerToNpc', 'npcToPlayer'] : [...actualKeys];
    if (path[0] === 'npc' && path.length === 2 && !actualKeys.includes('addressing'))
      keys.unshift('addressing');
    return (
      <li>
        <button
          className="vm-branch"
          aria-expanded={open}
          title={id}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {title}{' '}
          <small>
            {kind} · {actualKeys.length}
          </small>
        </button>
        {open && (
          <>
            {editable && (
              <button className="vm-edit-object" onClick={() => choose(path)}>
                编辑 {title} JSON
              </button>
            )}
            {editorPath === id && editor}
            <ul>
              {keys.slice(0, limit).map((name) => (
                <VariableTree
                  key={name}
                  path={[...path, name]}
                  value={fields?.[name]}
                  editorPath={editorPath}
                  editor={editor}
                  choose={choose}
                />
              ))}
            </ul>
            {limit < keys.length && (
              <button onClick={() => setLimit(limit + 24)}>显示更多字段</button>
            )}
          </>
        )}
      </li>
    );
  }
  return (
    <li className="vm-leaf">
      <div>
        <strong title={id}>{title}</strong>{' '}
        <small>
          {kind}
          {!editable && ' · 只读'}
        </small>
      </div>
      {editorPath === id ? (
        editor
      ) : editable ? (
        <button title={id} aria-label={`编辑 ${title}`} onClick={() => choose(path)}>
          {String(value ?? '尚未设置')} <span aria-hidden="true">✎</span>
        </button>
      ) : (
        <span>{String(value ?? '未设置')}</span>
      )}
    </li>
  );
}
