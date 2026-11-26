import type { PromptModule } from './manifest';

// Alternate projections for modules that contain both game rules and native creative direction.
// Shared domain protocols, the worldbooks, difficulty and player agency still come from the original resources.
const gameText: Record<string, string> = {
  'identity.fusheng': '本回合承接玩家角色“{{playerName}}”的行动。保持世界观、人物动机、时间顺序、因果及存档事实一致，遵守当前内容边界、服务适用规则和本阶段输出协议。',
  'stages.opening.story': '这是《黑金王朝》首个开局回合。根据玩家创建资料、所选城市和存档建立主角的生活背景、职业、住处、社会关系与经济基础。保留玩家设定的经历、财产和意愿。初始同伴以特殊 NPC 身份入场，开局不得死亡、背叛主角或无缘无故怀疑主角，此保护仅限开局。人物只按自身知情范围行动；重大选择交给玩家。在短期记忆记录实际经历，变量规划可提供初始状态参考，区分原有资产、预期收入和实际交易。Story 不生成可执行的结算命令。',
  'stages.regular.story': '这是普通回合。承接当前玩家行动、正式时钟、地点、人物、最近{{immediateMemoryTurns}}回合及分层记忆。主角的主动决定属于玩家，NPC 按既有身份和实际知情行动。仅记录本幕实际结果，计划和传闻保持原有性质。TIME_PREFLIGHT 仅提供候选；按真实事件身份、发生时间、地点及传播渠道裁定亲自入场、自然获知或不涉及。实际中断时以 time:pause 落实停止时刻。其余场外演进由 World 处理。',
  'writing.conflict_pacing': '已结束、暂停或和解的事件须承接已有状态。组织行动受现有资源、权限、实际掌握的信息及社会后果约束。',
  'writing.emotion_guard': '人物的关系、意愿及认知以各自的既有经历和实际互动为基础。单次情绪或亲密互动不会自动改写人格、形成永久忠诚或使双方共享秘密。',
  'writing.action_feasibility': '玩家决定尝试的行动，结果须考虑地点、时间、健康、资金、职业权限和对方意愿。询价、申请、计划和传言保留各自状态。正式变量只承接已发生的变化，场外后续由动态世界负责。',
  'shared.09_dialogue_labels': '对白只代表实际发言者说出的话。对白标记不授予角色知识、同意或状态变更。',
  'compatibility.cot_format_ack': '已确认本回合的输出协议。可选的项目规划不等于供应商隐藏推理。将按约定顺序输出完整的正文、短期记忆、必要的开局时间及启用的行动选项。这段确认不代表剧情已经发生。',
};

export function nativeLiteraryModule(id: string): boolean {
  return id.startsWith('writing.perspective_') || id.startsWith('writing.style_')
    || ['writing.min_length', 'writing.natural_prose', 'writing.nsfw', 'planning.opening', 'planning.regular'].includes(id);
}

export function storyModuleText(module: PromptModule, original: string, preset: boolean): string | undefined {
  if (preset && nativeLiteraryModule(module.id)) return undefined;
  if (module.id === 'shared.06_story_output')
    return original.replace(/<!--native-length-->([\s\S]*?)<!--\/native-length-->/gu, preset ? '' : '$1');
  return (preset && gameText[module.id]) || original;
}
