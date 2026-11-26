interface WorkflowNode {
  class_type?: string;
  title?: string;
  _meta?: { title?: string };
  inputs?: Record<string, unknown>;
}
const 判断ComfyUI正向文本节点 = (node: WorkflowNode): boolean => {
  const title = String(node?._meta?.title || node?.title || '').toLowerCase();
  const text = String(node?.inputs?.text || '').toLowerCase();
  return (
    /positive|prompt|正向|正面|提示词/.test(title) ||
    (!/negative|负向|负面|反向/.test(title) && !/lowres|bad anatomy|worst quality|watermark|nsfw/.test(text))
  );
};

const 判断ComfyUI负向文本节点 = (node: WorkflowNode): boolean => {
  const title = String(node?._meta?.title || node?.title || '').toLowerCase();
  const text = String(node?.inputs?.text || '').toLowerCase();
  return (
    /negative|负向|负面|反向/.test(title) ||
    /lowres|bad anatomy|worst quality|watermark|bad hands|blurry/.test(text)
  );
};

const 展开嵌套ComfyUI工作流 = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const nestedKeys = ['workflowJson', 'ComfyUI工作流JSON', 'workflow', 'apiWorkflow', 'anima工作流'];
  for (const key of nestedKeys) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // 不是嵌套 JSON，继续走原始对象校验。
    }
  }
  const entries = Object.entries(record);
  if (entries.length === 1 && typeof entries[0]?.[1] === 'string') {
    try {
      const parsed = JSON.parse(entries[0][1] as string);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return raw;
    }
  }
  return raw;
};

const 规范化旧式ComfyUI占位符 = (value: string): string =>
  value
    .replace(/%prompt%/gi, '__PROMPT__')
    .replace(/%negative_prompt%/gi, '__NEGATIVE_PROMPT__')
    .replace(/%width%/gi, '__WIDTH__')
    .replace(/%height%/gi, '__HEIGHT__')
    .replace(/%seed%/gi, '__SEED__')
    .replace(/%steps%/gi, '__STEPS__')
    .replace(/%cfg_scale%/gi, '__CFG__')
    .replace(/%cfg%/gi, '__CFG__')
    .replace(/%sampler_name%/gi, '__SAMPLER__')
    .replace(/%scheduler%/gi, '__SCHEDULER__');

const 递归规范化ComfyUI占位符 = (value: unknown): unknown => {
  if (typeof value === 'string') return 规范化旧式ComfyUI占位符(value);
  if (Array.isArray(value)) return value.map(递归规范化ComfyUI占位符);
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      (value as Record<string, unknown>)[key] = 递归规范化ComfyUI占位符(child);
    });
  }
  return value;
};

export const 规范化ComfyUI工作流JSON = (raw: unknown): string => {
  raw = 展开嵌套ComfyUI工作流(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ComfyUI API workflow JSON 必须是对象');
  }
  const workflow = JSON.parse(JSON.stringify(raw)) as Record<string, WorkflowNode>;
  递归规范化ComfyUI占位符(workflow);
  const nodes = Object.entries(workflow).filter(([, node]) => node && typeof node === 'object');
  let positiveDone = false;
  let negativeDone = false;

  nodes.forEach(([, node]) => {
    const classType = String(node.class_type || '').toLowerCase();
    const inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs : null;
    if (!inputs) return;

    if (typeof inputs.text === 'string' && /cliptextencode|textencode|prompt/.test(classType)) {
      if (!negativeDone && 判断ComfyUI负向文本节点(node)) {
        inputs.text = '__NEGATIVE_PROMPT__';
        negativeDone = true;
      } else if (!positiveDone && 判断ComfyUI正向文本节点(node)) {
        inputs.text = '__PROMPT__';
        positiveDone = true;
      }
    }

    if (/emptylatentimage|latent/.test(classType)) {
      if ('width' in inputs) inputs.width = '__WIDTH__';
      if ('height' in inputs) inputs.height = '__HEIGHT__';
    }

    if (/ksampler|sampler/.test(classType)) {
      if ('seed' in inputs) inputs.seed = '__SEED__';
      if ('steps' in inputs) inputs.steps = '__STEPS__';
      if ('cfg' in inputs) inputs.cfg = '__CFG__';
      if ('sampler_name' in inputs) inputs.sampler_name = '__SAMPLER__';
      if ('scheduler' in inputs) inputs.scheduler = '__SCHEDULER__';
    }
  });

  if (!positiveDone) {
    const textNode = nodes.find(([, node]) => typeof node?.inputs?.text === 'string');
    if (textNode?.[1].inputs) textNode[1].inputs.text = '__PROMPT__';
  }

  return JSON.stringify(workflow, null, 2);
};
