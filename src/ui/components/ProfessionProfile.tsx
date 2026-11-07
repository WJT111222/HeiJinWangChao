import type { Protagonist } from '../../domain/protagonist/schema';
import { Detail } from '../Dialog';

export function ProfessionProfile({ hero }: { hero: Pick<Protagonist, 'profession' | 'professionDescription' | 'professionLongTermImpact' | 'skills'> }) {
  return <section className="profession-profile" aria-label="职业档案">
    <h3>职业档案</h3>
    <dl>
      <Detail label="职业">{hero.profession}</Detail>
      <Detail label="职业介绍">{hero.professionDescription}</Detail>
      <Detail label="技能">{hero.skills.length ? <ul className="skill-tags">{hero.skills.map((skill, index) => <li key={index}>{skill}</li>)}</ul> : undefined}</Detail>
      <Detail label="长期影响">{hero.professionLongTermImpact}</Detail>
    </dl>
  </section>;
}
