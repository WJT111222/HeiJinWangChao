import raw from './world-teahouse-original.json';
import { game, npc } from './game';
import { GameStateSchema } from '../../domain/state';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../../domain/drafts';
// 原始 World 来自用户；没有原存档和Story，以下现场、时间窗口、组织均为明确的测试假设。
export function teahouse() {
  const state = game(); state.worldClock = '2023-09-15T15:30:00+08:00';
  state.protagonist = { ...state.protagonist, id:'protagonist', name:'吴杰涛', locationId:'jumingxuan' };
  state.locations.shapingba_street = { id:'shapingba_street', name:'沙坪坝老街', parentId:'chongqing' };
  state.locations.jumingxuan = { id:'jumingxuan', name:'聚茗轩', parentId:'shapingba_street' };
  for (const [id,name] of [['npc_chen_zhiyuan','陈志远'],['npc_zhou_fuhua','周富华']]) state.npc[id] = { ...npc(id), name, locationId:'jumingxuan' };
  for (const id of ['org_zhou_trade','org_chen_company']) state.organizations[id] = { id,name:id,kind:'business',description:'合成测试组织',protagonistRelation:'暂无往来',relationHistory:[],keyNpcIds:[],currentTaskIds:[],sectors:[],businessRelations:[] };
  const draft = rerollStory(createTurnDraft(state.saveId,0,raw.eventCommands[0].event.sourceTurnIds[0],'opening',''), {
    turnKind:'opening', narrative:'【旁白】陈志远离开茶楼取证件。吴杰涛留在包厢，与周富华继续交谈。',summary:'测试假设：离场取件，现场交谈继续。',variableGuide:[],
  });
  return { state:GameStateSchema.parse(state), draft:TurnDraftSchema.parse({ ...draft,
    variables:{storyRevision:1,candidateRevision:1,requestRevision:0,validation:'validated',result:{commands:[
      {type:'SetWorldClock',commandId:'clock',worldClock:'2023-09-15T15:40:00+08:00',evidence:'本幕窗口'},
      {type:'UpdateNpc',commandId:'leave',npcId:'npc_chen_zhiyuan',expectedRevision:0,changes:{onScene:false},evidence:'离场'},
    ],rejectedSuggestions:[],unresolved:[]}},stageStatus:{...draft.stageStatus,variables:'ready'},
  }), response:structuredClone(raw) };
}
