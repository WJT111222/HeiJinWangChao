import { useState } from 'react';
import { cities, professions, professionCategories, professionProfile, validateStep, selectProfession } from './model';
import type { Creation } from './model';
import { Detail } from '../Dialog';
import { dateTime } from '../panels/playerView';

import { appearanceTemplates, personalityTemplates } from './personTemplates';
import { ThemedSelect } from '../components/ThemedSelect';
import { ProfessionProfile } from '../components/ProfessionProfile';
import { OpeningPacks } from './OpeningPacks';

const steps = ['基本信息', '职业与能力', '城市与背景', '初始同伴', '确认与开局'];
export function CreationWizard({
  form,
  onChange,
  onCreate,
  busy,
  onExit,
}: {
  form: Creation;
  onChange: (form: Creation) => void;
  onCreate: () => void;
  busy: boolean;
  onExit: () => void;
}) {
  const [error, setError] = useState('');
  const change = (patch: Partial<Creation>) => onChange({ ...form, ...patch });
  function move(step: number) {
    try {
      if (step > form.step) validateStep(form);
      setError('');
      change({ step });
    } catch (e) {
      setError(e instanceof Error ? e.message : '请检查填写内容');
    }
  }
  const profile = professionProfile(form);
  const category = form.professionCategory ?? professionCategories[0];
  const person = (key: keyof Creation['person'], label: string, multiline = false) => (
    <label key={key}>
      {label}
      {multiline ? (
        <textarea
          aria-label={label}
          value={form.person[key]}
          onChange={(e) => change({ person: { ...form.person, [key]: e.target.value } })}
          rows={4}
        />
      ) : (
        <input
          aria-label={label}
          value={form.person[key]}
          onChange={(e) => change({ person: { ...form.person, [key]: e.target.value } })}
          type={key === 'age' ? 'number' : 'text'}
          min={key === 'age' ? 0 : undefined}
          required={['name', 'age', 'gender'].includes(key)}
        />
      )}
    </label>
  );
  const companion = (key: keyof Creation['companion'], label: string, multiline = false) => (
    <label key={key}>
      {label}
      {multiline ? (
        <textarea
          rows={3}
          value={form.companion[key]}
          onChange={(e) => change({ companion: { ...form.companion, [key]: e.target.value } })}
        />
      ) : (
        <input
          type={key === 'age' ? 'number' : 'text'}
          min={key === 'age' ? 0 : undefined}
          required={['name', 'relationship'].includes(key)}
          value={form.companion[key]}
          onChange={(e) => change({ companion: { ...form.companion, [key]: e.target.value } })}
        />
      )}
    </label>
  );
  return (
    <main className="creation-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">A LIFE, UNWRITTEN</p>
          <h1>写下你是谁。</h1>
          <p className="muted">从一座真实的城市开始。此后的人生，由你选择。</p>
        </div>
        <button onClick={onExit} disabled={busy}>
          返回首页
        </button>
      </div>
      <nav className="steps" aria-label="角色创建步骤">
        {steps.map((label, index) => (
          <button
            disabled={busy}
            key={label}
            aria-current={form.step === index + 1 ? 'step' : undefined}
            onClick={() => move(index + 1)}
          >
            <span>0{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <OpeningPacks form={form} onApply={onChange} busy={busy} />
      <form
        inert={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (form.step < 5) move(form.step + 1);
          else {
            for (let step = 1; step <= 4; step++) {
              try {
                validateStep(form, step);
              } catch (e) {
                setError(e instanceof Error ? e.message : '请检查填写内容');
                change({ step });
                return;
              }
            }
            onCreate();
          }
        }}
      >
        <div className="creation-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">STEP 0{form.step} / 05</p>
              <h2>{steps[form.step - 1]}</h2>
            </div>
            <span className="tag">填写内容自动保留</span>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {form.step === 1 && (
            <div className="form-grid">
              {person('name', '姓名')}
              {person('age', '年龄')}
              <fieldset className="creation-gender">
                <legend>性别</legend>
                <div className="creation-options">
                  {['男性', '女性'].map((gender) => <label key={gender} className="creation-choice">
                    <input type="radio" name="gender" value={gender} required checked={form.person.gender === gender}
                      onChange={() => change({ person: { ...form.person, gender } })} />{gender}
                  </label>)}
                </div>
              </fieldset>
              <div className="creation-templates">
                {(['appearance', 'personality'] as const).map((field) => {
                  const label = field === 'appearance' ? '外貌' : '性格';
                  const templates = field === 'appearance' ? appearanceTemplates : personalityTemplates;
                  const key = field === 'appearance' ? 'appearanceTemplate' : 'personalityTemplate';
                  return <div key={field}>
                    <ThemedSelect label={`${label}模板`} value={form[key] ?? 'custom'}
                      options={[{ value: 'custom', label: '自由选择' }, ...templates.map((item) => ({ value: item.name, label: item.name }))]}
                      onChange={(value) => change({ [key]: value, person: { ...form.person,
                        [field]: templates.find((item) => item.name === value)?.description ?? form.person[field] } })} />
                    {person(field, label, true)}
                  </div>;
                })}
              </div>
            </div>
          )}
          {form.step === 2 && (
            <>
              <fieldset className="profession-picker">
                <legend className="sr-only">选择职业</legend>
                <label className="creation-choice">
                  <input type="radio" name="profession" checked={form.profession === 'custom'}
                    onChange={() => onChange(selectProfession(form, 'custom'))} />自由选择
                </label>
                <nav className="profession-categories" aria-label="职业方向">
                  {professionCategories.map((name) => <button type="button" key={name}
                    aria-pressed={category === name} onClick={() => change({ professionCategory: name })}>{name}</button>)}
                </nav>
                <div className="profession-buttons">
                  {professions.filter((job) => job.category === category).map((job) => <label
                    className="creation-choice" key={job.name}>
                    <input type="radio" name="profession" checked={form.profession === job.name}
                      onChange={() => onChange(selectProfession(form, job.name))} />{job.name}
                  </label>)}
                </div>
              </fieldset>
              {form.profession === 'custom' ? <div className="custom-profession">
                <label>职业名称<input value={form.customProfession} required
                  onChange={(e) => change({ customProfession: e.target.value })} /></label>
                <label>职业介绍<textarea aria-label="职业介绍" rows={5} value={form.professionDescription ?? ''}
                  onChange={(e) => change({ professionDescription: e.target.value })} /></label>
                <label>内置职业技能<textarea aria-label="内置职业技能" rows={4} value={form.skills} placeholder="每行一项"
                  onChange={(e) => change({ skills: e.target.value, skillsSource: 'manual' })} /></label>
                <label>长期影响<textarea aria-label="长期影响" rows={5} value={form.professionLongTermImpact ?? ''}
                  onChange={(e) => change({ professionLongTermImpact: e.target.value })} /></label>
              </div> : <>
                <ProfessionProfile hero={{ profession: profile.name, professionDescription: profile.description,
                  professionLongTermImpact: profile.longTermImpact, skills: profile.skills }} />
                <label>个人技能与专长<textarea aria-label="个人技能与专长" rows={3} value={form.skills} placeholder="每行一项"
                  onChange={(e) => change({ skills: e.target.value, skillsSource: 'manual' })} /></label>
              </>}
            </>
          )}
          {form.step === 3 && (
            <div className="city-stage">
              <section>
                <p className="muted">选择起点，不限制未来的目的地。</p>
                <fieldset className="city-list">
                  <legend className="sr-only">初始城市</legend>
                  {cities.map((city) => (
                    <label
                      className={`choice-card city-card ${form.city === city.id ? 'selected' : ''}`}
                      key={city.id}
                    >
                      <input
                        type="radio"
                        name="city"
                        checked={form.city === city.id}
                        onChange={() => change({ city: city.id })}
                      />
                      <small>{city.label}</small>
                      <strong>{city.name}</strong>
                      <p>{city.description}</p>
                    </label>
                  ))}
                </fieldset>
              </section>
              <section className="background-box">
                <label>
                  人物背景（可选）
                  <textarea
                    rows={5}
                    value={form.background}
                    onChange={(e) => change({ background: e.target.value })}
                    placeholder="家庭、工作经历、个人秘密……也可以留白。切换城市不会改写这里的内容。"
                  />
                </label>
                <button type="button" className="text-button" onClick={() => move(4)}>
                  跳过背景，继续
                </button>
              </section>
            </div>
          )}
          {form.step === 4 && (
            <>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.hasCompanion}
                  onChange={(e) => change({ hasCompanion: e.target.checked })}
                />
                <span>创建一名初始同伴</span>
              </label>
              <p className="muted">
                可完全跳过。同伴将作为特殊 NPC 保存；开局保护规则将在 AI 接入后执行。
              </p>
              {form.hasCompanion && (
                <div className="form-grid">
                  {companion('name', '同伴姓名')}
                  {companion('age', '同伴年龄（可选）')}
                  {companion('identity', '同伴身份')}
                  {companion('relationship', '与主角的关系')}
                  {companion('appearance', '同伴外貌', true)}
                  {companion('personality', '同伴性格', true)}
                  {companion('skills', '同伴能力（一行一项）', true)}
                  {companion('background', '同伴个人经历', true)}
                </div>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setError('');
                  change({ hasCompanion: false, step: 5 });
                }}
              >
                跳过同伴，继续
              </button>
            </>
          )}
          {form.step === 5 && (
            <>
              <div className="two-grid creation-review">
                <section className="card">
                  <div className="section-heading">
                    <h3>人物资料</h3>
                    <button type="button" onClick={() => move(1)}>
                      修改基本信息
                    </button>
                  </div>
                  <dl>
                    <Detail label="姓名">{form.person.name}</Detail>
                    <Detail label="年龄">{form.person.age}</Detail>
                    <Detail label="性别">{form.person.gender}</Detail>
                    <Detail label="外貌">{form.person.appearance}</Detail>
                    <Detail label="性格">{form.person.personality}</Detail>
                    <Detail label="外貌模板">{form.appearanceTemplate === 'custom' ? '自由选择' : form.appearanceTemplate}</Detail>
                    <Detail label="性格模板">{form.personalityTemplate === 'custom' ? '自由选择' : form.personalityTemplate}</Detail>
                  </dl>
                </section>
                <section className="card">
                  <div className="section-heading">
                    <h3>职业与起点</h3>
                    <button type="button" onClick={() => move(2)}>
                      修改职业
                    </button>
                  </div>
                  <ProfessionProfile hero={{ profession: profile.name, professionDescription: profile.description,
                    professionLongTermImpact: profile.longTermImpact, skills: profile.skills }} />
                  <details>
                    <summary>完整职业表单</summary>
                    <dl>
                      <Detail label="职业分类">{form.professionCategory}</Detail>
                      <Detail label="技能模式">{form.skillsSource === 'manual' ? '手动技能' : form.skillsSource === 'automatic' ? '自动技能' : '未设置'}</Detail>
                      <Detail label="技能原文">{form.skills}</Detail>
                      <Detail label="自定义职业">{form.customProfession}</Detail>
                      <Detail label="自定义介绍">{form.professionDescription}</Detail>
                      <Detail label="自定义长期影响">{form.professionLongTermImpact}</Detail>
                    </dl>
                    {form.customProfile && <section aria-label="保留的自定义职业">
                      <h4>保留的自定义职业</h4>
                      <dl>{Object.entries({ 名称: form.customProfile.name, 介绍: form.customProfile.description,
                        技能: form.customProfile.skills, 长期影响: form.customProfile.longTermImpact }).map(([label, value]) =>
                        <Detail label={label} key={label}>{value}</Detail>)}</dl>
                    </section>}
                  </details>
                  <dl>
                    <Detail label="城市">{cities.find((c) => c.id === form.city)?.name}</Detail>
                    <Detail label="人物背景">{form.background}</Detail>
                  </dl>
                  <button type="button" onClick={() => move(3)}>
                    修改城市与背景
                  </button>
                </section>
                <section className="card">
                  <div className="section-heading">
                    <h3>初始同伴</h3>
                    <button type="button" onClick={() => move(4)}>
                      修改同伴
                    </button>
                  </div>
                  {form.hasCompanion ? (
                    <dl>
                      {Object.entries({
                        姓名: form.companion.name,
                        年龄: form.companion.age,
                        身份: form.companion.identity,
                        外貌: form.companion.appearance,
                        性格: form.companion.personality,
                        能力: form.companion.skills,
                        个人经历: form.companion.background,
                        与主角的关系: form.companion.relationship,
                      }).map(([label, value]) => (
                        <Detail key={label} label={label}>
                          {value}
                        </Detail>
                      ))}
                    </dl>
                  ) : (
                    <p className="muted">未创建同伴</p>
                  )}
                </section>
                <section className="card">
                  <h3>开局准备</h3>
                  <p>{form.openingTimePending ? '开局时间待确认' : `初始游戏时间：${dateTime(form.worldClock)}`}</p>
                  <p className="muted">
                    可以在开局偏好中指定故事年份、季节或日期；未指定时由 AI 在开局正文中根据剧情安排。请用明确年份，不以设备日期解释“今年”。首次正式结算后时间成为存档事实。资产、健康与天气等待开局确认，同伴关系倾向暂不作推断。
                  </p>
                </section>
              </div>
              <label>
                开局偏好（可选）
                <textarea
                  value={form.openingPreference}
                  onChange={(e) => change({ openingPreference: e.target.value })}
                  rows={4}
                  placeholder="对故事起点的期待，将随开局草稿保存。"
                />
              </label>
              <p className="notice" id="opening-generation-notice">
                确认后创建存档并自动开始开局，可能产生第三方 API 费用。按已启用的阶段顺序生成候选，不会自动结算；未配置 AI 时会安全停止，设置后由你主动继续。
              </p>
            </>
          )}
        </div>
        <footer className="wizard-footer">
          <button
            type="button"
            disabled={form.step === 1 || busy}
            onClick={() => move(form.step - 1)}
          >
            上一步
          </button>
          <span>0{form.step} / 05</span>
          <button className="primary" disabled={busy} type="submit" aria-describedby={form.step === 5 ? 'opening-generation-notice' : undefined}>
            {busy ? '正在保存…' : form.step === 5 ? '确认并创建存档' : '下一步 →'}
          </button>
        </footer>
      </form>
    </main>
  );
}
