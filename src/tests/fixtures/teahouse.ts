import raw from './world-teahouse-synthetic.json';
import { game, npc } from './game';
import { GameStateSchema } from '../../domain/state';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../../domain/drafts';
// 完全虚构的展览筹备夹具，仅保留离场任务与单侧关联的故障结构；不包含玩家会话原文。
export function teahouse() {
  const state = game(); state.worldClock = '2040-04-18T09:00:00+08:00';
  state.protagonist = { ...state.protagonist, id:'hero_fixture', name:'顾宁', locationId:'loc_fixture_teahouse' };
  state.locations = {
    loc_fixture_city:{id:'loc_fixture_city',name:'青禾市'},
    loc_fixture_lane:{id:'loc_fixture_lane',name:'纸艺巷',parentId:'loc_fixture_city'},
  };
  state.locations.loc_fixture_teahouse = { id:'loc_fixture_teahouse', name:'青岚茶室', parentId:'loc_fixture_lane' };
  for (const [id,name] of [['npc_fixture_lin','林岚'],['npc_fixture_xu','许松']]) state.npc[id] = { ...npc(id), name, locationId:'loc_fixture_teahouse' };
  for (const [id,name] of [['org_fixture_supplies','青岚物资社'],['org_fixture_studio','青禾工作室']]) state.organizations[id] = { id,name,kind:'business',description:'合成测试组织',protagonistRelation:'暂无往来',relationHistory:[],keyNpcIds:[],currentTaskIds:[],sectors:[],businessRelations:[] };
  const draft = rerollStory(createTurnDraft(state.saveId,0,raw.eventCommands[0].event.sourceTurnIds[0],'opening',''), {
    turnKind:'opening', narrative:'【旁白】林岚离开青岚茶室，前往工坊取展台标识。顾宁与许松留在茶室讨论展览布置。',summary:'合成场景：离场取材料，展览讨论继续。',variableGuide:[],
  });
  return { state:GameStateSchema.parse(state), draft:TurnDraftSchema.parse({ ...draft,
    variables:{storyRevision:1,candidateRevision:1,requestRevision:0,validation:'validated',result:{commands:[
      {type:'SetWorldClock',commandId:'clock',worldClock:'2040-04-18T09:10:00+08:00',evidence:'本幕窗口'},
      {type:'UpdateNpc',commandId:'leave',npcId:'npc_fixture_lin',expectedRevision:0,changes:{onScene:false},evidence:'离场'},
    ],rejectedSuggestions:[],unresolved:[]}},stageStatus:{...draft.stageStatus,variables:'ready'},
  }), response:structuredClone(raw) };
}
