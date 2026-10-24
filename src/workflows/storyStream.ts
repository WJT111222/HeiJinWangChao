// 临时结构投影，不替代最终严格解析。任何 delta/UTF-8 边界均不公开规划或尾部 JSON。
export class StoryStream {
  private phase: 'planning-open' | 'planning' | 'body-open' | 'body' | 'closed' = 'planning-open';
  private pending = '';
  private narrative = '';
  planning = '';

  push(delta: string): string {
    if (this.phase === 'closed') return this.narrative;
    this.pending += delta;
    while (true) {
      if (this.phase === 'planning-open' || this.phase === 'body-open') {
        this.pending = this.pending.trimStart();
        const opening = this.phase === 'planning-open' ? '<thinking>' : '<正文>';
        if (opening.startsWith(this.pending)) break;
        if (!this.pending.startsWith(opening)) { this.phase = 'closed'; break; }
        this.pending = this.pending.slice(opening.length);
        this.phase = this.phase === 'planning-open' ? 'planning' : 'body';
      }
      const boundary = this.pending.indexOf('<');
      const text = boundary < 0 ? this.pending : this.pending.slice(0, boundary);
      if (this.phase === 'planning') this.planning += text;
      else this.narrative += text;
      this.pending = boundary < 0 ? '' : this.pending.slice(boundary);
      if (boundary < 0) break;
      if (this.phase === 'body') { this.phase = 'closed'; break; }
      const closing = '</thinking>';
      if (closing.startsWith(this.pending)) break;
      if (!this.pending.startsWith(closing) || !this.planning.trim()) { this.phase = 'closed'; break; }
      this.pending = this.pending.slice(closing.length);
      this.phase = 'body-open';
    }
    if (this.phase === 'closed') this.pending = '';
    return this.narrative;
  }
}
