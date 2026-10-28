import { z } from 'zod';
import source from '../../prompts/manifest.json';

const StageSchema = z.enum(['story', 'variables', 'world', 'memory']);
const ModeSchema = z.enum(['opening', 'regular']);
const ModuleSchema = z.strictObject({
  id: z.string().min(1),
  variableProtocol: z.enum(['json', 'text']).optional(),
  path: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[\p{L}\p{N}_./-]+\.(?:md|txt|json)$/u),
  title: z.string().min(1),
  kind: z.enum(['prompt', 'documentation', 'example', 'reference']),
  applicableStages: z.array(StageSchema),
  modes: z.array(ModeSchema),
  toggle: z.string().nullable(),
  domain: z.string().nullable(),
  characters: z.number().int().nonnegative(),
  version: z.string().min(1),
  messageRole: z.enum(['system', 'user', 'assistant']).nullable(),
  activation: z.enum([
    'always',
    'setting',
    'relevant-domain',
    'memory-task',
    'protocol-compatibility',
    'never',
  ]),
  permanent: z.boolean(),
  configurable: z.boolean(),
  defaultOrder: z.number().int().nonnegative(),
  orderGroup: z.enum([
    'identity',
    'worldbooks',
    'shared',
    'narrative_core',
    'writing',
    'stage',
    'output',
    'variable_group',
    'memory',
    'assistant_tail',
    'planning',
    'reference',
  ]),
  reorderable: z.boolean(),
  category: z.enum([
    'identity',
    'worldbook',
    'shared',
    'narrative_core',
    'writing',
    'stage',
    'output',
    'variable_group',
    'memory',
    'compatibility',
    'planning',
    'documentation',
    'example',
    'reference',
  ]),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  placeholders: z.array(z.string().min(1)),
});
export type PromptModule = z.infer<typeof ModuleSchema>;

