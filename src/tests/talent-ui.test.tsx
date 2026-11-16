import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { talentDefinitions } from '../domain/protagonist/talents';
import { TalentPicker } from '../ui/creation/TalentPicker';
import { TalentProfile } from '../ui/components/TalentProfile';
import { CreationWizard } from '../ui/creation/CreationWizard';
import { CreationDossier } from '../ui/creation/DesktopCreation';
import { FullCreationTicket } from '../ui/creation/MobileCreation';
import { ProfilePanel } from '../ui/panels/ProfilePanel';
import { buildCreationState, newCreation, selectProfession } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';

const noop = () => {};
const fields = ['introduction', 'longTermImpact', 'mechanism', 'boundary'] as const;
afterEach(() => vi.unstubAllGlobals());

describe('PR-C 天赋只读资料与可选单选 UI', () => {
  it.each(talentDefinitions)('$name 使用唯一正式全文，选择不要求职业/城市，正式展示不含编辑控件', definition => {
    const input = newCreation(); input.step = 2; input.talentId = definition.id;
    const before = structuredClone(input);
    const picker = renderToStaticMarkup(<TalentPicker value={definition.id} onChange={noop} />);
    expect(picker.match(/type="radio"/g)).toHaveLength(9);
    expect(picker.match(/checked=""/g)).toHaveLength(1);
    expect(picker.match(/<input\b[^>]*>/g)?.find(tag => tag.includes(`aria-label="${definition.name}"`))).toContain('checked=""');
    for (const item of talentDefinitions) for (const field of fields) expect(picker).toContain(item[field]);
    const readonly = renderToStaticMarkup(<TalentProfile talentId={definition.id} />);
    for (const field of fields) expect(readonly).toContain(definition[field]);
    expect(readonly).toContain(definition.mechanismName);
    expect(readonly).not.toMatch(/<(?:input|button|select|textarea)\b/);
    const wizard = renderToStaticMarkup(<CreationWizard form={input} onChange={noop} onCreate={noop} onExit={noop} busy={false} />);
    expect(wizard.match(/<input\b[^>]*>/g)?.find(tag => tag.includes(`aria-label="${definition.name}"`))).toContain('checked=""');
    expect(input).toEqual(before);
  });

  it.each(talentDefinitions)('$name 的第五步、PC 实时档案、手机完整车票及正式人物档案读取同一 ID', definition => {
    const form = selectProfession(newCreation(), '教师'); form.step = 5; form.talentId = definition.id;
    form.person = { name: '林岚', age: '29', gender: '女性', appearance: '旧外貌', personality: '谨慎' };
    form.background = '旧背景'; form.skills = '手动技能\n沟通'; form.skillsSource = 'manual';
    const before = structuredClone(form), state = buildCreationState(form, defaultSettings()), saved = structuredClone(state);
    const review = renderToStaticMarkup(<CreationWizard form={form} onChange={noop} onCreate={noop} onExit={noop} busy={false} />);
    const dossier = renderToStaticMarkup(<CreationDossier form={form} busy={false} />);
    const ticket = renderToStaticMarkup(<FullCreationTicket form={form} stub={null} />);
    const archive = renderToStaticMarkup(<ProfilePanel state={state} equipment={[]} onEconomy={noop} onNpc={noop} onSaves={noop} />);
    for (const html of [review, dossier, ticket, archive]) expect(html).toContain(definition.name);
    for (const html of [review, archive]) for (const field of fields) expect(html).toContain(definition[field]);
    expect(review).not.toContain('name="opening-talent"'); expect(archive).not.toContain('name="opening-talent"');
    expect(form).toEqual(before); expect(state).toEqual(saved);
  });

  it('无天赋旧草稿可直接继续，确认、车票、实时档案与正式资料不虚构默认值，也不请求模型', () => {
    const network = vi.fn(() => { throw new Error('UI may not call AI'); }); vi.stubGlobal('fetch', network);
    const form = selectProfession(newCreation(), '教师'); form.step = 5;
    form.person = { name: '林岚', age: '29', gender: '女性', appearance: '', personality: '' };
    const before = structuredClone(form), state = buildCreationState(form, defaultSettings());
    expect(renderToStaticMarkup(<TalentProfile />)).toBe('');
    for (const html of [
      renderToStaticMarkup(<CreationWizard form={form} onChange={noop} onCreate={noop} onExit={noop} busy={false} />),
      renderToStaticMarkup(<CreationDossier form={form} busy={false} />),
      renderToStaticMarkup(<FullCreationTicket form={form} stub={null} />),
      renderToStaticMarkup(<ProfilePanel state={state} equipment={[]} onEconomy={noop} onNpc={noop} onSaves={noop} />),
    ]) {
      expect(html).not.toContain('talent-profile'); expect(html).not.toContain('开局天赋');
      for (const item of talentDefinitions) expect(html).not.toContain(item.name);
    }
    const picker = renderToStaticMarkup(<TalentPicker onChange={noop} />);
    expect(picker.match(/checked=""/g)).toHaveLength(1); expect(picker).not.toContain('required');
    expect(form).not.toHaveProperty('talentId'); expect(form).toEqual(before);
    expect(state.protagonist).not.toHaveProperty('talentId'); expect(network).not.toHaveBeenCalled();
  });
});
