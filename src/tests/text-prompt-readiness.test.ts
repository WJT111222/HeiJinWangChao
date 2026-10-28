import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { composePrompt, composeTextVariablesPrompt } from '../prompts/composer';
import { readPromptResource } from '../prompts/loader';
import { promptManifest, PromptManifestSchema } from '../prompts/manifest';
import { selectPromptModules } from '../prompts/selection';
import { textVariableCatalog } from '../executors/variableText/catalog';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { game, npc, story } from './fixtures/game';
import manifest from '../../prompts/manifest.json';
import sources from '../../prompts/sources.lock.json';

const domains=['protagonist','npc_ordinary','npc_special','items','economy','org_gang','org_government','org_civil','org_business'];
function input(mode:'opening'|'regular'='regular') {
  const state=game();
  const draft=rerollStory(createTurnDraft(state.saveId,0,'prompt-turn',mode,'继续'),{...story,turnKind:mode});
  return {stage:'variables' as const,mode,state,draft,userInput:'继续',settings:defaultSettings(),domains};
}
const textModules=promptManifest.modules.filter(m=>m.variableProtocol==='text');
const sha=(content:string)=>createHash('sha256').update(content).digest('hex');
describe('文本协议真实资源与离线组装',()=>{
  it('40条路径目录类型齐备，现场任务事件复用旧命令',()=>{
    const catalog=textVariableCatalog();
    expect(catalog.entries).toHaveLength(40);
    expect(new Set(catalog.entries.map(e=>`${e.operation}:${e.path}`)).size).toBe(40);
    expect(new Set(catalog.entries.map(e=>e.commandType)).size).toBe(23);
    for(const e of catalog.entries)expect(e.valueSchema).toHaveProperty('$schema');
    expect(catalog.entries.some(e=>['RetireNpc'].includes(e.commandType))).toBe(false);
    expect(catalog.entries.some(e=>e.path==='economy.cash'&&e.operation==='set')).toBe(false);
  });
  it.each(['opening','regular'] as const)('%s文本组装只加载相应主模板/九组，不混入旧JSON协议',async(mode)=>{
    const a=input(mode),before=structuredClone(a),r=await composeTextVariablesPrompt(a);
    expect(a).toEqual(before);
    const ids=r.modules.map(m=>m.id);
    expect(ids.filter(id=>id.startsWith('stages.'))).toEqual([`stages.${mode}.variables.text`]);
    expect(ids.filter(id=>id.startsWith('variableGroups.'))).toHaveLength(9);
    for(const group of domains)expect(ids).toContain(`variableGroups.${group}.${mode==='opening'?'init':'update'}.text`);
    expect(ids).toContain('shared.07_command_output.text');
    expect(ids).not.toContain('shared.07_command_output');
    expect(r.context).not.toHaveProperty('COMMAND_CATALOG');expect(r.context).toHaveProperty('TEXT_COMMAND_CATALOG',textVariableCatalog());
    const systems=r.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    expect(systems).not.toContain('输出严格JSON {commands,rejectedSuggestions,unresolved}');
    expect(systems).toContain('不输出旧的领域命令JSON对象');expect(systems).toContain('VARIABLE_TEXT_V1');
    expect(ids).not.toContain(`stages.${mode==='opening'?'regular':'opening'}.variables.text`);
  });
  it.each(['opening','regular'] as const)('%s默认正式组装使用文本资源，World不加载文本init',async(mode)=>{
    const a=input(mode),r=await composePrompt(a);
    expect(r.context).toHaveProperty('TEXT_COMMAND_CATALOG');expect(r.context).not.toHaveProperty('COMMAND_CATALOG');
    expect(r.modules.some(m=>m.id.endsWith('.text'))).toBe(true);
    expect(r.messages.some(m=>m.content.includes('输出严格JSON {commands,rejectedSuggestions,unresolved}'))).toBe(false);
    const world=selectPromptModules({...a,stage:'world'});
    expect(world.some(m=>m.variableProtocol==='text')).toBe(false);
    expect(world.some(m=>m.id==='shared.08_world_output')).toBe(true);
    expect(world.some(m=>m.id==='shared.07_command_output')).toBe(false);
  });
  it('显式离线入口不调用网络、AI或存储，切换准备模式不变更设置/草稿',async()=>{
    const fetch=vi.fn(),open=vi.fn();vi.stubGlobal('fetch',fetch);vi.stubGlobal('indexedDB',{open});
    try {const a=input(),before=structuredClone(a);await composeTextVariablesPrompt(a);await composePrompt(a);expect(a).toEqual(before);expect(fetch).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();}
    finally {vi.unstubAllGlobals();}
  });
  it('非法阶段和无正文不伪造组装',async()=>{
    const a=input();await expect(composeTextVariablesPrompt({...a,draft:undefined})).rejects.toMatchObject({code:'configuration'});
    // 验证来自JS调用者的运行时输入也受阶段限制，未使用类型断言。
    const dynamic:unknown={...a,stage:'world'};
    expect(typeof dynamic).toBe('object');
    await expect(Reflect.apply(composeTextVariablesPrompt,undefined,[dynamic])).rejects.toMatchObject({code:'configuration'});
  });
  it('九组选择与排序仍来自Manifest，不默认全加载或放宽固定顺序',async()=>{
    const a={...input(),domains:['npc_ordinary']},r=await composeTextVariablesPrompt(a);
    expect(r.modules.filter(m=>m.id.startsWith('variableGroups.')).map(m=>m.id)).toEqual(['variableGroups.npc_ordinary.update.text']);
    await expect(composeTextVariablesPrompt({...a,domains:['invented']})).rejects.toMatchObject({code:'configuration'});
    await expect(composeTextVariablesPrompt({...a,orderOverrides:{'stages.regular.variables.text':0}})).rejects.toMatchObject({code:'configuration'});
  });
  it.each(textModules.map(m=>[m.id,m.path] as const))('%s正文真实加载且原JSON快照逐字保留',async(id,path)=>{
    const current=await readPromptResource(id);expect(current).toBe(readFileSync(resolve('prompts',path),'utf8'));
    const record=sources.resources[path as keyof typeof sources.resources];
    if(!('textProtocol' in record))throw new Error('文本来源记录缺失');
    const old=readFileSync(resolve('prompts',record.textProtocol.legacyPath),'utf8');
    const prior=promptManifest.modules.find(m=>m.id===id.replace(/\.text$/,''));
    expect(prior?.path).toBe(record.textProtocol.legacyPath);
    expect(sha(old)).toBe(prior?.contentSha256);
    expect(current).not.toBe(old);
  });
  it.each(['stage','world','order'] as const)('Manifest拒绝文本资源错误%s元数据',kind=>{
    const changed=structuredClone(manifest),m=changed.modules.find(m=>m.id==='stages.regular.variables.text')!;
    if(kind==='stage')m.modes=['opening'];
    if(kind==='world')m.applicableStages=['world'];
    if(kind==='order')m.defaultOrder=20;
    expect(PromptManifestSchema.safeParse(changed).success).toBe(false);
  });
});

