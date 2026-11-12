import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfilePanel } from '../ui/panels/ProfilePanel';
import { OrganizationPanel } from '../ui/panels/OrganizationPanel';
import { ArchivePanel } from '../ui/ArchivePanel';
import { organizationArchiveState } from './fixtures/organizations';
import { playerView, dateTime } from '../ui/panels/playerView';

const equipment: [string,string][] = ['上衣','下装','鞋子','饰品','主武器','副武器','载具'].map((label,i)=>[label,i?'无':'旧外套']);
const noop = () => undefined;
const plain = (html:string) => html.replace(/<[^>]*>/g,'');
const fields = (html:string) => [...html.matchAll(/<dt>(.*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(m=>[m[1],plain(m[2])]);

test('人物档案16字段、职业档案、七槽和三个入口完全由正式状态投影',()=>{
 const state=organizationArchiveState(),hero=state.protagonist,before=structuredClone(state);
 const candidateTime='2026-10-18T09:05:00+08:00';
 const html=renderToStaticMarkup(createElement(ProfilePanel,{state,equipment,candidateTime,onEconomy:noop,onNpc:noop,onSaves:noop}));
 const profile=[...html.matchAll(/<dl class="[^"]*profile-details[^"]*"[^>]*>([\s\S]*?)<\/dl>/g)].flatMap(m=>fields(m[1]));
 expect(Object.fromEntries(profile)).toEqual({姓名:hero.name,年龄:String(hero.age),性别:hero.gender,职业:hero.profession||'未填写',外貌:hero.appearance||'未填写',性格:hero.personality||'未填写',背景:hero.background||'未填写',当前时间:dateTime(state.worldClock),候选时间:`${dateTime(candidateTime)}（未正式结算）`,地点:state.locations[hero.locationId].name,天气:state.weatherText||'天气待确认',环境:state.environmentText||'环境将由开局正文确立。',身体:hero.healthText||'待开局确认',情绪:hero.emotionText||'待开局确认',社会状态:hero.publicStatus||'未确认',法律状态:hero.legalStatus||'未确认'});
 expect(profile).toHaveLength(16);expect(html).toContain('aria-label="职业档案"');
 expect(fields(html)).toEqual(expect.arrayContaining(equipment));
 for(const label of ['职业介绍','技能','长期影响','经济与资产','NPC 人物资料','切换存档'])expect(html).toContain(label);
 expect(html).toContain('class="pf-stamp" aria-hidden="true"');expect(state).toEqual(before);
});

test('候选时间不存在时不显示；未确认开局时间不显示虚构日期',()=>{
 const state=organizationArchiveState();state.openingTimePending=true;
 const html=renderToStaticMarkup(createElement(ProfilePanel,{state,equipment,onEconomy:noop,onNpc:noop,onSaves:noop}));
 expect(html).not.toContain('<dt>候选时间</dt>');expect(html).toContain('开局时间待确认');expect(html).not.toContain(dateTime(state.worldClock));
});

test.each(['gang','government','civil','business'])('组织 %s 保留移动端原有技术和正式字段',kind=>{
 const state=organizationArchiveState(),view=playerView(state),initialId=`org-${kind}`;
 const render=(desktop:boolean)=>renderToStaticMarkup(createElement(OrganizationPanel,{view,initialId,desktop,links:{npc:noop,organization:noop,event:noop}}));
 expect(fields(render(true))).toEqual(fields(render(false)));
 for(const label of ['组织概况','当前状况','管理层与关键人物','势力关系','当前动态','与主角关系','组织技术记录']) expect(render(true)).toContain(label);
 expect(render(true)).toContain(`data-org-id="${initialId}"`);
 expect(render(true)).not.toContain('<details open');
});

test('publicName=null 即使有npcId也不通过卡片泄露姓名，历史原文不伪造日期',()=>{
 const state=organizationArchiveState(),org=state.organizations['org-business'];
 org.leadership=[{position:'未公开身份',publicName:null,npcId:'person',description:'身份尚未公开'}];
 org.relationHistory=['2026-10-18T08:00:00.123+08:00 正式关系记录','仅记录先后顺序，无日期'];
 const html=renderToStaticMarkup(createElement(OrganizationPanel,{view:playerView(state),initialId:org.id,desktop:true,links:{npc:noop,organization:noop,event:noop}}));
 const row=html.match(/<li><strong class="pos">未公开身份：[\s\S]*?<\/li>/)![0];
 expect(row).toContain('未知');expect(row).not.toContain('<button');expect(row).not.toContain('林澄');
 for(const text of org.relationHistory)expect(html).toContain(text);
});

test('桌面大量关系历史分页，原始记录仍完整保留在折叠技术记录中',()=>{
 const state=organizationArchiveState(),org=state.organizations['org-business'];org.relationHistory=Array.from({length:45},(_,i)=>`原始关系文字 ${i}`);
 const html=renderToStaticMarkup(createElement(OrganizationPanel,{view:playerView(state),initialId:org.id,desktop:true}));
 const list=html.match(/<section aria-label="组织关系历史">([\s\S]*?)<\/section>/)![1];
 expect(list.match(/class="prose history-entry"/g)).toHaveLength(20);expect(list).toContain('下一页');
 expect(html).toContain('原始关系文字 44');expect(html).toContain('关系历史 · 45');
});

test('公共档案柜支持主角专用eyebrow，保持非模态语义与可访问标题',()=>{
 const html=renderToStaticMarkup(createElement(ArchivePanel,{title:'人物档案',seal:'档',subtitle:'主角 · 林舟',eyebrow:'PROTAGONIST · 主角档案',onClose:noop,children:'资料'}));
 expect(html).toContain('aria-modal="false"');expect(html).toContain('PROTAGONIST · 主角档案');expect(html).toContain('关闭资料界面');expect(html).not.toContain('<dialog');
});

test('空组织投影不生成演示组织或虚构字段',()=>{
 const view={...playerView(organizationArchiveState()),organizations:[]};
 const html=renderToStaticMarkup(createElement(OrganizationPanel,{view,desktop:true}));
 expect(html).toContain('暂无符合条件的组织');expect(html).toContain('选择组织，阅读势力档案');expect(html).not.toContain('data-org-id=');
});
