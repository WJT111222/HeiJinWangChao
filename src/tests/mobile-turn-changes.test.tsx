import {test,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {turnChangesPair} from './fixtures/turnChanges';
import {diffTurn} from '../ui/game/turnChanges';
import {turnChangeBadges} from '../ui/game/turnChangeBadges';
import {TurnChanges} from '../ui/game/TurnChanges';
import {panelNames} from '../ui/panels/Panels';
test('七入口按真实 target.panel 逐行计数，与世界分组、对象数量及未读状态无关',()=>{
 const {before,after}=turnChangesPair(),original=structuredClone({before,after}),groups=diffTurn(before,after),badges=turnChangeBadges(groups);
 for(const panel of panelNames)expect(badges[panel]??0).toBe(groups.flatMap(g=>g.rows).filter(r=>r.target.panel===panel).length);
 expect(Object.keys(badges).sort()).toEqual([...panelNames].sort());expect(badges['NPC']).toBeGreaterThan(1);expect(badges['势力组织']).not.toBe(groups.find(g=>g.key==='world')!.rows.length);expect(badges).not.toHaveProperty('人物档案');expect(badges).not.toHaveProperty('经济与资产');expect({before,after}).toEqual(original);
});
test('无可靠结果或零条变化不显示角标，不保留旧计数',()=>{
 expect(turnChangeBadges([])).toEqual({});const {before,after}=turnChangesPair(0,true);expect(turnChangeBadges(diffTurn(before,after))).toEqual({});
});
test('核对中、不可用与无变化按钮沿用禁用语义，不提前渲染抽屉内容',()=>{
 const {after}=turnChangesPair();for(const [ready,unavailable,text] of [[false,false,'核对中'],[true,true,'不可用'],[true,false,'· 无']] as const){
  const html=renderToStaticMarkup(<TurnChanges state={after} mobile comparison={{ready,unavailable,groups:[],count:0}} onOpen={()=>{}}/>);
  expect(html).toContain('disabled');expect(html).toContain('aria-expanded="false"');expect(html).toContain(text);expect(html).not.toContain('role="dialog"');expect(html).not.toContain('chg-row');
 }
});
