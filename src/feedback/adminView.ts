import { summaryNames } from '../domain/memories/configuration';
import { memoryFailureReasons, memorySteps } from '../domain/memories/diagnostics';
import { feedbackAdminPath, feedbackCategories, feedbackStatuses, feedbackErrorStages } from '../services/feedback/contract';
import type { FeedbackStatus } from '../services/feedback/contract';
import type { FeedbackFilters, ListRow, feedbackOverview, getFeedback } from './database';
import { feedbackHeaders } from './http';

const styles = `
:root{color-scheme:dark;--bg:#0b0d0c;--panel:#131614;--text:#e8e4d8;--muted:#a8a89b;--gold:#e3cb8a;--line:#393c32;--risk:#efa991}
@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f6f0e1;--panel:#fffaf0;--text:#25231a;--muted:#575344;--gold:#785822;--line:#c9bea3;--risk:#953b22}}
*{box-sizing:border-box}body{margin:0;font:1rem/1.55 system-ui,sans-serif;color:var(--text);background:var(--bg)}
main,header{max-width:70rem;margin:auto;padding:1.2rem clamp(1rem,4vw,3rem)}header{border-bottom:1px solid var(--line)}
header h1{margin:.25rem 0;font:700 clamp(1.5rem,5vw,2.4rem)/1.2 'Noto Serif SC','Songti SC',serif}nav,.actions{display:flex;gap:.8rem;flex-wrap:wrap;align-items:center}
a{color:var(--gold);text-underline-offset:.2em}p{margin:.4rem 0 .85rem}h2{margin:1.3rem 0 .6rem}h3{margin:.25rem 0 .55rem}
section,.card,fieldset{min-width:0;border:1px solid var(--line);border-radius:.3rem;background:var(--panel);padding:1rem;margin-bottom:1rem}
section h2:first-child{margin-top:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:.7rem}.number{font-size:1.65rem;color:var(--gold)}
ul{padding-left:1.1rem;margin:.25rem 0}li{margin:.35rem 0;overflow-wrap:anywhere}.muted,time{color:var(--muted)}code{overflow-wrap:anywhere}.text{white-space:pre-wrap;overflow-wrap:anywhere}
form{display:grid;gap:.75rem}label{display:grid;gap:.3rem;min-width:0}
input,select,textarea,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);padding:.55rem;border-radius:.25rem;min-width:0}
input,select,textarea{width:100%}textarea{resize:vertical}button{cursor:pointer;justify-self:start;min-height:2.6rem}button.primary{border-color:var(--gold);color:var(--gold)}
summary{cursor:pointer;padding:.4rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:.85rem;border:1px solid var(--line);max-height:25rem;overflow:auto;margin:0;background:var(--bg)}
.danger{color:var(--risk)}.badge{border:1px solid var(--line);padding:.1rem .4rem;border-radius:.25rem}.counts{margin-top:.8rem}
`;
const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, token => escapes[token]);
const time = (value: number) => new Date(value).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
const typeName = (kind: string, category: string | null) =>
  kind === 'error' ? '错误报告' : feedbackCategories[category as keyof typeof feedbackCategories] ?? '反馈建议';
const statusChoices = (status: FeedbackStatus) => Object.entries(feedbackStatuses).map(([value, label]) =>
  `<option value="${value}"${value === status ? ' selected' : ''}>${label}</option>`).join('');
const stages = { ...feedbackErrorStages, story: '正文', variables: '变量', workflow: '工作流', commit: '结算' };
const labelFor = (labels: Record<string, string>, value: string) => Object.hasOwn(labels, value) ? labels[value] : value;

export function adminPage(title: string, content: string, status = 200, headers?: Record<string, string>) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)} · 黑金王朝</title><style>${styles}</style></head>
<body><header><h1>黑金王朝 · 反馈管理</h1><nav aria-label="反馈后台"><a href="${feedbackAdminPath}">总览</a><a href="${feedbackAdminPath}/list">反馈列表</a></nav></header>
<main>${content}</main><script nonce="${nonce}">const button=document.getElementById('copy-diagnostics');if(button)button.addEventListener('click',async()=>{const text=document.getElementById('diagnostics'),status=document.getElementById('copy-status');try{await navigator.clipboard.writeText(text.value);status.textContent='已复制技术诊断';}catch{text.select();status.textContent='请复制选中的技术诊断';}});</script></body></html>`, {
    status, headers: {
      ...feedbackHeaders, ...headers, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}
export function adminMessage(title: string, message: string, status: number, headers?: Record<string, string>) {
  return adminPage(title, `<h2>${e(title)}</h2><p>${e(message)}</p>`, status, headers);
}
function cards(rows: ListRow[]) {
  return rows.length ? rows.map(row => `<article class="card"><h3><a href="${feedbackAdminPath}/${e(row.id)}">${typeName(row.kind, row.category)}</a>
<span class="badge">${feedbackStatuses[row.status]}</span></h3><time>${time(row.created_at)}</time>${row.excerpt ? `<p class="text">${e(row.excerpt)}</p>` : ''}</article>`).join('') : '<p>暂无匹配的反馈。</p>';
}
export function overviewView(data: Awaited<ReturnType<typeof feedbackOverview>>) {
  const count = (status: FeedbackStatus) => data.totals.find(row => row.status === status)?.count ?? 0;
  const metrics = [['反馈总数', data.totals.reduce((total, row) => total + row.count, 0)],
    ['待处理', count('pending')], ['处理中', count('reviewing')], ['已处理', count('fixed') + count('closed')]];
  return adminPage('总览', `<h2>总览</h2><div class="grid counts">${metrics.map(([label, number]) => `<section><div>${label}</div><strong class="number">${number}</strong></section>`).join('')}</div>
