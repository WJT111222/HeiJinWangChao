export const openingGuideTimes = { startAt: '2026-10-15T17:45:00+08:00', endAt: '2026-10-15T18:05:00+08:00' };
export const openingGuideEntry = (fact: unknown) => ({
  group: 'time', subjectHint: 'time:opening', observedFact: fact, textEvidence: '开局实际经过的时间',
});
export function wrappedOpeningGuide(value = openingGuideTimes) {
  return JSON.stringify(openingGuideEntry(value))
    .replace('"observedFact":', '"observedFact":"').replace('},"textEvidence"', '}","textEvidence"');
}
export const ordinaryGuideRaw = '{ "group":"npc", "subjectHint":"npc-a", "observedFact":\'值班员整理了资料\' }';
