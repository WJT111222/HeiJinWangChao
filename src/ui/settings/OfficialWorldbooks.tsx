import { useState } from 'react';
import { officialIds, type OfficialId, type OfficialSelection } from '../../domain/worldbook/mainWorldbook';
import { readPromptResource } from '../../prompts/loader';
import { promptManifest } from '../../prompts/manifest';

const purposes = ['时代、地域、社会生活与人物起点', '产业、组织、资本与地下社会的运行逻辑'];
export function OfficialWorldbooks({ flags, busy, toggle, copy }: {
  flags: OfficialSelection | null; busy: boolean; toggle: (id?: OfficialId, enabled?: boolean) => void;
  copy: (id: OfficialId, title: string) => void;
}) {
  const [text, setText] = useState<Partial<Record<OfficialId, string>>>({});
  async function show(id: OfficialId) {
    try { const body = await readPromptResource(id); setText(old => ({ ...old, [id]: body })); }
    catch { setText(old => ({ ...old, [id]: '正文资源校验失败，请刷新重试。' })); }
  }
  return <section className="wb-official" aria-label="内置主世界书">
    <div className="wb-detail-head"><h3>内置主世界书</h3>
      <button className="wb-link" disabled={busy} onClick={() => toggle()}>恢复官方默认开关</button></div>
    {officialIds.map((id, i) => {
      const module = promptManifest.modules.find(m => m.id === id)!;
      return <article key={id} className="wb-official-book">
        <div className="wb-detail-head"><strong>{module.title}</strong>
          <label className="toggle"><input type="checkbox" disabled={busy || !flags} checked={flags?.[id] ?? false}
            aria-label={'启用「' + module.title + '」'} onChange={e => toggle(id, e.target.checked)} /></label></div>
        <small className="muted">官方主世界书 · v{module.version} · {purposes[i]}</small>
        <div className="wb-actions"><button className="wb-link" disabled={busy || !flags} onClick={() => copy(id, module.title)}>复制为自定义世界书</button></div>
        <details onToggle={e => { if (e.currentTarget.open) void show(id); }}>
          <summary>查看完整正文</summary><pre>{text[id] ?? '正在读取正文…'}</pre></details>
      </article>;
    })}
  </section>;
}
