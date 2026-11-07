import type { ImportantItem } from '../../domain/items/schema';
import type { GameState } from '../../domain/state';
import { itemCategoryGroup, itemDetailFields } from '../../domain/items/details';
import type { ItemGroup } from '../../domain/items/details';
export const inventoryGroups = [
  { id: 'all', label: '全部' }, { id: 'clothing', label: '衣物穿戴' },
  { id: 'devices', label: '电子设备' }, { id: 'documents', label: '证件文件' },
  { id: 'tools', label: '工具与武器' }, { id: 'supplies', label: '生活用品与杂物' },
] as const;
export type InventoryFilter = typeof inventoryGroups[number]['id'];
export function protagonistInventory(items: readonly ImportantItem[], hero: GameState['protagonist']) {
  const owned = items.filter(item => item.ownerRef?.kind === 'protagonist' && item.ownerRef.id === hero.id);
  const wear = hero.currentWear;
  const equipped = new Set([wear.topItemId, wear.bottomItemId, wear.shoesItemId,
    wear.primaryWeaponItemId, wear.secondaryWeaponItemId, ...wear.accessoryItemIds].filter(Boolean));
  return { items: owned, equipped, counts: Object.fromEntries(inventoryGroups.map(group => [group.id,
    group.id === 'all' ? owned.length : owned.filter(item => itemCategoryGroup[item.category] === group.id).length,
  ])) as Record<InventoryFilter, number> };
}
const descriptionKeys = ['description', '描述', '物品描述'];
export function itemDescription(item: ImportantItem) {
  return item.description?.trim() ? item.description
    : descriptionKeys.map(key => item.itemDetails?.[key]).find(value => value?.trim()) ?? '暂无描述';
}
export function itemAttributes(item: ImportantItem): { key: string; label: string; value: string }[] {
  const allowed = itemDetailFields[itemCategoryGroup[item.category]];
  const all = Object.values(itemDetailFields).flatMap(fields => [...Object.keys(fields), ...Object.values(fields)]);
  const applicable = new Set([...Object.keys(allowed), ...Object.values(allowed)]);
  return Object.entries(item.itemDetails ?? {}).filter(([key, value]) => value.trim() && !descriptionKeys.includes(key)
    && (!all.includes(key) || applicable.has(key))).map(([key, value]) => ({ key, label: Object.hasOwn(allowed, key) ? allowed[key] : key, value }));
}
export { itemCategoryGroup };
export type { ItemGroup };
