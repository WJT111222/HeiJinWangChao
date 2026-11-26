import type { PackageOverride } from '../package';

export const oracleId = 'meowssiah';
export const oracleDefinition = { id: oracleId, title: '小猫之神', author: 'SoliUmbra',
  version: '3.0-Preview-01.301-694da4858898712482670b68d220ccedcdd8d748203c355af381b068d44b0d16', lockedOff: [] };

// Only the stock inner-monologue presentation changed between these two editions.
export const previousOracleVersion = '3.0-Preview-01.301-3d76d24b5bb83f058372d1b55d2d51367182ced3748595c6f76ede5b69192a0b';
export function upgradeOraclePreferences(preferences: PackageOverride): PackageOverride {
  if (preferences.version !== previousOracleVersion) return preferences;
  const entries = { ...preferences.entries };
  const id = 'eb65ec28-14a7-401c-887a-e6e22c3295c9';
  const oldDefault = '在剧情中穿插角色的内心活动，格式如下\n<details><summary>内心-角色名</summary>\n内心话\n</details>';
  if (entries[id]?.content === oldDefault) {
    entries[id] = { ...entries[id] };
    delete entries[id].content;
  }
  return { ...preferences, entries, version: oracleDefinition.version };
}