const groups=textModules.filter(m=>m.category==='variable_group');
describe('真实模块示例经解析器/编译器/领域执行',()=>{
  it.each(groups.map(m=>[m.id,m.path] as const))('%s里的全部完整命令示例可执行',async(_id,path)=>{
    const content=readFileSync(resolve('prompts',path),'utf8'),blocks=content.match(/<命令>[\s\S]*?<\/命令>/g)??[];
    expect(blocks.length).toBeGreaterThan(0);
    for(const block of blocks){
      const a=input();a.state.turnNumber=1;a.state.journal=[{turnId:'past',revision:0,story,relatedActorRefs:[]}];
      a.state.npc.lin={...npc('lin'),affinity:0,kind:'special',onScene:false,detailedBackground:'社区工作者',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[]};
      const parsed=parseVariableText(block);if(!parsed.ok)throw new Error(parsed.error.code);
      const context={draft:a.draft,expectedRevision:0},before=structuredClone(a.state);
      const plan=await compileVariableCommands(parsed.value,a.state,context);if(!plan.ok)throw new Error(plan.error.code);
      const r=await simulateVariablePlan(plan.value,a.state,context);if(!r.ok)throw new Error(r.error.code);
      expect(a.state).toEqual(before);
    }
  });
});

describe('共享指令不能污染文本输出契约',()=>{
  it.each(['opening','regular'] as const)('%s实际消息不要求AI补程序命令元数据或旧JSON错误数组',async(mode)=>{
    const r=await composeTextVariablesPrompt(input(mode)),systems=r.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    expect(systems).not.toContain('每条变更提案必须给出命令类别、对象、证据和稳定的唯一命令标识');
    expect(systems).not.toContain('必要时通过 unresolved 报告');
    expect(systems).not.toContain('宁可把它列入 unresolved');
  });
});

it('文本目录保留既有状态文本长度约束，不把无效空值宣称为合法输入',()=>{
  const catalog=textVariableCatalog();
  for(const path of ['protagonist.healthText','protagonist.emotionText','npc[id].healthText','npc[id].relationshipText']){
    expect(catalog.entries.find(e=>e.path===path)?.valueSchema).toMatchObject({type:'string',minLength:1,maxLength:8192});
  }
});
