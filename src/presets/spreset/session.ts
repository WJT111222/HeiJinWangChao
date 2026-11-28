import { LiterarySession } from './literarySession';

export class PrototypeSession extends LiterarySession {
  constructor(signal: AbortSignal) {
    super(signal, { title: 'SPreset 实验处理器', path: '/experiments/spreset/sandbox.html', tool: 'submit_scene', field: 'content' });
  }
}
