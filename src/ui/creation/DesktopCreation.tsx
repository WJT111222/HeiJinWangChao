// 电脑端（≥901px）创角五步的展示组件。只读取 Creation 草稿，不写入任何新字段。
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { CITY_TICKET_META, skyline } from '../home/skyline';
import { cities, professionProfile } from './model';
import type { Creation } from './model';
import { creationCity } from './MobileCreation';

export const creationSteps = ['基本信息', '职业与能力', '城市与背景', '初始同伴', '确认与开局'] as const;
const stampMarks = ['基', '职', '城', '伴', '启'];
export const creationStepHints = [
  '姓名、年龄、性别是必填；外貌与性格可选模板后改写。',
  '选择一种职业，或自由填写。职业影响 AI 对人物经历与能力的理解。',
  '人物从哪座城市开始，以及可选的人物背景。',
  '可选。同伴会作为特殊 NPC 进入故事。',
  '核对档案。确认后立档并自动开始开局。',
];

/** 城市色只在走到第 3 步（城市与背景）之后才写上档案，和手机端车票一致。 */
export function creationTint(form: Creation) {
  return form.step >= 3 ? CITY_TICKET_META[creationCity[form.city]].tint : '#C9A961';
}

/** 左侧人物档案：右侧填什么，这里就实时写上什么。纯展示，屏幕阅读器直接读右侧表单。 */
export function CreationDossier({ form, busy }: { form: Creation; busy: boolean }) {
  const profile = professionProfile(form), city = cities.find(item => item.id === form.city);
  const meta = CITY_TICKET_META[creationCity[form.city]], cityOn = form.step >= 3;
  const companion = [form.companion.name, form.companion.identity, form.companion.relationship].filter(text => text.trim()).join(' · ');
  const text = (value: string, pending = '（待填）') => value.trim() ? <dd>{value}</dd> : <dd className="pending">{pending}</dd>;
  const para = (value: string, pending = '（待填）') => <p className={`dz-text${value.trim() ? '' : ' pending'}`}>{value.trim() || pending}</p>;
  return <aside className="creation-dossier" aria-hidden="true">
    <div className="dz-band"><b>人物档案</b><small>黑金王朝 · 立档处</small>
      <span className="dz-no">No. {form.saveId.replace(/[^0-9a-z]/gi, '').slice(-4).toUpperCase() || '0000'}-{cityOn ? creationCity[form.city].toUpperCase() : '—'}</span></div>
    <div className="dz-body">
      <div className="dz-top">
        <div className={`dz-photo${form.person.name.trim() ? '' : ' empty'}`}>{[...form.person.name.trim()][0] ?? '人'}
          <span className={`dz-city-seal${cityOn ? ' on' : ''}`}>{meta.seal}</span></div>
        <dl className="dz-fields">
          <div className="wide"><dt>姓名</dt>{text(form.person.name)}</div>
          <div><dt>年龄</dt>{text(form.person.age ? `${form.person.age} 岁` : '')}</div>
          <div><dt>性别</dt>{text(form.person.gender)}</div>
          <div><dt>职业</dt>{text(profile.name)}</div>
          <div><dt>起点城市</dt>{text(cityOn ? city?.name ?? '' : '')}</div>
        </dl>
      </div>
      <h3 className="dz-sec">外貌</h3>{para(form.person.appearance)}
      <h3 className="dz-sec">性格</h3>{para(form.person.personality)}
      {profile.skills.length > 0 && <><h3 className="dz-sec">职业技能</h3>
        <div className="dz-skills">{profile.skills.slice(0, 6).map((skill, index) => <span key={index}>{skill}</span>)}</div></>}
      {form.background.trim() && <><h3 className="dz-sec">人物背景</h3>{para(form.background)}</>}
      <h3 className="dz-sec">初始同伴</h3>{form.hasCompanion ? para(companion) : <p className="dz-text pending">未创建同伴</p>}
      <div className="dz-stamps">
        {stampMarks.map((mark, index) => <span key={mark} title={creationSteps[index]}
          className={`dz-stamp${index + 1 < form.step || (busy && index === 4) ? ' done' : form.step === index + 1 ? ' current' : ''}`}>{mark}</span>)}
        <span className="dz-stamp-note">每完成一步<br />盖一枚章</span>
      </div>
    </div>
    <div className={`dz-big-seal${busy && form.step === 5 ? ' on' : form.step === 5 ? ' wait' : ''}`}>立档<small>HEIJIN</small></div>
  </aside>;
}

/** 外貌 / 性格模板小卡：单选组语义，与手机端模板条相同（方向键、Home、End 切换）。 */
export function TemplateCards({ label, value, options, onChange }: {
  label: string; value: string; options: readonly { name: string; description: string }[]; onChange: (value: string) => void;
}) {
  const items = [{ value: 'custom', name: '自由选择', description: '不套模板，自己写' }, ...options.map(option => ({ value: option.name, ...option }))];
  const current = items.some(item => item.value === value) ? value : 'custom';
  return <div className="creation-template-cards" role="radiogroup" aria-label={label}>
    {items.map((item, index) => <button type="button" role="radio" key={item.value} aria-checked={current === item.value}
      tabIndex={current === item.value ? 0 : -1} className={item.value === 'custom' ? 'free' : undefined} title={item.description}
      onClick={() => onChange(item.value)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (back ? -1 : 1) + items.length) % items.length;
        onChange(items[next].value);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}>
      <b>{item.name}</b><span aria-hidden="true">{item.description}</span>
    </button>)}
  </div>;
}

/** 城市卡顶部的天际线、城市印与经度；沿用首页同一套确定性剪影。 */
export function CityCardArt({ city, selected }: { city: Creation['city']; selected: boolean }) {
  const key = creationCity[city], meta = CITY_TICKET_META[key];
  const svg = useMemo(() => skyline(key, 'aria-hidden="true" focusable="false"', false), [key]);
  return <span className="creation-city-art" aria-hidden="true" style={{ '--c': meta.tint } as CSSProperties}>
    <span className="creation-city-sky" dangerouslySetInnerHTML={{ __html: svg }} />
    <span className="creation-city-seal">{meta.seal}</span>
    <span className="creation-city-lon">{meta.longitude}</span>
    {selected && <span className="creation-city-start">起点</span>}
  </span>;
}
