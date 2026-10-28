/** 仅用于把旧测试的数据场景写成新模型协议；生产代码从不导入，不解析真实模型回复。 */
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid variable fixture');
  return Object.fromEntries(Object.entries(value));
}
const line=(op:string,path:string,value:unknown)=>`${op} ${path} = ${JSON.stringify(value)}`;
function withoutId(value:unknown){const {id:_id,...rest}=object(value);void _id;return rest;}
function commandText(value:unknown):string[]{
  const c=object(value),nested=(key:string)=>object(c[key]);
  switch(c.type){
    case 'SetWorldClock':return[line('set','worldClock',c.worldClock)];
    case 'SaveEvent':return[line('set',`events[${nested('event').id}]`,withoutId(c.event))];
    case 'SaveTask':return[line('set',`tasks[${nested('task').id}]`,withoutId(c.task))];
    case 'SpendFunds':return[line('add',`economy.${c.account}`,typeof c.amount==='number'?-c.amount:c.amount)];
    case 'UpdateProtagonist':return Object.entries(nested('changes')).map(([key,v])=>line('set',`protagonist.${key}`,v));
    case 'UpdateNpc':return [...Object.entries(nested('changes')).filter(([key])=>!c.affinityChange||key!=='relationshipText').map(([key,v])=>line('set',`npc[${c.npcId}].${key}`,v)),
      ...(c.affinityChange?[line('set',`npc[${c.npcId}].affinityChange`,{...object(c.affinityChange),relationshipText:nested('changes').relationshipText})]:[]),
      ...(c.activeGoals?[line('set',`npc[${c.npcId}].activeGoals`,c.activeGoals)]:[])];
    case 'CreateNpc':return[line('set',`npc[${nested('npc').id}]`,withoutId(c.npc))];
    case 'RegisterContact':return[line('set',`npc[${c.npcId}].contact`,{reason:c.reason})];
    case 'CreateOrganization':return[line('set',`organizations[${nested('organization').id}]`,withoutId(c.organization))];
    case 'RecordOrgRelation':return[line('set',`organizations[${c.organizationId}].protagonistRelation`,{relation:c.relation,reason:c.reason})];
    case 'CreateLocation':return[line('set',`locations[${nested('location').id}]`,withoutId(c.location))];
    case 'ReceiveIncome':return[line('set',`economy.incomes[${nested('income').id}]`,withoutId(c.income))];
    case 'TransferFunds':return[line('push','economy.transfers',{from:c.from,to:c.to,amount:c.amount})];
    case 'Borrow':return[line('set',`economy.debts[${nested('debt').id}]`,{account:c.account,debt:withoutId(c.debt)})];
    case 'RepayDebt':return[line('push',`economy.debts[${c.debtId}].repayments`,{account:c.account,amount:c.amount})];
    case 'AcquireItem':return[line('set',`items[${nested('item').id}]`,withoutId(c.item))];
    case 'PurchaseItem':return[line('set',`items[${nested('item').id}].purchase`,{account:c.account,price:c.price,item:withoutId(c.item)})];
    case 'PurchaseVehicle':return[line('set',`economy.vehicles[${nested('vehicle').id}].purchase`,{account:c.account,price:c.price,vehicle:withoutId(c.vehicle)})];
    case 'TransferItem':return[line('set',`items[${c.itemId}].transfer`,{from:c.from,to:c.to})];
    case 'LoseItem':return[line('set',`items[${c.itemId}].loss`,{expectedOwner:c.expectedOwner,locationId:c.locationId,conditionText:c.conditionText})];
    case 'SetEquipment':return[line('set','protagonist.currentWear',c.equipment)];
    case 'RecordNpcMemory':{
      const m=nested('memory');return[line('push',`npc[${c.npcId}].${c.addToKnownInformation?'knownInformation':c.layer==='longTerm'?'longTermMemories':'memories'}`,{text:m.text,knowledgeKind:c.knowledgeKind,knowledgeSource:m.knowledgeSource,visibility:m.visibility})];
    }
    case 'UpdateItem':return Object.entries(nested('changes')).map(([key,v])=>line(key==='quantity'?'add':'set',`items[${c.itemId}].${key}`,key==='quantity'&&typeof v==='number'&&typeof c.expectedQuantity==='number'?v-c.expectedQuantity:v));
    default:throw new Error(`No text fixture mapping for ${String(c.type)}`);
  }
}
export function variableReply(value:unknown):string{
  const result=object(value);if(!Array.isArray(result.commands))throw new Error('missing fixture commands');
  return `<命令>\n${result.commands.flatMap(commandText).join('\n')}\n</命令>`;
}
