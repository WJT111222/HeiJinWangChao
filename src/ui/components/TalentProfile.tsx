import { getTalentDefinition } from '../../domain/protagonist/talents';
import type { TalentDefinition, TalentId } from '../../domain/protagonist/talents';
import './talents.css';

/** The catalog owns all four descriptions; UI never keeps another text copy. */
export function TalentDescription({ definition }: { definition: TalentDefinition }) {
  return <div className="talent-description">
    <dl>
      <div><dt>能力介绍</dt><dd>{definition.introduction}</dd></div>
      <div><dt>长期影响</dt><dd>{definition.longTermImpact}</dd></div>
    </dl>
    <details className="talent-boundaries">
      <summary>专属机制与能力边界</summary>
      <dl>
        <div><dt>专属机制 · {definition.mechanismName}</dt><dd>{definition.mechanism}</dd></div>
        <div><dt>能力边界</dt><dd>{definition.boundary}</dd></div>
      </dl>
    </details>
  </div>;
}

/** A saved identity is display-only. Absent IDs do not acquire a default. */
export function TalentProfile({ talentId }: { talentId?: TalentId }) {
  const definition = getTalentDefinition(talentId);
  if (!definition) return null;
  return <section className="talent-profile" aria-label="开局天赋">
    <header className="talent-heading"><span className="talent-seal" aria-hidden="true">赋</span><div>
      <p>开局天赋 · {definition.coreDomain}</p>
      <h3>{definition.name}</h3>
    </div><span className="talent-readonly">只读</span></header>
    <TalentDescription definition={definition} />
  </section>;
}
