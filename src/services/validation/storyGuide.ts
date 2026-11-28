import type { z } from 'zod';
import type { StoryRule } from '../../domain/storyDiagnostics';
import { parseOpeningTimeFact } from '../../domain/openingTime';
import { ordinaryGuideGroup, StorySchema, storyGuideReferenceChars, storyGuideReferenceLimit, storyGuideRawLimit } from '../../domain/state';
import { AiError } from '../ai/errors';
import { storyFailure, storySchemaError } from './storyDiagnostics';

function invalidJson(): never {
  throw new AiError('invalid_json', undefined, { storyRule: 'guide_json', storyTag: '变量规划' });
}

// eslint-disable-next-line no-control-regex -- JSON strings exclude unescaped ASCII controls.
const jsonText = /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const jsonScalar = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?)/y;
// eslint-disable-next-line no-control-regex -- Recovered text uses the same control-character boundary.
const singleQuotedText = /'[^'\\\x00-\x1f]*'/y;
const ordinaryFields = new Set(['group', 'subjectHint', 'observedFact', 'textEvidence']);
const textFields = new Set(['observedFact', 'textEvidence']);
const eventFields = new Set(['eventInteraction', 'eventNarration']);
type Story = z.infer<typeof StorySchema>;

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { invalidJson(); }
}

/** Frame each array item and its object keys so a malformed item cannot absorb its neighbors. */
class GuideReader {
  offset = 0;
  constructor(readonly source: string) {}
  private match(pattern: RegExp) {
    pattern.lastIndex = this.offset;
    const match = pattern.exec(this.source);
    if (match) this.offset = pattern.lastIndex;
    return match?.[0];
  }
  peek() {
    this.match(/[ \t\r\n]+/y);
    return this.source[this.offset];
  }
  take(char: string) {
    if (this.peek() !== char) return false;
    this.offset++;
    return true;
  }
  expect(char: string) {
    if (!this.take(char)) invalidJson();
  }
  value(): unknown {
    const first = this.peek(), start = this.offset;
    if (first === '{' || first === '[') {
      // Only locate the end of a nested JSON value here. JSON.parse checks its grammar.
      const stack = [first === '{' ? '}' : ']'];
      this.offset++;
      while (stack.length && this.offset < this.source.length) {
        const char = this.source[this.offset];
        if (char === '"') {
          if (!this.match(jsonText)) invalidJson();
          continue;
        }
        if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
        if (char === '}' || char === ']') if (stack.pop() !== char) invalidJson();
        this.offset++;
      }
      if (stack.length) invalidJson();
      return parseJson(this.source.slice(start, this.offset));
    }
    const token = this.match(first === '"' ? jsonText : jsonScalar);
    if (!token) invalidJson();
    return parseJson(token);
  }
  private wrappedObject() {
    const start = this.offset;
    // A valid legacy JSON string has escaped inner quotes. This recognises only a
    // complete, strictly encoded object enclosed by one erroneous extra quote pair.
    if (!this.match(/"(?=[ \t\r\n]*\{[ \t\r\n]*")/y)) return;
    try {
      const objectStart = this.offset;
      const value = this.value();
      const source = this.source.slice(objectStart, this.offset);
      this.expect('"');
      return { value, source };
    } catch {
      this.offset = start;
      return undefined;
    }
  }
  object(recover = false) {
    this.expect('{');
    const entries = new Map<string, unknown>();
    let singleQuoted = false, wrapped = false, factObject: string | undefined;
    if (!this.take('}')) {
      do {
        this.peek();
        const keyToken = this.match(jsonText);
        if (!keyToken) invalidJson();
        const key = JSON.parse(keyToken) as string;
        if (entries.has(key)) invalidJson();
        this.expect(':');
        const first = this.peek(), from = this.offset;
        if (recover && key === 'observedFact' && first === '"') {
          const embedded = this.wrappedObject();
          if (embedded) {
            entries.set(key, embedded.value);
            factObject = embedded.source;
            wrapped = true;
            continue;
          }
        }
        if (recover && textFields.has(key) && first === "'") {
          if (!this.match(singleQuotedText)) invalidJson();
          singleQuoted = true;
          entries.set(key, null);
          continue;
        }
        if (recover && first === '{' && eventFields.has(key)) {
          entries.set(key, this.object().value);
          continue;
        }
        entries.set(key, this.value());
        if (key === 'observedFact' && first === '{') factObject = this.source.slice(from, this.offset);
      } while (this.take(','));
      this.expect('}');
    }
    return { value: Object.fromEntries(entries), singleQuoted, wrapped, factObject };
  }
}

