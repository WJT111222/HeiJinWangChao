export const settingsGroups = [
  ['模型与连接', [
    ['channels', '连', '渠道与密钥', '服务商、地址、密钥与最大输出'],
    ['routing', '配', '模型分配', '每项 AI 任务用哪个模型'],
    ['network', '网', '跨域与网络', '网页版跨域自动中转'],
  ]],
  ['写作', [
    ['writing', '文', '正文与风格', '人称、篇幅、风格与难度'],
    ['literary', '预', '文学预设', '正文预设、破甲模式与脚本'],
    ['prompts', '词', '提示词开关', '防抢话、文风、行动选项、真实世界'],
  ]],
  ['世界', [['worldbooks', '书', '世界书', '内置主世界书与玩家世界书']]],
  ['回合流程', [
    ['stages', '段', '生成阶段', '三个变量阶段与流式传输'],
    ['timing', '时', '超时与重试', '请求时限与失败自动重试'],
    ['memory', '忆', '记忆', '即时记忆与三层记忆总结'],
  ]],
  ['扩展功能', [
    ['phone', '机', '手机', '私聊、群聊与小黑书'],
    ['images', '图', '文生图', '图片接口、画风与自动生图'],
    ['theater', '剧', '小剧场', '新建番外的默认设置'],
  ]],
  ['外观与提醒', [['look', '色', '外观与提示音', '配色与生成完成提醒']]],
  ['数据与排查', [
    ['variables', '量', '变量管理', '查看并修正当前存档'],
    ['promptmgr', '管', '提示词管理', '查看与编辑提示词'],
    ['feedback', '言', '反馈建议', '向开发者匿名反馈'],
  ]],
] as const;

export type PageInfo = typeof settingsGroups[number][1][number];
export type SettingsPage = PageInfo[0];
export function draftGroup(page: SettingsPage) {
  if (page === 'channels' || page === 'routing') return 'ai';
  if (['writing', 'prompts', 'stages', 'timing', 'phone', 'theater', 'promptmgr'].includes(page)) return 'local';
  return page;
}
