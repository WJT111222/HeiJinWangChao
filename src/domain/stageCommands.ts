import type { DomainCommand } from './commands';

type CommandType = DomainCommand['type'];

export const offscreenGroups = {
  worldCommands: [
    'CreateNpc', 'UpdateNpc', 'RecordNpcMemory', 'CreateLocation', 'CreateOrganization',
    'UpdateOrganization', 'RecordOrgRelation', 'RecordHistory', 'ApplyHaremBackground',
  ],
  taskCommands: ['SaveTask'],
  eventCommands: ['SaveEvent', 'DeleteEvent'],
} as const satisfies Record<string, readonly CommandType[]>;

export const stageCommands = {
  entities: [
    'CreateNpc', 'UpdateNpc', 'RecordNpcMemory', 'PromoteNpc', 'RegisterContact',
    'CreateOrganization', 'CreateLocation', 'ApplyHaremChanges',
  ],
  scene: [
    'UpdateProtagonist', 'SetEquipment', 'SpendFunds', 'TransferFunds', 'ReceiveIncome',
    'Borrow', 'RepayDebt', 'PurchaseItem', 'PurchaseVehicle', 'AcquireItem', 'UpdateItem',
    'LoseItem', 'TransferItem', 'SetWorldClock', 'SetSceneDescription', 'InitializeOpeningState',
    'UpdateOrganization', 'RecordOrgRelation', 'RecordOrgKnowledge', 'SaveEvent', 'SaveTask',
  ],
  offscreen: Object.values(offscreenGroups).flat(),
} as const satisfies Record<string, readonly CommandType[]>;

export type VariablePhase = keyof typeof stageCommands;

export function commandsForPhase(phase: VariablePhase, mode: 'opening' | 'regular', historical = false) {
  const registered: readonly CommandType[] = stageCommands[phase];
  return registered.filter(type =>
    (type !== 'InitializeOpeningState' || mode === 'opening') &&
    (type !== 'RecordHistory' || historical));
}
