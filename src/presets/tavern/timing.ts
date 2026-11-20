// Numeric milestones are observed in this page only. Reading bytes, receiving a
// data event and receiving generated content are intentionally separate clocks.
type Milestone = 'assistantReadyMs' | 'generationEventsDoneMs' | 'settingsReadyMs' | 'budgetStartMs' | 'sentMs' | 'headersMs' | 'firstByteMs'
  | 'firstSseEventMs' | 'firstContentMs' | 'firstArgumentsMs' | 'firstReasoningMs'
  | 'upstreamCompleteMs' | 'wrapperReturnedMs' | 'restoredMs' | 'clientEndMs';
type DeadlinePhase = 'request_preparation' | 'awaiting_headers' | 'awaiting_bytes'
  | 'upstream_read' | 'upstream_incomplete' | 'wrapper_restore';
export interface StoryTiming extends Partial<Record<Milestone, number>> {
  waitedForInitialization?: boolean;
  timeoutSeconds?: number;
  deadlineMs?: number;
  deadlinePhase?: DeadlinePhase;
  userCancelMs?: number;
  userCancelPhase?: DeadlinePhase;
  lastByteMs?: number;
  lastSseEventMs?: number;
  lastProgressMs?: number;
  byteChunks: number;
  comments: number;
  dataEvents: number;
}
export class StoryClock {
  readonly marks: StoryTiming = { byteChunks: 0, comments: 0, dataEvents: 0 };
  reading = false;
  constructor(private readonly start = performance.now()) {}
  elapsed() { return Math.round(performance.now() - this.start); }
  first(key: Milestone) { this.marks[key] ??= this.elapsed(); }
  bytes() {
    const at = this.elapsed();
    this.marks.firstByteMs ??= at;
    this.marks.lastByteMs = at;
    this.marks.byteChunks++;
  }
  frame() {
    const at = this.elapsed();
    this.marks.firstSseEventMs ??= at;
    this.marks.lastSseEventMs = at;
    this.marks.dataEvents++;
  }
  progress(key: 'firstContentMs' | 'firstArgumentsMs' | 'firstReasoningMs') {
    const at = this.elapsed();
    this.marks[key] ??= at;
    this.marks.lastProgressMs = at;
  }
  private phase(): DeadlinePhase {
    const m = this.marks;
    if (m.sentMs === undefined) return 'request_preparation';
    if (m.headersMs === undefined) return 'awaiting_headers';
    if (m.upstreamCompleteMs !== undefined) return 'wrapper_restore';
    if (m.firstByteMs === undefined) return 'awaiting_bytes';
    return this.reading ? 'upstream_read' : 'upstream_incomplete';
  }
  deadline() {
    this.marks.deadlineMs = this.elapsed();
    this.marks.deadlinePhase = this.phase();
  }
  userCancel() {
    this.marks.userCancelMs = this.elapsed();
    this.marks.userCancelPhase = this.phase();
  }
}
