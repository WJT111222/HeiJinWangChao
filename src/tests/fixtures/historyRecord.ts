import type { DomainCommand } from '../../domain/commands';
export function history(eventId: string, changes: Partial<Extract<DomainCommand,{type:'RecordHistory'}>['entry']> = {}): Extract<DomainCommand,{type:'RecordHistory'}> {
  return {type:'RecordHistory',commandId:`record-${eventId}`,evidence:'本幕历史记录',entry:{
    id:`history-${eventId}`,eventId,title:'预约已完成',summary:'预约已完成',knowledgeKind:'established',actorRefs:[],relatedEntryIds:[],...changes,
  }};
}
