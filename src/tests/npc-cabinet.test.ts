import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NpcPanel } from '../ui/panels/NpcPanel';
import { playerView } from '../ui/panels/playerView';
import { npcRosterState } from './fixtures/npcRoster';

test.each(['person','special','other'])('桌面纸柜保留移动端既有全部字段和值：%s', id => {
 const view=playerView(npcRosterState());
 const render=(desktop:boolean)=>renderToStaticMarkup(createElement(NpcPanel,{view,initialId:id,desktop}));
 const fields=(s:string)=>[...s.matchAll(/<dt>(.*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map(m=>[m[1],m[2]]);
 expect(fields(render(true))).toEqual(fields(render(false)));
 expect(fields(render(true)).length).toBeGreaterThanOrEqual(14);
});
test('桌面不绕过现有未成年人私密字段边界',()=>{
 const state=npcRosterState();state.npc.special.age=17;
 const html=renderToStaticMarkup(createElement(NpcPanel,{view:playerView(state),initialId:'special',desktop:true}));
 expect(html).not.toContain('香闺秘档');expect(html).toContain('详细经历');
});
