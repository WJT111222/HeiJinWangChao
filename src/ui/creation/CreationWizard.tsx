import { useState } from 'react';
import { cities, professions, professionName, validateStep } from './model';
import type { Creation } from './model';
import { Detail } from '../Dialog';
import { dateTime } from '../panels/playerView';

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
  const person = (key: keyof Creation['person'], label: string, multiline = false) => (
    <label key={key}>
      {label}
      {multiline ? (
        <textarea
          value={form.person[key]}
          onChange={(e) => change({ person: { ...form.person, [key]: e.target.value } })}
          rows={4}
        />
      ) : (
        <input
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
              {person('gender', '性别')}
              <p className="field-hint">性别、外貌与性格都可以自由填写。家庭与经历留到第三步。</p>
              {person('appearance', '外貌', true)}
              {person('personality', '性格', true)}
            </div>
          )}
          {form.step === 2 && (
            <>
              <p className="muted">职业意味着经历与专长，不决定你接下来要走的路。</p>
              <fieldset className="profession-list">
                <legend className="sr-only">选择职业</legend>
                {professions.map((job) => (
                  <label
                    className={`choice-card ${form.profession === job.name ? 'selected' : ''}`}
                    key={job.name}
                  >
                    <input
                      type="radio"
                      name="profession"
                      value={job.name}
                      checked={form.profession === job.name}
                      onChange={() =>
                        change({
                          profession: job.name,
                          skills: form.skills.trim() ? form.skills : job.abilities,
                        })
                      }
                    />
                    <strong>{job.name}</strong>
                    <p>
                      <b>职业介绍</b>
                      {job.description}
                    </p>
                    <p>
                      <b>能力与特长</b>
                      {job.abilities}
                    </p>
                  </label>
                ))}
                <label className={`choice-card ${form.profession === 'custom' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="profession"
                    checked={form.profession === 'custom'}
                    onChange={() => change({ profession: 'custom' })}
                  />
                  <strong>自定义职业</strong>
                  <p>以你自己的文字描述职业与专业经历。</p>
                </label>
              </fieldset>
              {form.profession === 'custom' && (
                <label>
                  自定义职业名称
                  <input
                    value={form.customProfession}
                    onChange={(e) => change({ customProfession: e.target.value })}
                    required
                  />
                </label>
              )}
              <label>
                个人技能与专长
                <textarea
                  rows={4}
                  value={form.skills}
                  onChange={(e) => change({ skills: e.target.value })}
                  placeholder="可编辑或补充，一行一项"
                />
              </label>
              <p className="field-hint">切换职业会保留你已经填写的技能，请按需要调整。</p>
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
              <div className="two-grid">
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
                  </dl>
                </section>
                <section className="card">
                  <div className="section-heading">
                    <h3>职业与起点</h3>
                    <button type="button" onClick={() => move(2)}>
                      修改职业
                    </button>
                  </div>
                  <dl>
                    <Detail label="职业">{professionName(form)}</Detail>
                    <Detail label="技能">{form.skills}</Detail>
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
                  <p>初始游戏时间：{dateTime(form.worldClock)}</p>
                  <p className="muted">
                    时间以创角开始时刻初始化；之后不会随现实时间自动推进。资产、健康与天气等待开局确认，同伴关系倾向暂不作推断。
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
              <p className="notice">
                本阶段只创建存档。AI 开局生成将在后续阶段开放，不会自动生成剧情、财富或装备。
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
          <button className="primary" disabled={busy} type="submit">
            {busy ? '正在保存…' : form.step === 5 ? '确认并创建存档' : '下一步 →'}
          </button>
        </footer>
      </form>
    </main>
  );
}
