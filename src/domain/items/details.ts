import type { ImportantItem } from './schema';

/** Stable category mapping only; never classify by a name or alter old `other` records. */
export const itemCategoryGroup = {
  top: 'clothing', bottom: 'clothing', shoes: 'clothing', accessory: 'clothing',
  device: 'devices', document: 'documents', weapon: 'tools', tool: 'tools', other: 'supplies',
} as const satisfies Record<ImportantItem['category'], string>;
export type ItemGroup = typeof itemCategoryGroup[keyof typeof itemCategoryGroup];
// Optional string-valued itemDetails conventions shared by the prompt catalog and reader.
// They are not a semantic validator; legacy/custom string attributes remain valid data.
export const itemDetailFields: Record<ItemGroup, Record<string, string>> = {
  clothing: { material: '材质', size: '尺码', warmth: '保暖性', protection: '防护性', wearFeatures: '穿着特点' },
  devices: { brandModel: '品牌型号', functions: '设备功能', batteryText: '电量', operationText: '运行情况' },
  documents: { contents: '文件内容', issuer: '签发方', signatureStatus: '签署状态', validUntil: '有效期限', purpose: '用途' },
  tools: { purpose: '主要用途', functionCondition: '功能状况', durabilityText: '耐用情况', reserveText: '燃料或弹药余量' },
  supplies: { purpose: '用途', shelfLife: '保质期', remainingText: '剩余用量', effectText: '使用效果' },
};
