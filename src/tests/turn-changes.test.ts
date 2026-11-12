import {expect,test} from 'vitest';
import {diffTurn} from '../ui/game/turnChanges';
import {turnChangesPair} from './fixtures/turnChanges';
import {GameStateSchema} from '../domain/state';
const rows=(a:ReturnType<typeof diffTurn>)=>a.flatMap(g=>g.rows);
const visible=(a:ReturnType<typeof diffTurn>)=>rows(a).map(r=>[r.subject,r.field,r.value,r.detail,r.oldValue,r.newValue].filter(Boolean).join(' ')).join('\n');
test('正式六组、确定顺序和完整文本，纯函数不改变双方状态',()=>{
 const {before,after}=turnChangesPair(),saved=structuredClone({before,after}),groups=diffTurn(before,after);
 expect(groups.map(g=>g.key)).toEqual(['time','me','npc','item','world','mem']);expect({before,after}).toEqual(saved);expect(diffTurn(before,after)).toEqual(groups);
 for(const value of ['18分钟','南桥资料室','-28.00 元','+50.00 元','30 → 34','新人物','新组织','新阶段','数量','短期记忆','主角重大纪事'])expect(visible(groups)).toContain(value);
});
test('无变化与仅元数据、正文、内部配置变化不产生项目',()=>{
 const {before,after}=turnChangesPair(0,true);expect(diffTurn(before,before)).toEqual([]);expect(diffTurn(before,after)).toEqual([]);
 after.title='标题修改';after.npcManagementRevision=20;after.openingCityId='shanghai';after.npc['npc-a'].importancePreference='special';expect(diffTurn(before,after)).toEqual([]);
});
test('极大金额差值先转 BigInt；未知余额不当零',()=>{
 const {before,after}=turnChangesPair(0,true);before.economy.cash=Number.MAX_SAFE_INTEGER;after.economy.cash=0;before.economy.onlineBalance=null;after.economy.onlineBalance=100;
 const text=visible(diffTurn(before,after));expect(text).toContain('-90,071,992,547,409.91 元');expect(text).toContain('未确认 → 1.00 元');expect(text).not.toContain('NaN');expect(text).not.toContain('Infinity');
 const online=rows(diffTurn(before,after)).find(r=>r.subject==='线上资金')!;expect(online.value).toBe('变更');expect(online.tone).toBe('mod');
});
test('七装备、库存只取正式主角持有集合，失去物品只打开可用入口',()=>{
 const {before,after}=turnChangesPair();const groups=diffTurn(before,after),item=groups.find(g=>g.key==='item')!;
 expect(item.rows.find(r=>r.key==='quantity:clips')?.value).toBe('×10 → ×12');expect(item.rows.find(r=>r.subject==='已归还的借阅凭据')?.target).toEqual({panel:'物品栏'});
 expect(item.rows.find(r=>r.subject==='纸质归档袋')?.target).toEqual({panel:'物品栏',id:'folder'});
 before.items.hidden={id:'hidden',name:'别人私藏的物品',category:'other',quantity:1,conditionText:'隐藏',ownerRef:{kind:'npc',id:'npc-a'}};after.items.hidden={...before.items.hidden,quantity:2};expect(visible(diffTurn(before,after))).not.toContain('别人私藏的物品');
 const same=turnChangesPair(0,true);same.after.protagonist.currentWear.accessoryItemIds=[];expect(diffTurn(same.before,same.after)).toEqual([]);
});
test('未确认同伴关系不泄露存储占位数值，私密身体和休眠档案均不比较',()=>{
 const {before,after}=turnChangesPair(0,true);before.initialCompanionId=after.initialCompanionId='npc-a';before.npc['npc-a'].affinity=17;after.npc['npc-a'].affinity=99;
 if(after.npc['npc-a'].kind==='special')after.npc['npc-a'].privateProfile={bodyDescription:'不应出现在变化清单的私密字段'};
 expect(diffTurn(before,after)).toEqual([]);after.npc['npc-a'].affinityConfirmed=true;
 expect(visible(diffTurn(before,after))).toContain('未确认 → 99');expect(visible(diffTurn(before,after))).not.toContain('17');expect(visible(diffTurn(before,after))).not.toContain('私密字段');
});
test('并行阶段、退役档案与任务保留真实目标，不拼成串行进度或倒计时',()=>{
 const {before,after}=turnChangesPair(),world=diffTurn(before,after).find(g=>g.key==='world')!;
 const stages=world.rows.filter(r=>r.value==='新阶段');expect(stages.map(r=>r.target)).toEqual([{panel:'世界事件',id:'changes-sub-one'},{panel:'世界事件',id:'changes-sub-two'}]);
 expect(world.rows.some(r=>r.key==='event-archive:failed')).toBe(true);expect(visible([world])).not.toContain('倒计时');expect(visible([world])).toContain('不代表主角新增知情');
 expect(world.rows.find(r=>r.key==='task:archive-task')?.target).toEqual({panel:'世界事件'});
});
test('事实、转述、推测和人物私有记忆保留来源性质；程序ID及知情标记不进入文案',()=>{
 const {before,after}=turnChangesPair(),text=visible(diffTurn(before,after));for(const label of ['已核实事实','转述（未核实）','推测（未确认）','人物私有记录 · 不代表主角已知'])expect(text).toContain(label);
 for(const id of ['changes-sub-one','changes-turn-3','org-stage-b','npc-report','revision','knownToProtagonist'])expect(text).not.toContain(id);
});
test('世界隐藏记录仍仅以既有客观档案呈现，不当成角色新知识',()=>{
 const {before,after}=turnChangesPair(0,true);const base=after.events.legacy;after.events.legacy={...base,status:'blocked',title:'后台档案变化'};
 const text=visible(diffTurn(before,after));expect(text).toContain('客观世界档案 · 不代表主角新增知情');expect(text).not.toContain('主角得知');
});
test('历史精度不补日期，史料和重大纪事分开；长内容原样可达',()=>{
 const {before,after}=turnChangesPair();after.timeline.at(-1)!.summary='长历史说明。'.repeat(80)+'历史原文末尾';after.timeline.push({...after.timeline.at(-1)!,id:'changes-ordinary',chronicle:undefined,title:'原始转述',knowledgeKind:'reported',occurredAt:undefined,occurredTimeText:'大学时期'});
 const text=visible(diffTurn(before,after));expect(text).toContain('主角重大纪事');expect(text).toContain('史料记录');expect(text).toContain('人物陈述');expect(text).toContain('历史原文末尾');expect(text).not.toContain('2026/01/01');expect(()=>GameStateSchema.parse(after)).not.toThrow();
});

