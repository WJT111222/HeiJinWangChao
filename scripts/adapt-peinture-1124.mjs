import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import manifest from '../src/presets/resources/peinture-1124-manifest.json' with { type: 'json' };

const clockScript = 'f80c9901-cdef-4511-a234-123104501103';
const root = new URL('../src/presets/resources/', import.meta.url);

function between(text, start, stop) {
  const begin = text.indexOf(start), end = text.indexOf(stop, begin + start.length);
  if (begin < 0 || end < 0) throw new Error('1124 脚本结构与审核记录不符。');
  return text.slice(begin, end);
}

// Only the two message labels and the pure history/length preparation functions come from 1124.
// All network handling, real upstream status checks and tool restoration use the reviewed host edition.
function adaptMain(reviewed, source) {
  function replaceSpan(text, start, stop) {
    return text.replace(between(text, start, stop), () => between(source, start, stop));
  }
  let script = replaceSpan(reviewed, 'const READ_INSTRUCTION', '\n');
  script = replaceSpan(script, 'const DESCRIPTION_HEADER', '\n');
  script = replaceSpan(script, 'function filterRecentWaveExtras', 'function transformRequest');
  // Formal journals hold the narrative itself, without SillyTavern's <content> envelope.
  return script.replace('资料区为空，请保持角色资料和聊天记录条目位于两条边界之间', '示例和聊天记录区为空，本轮使用原始消息')
    .replace('起点在角色资料前，终点在聊天记录后', '起点在对话示例前，终点在聊天记录后')
    .replace('[/资料区为空/', '[/资料区为空|聊天记录区为空/')
    .replace('把角色资料和聊天记录条目放在两条资料边界之间，再发送。', '无历史的开局可正常发送。已有人物和世界资料继续保留在消息中。')
    .replace('if(!story)return 0;', 'if(!story && history)story=raw;if(!story)return 0;')
    .replace('王朝 1118 适配', '王朝 1124 适配');
}

function adapt(source, reviewed) {
  const original = JSON.parse(source);
  const scripts = reviewed.extensions.tavern_helper.scripts;
  const originalScripts = original.extensions.tavern_helper.scripts;
  const main = scripts.find(s => s.id === originalScripts[0].id);
  main.info = '正式世界和人物资料保留在消息中，示例和历史按边界整理。输出采用宿主正文通道。';
  main.content = adaptMain(String(main.content), String(originalScripts[0].content));
  const launcher = scripts.find(s => s.id === originalScripts[1].id);
  launcher.info = '打开王朝 React 潮汐控制台。';
  launcher.content = String(launcher.content).replace('1118 peinture', '1124 anime');
  scripts.push({ id: clockScript, name: '浪潮 · 主线时序校对', enabled: true, data: {},
    button: { enabled: true, buttons: [{ name: '主线时序', visible: true }] },
    content: "eventOn(getButtonEvent('主线时序'), () => parent.dispatchEvent(new parent.Event('heijin:open-preset-clock')));",
  });
  const prompts = original.prompts.map(p => {
    if (manifest.lockedOff.includes(p.identifier)) return { ...p, content: '', enabled: false };
    if (p.identifier !== 'jailbreak') return p;
    // Keep the author's six literary planning sections, perspective precedence and prose guidance.
    // The Story envelope and official state fields are supplied by the game at the final boundary.
    const introduction = between(p.content, '浪潮，咱们准备怎样', '实际回复先交规划');
    const planning = between(p.content, '一 承接与现场', '{{getvar::wave_cfg_custom_format}}');
    return { ...p, content: '<output_contract>\n' + introduction + '\n' + planning +
      '\n如需呈现公开创作安排，使用游戏的 thinking 块。按本轮游戏协议交付正文和记忆。\n</output_contract>' };
  });
  const { prompt_order, temperature, top_p, frequency_penalty, presence_penalty, function_calling, squash_system_messages } = original;
  for (const table of prompt_order) for (const row of table.order) {
    if (manifest.lockedOff.includes(row.identifier)) row.enabled = false;
  }
  // Display HTML, the original executables, secondary channels and extension settings never enter the host.
  return JSON.stringify({ prompts, prompt_order, temperature, top_p, frequency_penalty, presence_penalty, function_calling, squash_system_messages,
    extensions: { tavern_helper: { scripts }, regex_scripts: original.extensions.regex_scripts.filter(rule => rule.promptOnly && rule.placement.includes(2)) } }, null, 2) + '\n';
}

const [path, flag] = process.argv.slice(2);
if (!path || (flag && flag !== '--check')) throw new Error('用法：node scripts/adapt-peinture-1124.mjs <1124 原件> [--check]');
const source = await readFile(path);
if (createHash('sha256').update(source).digest('hex') !== manifest.sourceSha256) throw new Error('1124 原件 SHA-256 不匹配。');
const reviewed = JSON.parse(await readFile(new URL('peinture-1118.json', root), 'utf8'));
const adapted = adapt(source.toString('utf8'), reviewed);
const original = JSON.parse(source.toString('utf8'));
const consoleSource = original.extensions.tavern_helper.scripts[1].content;
const mascot = /const tideMascot = "data:image\/png;base64,([A-Za-z0-9+/=]+)";/.exec(consoleSource);
if (!mascot) throw new Error('原件缺少潮汐控制台图像。');
const mascotBytes = Buffer.from(mascot[1], 'base64');
const icon = new URL('peinture-1124-mascot.png', root);
const target = new URL('peinture-1124.json', root);
if (flag === '--check') {
  if (!mascotBytes.equals(await readFile(icon)) || await readFile(target, 'utf8') !== adapted) throw new Error('仓内 1124 适配件与核验重建结果不同。');
} else {
  await writeFile(target, adapted);
  await writeFile(icon, mascotBytes);
}
console.log('1124 适配件 SHA-256', createHash('sha256').update(adapted).digest('hex'));
