import { useId, useRef } from 'react';
import { talentDefinitions } from '../../domain/protagonist/talents';
import type { TalentId } from '../../domain/protagonist/talents';
import { TalentDescription } from '../components/TalentProfile';

export function TalentPicker({ value, onChange }: { value?: TalentId; onChange: (id?: TalentId) => void }) {
  const hint = useId();
  const none = useRef<HTMLInputElement>(null);
  return <fieldset className="talent-picker" aria-describedby={hint}>
    <legend>开局天赋（可选）</legend>
    <p id={hint} className="talent-hint">最多选择一种，也可以完全不选。不限制职业或城市；正式建档后不可更换。</p>
    <label className={`talent-none${value === undefined ? ' selected' : ''}`}>
      <input ref={none} type="radio" name="opening-talent" checked={value === undefined} onChange={() => onChange()} />
      <span>不选择天赋<small>保留空白，由自己的行动书写人生。</small></span>
    </label>
    <div className="talent-grid">
      {talentDefinitions.map((definition, index) => <article className={`talent-card${value === definition.id ? ' selected' : ''}`} key={definition.id}>
        <label className="talent-choice">
          <input type="radio" name="opening-talent" aria-label={definition.name} checked={value === definition.id} onChange={() => onChange(definition.id)} />
          <span><b>{definition.name}</b><small>{definition.coreDomain}</small><em>{definition.mechanismName}</em></span>
          <span className="talent-index" aria-hidden="true">0{index + 1}</span>
        </label>
        <TalentDescription definition={definition} />
        {value === definition.id && <button className="talent-clear" type="button" aria-label={`取消选择${definition.name}`} onClick={() => { onChange(); none.current?.focus(); }}>取消选择</button>}
      </article>)}
    </div>
  </fieldset>;
}
