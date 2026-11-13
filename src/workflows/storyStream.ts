// 临时结构投影，不替代最终严格解析。任何 delta/UTF-8 边界均不公开规划或尾部 JSON。
export class StoryStream {
  private phase: 'planning-open' | 'planning' | 'body-open' | 'body' | 'closed' = 'planning-open';
  private pending = '';
  private narrative = '';
  planning = '';
  bodyStarted = false;

  push(delta: string): string {
    if (this.phase === 'closed') return this.narrative;
    this.pending += delta;
    while (true) {
      if (this.phase === 'planning-open' || this.phase === 'body-open') {
        this.pending = this.pending.trimStart();
        // Display-only: a direct body or an empty planning block can be previewed;
        // final acceptance still belongs exclusively to parseStoryEnvelope.
        const openings = this.phase === 'planning-open' ? ['<thinking>', '<正文>'] : ['<正文>'];
        if (openings.some(opening => this.pending.length < opening.length && opening.startsWith(this.pending))) break;
        const opening = openings.find(opening => this.pending.startsWith(opening));
        if (!opening) { this.phase = 'closed'; break; }
        this.pending = this.pending.slice(opening.length);
        this.phase = opening === '<thinking>' ? 'planning' : 'body';
        if (this.phase === 'body') this.bodyStarted = true;
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
      if (!this.pending.startsWith(closing)) { this.phase = 'closed'; break; }
      this.pending = this.pending.slice(closing.length);
      this.phase = 'body-open';
    }
    if (this.phase === 'closed') this.pending = '';
    return this.narrative;
  }
}
