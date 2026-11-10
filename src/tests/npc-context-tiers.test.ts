import { expect,it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { composePrompt } from '../prompts/composer';
import { inspectBudget } from '../prompts/budgetInspection';
import { parseTextVariables,parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { setNpcImportance } from '../domain/npc/profiles';
import { GameStateSchema } from '../domain/state';
import { createTurnDraft,rerollStory,TurnDraftSchema } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { npcContextFixture } from './fixtures/npcContextTiers';
import { sentContext } from './fixtures/contextAssertions';
import { fullPrivateProfile } from './fixtures/npcUnified';
import { worldState,worldDraft,worldResult } from './fixtures/world';
import { task } from './fixtures/game';
import { completeDraft,submission } from './fixtures/turn';
import { record,array } from '../services/ai/protocols';

const body=(commands:string)=>`<thinking>根据选定正文更新。</thinking><说明></说明><命令>\n${commands}\n</命令>`;
function copies(value:unknown,id:string):number{
 if(!value||typeof value!=='object')return 0;
 const self=!Array.isArray(value)&&'id' in value&&value.id===id&&('onScene' in value||'sourceTurnIds' in value&&'text' in value)?1:0;
 return self+Object.values(value).reduce<number>((sum,v)=>sum+copies(v,id),0);
}
function entities(c:Record<string,unknown>){return record(record(c.SAVE_STATE).npc);}

it.each(['story','variables','world'] as const)('%s真实messages：四级唯一资料表、记忆去重、完整特殊档案与地点认知',async stage=>{
 const a=npcContextFixture(),before=structuredClone(a);
 a.state.npc['scene-special']={...a.state.npc['scene-special'],kind:'special',detailedBackground:'完整专属经历',activeGoals:['经营企业'],habits:['晨跑'],offscreenTaskIds:[],longTermMemories:[],age:30,gender:'female',privateProfile:fullPrivateProfile};
 const prompt=await composePrompt({...a,stage,mode:'regular',userInput:a.draft.userInput}),c=sentContext(prompt.messages),n=entities(c),groups=record(record(c.NPC_CONTEXT).groups);
 expect(groups.sceneOrdinary).toContain('scene-ordinary');expect(groups.sceneSpecial).toContain('scene-special');expect(groups.offsceneOrdinary).toContain('off-ordinary');expect(groups.offsceneSpecial).toContain('off-special');
 expect(Object.keys(n)).toEqual(Object.keys(a.state.npc));expect(c).not.toHaveProperty('NPC_KNOWLEDGE');expect(c).not.toHaveProperty('SCENE_NPCS');
 for(const npc of Object.values(a.state.npc)){
  const shown=record(n[npc.id]);expect(shown).toMatchObject({id:npc.id,identityKey:npc.identityKey,kind:npc.kind,onScene:npc.onScene,affinity:npc.affinity,knownInformation:npc.knownInformation,phoneContact:npc.phoneContact,usualLocations:npc.usualLocations});
  expect(copies(c,npc.id)).toBe(1);
  for(const m of array(shown.memories)){expect(npc.memories).toContainEqual(m);expect(copies(c,String(record(m).id))).toBe(1);}
  if(npc.onScene||npc.kind==='special')expect(shown.memories).toEqual(npc.memories);
  if(npc.kind==='special'){expect(shown).toMatchObject({detailedBackground:npc.detailedBackground,activeGoals:npc.activeGoals,habits:npc.habits,offscreenTaskIds:npc.offscreenTaskIds});expect(shown.privateProfile).toEqual(npc.privateProfile);expect(shown.relationshipNetwork).toEqual(npc.relationshipNetwork);expect(shown.profilePending).toEqual(npc.profilePending);expect(shown).not.toHaveProperty('longTermMemories');}
 }
 expect(record(n['scene-special']).privateProfile).toEqual(fullPrivateProfile);
 const compact=record(n['tier-npc-6']);expect(compact).not.toHaveProperty('background');expect(array(compact.memories)).toHaveLength(20);
 expect(compact.usualLocations).toEqual([{locationId:'chongqing',role:'home',knownToProtagonist:false}]);
 expect(record(record(c.SAVE_STATE).memories).npcSummaries).toEqual(a.state.memories.npcSummaries);
 if(stage==='story')expect(c.SCENE_NPC_IDS).toEqual(Object.values(a.state.npc).filter(n=>n.onScene).map(n=>n.id));
 if(stage==='world'){expect(record(c.OFFSCREEN_STATE)).not.toHaveProperty('npc');expect(array(record(c.OFFSCREEN_STATE).npcIds).every(id=>typeof id==='string')).toBe(true);expect(record(c.OFFSCREEN_STATE).tasks).toEqual(Object.values(a.state.tasks).filter(t=>t.actorRef.kind==='organization'||t.actorRef.kind==='npc'&&!a.state.npc[t.actorRef.id]?.onScene));}
 const measured=inspectBudget(prompt.messages);expect(measured.reconciliation.characters).toBe(0);expect(measured.reconciliation.bytes).toBe(0);
 expect(measured.duplicates.filter(d=>d.identity.startsWith('npc:')||d.identity.startsWith('memory:')&&!d.identity.startsWith('memory:layered:'))).toEqual([]);
 // Only compose is read-only; the synthetic private profile was intentionally assigned above.
 expect(a.state.npc['tier-npc-6']).toEqual(before.state.npc['tier-npc-6']);
});

it('无可靠总结不删原文，未知认知/可见性/旧总结和元数据保持原状',async()=>{
 const a=npcContextFixture(),id='tier-npc-6';delete a.state.memories.npcSummaries[id][0].npcProvenance;delete a.state.memories.npcSummaries[id][1].npcProvenance;
 delete a.state.npc[id].memories[0].knowledgeKind;a.state.npc[id].memories[0].visibility='internal';
 const before=structuredClone(a),c=sentContext((await composePrompt({...a,stage:'story',mode:'regular',userInput:'继续'})).messages);
 expect(record(entities(c)[id]).memories).toEqual(a.state.npc[id].memories);expect(record(record(c.SAVE_STATE).memories).npcSummaries).toEqual(a.state.memories.npcSummaries);expect(a).toEqual(before);
});

it.each(['story','variables','world'] as const)('%s明确引用离场普通人物时展开，不凭分组认定行动权限',async stage=>{
 const a=npcContextFixture(),id='tier-npc-6';
 if(stage==='variables')a.draft.story!.narrative=`【旁白】${a.state.npc[id].name}回来谈起往事。`;
 else a.draft.userInput=`去找${id}，谈谈当年的经历。`;
 const c=sentContext((await composePrompt({...a,stage,mode:'regular',userInput:a.draft.userInput})).messages),shown=record(entities(c)[id]);
 expect(shown.background).toBe(a.state.npc[id].background);expect(shown.memories).toEqual(a.state.npc[id].memories);expect(record(record(c.NPC_CONTEXT).groups).offsceneOrdinary).toContain(id);expect(shown.onScene).toBe(false);
});

it('相关召回的原始来源仍可取回已由总结覆盖的旧记忆',async()=>{
 const a=npcContextFixture(),id='tier-npc-6';a.state.journal[0].story.narrative='那天签订了独有编号K9的设计约定。';a.draft.userInput='回忆独有编号K9的设计约定';
 const c=sentContext((await composePrompt({...a,stage:'story',mode:'regular',userInput:a.draft.userInput})).messages);
 expect(array(record(c.MEMORY_CONTEXT).recalledTurns).map(t=>record(t).turnId)).toContain('tier-turn-0');
 expect(array(record(entities(c)[id]).memories).map(m=>record(m).id)).toContain(`${id}-raw-0`);
});

it.each(['scene-ordinary','off-special'] as const)('在离场/身份切换后重新分类，休眠七字段不因被引用泄漏：%s',async id=>{
 const a=npcContextFixture(),privateRecord=Object.fromEntries(Object.entries(fullPrivateProfile).map(([k,v])=>[k,typeof v==='string'?`${id}:独有休眠-${v}`:v]));
 if(id==='scene-ordinary')a.state.npc[id].onScene=false;
 else {a.state.npc[id]={...a.state.npc[id],kind:'special',age:30,gender:'female',detailedBackground:'休眠独有详细经历',activeGoals:['休眠独有目标'],habits:['休眠独有习惯'],offscreenTaskIds:[],longTermMemories:[],privateProfile:privateRecord};a.state=setNpcImportance(a.state,id,a.state.npc[id].identityKey,'ordinary');}
 a.draft.userInput=`找${id}`;
 for(const stage of ['story','variables','world'] as const){const c=sentContext((await composePrompt({...a,stage,mode:'regular',userInput:a.draft.userInput})).messages);expect(record(record(c.NPC_CONTEXT).groups).offsceneOrdinary).toContain(id);
  const shown=record(entities(c)[id]);expect(shown).not.toHaveProperty('privateProfile');expect(shown).not.toHaveProperty('activeGoals');
  if(id==='off-special')for(const s of ['休眠独有详细经历','休眠独有目标','休眠独有习惯',...Object.values(privateRecord).filter((v):v is string=>typeof v==='string')])expect(JSON.stringify(c)).not.toContain(s.trim());
 }
 if(id==='off-special'){a.state=setNpcImportance(a.state,id,a.state.npc[id].identityKey,'special');const c=sentContext((await composePrompt({...a,stage:'story',mode:'regular',userInput:'继续'})).messages);expect(record(record(c.NPC_CONTEXT).groups).offsceneSpecial).toContain(id);expect(record(entities(c)[id]).privateProfile).toEqual(privateRecord);}
});

it('未验证Variables不能改变World分类/版本；正式离场投影可建后台任务，现场仍受保护',async()=>{
 const a=npcContextFixture(),id='scene-ordinary',command={type:'UpdateNpc' as const,commandId:'leave',expectedRevision:a.state.revision,npcId:id,changes:{onScene:false},evidence:'本轮离场'};
 a.draft.variables!.result.commands=[command];a.draft.variables!.validation='preview';a.draft.stageStatus.variables='preview';
 let c=sentContext((await composePrompt({...a,stage:'world',mode:'regular',userInput:''})).messages);expect(c.variablePending).toBe(true);expect(record(record(c.NPC_CONTEXT).groups).sceneOrdinary).toContain(id);expect(record(c.SAVE_STATE).revision).toBe(a.state.revision);
 a.draft.variables!.validation='validated';a.draft.stageStatus.variables='ready';c=sentContext((await composePrompt({...a,stage:'world',mode:'regular',userInput:''})).messages);
 expect(record(record(c.NPC_CONTEXT).groups).offsceneOrdinary).toContain(id);expect(record(c.SAVE_STATE).revision).toBe(a.state.revision);expect(c.BASE_SAVE_REVISION).toBe(a.state.revision);
 const newTask={...task('new-duty'),actorRef:{kind:'npc' as const,id},goal:'持续跟进工作室合作'};
 const result=worldResult();result.taskCommands=[{type:'SaveTask',commandId:'background-task',evidence:'离场后继续工作',task:newTask}];expect(()=>parseWorld(JSON.stringify(result),a.state,a.draft)).not.toThrow();
 expect(()=>parseWorld(JSON.stringify(worldResult([{type:'UpdateNpc',commandId:'scene',npcId:'scene-special',expectedRevision:a.state.revision,changes:{healthText:'疲倦'},evidence:'场内状态'}])),a.state,a.draft)).toThrow();
});

it('开局同伴离场也完整可读，但四级分组不解除原有保护',async()=>{
 const state=worldState();state.initialCompanionId='npc-a';const draft=worldDraft(true,'opening');
 const c=sentContext((await composePrompt({state,draft,stage:'world',mode:'opening',settings:defaultSettings(),userInput:''})).messages);
 expect(record(record(c.NPC_CONTEXT).groups).offsceneSpecial).toContain('npc-a');expect(record(c.PROTECTED_SCENE).sceneNpcIds).toContain('npc-a');expect(record(c.OFFSCREEN_STATE).npcIds).not.toContain('npc-a');
});

it('在场普通互动、特殊离场执行任务、再接触：真实文本→候选→Commit→重载身份与来源连续',async()=>{
 const factory=new IDBFactory(),repo=await SaveRepository.open('tier-continuity',factory),state=worldState();
 try{await repo.create(state);await repo.saveDraft(createTurnDraft(state.saveId,0,'first','opening','交谈'),null);const draft=rerollStory(createTurnDraft(state.saveId,0,'first','opening','交谈'),{turnKind:'opening',narrative:'【旁白】熟识的同事与主角确认约定，随后各自工作。',summary:'确认约定',variableGuide:[]});
  const text=body('push npc[scene].memories = {"text":"共同确认工作约定","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}');
  const variables=await parseTextVariables(text,state,draft),result=worldResult();result.taskCommands=[{type:'SaveTask',commandId:'work',evidence:'场外继续工作',task:{...task('work'),actorRef:{kind:'npc',id:'npc-a'}}}];
  const ready=await completeDraft(repo,{variables,world:result});parseWorld(JSON.stringify(result),state,ready);const first=await repo.commitTurn(submission(ready,''));
  expect(first.state.tasks.work.actorRef).toEqual({kind:'npc',id:'npc-a'});expect(first.state.npc.scene.memories).toHaveLength(1);
  const second=rerollStory(first.draft,{turnKind:'regular',narrative:'【旁白】离场同事重新回来交流工作进展。',summary:'同事回来',variableGuide:[]});
  const update=await parseTextVariables(body('set npc[npc-a].onScene = true\npush npc[npc-a].memories = {"text":"回到现场交流进展","knowledgeKind":"observed","knowledgeSource":"亲历","visibility":"npc_private"}'),first.state,second);
  const candidate=TurnDraftSchema.parse({...second,variables:{candidateRevision:1,storyRevision:second.storyRevision,validation:'validated',result:update},stageStatus:{...second.stageStatus,variables:'ready'}});
  const c=sentContext((await composePrompt({state:first.state,draft:candidate,stage:'world',mode:'regular',settings:defaultSettings(),userInput:''})).messages);expect(record(record(c.NPC_CONTEXT).groups).sceneSpecial).toContain('npc-a');expect(record(c.PROTECTED_SCENE).sceneNpcIds).toContain('npc-a');
  const saved=await repo.commitTurn(submission(await completeDraft(repo,{variables:update,world:worldResult()}),''));expect(await repo.load('save-a')).toEqual(saved.state);expect(saved.state.npc['npc-a'].identityKey).toBe(state.npc['npc-a'].identityKey);expect(saved.state.npc.scene.memories[0].sourceTurnIds).toEqual([ready.turnId]);
  expect(GameStateSchema.safeParse(saved.state).success).toBe(true);
 }finally{repo.close();}
});
