import type { LoadedPreset } from './package';
import type { AiMessage } from '../services/ai/protocols';

export function historyForSending(messages: AiMessage[], preset: LoadedPreset): AiMessage[] {
  const rules = (preset.data.extensions?.regex_scripts ?? [])
    .filter((rule) => !rule.disabled && rule.promptOnly && rule.placement.includes(2))
    .map((rule) => {
      const parsed = /^\/(.*)\/([a-z]*)$/s.exec(rule.findRegex);
      if (rule.substituteRegex || rule.trimStrings?.length) throw new Error('不支持该发送正则的宏或裁剪选项');
      return { rule, regex: parsed ? new RegExp(parsed[1], parsed[2]) : new RegExp(rule.findRegex) };
    });
  return messages.map((m, index) => {
    if (m.role !== 'assistant') return m;
    let content = m.content;
    const depth = messages.length - 1 - index;
    for (const { rule, regex } of rules) {
      if (
        (rule.minDepth != null && rule.minDepth >= 0 && depth < rule.minDepth) ||
        (rule.maxDepth != null && rule.maxDepth >= 0 && depth > rule.maxDepth)
      )
        continue;
      content = content.replace(
        regex,
        rule.replaceString.replace(/\{\{match\}\}/gi, () => '$&'),
      );
    }
    return { ...m, content };
  });
}