<h2>错误分布</h2><div class="grid">${['错误代码', '模型', '失败阶段', '记忆总结任务'].map((label, i) =>
  `<section><h3>${label}</h3>${data.groups[i].length ? `<ul>${data.groups[i].map(row => `<li>${e(i === 2 ? labelFor(stages, row.label) : i === 3 ? labelFor(summaryNames, row.label) : row.label)} · ${row.count}</li>`).join('')}</ul>` : '<p class="muted">暂无记录</p>'}</section>`).join('')}</div>
<h2>最近收到的反馈</h2>${cards(data.newest)}`);
}
export function listView(filter: FeedbackFilters, rows: ListRow[], more: boolean) {
  const options = Object.entries({ '': '全部', error: '错误报告', ...feedbackCategories });
  const select = (labels: Record<string, string>, selected?: string) => Object.entries({ '': '全部', ...labels })
    .map(([value, label]) => `<option value="${e(value)}"${value === selected ? ' selected' : ''}>${e(label)}</option>`).join('');
  const nav = (page: number) => {
    const params = new URLSearchParams({ q: filter.q, type: filter.type, model: filter.model, code: filter.code, stage: filter.stage ?? '', memoryTask: filter.memoryTask ?? '', order: filter.order, page: String(page) });
    return `${feedbackAdminPath}/list?${e(params.toString())}`;
  };
  return adminPage('反馈列表', `<h2>反馈列表</h2><section><form method="get" action="${feedbackAdminPath}/list">
<div class="grid"><label>搜索反馈内容<input name="q" value="${e(filter.q)}" maxlength="150"></label>
<label>反馈类型<select name="type">${options.map(([value, label]) => `<option value="${value}"${filter.type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
<label>模型<input name="model" value="${e(filter.model)}" maxlength="200"></label>
<label>错误代码<input name="code" value="${e(filter.code)}" maxlength="64"></label>
<label>失败阶段<select name="stage">${select(stages, filter.stage)}</select></label>
<label>记忆总结任务<select name="memoryTask">${select(summaryNames, filter.memoryTask)}</select></label>
<label>时间排序<select name="order"><option value="newest">最新优先</option><option value="oldest"${filter.order === 'oldest' ? ' selected' : ''}>最早优先</option></select></label></div>
<button class="primary" type="submit">筛选</button></form></section>${cards(rows)}
<nav aria-label="翻页">${filter.page > 1 ? `<a href="${nav(filter.page - 1)}">上一页</a>` : ''}<span>第 ${filter.page} 页</span>${more ? `<a href="${nav(filter.page + 1)}">下一页</a>` : ''}</nav>`);
}
export function detailView(row: NonNullable<Awaited<ReturnType<typeof getFeedback>>>, updated: boolean) {
  const payload = row.payload, path = `${feedbackAdminPath}/${e(row.id)}`;
  const diagnostic = { id: row.id, receivedAt: new Date(row.created_at).toISOString(), version: payload.version,
    build: payload.build, browser: payload.browser, device: payload.device, ...(payload.kind === 'error' ? { errors: payload.errors } : { category: payload.category }) };
  const pretty = (value: unknown) => e(JSON.stringify(value, null, 2));
  const memory = payload.kind === 'error' ? payload.errors.flatMap(log => log.memory ?
    [`<li>错误 ${log.ref} · ${e(summaryNames[log.memory.task])} · ${e(memorySteps[log.memory.step])} · ${e(memoryFailureReasons[log.memory.reason])}</li>`] : []) : [];
  const attachments = payload.kind === 'error' && payload.attachments?.map(item => `<section><h3>错误 ${item.errorRef} 的附件</h3>
${item.truncated ? '<p class="muted">部分内容已截短。</p>' : ''}
${item.content ? `<details><summary>模型原文</summary><pre>${e(item.content)}</pre></details>` : ''}
${item.reasoning ? `<details><summary>公开思考</summary><pre>${e(item.reasoning)}</pre></details>` : ''}</section>`).join('');
  return adminPage('反馈详情', `<h2>${typeName(payload.kind, payload.kind === 'suggestion' ? payload.category : null)} · ${feedbackStatuses[row.status]}</h2>
<p class="muted">编号 ${e(row.id)} · <time>${time(row.created_at)}</time></p>
${updated ? '<p role="status">处理状态和备注已保存。</p>' : ''}
<section><h3>玩家反馈</h3><p class="text">${e(payload.text || '没有补充说明。')}</p></section>
${payload.kind === 'error' ? `<section><h3>错误日志 · ${payload.errors.length} 条</h3>${memory.length ? `<ul>${memory.join('')}</ul>` : ''}<pre>${pretty(payload.errors)}</pre></section>` : ''}
${attachments || ''}
<section><h3>技术诊断</h3>
<p class="muted">产品版本 ${e(payload.version)} · 构建版本 <code>${e(payload.build ?? '未记录')}</code></p>
<label>可复制的脱敏诊断<textarea id="diagnostics" readonly rows="5" spellcheck="false">${pretty(diagnostic)}</textarea></label>
<button type="button" id="copy-diagnostics">复制技术诊断</button><span id="copy-status" role="status"></span></section>
<section><h3>处理反馈</h3><form method="post" action="${path}"><label>处理状态<select name="status">${statusChoices(row.status)}</select></label>
<label>开发者内部备注<textarea name="note" rows="5" maxlength="4000">${e(row.note)}</textarea></label>
<button class="primary" type="submit" name="action" value="update">保存处理信息</button></form></section>
<details><summary class="danger">删除反馈</summary><p>删除后无法恢复。</p><form method="post" action="${path}"><button class="danger" type="submit" name="action" value="delete">确认删除</button></form></details>`);
}