test('无ID的已知信息按实际记录数比较，不擅自合并相同文本的新增记录',()=>{
 const {before,after}=turnChangesPair(0,true),entry={text:'同样的说法',source:'同一渠道',learnedAt:before.worldClock};before.npc['npc-a'].knownInformation=[entry];after.npc['npc-a'].knownInformation=[entry,entry];
 expect(rows(diffTurn(before,after)).find(r=>r.field==='新增已知信息')?.value).toBe('+1 条');
});
test('七个装备槽都解析正式名称，卸下同样完整比较，不修改穿戴引用',()=>{
 const {before,after}=turnChangesPair(0,true),ownerRef={kind:'protagonist' as const,id:after.protagonist.id};
 for(const [id,category,name] of [['t','top','棉上衣'],['b','bottom','长裤'],['s','shoes','布鞋'],['a','accessory','腕表'],['p','weapon','折伞'],['q','weapon','备用工具']] as const)after.items[id]={id,category,name,quantity:1,conditionText:'可用',ownerRef};
 after.economy.vehicles.van={id:'van',kind:'vehicle',name:'小型客车',model:'小型车',ownerRef,estimatedValue:null,source:'既有车辆记录',statusText:'正常'};
 after.protagonist.currentWear={topItemId:'t',bottomItemId:'b',shoesItemId:'s',accessoryItemIds:['a'],primaryWeaponItemId:'p',secondaryWeaponItemId:'q',currentVehicleAssetId:'van'};
 const saved=structuredClone(after.protagonist.currentWear),names=['上衣','下装','鞋子','饰品','主武器','副武器','载具'];expect(GameStateSchema.safeParse(after).success).toBe(true);
 for(const [a,b] of [[before,after],[after,before]]){const group=diffTurn(a,b).find(g=>g.key==='me')!;expect(group.rows.map(r=>r.subject)).toEqual(names);expect(group.rows.find(r=>r.subject==='载具')?.detail).toContain('小型客车');}
 expect(after.protagonist.currentWear).toEqual(saved);
});
test('跨日时间使用正式中国时间与真实时长，不借设备时间或天气推断',()=>{
 const {before,after}=turnChangesPair(0,true);before.worldClock='2027-04-01T23:59:30+08:00';after.worldClock='2027-04-02T00:00:15+08:00';const change=rows(diffTurn(before,after)).find(r=>r.key==='clock')!;
 expect(change.oldValue).toContain('2027/04/01 23:59');expect(change.newValue).toContain('2027/04/02 00:00');expect(change.detail).toBe('经过 45秒');
});