function ordinaryReference(value: Record<string, unknown>) {
  const group = ordinaryGuideGroup.safeParse(value.group);
  return group.success && Object.keys(value).every(key => ordinaryFields.has(key))
    && (value.subjectHint === undefined || (typeof value.subjectHint === 'string' && !value.subjectHint.trimStart().startsWith('time:')))
    && [...textFields].every(key => value[key] == null || ['string', 'number', 'boolean'].includes(typeof value[key]))
    ? group.data : undefined;
}

function checkLegacyControlKeys(value: unknown) {
  if (typeof value !== 'string') return;
  // Leave malformed legacy strings to the existing opening_json / retrospective_json
  // diagnostics. In a complete object, repeated control keys are ambiguous.
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { return; }
  if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded))
    new GuideReader(value).object();
}

function parseLegacyHints(source: string) {
  const reader = new GuideReader(source), notes = new Set<string>();
  if (!reader.take('[')) invalidJson();
  const variableGuide: Story['variableGuide'] = [], references: NonNullable<Story['variableGuideReferences']> = [];
  if (!reader.take(']')) {
    let index = 0;
    do {
      const first = reader.peek(), start = reader.offset;
      const path = ['variableGuide', index++];
      if (first !== '{') {
        const checked = StorySchema.shape.variableGuide.element.safeParse(reader.value());
        if (!checked.success) throw storySchemaError(checked.error, path);
        variableGuide.push(checked.data);
        continue;
      }
      const { value, wrapped, factObject, singleQuoted } = reader.object(true);
      const opening = value.group === 'time' && value.subjectHint === 'time:opening';
      if (wrapped && !opening) invalidJson();
      if (opening && factObject) {
        // Reject repeated keys instead of letting JSON.parse pick an arbitrary
        // occurrence. Both inputs use the same calendar/time validator as commit.
        new GuideReader(factObject).object();
        try { value.observedFact = JSON.stringify(parseOpeningTimeFact(parseJson(factObject))); }
        catch (error) { throw storyFailure(error); }
        notes.add(wrapped ? '变量规划：已恢复开局时间对象外多余的引号。' : '变量规划：已规范化开局时间对象。');
      } else if (opening || (value.group === 'time' && value.subjectHint === 'time:retrospective'))
        checkLegacyControlKeys(value.observedFact);
      const checked = StorySchema.shape.variableGuide.element.safeParse(value);
      if (checked.success && !singleQuoted) {
        variableGuide.push(checked.data);
        continue;
      }
      const group = ordinaryReference(value);
      if (!group) {
        if (singleQuoted) invalidJson();
        if (!checked.success) throw storySchemaError(checked.error, path);
        invalidJson();
      }
      if (references.length >= storyGuideReferenceLimit || reader.offset - start > storyGuideReferenceChars)
        throw new AiError('invalid_output', undefined, { storyRule: 'guide_reference_limit', guideIndex: index - 1, fieldPath: 'variableGuideReferences' });
      references.push({ group, text: source.slice(start, reader.offset) });
      notes.add('变量规划：普通条目原文已保留为 Variables 参考。');
    } while (reader.take(','));
    reader.expect(']');
  }
  if (reader.peek() !== undefined) invalidJson();
  if (!notes.size) notes.add('变量规划：按原有 JSON 数组协议解析。');
  return { variableGuide, ...(references.length ? { variableGuideReferences: references } : {}), notes: [...notes] };
}

/** Raw notes are data for the current Variables request. Only complete, validated
 * legacy hints can participate in the narrowly scoped legacy protocols. */
export function parseStoryGuide(source: string): {
  guide: Pick<Story, 'variableGuide' | 'variableGuideRaw' | 'variableGuideRawTruncated' | 'variableGuideReferences'>;
  notes: string[];
  failureRule?: StoryRule;
} {
  if (source.length > storyGuideRawLimit)
    return { guide: { variableGuideRaw: source.slice(0, storyGuideRawLimit), variableGuideRawTruncated: true as const,
      variableGuide: [] }, notes: ['变量参考笔记过长，仅保留开头部分。'] };
  try {
    const { notes, ...guide } = parseLegacyHints(source);
    return { guide: { variableGuideRaw: source, ...guide }, notes };
  }
  catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { guide: { variableGuideRaw: source, variableGuide: [] }, notes: [], failureRule: error.details?.storyRule };
  }
}
