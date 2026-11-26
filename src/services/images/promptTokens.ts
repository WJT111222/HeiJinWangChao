type 结构化角色词组片段 = {
  名称: string;
  内容: string;
};

type 结构化词组结果 = {
  基础: string;
  角色列表: 结构化角色词组片段[];
};

export const 清理生图词组输出 = (rawText: string): string => {
  return (rawText || '')
    .replace(/^```(?:text|markdown|json)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^【?生图词组】?[:：]?/i, '')
    .trim();
};

const 按逗号拆分提示词 = (text: string): string[] =>
  (text || '')
    .replace(/\r?\n+/g, ', ')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const 提取权重组内部提示词 = (token: string): string[] => {
  const source = (token || '').trim();
  if (!source.includes('::')) return [];
  const start = source.indexOf('::');
  const end = source.lastIndexOf('::');
  if (start < 0 || end <= start + 2) return [];
  return 按逗号拆分提示词(source.slice(start + 2, end));
};

const 规范化提示词键 = (token: string): string =>
  (token || '')
    .trim()
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)?::/g, '')
    .replace(/::$/g, '')
    .replace(/^[([{<]+|[)\]}>]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const 按提示词单元拆分 = (text: string): string[] => {
  const source = (text || '').replace(/\r?\n+/g, ', ').trim();
  if (!source) return [];
  const tokens: string[] = [];
  let current = '';
  let index = 0;
  let weightDepth = 0;
  while (index < source.length) {
    const ch = source[index];
    const nextTwo = source.slice(index, index + 2);
    if (nextTwo === '::') {
      weightDepth = weightDepth === 0 ? 1 : 0;
      current += nextTwo;
      index += 2;
      continue;
    }
    if (ch === ',' && weightDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) tokens.push(trimmed);
      current = '';
      index += 1;
      continue;
    }
    current += ch;
    index += 1;
  }
  const tail = current.trim();
  if (tail) tokens.push(tail);
  return tokens;
};

const 去重提示词片段 = (tokens: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  tokens.forEach((token) => {
    const normalized = token.replace(/^[-*•\s]+/, '').trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
};

export const 合并并去重提示词单元 = (...parts: Array<string | undefined>): string[] => {
  const result: string[] = [];
  const seenKeys = new Set<string>();
  const seenTokens = new Set<string>();
  parts.forEach((part) => {
    按提示词单元拆分((part || '').trim()).forEach((token) => {
      const normalizedToken = token.trim();
      if (!normalizedToken) return;
      const tokenKey = normalizedToken.toLowerCase();
      if (seenTokens.has(tokenKey)) return;

      const childTokens = 提取权重组内部提示词(normalizedToken);
      const keys = (childTokens.length > 0 ? childTokens : [normalizedToken])
        .map(规范化提示词键)
        .filter(Boolean);
      if (keys.length > 0 && keys.every((key) => seenKeys.has(key))) {
        return;
      }

      seenTokens.add(tokenKey);
      keys.forEach((key) => seenKeys.add(key));
      result.push(normalizedToken);
    });
  });
  return result;
};

const 合并正向提示词片段 = (...parts: Array<string | undefined>): string => {
  const tokens = 合并并去重提示词单元(...parts);
  return 规范化Artist标签大小写(tokens.join(', '));
};

const 提取最后一个标签完整块 = (rawText: string, tagName: string): string => {
  const source = (rawText || '').trim();
  if (!source) return '';
  const regex = new RegExp(`<\\s*${tagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tagName}\\s*>`, 'gi');
  const matches = source.match(regex);
  return Array.isArray(matches) && matches.length > 0 ? (matches[matches.length - 1] || '').trim() : '';
};

const 提取最后一个标签文本 = (rawText: string, tagName: string): string => {
  const block = 提取最后一个标签完整块(rawText, tagName);
  if (!block) return '';
  const source = block.trim();
  return source
    .replace(new RegExp(`^<\\s*${tagName}\\b[^>]*>`, 'i'), '')
    .replace(new RegExp(`<\\s*\\/\\s*${tagName}\\s*>$`, 'i'), '')
    .trim();
};

const 提取最后一个标签文本列表 = (rawText: string, tagNames: string[]): string => {
  for (const tagName of tagNames) {
    const text = 提取最后一个标签文本(rawText, tagName);
    if (text) return text;
  }
  return '';
};

const 规范化Artist标签大小写 = (rawText: string): string =>
  (rawText || '').replace(/\bArtist\s*:/g, 'artist:');

const 移除全部结构标签 = (rawText: string): string =>
  (rawText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const 移除序号角色名称前缀 = (rawText: string): string =>
  (rawText || '').replace(/(^|\n)\s*\[\d+\]\s*[^|\n<>]{1,80}\|/g, '$1').trim();

const 移除思考标签块 = (rawText: string): string =>
  (rawText || '')
    .replace(/<\s*thinking\s*>[\s\S]*?<\s*\/\s*thinking\s*>/gi, '')
    .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '')
    .trim();

const 转换NAI括号权重语法 = (rawText: string): string => {
  let output = rawText || '';
  for (let i = 0; i < 8; i += 1) {
    const next = output.replace(/\(([^()]+?)\s*:\s*(-?\d+(?:\.\d+)?)\)/g, (_match, content, weight) => {
      const cleanedContent = 清理生图词组输出(String(content || ''));
      const cleanedWeight = String(weight || '').trim();
      if (!cleanedContent || !cleanedWeight) return '';
      return `${cleanedWeight}::${cleanedContent}::`;
    });
    if (next === output) break;
    output = next;
  }
  for (let i = 0; i < 8; i += 1) {
    const next = output.replace(/\(\s*(-?\d+(?:\.\d+)?)::([\s\S]*?)::\s*\)/g, (_match, weight, content) => {
      const cleanedContent = 清理生图词组输出(String(content || ''));
      const cleanedWeight = String(weight || '').trim();
      if (!cleanedContent || !cleanedWeight) return '';
      return `${cleanedWeight}::${cleanedContent}::`;
    });
    if (next === output) break;
    output = next;
  }
  return 规范化Artist标签大小写(output);
};

const 清洗NAI脏权重语法 = (rawText: string): string => {
  let output = rawText || '';

  for (let i = 0; i < 8; i += 1) {
    const next = output.replace(
      /(-?\d+(?:\.\d+)?)::\s*([^:]+?)\s*,\s*::\s*(-?\d+(?:\.\d+)?)::\s*([^:]+?)::/g,
      (_match, leftWeight, leftContent, rightWeight, rightContent) => {
        const normalizedLeftWeight = String(leftWeight || '').trim();
        const normalizedRightWeight = String(rightWeight || '').trim();
        const normalizedLeftContent = 清理生图词组输出(String(leftContent || ''));
        const normalizedRightContent = 清理生图词组输出(String(rightContent || ''));
        const parts = [
          normalizedLeftWeight && normalizedLeftContent
            ? `${normalizedLeftWeight}::${normalizedLeftContent}::`
            : '',
          normalizedRightWeight && normalizedRightContent
            ? `${normalizedRightWeight}::${normalizedRightContent}::`
            : '',
        ].filter(Boolean);
        return parts.join(', ');
      },
    );
    if (next === output) break;
    output = next;
  }

  for (let i = 0; i < 8; i += 1) {
    const next = output.replace(/,\s*::\s*(-?\d+(?:\.\d+)?)::\s*([^:]+?)::/g, (_match, weight, content) => {
      const normalizedWeight = String(weight || '').trim();
      const normalizedContent = 清理生图词组输出(String(content || ''));
      if (!normalizedWeight || !normalizedContent) return '';
      return `, ${normalizedWeight}::${normalizedContent}::`;
    });
    if (next === output) break;
    output = next;
  }

  for (let i = 0; i < 8; i += 1) {
    const next = output.replace(/(-?\d+(?:\.\d+)?)::\s*([^:]+?)\s*,\s*::/g, (_match, weight, content) => {
      const normalizedWeight = String(weight || '').trim();
      const normalizedContent = 清理生图词组输出(String(content || ''));
      if (!normalizedWeight || !normalizedContent) return '';
      return `${normalizedWeight}::${normalizedContent}::, `;
    });
    if (next === output) break;
    output = next;
  }

  output = output
    .replace(/,\s*,+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();

  return output;
};

const 清洗最终主体提示词 = (rawText: string, options?: { isNovelAI?: boolean }): string => {
  const withoutThinking = 移除思考标签块(rawText);
  const 基础段内容 = 提取最后一个标签文本(withoutThinking, '基础');
  const 角色块内容 = 提取最后一个标签文本(withoutThinking, '角色');
  const 序号角色列表 = 解析序号角色列表(角色块内容 || withoutThinking);
  if (序号角色列表.length > 0) {
    const safeBase = 规范化Artist标签大小写(清理生图词组输出(基础段内容 || ''));
    const safeRoles = 序号角色列表
      .map((item) => 规范化Artist标签大小写(清理生图词组输出(item?.内容 || '')))
      .filter(Boolean);
    const mergedStructured = options?.isNovelAI
      ? [safeBase, ...safeRoles].filter(Boolean).join(' | ')
      : [safeBase, ...safeRoles].filter(Boolean).join('; ');
    if (mergedStructured.trim()) {
      return options?.isNovelAI ? 保守补全NAI权重语法(mergedStructured) : mergedStructured.trim();
    }
  }
  const extracted =
    提取最后一个标签文本列表(withoutThinking, ['提示词', '词组', '生图词组']) ||
    提取最后一个标签文本(withoutThinking, '基础') ||
    withoutThinking;
  const withoutResidualTags = 移除序号角色名称前缀(
    移除全部结构标签(
      (extracted || '')
        .replace(/<\s*\/?\s*提示词\s*>/gi, '')
        .replace(/<\s*\/?\s*词组\s*>/gi, '')
        .replace(/<\s*\/?\s*生图词组\s*>/gi, '')
        .trim(),
    ),
  );
  const cleaned = 规范化Artist标签大小写(清理生图词组输出(withoutResidualTags));
  if (!cleaned) return '';
  // [修复] 非 NovelAI 路径剥离 CJK 字符段：词组转化器偶尔漏出中文短语（如"主神空间""轮回者"），
  // SDXL/Flux 会把这些中文当文字画到图上。NovelAI 路径保留 CJK（NAI 模型支持中文 tag）。
  if (!options?.isNovelAI) {
    const 剥离CJK = cleaned
      .split(/[,，;；]/)
      .map((item) => item.trim())
      .filter((item) => item && !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(item))
      .join(', ');
    return 剥离CJK.trim() || cleaned;
  }
  return 保守补全NAI权重语法(cleaned);
};

const 解析标签属性 = (raw: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const regex = /([^\s=]+)\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw || ''))) {
    const key = (match[1] || '').trim();
    const value = (match[2] || '').trim();
    if (key && value) attrs[key] = value;
  }
  return attrs;
};

const 解析序号角色列表 = (rawText: string): 结构化角色词组片段[] => {
  const source = (rawText || '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];
  const roles: 结构化角色词组片段[] = [];
  const regex = /(?:^|\n)\s*\[(\d+)\]\s*([\s\S]*?)(?=(?:\n\s*\[\d+\]\s*)|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    const index = Number(match[1] || String(roles.length + 1));
    const payload = 清理生图词组输出(match[2] || '');
    if (!payload) continue;
    const separatorIndex = payload.indexOf('|');
    const maybeName = separatorIndex >= 0 ? payload.slice(0, separatorIndex).trim() : '';
    const maybeContent = separatorIndex >= 0 ? payload.slice(separatorIndex + 1).trim() : payload;
    const safeName = maybeName && !/,/.test(maybeName) ? maybeName : `角色${index}`;
    const safeContent = 清理生图词组输出(maybeContent);
    if (!safeContent) continue;
    roles.push({
      名称: safeName,
      内容: safeContent,
    });
  }
  return roles;
};

const 解析结构化词组结果 = (rawText: string): 结构化词组结果 | null => {
  const source = (提取最后一个标签完整块(rawText, '提示词结构') || rawText || '').trim();
  if (!source) return null;
  const 基础完整块 = 提取最后一个标签完整块(source, '基础');
  const 基础 = 基础完整块 ? 提取最后一个标签文本(基础完整块, '基础') : 提取最后一个标签文本(source, '基础');
  const 角色列表: 结构化角色词组片段[] = [];
  const roleRegex = /<\s*角色\b([^>]*)>([\s\S]*?)<\s*\/\s*角色\s*>/gi;
  let roleMatch: RegExpExecArray | null;
  let roleIndex = 0;
  while ((roleMatch = roleRegex.exec(source))) {
    const attrs = 解析标签属性(roleMatch[1] || '');
    const 原始内容 = roleMatch[2] || '';
    const 序号角色 = 解析序号角色列表(原始内容);
    if (序号角色.length > 0 && !attrs.名称 && !attrs.name && !attrs.role && !attrs.角色) {
      序号角色.forEach((item) => {
        角色列表.push(item);
        roleIndex += 1;
      });
      continue;
    }
    const 名称 = (attrs.名称 || attrs.name || attrs.role || attrs.角色 || `角色${roleIndex + 1}`).trim();
    const 内容 = 清理生图词组输出(原始内容);
    if (名称 || 内容) {
      角色列表.push({ 名称, 内容 });
      roleIndex += 1;
    }
  }
  if (角色列表.length <= 0) {
    const 序号角色列表 = 解析序号角色列表(提取最后一个标签文本(source, '角色'));
    if (序号角色列表.length > 0) {
      角色列表.push(...序号角色列表);
    }
  }
  if (基础 || 角色列表.length > 0) {
    return {
      基础: 清理生图词组输出(基础),
      角色列表,
    };
  }

  const bracketSource = source.replace(/\r\n/g, '\n');
  const blockRegex = /【\s*(基础|角色(?:\s*[:：]\s*([^\]】]+))?)\s*】([\s\S]*?)(?=【\s*(?:基础|角色)|$)/g;
  let blockMatch: RegExpExecArray | null;
  let bracketBase = '';
  const bracketRoles: 结构化角色词组片段[] = [];
  while ((blockMatch = blockRegex.exec(bracketSource))) {
    const section = (blockMatch[1] || '').trim();
    const roleName = (blockMatch[2] || '').trim();
    const content = 清理生图词组输出(blockMatch[3] || '');
    if (!content) continue;
    if (section.startsWith('基础')) {
      bracketBase = content;
      continue;
    }
    bracketRoles.push({
      名称: roleName || `角色${bracketRoles.length + 1}`,
      内容: content,
    });
  }
  if (!bracketBase && bracketRoles.length <= 0) return null;
  return {
    基础: bracketBase,
    角色列表: bracketRoles,
  };
};

const 清理NAI角色段占位词 = (text: string): string => {
  const source = 清理生图词组输出(text)
    .replace(/^\[\d+\]\s*/u, '')
    .replace(/^(?:主体|角色\s*\d+|character\s*\d+|role\s*\d+|subject)\s*[:：-]?\s*/iu, '')
    .trim();
  if (!source) return '';
  return 去重提示词片段(按逗号拆分提示词(source))
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^(?:主体|角色\s*\d+|character\s*\d+|role\s*\d+|subject)\s*[:：-]?$/iu.test(token))
    .join(', ');
};

export const 归一化单段词组转化器输出 = (rawText: string, options?: { isNovelAI?: boolean }): string => {
  const sanitizedRawText = 移除思考标签块(rawText);
  const structured = 解析结构化词组结果(sanitizedRawText);
  const merged = structured
    ? 合并正向提示词片段(
        structured.基础,
        ...(structured.角色列表 || []).map((role) => 清理NAI角色段占位词(role?.内容 || '')),
      )
    : 清洗最终主体提示词(sanitizedRawText, { isNovelAI: options?.isNovelAI });
  return options?.isNovelAI ? 保守补全NAI权重语法(merged) : 清理生图词组输出(merged);
};

const 保守补全NAI权重语法 = (rawText: string): string => {
  const cleaned = 清理生图词组输出(清洗NAI脏权重语法(转换NAI括号权重语法(移除思考标签块(rawText))));
  if (!cleaned) return '';
  return cleaned;
};
