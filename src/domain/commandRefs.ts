const referenceFields = new Set([
  'locationId', 'parentId', 'npcId', 'organizationId', 'itemId', 'taskId', 'eventId', 'parentEventId',
  'linkedEventId', 'linkedTaskIds', 'predecessorEventIds', 'fromTaskId', 'offscreenTaskIds',
  'currentTaskIds', 'keyNpcIds', 'mortgageDebtId', 'collateralAssetIds', 'debtId', 'relatedEntryIds',
  'topItemId', 'bottomItemId', 'shoesItemId', 'primaryWeaponItemId', 'secondaryWeaponItemId',
  'accessoryItemIds', 'currentVehicleAssetId', 'leftNpcId', 'rightNpcId', 'parentNpcId', 'childNpcId', 'headNpcId', 'memoryId', 'sourceMemoryIds',
]);
const referenceObjects = new Set([
  'location', 'npc', 'organization', 'event', 'task', 'item', 'entry', 'vehicle', 'property', 'asset', 'debt', 'memory', 'actorRef',
  'properties', 'vehicles', 'otherAssets', 'debts',
  'actorRefs', 'ownerRef', 'affectedEntityRefs', 'expectedOwner', 'from', 'to', 'transfer', 'loss', 'changes',
  'purchase', 'profile', 'specialProfile', 'usualLocations', 'relationshipNetwork', 'relations', 'leadership',
  'members', 'departments', 'value', 'handoff', 'continuation', 'protagonistEntry', 'currentWear', 'equipment', 'state',
]);
const actorObjects = new Set(['actorRef','actorRefs','ownerRef','affectedEntityRefs','expectedOwner','from','to']);

export function structuredRefs(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return referenceFields.has(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(item => structuredRefs(item, key));
  if (!value || typeof value !== 'object' || key && !referenceObjects.has(key)) return [];
  const refs = Object.entries(value).flatMap(([name, item]) => structuredRefs(item, name));
  if (actorObjects.has(key) && 'kind' in value && 'id' in value && typeof value.id === 'string')
    refs.push(value.id);
  return refs;
}
