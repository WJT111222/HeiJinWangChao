import { promptManifest } from './manifest';
import type { PromptModule } from './manifest';
import type { ComposeInput } from './context';
import { AiError } from '../services/ai/errors';

export type SelectionInput = Pick<
  ComposeInput,
  'stage' | 'mode' | 'settings' | 'domains' | 'memoryTask' | 'cotAllowed'
>;
export function moduleActivation(module: PromptModule, input: SelectionInput) {
  if (module.activation === 'never')
    return { status: 'not-applicable', reason: '参考/文档资源，永不注入' } as const;
  if (!module.applicableStages.includes(input.stage) || !module.modes.includes(input.mode))
    return { status: 'not-applicable', reason: '不适用当前阶段或回合模式' } as const;
  let enabled = false;
  let reason: string = module.activation;
  if (module.activation === 'always') {
    enabled = true;
    reason = '在所属阶段常驻，无关闭开关';
  }
  if (module.activation === 'relevant-domain') {
    enabled = (input.domains ?? []).includes(module.domain!);
    reason = `相关变量域：${module.domain}`;
  }
  if (module.activation === 'memory-task') {
    enabled = module.id === input.memoryTask;
    reason = '仅在对应记忆维护任务激活';
  }
  if (module.activation === 'protocol-compatibility') {
    enabled = input.stage === 'story' && input.cotAllowed === true;
    reason = '仅在具体协议/模型确认兼容时激活';
  }
  if (module.activation === 'setting') {
    const [field, value] = module.toggle!.split(':');
    enabled =
      String(input.settings.prompts[field as keyof typeof input.settings.prompts]) === value;
    reason = `既有写作设置：${module.toggle}`;
  }
  return { status: enabled ? 'enabled' : 'disabled', reason } as const;
}
export function selectPromptModules(input: SelectionInput) {
  const knownDomains = new Set(promptManifest.modules.filter((m) => m.domain).map((m) => m.domain));
  if ((input.domains ?? []).some((domain) => !knownDomains.has(domain)))
    throw new AiError('configuration');
  if (
    input.stage === 'memory' &&
    !promptManifest.modules.some((m) => m.id === input.memoryTask && m.activation === 'memory-task')
  )
    throw new AiError('configuration');
  return promptManifest.modules.filter(
    (module) => moduleActivation(module, input).status === 'enabled',
  );
}

export function comparePromptModes(input: SelectionInput) {
  const opening = selectPromptModules({ ...input, mode: 'opening' });
  const regular = selectPromptModules({ ...input, mode: 'regular' });
  return {
    openingOnly: opening.filter((module) => !regular.some((other) => other.id === module.id)),
    regularOnly: regular.filter((module) => !opening.some((other) => other.id === module.id)),
    shared: opening.filter((module) => regular.some((other) => other.id === module.id)),
  };
}
