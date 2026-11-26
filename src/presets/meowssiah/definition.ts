export const oracleId = 'meowssiah';
export const oracleDefinition = { id: oracleId, title: '小猫之神', author: 'SoliUmbra',
  version: '3.0-Preview-01.301-694da4858898712482670b68d220ccedcdd8d748203c355af381b068d44b0d16', lockedOff: [] };

// Only the stock inner-monologue presentation changed between these two editions.
export const previousOracleVersion = '3.0-Preview-01.301-3d76d24b5bb83f058372d1b55d2d51367182ced3748595c6f76ede5b69192a0b';
export function upgradeOraclePreferences<T extends { version: string }>(preferences: T): T {
  return preferences.version === previousOracleVersion ? { ...preferences, version: oracleDefinition.version } : preferences;
}
