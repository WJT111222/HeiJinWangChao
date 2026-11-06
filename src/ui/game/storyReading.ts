/** A read-only presentation projection. Never use this as Story or AI context data. */
export type StoryReadingBlock =
  | { kind: 'plain' | 'narration'; text: string }
  | { kind: 'dialogue'; speaker: string; isProtagonist: boolean; text: string };

export function parseStoryReading(narrative: string, protagonistName: string): StoryReadingBlock[] {
  if (!narrative) return [];
  // Labels belong at a paragraph/line start. Brackets inside prose or quotes stay literal.
  const starts = [...new Set([0, ...Array.from(narrative.matchAll(/^[ \t]*【/gm), match => match.index)])];
  return starts.map((start, index): StoryReadingBlock => {
    const raw = narrative.slice(start, starts[index + 1] ?? narrative.length);
    const label = /^([ \t]*)【([^【】\r\n]+)】/.exec(raw);
    if (!label || label[2].trim() !== label[2]) return { kind: 'plain', text: raw };
    const text = label[1] + raw.slice(label[0].length);
    // An incomplete/empty speech is ordinary text, including its original label.
    if (!text.trim()) return { kind: 'plain', text: raw };
    return label[2] === '旁白' ? { kind: 'narration', text }
      : { kind: 'dialogue', speaker: label[2], isProtagonist: label[2] === protagonistName, text };
  });
}