test('同名地点之间实际移动仍有变化条目且跳转使用真实ID，不把同名当作未移动',()=>{
 const {before,after}=turnChangesPair(0,true);for(const state of [before,after]){state.locations.sameA={id:'sameA',name:'资料室',parentId:'chongqing'};state.locations.sameB={id:'sameB',name:'资料室',parentId:'chongqing'};for(const npc of Object.values(state.npc))npc.onScene=false;}
 before.protagonist.locationId='sameA';after.protagonist.locationId='sameB';expect(GameStateSchema.safeParse(before).success).toBe(true);expect(GameStateSchema.safeParse(after).success).toBe(true);
 const row=rows(diffTurn(before,after)).find(r=>r.subject==='地点')!;expect(row.detail).toBe('重庆 › 资料室 → 重庆 › 资料室');expect(row.target).toEqual({panel:'地图',id:'sameB'});
});

test.each(['reported','suspected','unknown'] as const)('退场人物保留到长期记忆后仍保留 %s 的正式认知性质',kind=>{
 const {before,after}=turnChangesPair(0,true);
 after.memories.long.push({id:'retired-knowledge',text:'后来保存的原始说法，不补造事实。',sourceTurnIds:['changes-turn-3'],affectedEntityRefs:[],visibility:'npc_private',createdAtGameTime:after.worldClock,retiredNpcSource:{npcId:'npc-a',sourceMemoryId:'retired-source',knowledgeKind:kind,knowledgeSource:'原始来源记录'}});
 expect(GameStateSchema.safeParse(after).success).toBe(true);
 const memory=diffTurn(before,after).find(g=>g.key==='mem')!.rows[0],labels={reported:'转述（未核实）',suspected:'推测（未确认）',unknown:'认知来源未分类'};
 expect(memory.detail).toContain(labels[kind]);expect(memory.detail).toContain('人物私有记录 · 不代表主角已知');expect(memory.target).toEqual({panel:'记忆',level:'long'});
});

test('正式时钟含毫秒时，时长不出现浮点减法尾数，回溯同样精确',()=>{
 const {before,after}=turnChangesPair(0,true);before.worldClock='2027-04-01T10:00:00+08:00';after.worldClock='2027-04-01T10:01:01.100+08:00';
 expect(GameStateSchema.safeParse(after).success).toBe(true);
 expect(rows(diffTurn(before,after)).find(r=>r.key==='clock')?.detail).toBe('经过 1分钟 1.1秒');
 expect(rows(diffTurn(after,before)).find(r=>r.key==='clock')?.detail).toBe('回溯 1分钟 1.1秒');
});