export const PromptManifestSchema = z
  .strictObject({
    project: z.literal('黑金王朝'),
    version: z.string().min(1),
    authoredAt: z.string(),
    status: z.string().min(1),
    schemaVersion: z.literal(2),
    runtimeImplemented: z.literal(true),
    globalDefaults: z.strictObject({
      immediateMemoryTurns: z.number().int().positive(),
      minNarrativeChars: z.number().int().positive(),
      perspective: z.enum(['first', 'second', 'third']),
      style: z.literal('general'),
      noControl: z.boolean(),
      naturalProse: z.boolean(),
      actionOptions: z.boolean(),
      realWorld: z.boolean(),
      variableStageEnabled: z.boolean(),
      worldStageEnabled: z.boolean(),
      maxTotalAttemptsPerStage: z.number().int().positive(),
    }),
    tokenAccounting: z.strictObject({
      characters: z.literal('unicode-code-points'),
      tokens: z.literal('requires-model-tokenizer'),
      actualUsage: z.literal('requires-api-response'),
    }),
    ordering: z.strictObject({
      roleMeaning: z.literal('logical-default-not-an-actual-request'),
      lockedPrefix: z.tuple([
        z.literal('identity.fusheng'),
        z.literal('worldbooks.heijin.worldview'),
        z.literal('worldbooks.heijin.modern_underworld'),
      ]),
      adjustableGroups: z.tuple([z.literal('narrative_core'), z.literal('writing')]),
      overrideRule: z.string().min(1),
    }),
    futureExtensions: z.array(
      z.strictObject({
        id: z.string().min(1),
        status: z.literal('design-only'),
        note: z.string().min(1),
      }),
    ),
    contentGaps: z.array(
      z.strictObject({
        id: z.string().min(1),
        status: z.literal('not-completed'),
        note: z.string().min(1),
      }),
    ),
    modules: z.array(ModuleSchema).min(1),
  })
  .superRefine((manifest, ctx) => {
    const check = (ok: unknown, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', message });
    };
    const modules = manifest.modules;
    const byId = new Map(modules.map((module) => [module.id, module]));
    check(byId.size === modules.length, '模块 ID 重复');
    check(
      new Set(modules.map((module) => module.path)).size === modules.length,
      '资源路径重复注册',
    );
    for (const module of modules) {
      check(
        new Set(module.applicableStages).size === module.applicableStages.length,
        `${module.id} 阶段重复`,
      );
      check(new Set(module.modes).size === module.modes.length, `${module.id} 模式重复`);
      check(
        module.permanent === (module.activation === 'always'),
        `${module.id} 常驻与加载策略不一致`,
      );
      if (module.activation === 'never') {
        check(
          !module.messageRole &&
            !module.applicableStages.length &&
            !module.modes.length &&
            !module.configurable &&
            !module.reorderable,
          `${module.id} 非注入项不能具备运行配置`,
        );
      } else {
        check(
          module.kind === 'prompt' &&
            module.messageRole &&
            module.applicableStages.length &&
            module.modes.length,
          `${module.id} 运行作用域不完整`,
        );
      }
      if (module.kind !== 'prompt')
        check(module.activation === 'never', `${module.id} 审核/参考资料不能注入`);
      if (module.activation === 'setting')
        check(module.toggle && module.configurable, `${module.id} 缺少既有设置条件`);
      if (module.activation === 'relevant-domain')
        check(module.domain && module.category === 'variable_group', `${module.id} 缺少变量域条件`);
      if (module.activation === 'memory-task')
        check(
          module.applicableStages.length === 1 && module.applicableStages[0] === 'memory',
          `${module.id} 记忆任务不能进入常规三阶段`,
        );
      if (['writing', 'narrative_core'].includes(module.category))
        check(module.applicableStages.join() === 'story', `${module.id} 小说规则只能进入正文阶段`);
      if (module.reorderable) {
        const core =
          module.orderGroup === 'narrative_core' &&
          module.defaultOrder >= 80 &&
          module.defaultOrder <= 82;
        const writing =
          module.orderGroup === 'writing' &&
          module.defaultOrder >= 224 &&
          module.defaultOrder <= 227;
        check(
          (core || writing) &&
            module.messageRole === 'system' &&
            module.applicableStages.length === 1 &&
            module.applicableStages[0] === 'story',
          `${module.id} 可调顺序越过固定边界`,
        );
      }
    }
    for (const stage of ['story', 'variables', 'world'] as const) {
      for (const mode of ['opening', 'regular'] as const) {
        const main = modules.filter(
          (m) =>
            m.variableProtocol !== 'text' && m.category === 'stage' && m.applicableStages.includes(stage) && m.modes.includes(mode),
        );
        check(
          main.length === 1 && main[0].id === `stages.${mode}.${stage}`,
          `${stage}/${mode} 必须仅有对应主提示词`,
        );
      }
    }
    for (const mode of ['opening', 'regular'] as const) {
      const main = modules.filter((m) => m.variableProtocol === 'text' && m.category === 'stage' && m.modes.includes(mode));
      check(main.length === 1 && main[0].id === `stages.${mode}.variables.text`, '文本变量主模板必须按模式互斥');
    }
    for (const module of modules.filter((m) => m.variableProtocol === 'text')) {
      check(module.applicableStages.join() === 'variables' && !module.configurable && !module.reorderable,
        '文本准备资源只能用于变量离线组装，不能流入世界/正文或变成玩家设置');
      const original = byId.get(module.id.replace(/\.text$/, ''));
      check(original?.variableProtocol === 'json' && original.defaultOrder === module.defaultOrder
        && original.modes.join() === module.modes.join(), '文本资源必须对应同顺序同模式的原变量模块');
    }
    const prefix = manifest.ordering.lockedPrefix.map((id) => byId.get(id));
    check(
      prefix.every(
        (m) =>
          m?.permanent &&
          m.messageRole === 'system' &&
          !m.configurable &&
          !m.reorderable &&
          m.modes.length === 2,
      ),
      '身份与世界书必须常驻锁定',
    );
    check(
      prefix.every((m, i) => m?.defaultOrder === i * 10),
      '身份与双世界书顺序错误',
    );
    const first = modules
      .filter((m) => m.permanent && m.applicableStages.includes('story'))
      .sort((a, b) => a.defaultOrder - b.defaultOrder)
      .slice(0, 3)
      .map((m) => m.id);
    check(first.join() === manifest.ordering.lockedPrefix.join(), '正文常驻前缀不能插入其他模块');
    for (const id of [
      'identity.fusheng',
      'writing.nsfw',
      'writing.intimacy_boundaries',
      'writing.conflict_pacing',
      'writing.emotion_guard',
      'writing.action_feasibility',
    ]) {
      const module = byId.get(id);
      check(
        module?.permanent &&
          module.applicableStages.join() === 'story' &&
          module.modes.length === 2 &&
          module.toggle === null &&
          !module.configurable,
        `${id} 必须仅在两种正文模式常驻，无开关`,
      );
    }
    for (const [id, stage] of [
      ['shared.06_story_output', 'story'],
      ['shared.09_dialogue_labels', 'story'],
      ['shared.07_command_output', 'variables'],
      ['shared.08_world_output', 'world'],
    ] as const) {
      const module = byId.get(id);
      check(
        module?.permanent &&
          module.applicableStages.join() === stage &&
          module.category === 'output',
        `${id} 输出协议作用域错误`,
      );
    }
    check(byId.get('shared.00_world')?.activation === 'never', '旧世界底座不得重复注入');
    const cot = byId.get('compatibility.cot_format_ack');
    check(
      cot?.messageRole === 'assistant' &&
        cot.activation === 'protocol-compatibility' &&
        cot.applicableStages.join() === 'story' &&
        !cot.permanent &&
        cot.toggle === null &&
        !cot.configurable,
      'COT 仅用于正文完整 assistant 格式确认历史',
    );
    for (const mode of ['opening', 'regular'] as const) {
      const planning = byId.get(`planning.${mode}`);
      check(planning?.permanent && planning.applicableStages.join() === 'story' && planning.modes.join() === mode
        && planning.category === 'planning' && planning.messageRole === 'system' && planning.defaultOrder === 350
        && !planning.configurable && !planning.reorderable && planning.toggle === null, '叙事规划仅按回合模式互斥常驻');
    }
    for (const extension of manifest.futureExtensions)
      check(!byId.has(extension.id), '未来扩展不能注册成当前运行模块');
  });

// 只有元数据校验；不读取正文，不替换占位符，不产生 API 消息或“实际组装结果”。
export const promptManifest = PromptManifestSchema.parse(source);
