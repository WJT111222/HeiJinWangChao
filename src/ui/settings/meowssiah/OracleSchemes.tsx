import { useState } from 'react';
import { oracleDefinition, previousOracleVersion } from '../../../presets/meowssiah/definition';
import { oracleEdits } from '../../../presets/meowssiah/config';
import type { PackageOverride } from '../../../presets/package';

const key = 'heijin.' + oracleDefinition.id + '.schemes.' + oracleDefinition.version;
function read(): Record<string, PackageOverride> {
  const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem('heijin.' + oracleDefinition.id + '.schemes.' + previousOracleVersion) ?? '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('方案列表损坏');
  return Object.fromEntries(Object.entries(parsed).map(([name, value]) => [name, oracleEdits(value)]));
}
export function OracleSchemes({
  edits,
  apply,
}: {
  edits: PackageOverride;
  apply(value: PackageOverride): void;
}) {
  const [name, setName] = useState(''),
    [notice, setNotice] = useState('');
  const [schemes, setSchemes] = useState(() => {
    try {
      return Object.keys(read());
    } catch {
      return [];
    }
  });
  async function store(remove: boolean) {
    const id = name.trim();
    const change = () => {
      const entries = new Map(Object.entries(read()));
      if (remove) entries.delete(id);
      else {
        if (entries.has(id)) throw new Error('该方案名称已使用');
        entries.set(id, edits);
      }
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
      setSchemes([...entries.keys()]);
      setNotice(remove ? '方案已删除' : '方案已保存');
    };
    try {
      if (navigator.locks) await navigator.locks.request(key, change);
      else change();
    } catch (error) {
      setNotice(String(error));
    }
  }
  return (
    <section>
      <h3>我的方案</h3>
      <label>
        方案名称
        <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="oracle-actions">
        <button disabled={!name.trim()} onClick={() => void store(false)}>
          另存方案
        </button>
        <button disabled={!schemes.includes(name)} onClick={() => void store(true)}>
          删除选中方案
        </button>
        <button
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json' }),
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = '神域文学方案.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          导出 JSON
        </button>
      </div>
      {schemes.map((id) => (
        <button
          key={id}
          onClick={() => {
            try {
              apply(read()[id]);
              setName(id);
              setNotice('已载入，可编辑后保存');
            } catch (error) {
              setNotice(String(error));
            }
          }}
        >
          {id}
        </button>
      ))}
      <label>
        导入方案
        <input
          type="file"
          accept=".json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              if (file.size > 1048576) throw new Error('方案超过 1 MiB');
              apply(oracleEdits(JSON.parse(await file.text())));
              setNotice('已载入，可编辑后保存');
            } catch (error) {
              setNotice(String(error));
            }
          }}
        />
      </label>
      <p role="status">{notice}</p>
    </section>
  );
}
