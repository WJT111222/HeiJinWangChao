// 临时阅读投影，不替代 parseStory。标签可以在任意 delta / UTF-8 字节边界断开。
// 遇到未识别的尖括号内容停止预览，等待完整解析，避免把内部块当作小说。
export class StoryStream {
  private phase: 'opening' | 'body' | 'closed' = 'opening';
  private pending = '';
  private narrative = '';

  push(delta: string): string {
    if (this.phase === 'closed') return this.narrative;
    this.pending += delta;
    if (this.phase === 'opening') {
      this.pending = this.pending.trimStart();
      const opening = '<正文>';
      if (opening.startsWith(this.pending)) return this.narrative;
      if (!this.pending.startsWith(opening)) {
        this.phase = 'closed';
        this.pending = '';
        return this.narrative;
      }
      this.pending = this.pending.slice(opening.length);
      this.phase = 'body';
    }
    const boundary = this.pending.indexOf('<');
    if (boundary < 0) {
      this.narrative += this.pending;
      this.pending = '';
    } else {
      this.narrative += this.pending.slice(0, boundary);
      // 不论结束标签是否完整，都不再输出它或其后面的结构化资料。
      this.phase = 'closed';
      this.pending = '';
    }
    return this.narrative;
  }
}
