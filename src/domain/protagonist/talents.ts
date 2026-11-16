import { z } from 'zod';

// V2 正式资料的单一来源。只存身份与说明，不执行触发、判定或生成。
const definitions = [
  {
    "id": "underworld_aura",
    "name": "枭雄光环",
    "coreDomain": "地下人才与势力归附",
    "mechanismName": "群雄来投",
    "introduction": "你天生拥有令人难以忽视的枭雄气质。在地下世界，你更容易得到那些野心勃勃、能力出众之人的认可与追随。\n\n无论是江湖老手、情报掮客、行动骨干，还是掌握独特资源的地下人物，都可能因为你的名声、能力或行事风格主动与你接触。",
    "mechanism": "优秀的地下人才更容易主动寻求合作、投奔或效力，不必永远依靠玩家亲自寻找。玩家即使没有主动招募，也可以合理出现有自身动机的地下人才接触机会。",
    "longTermImpact": "随着你的事迹传播和势力发展，地下世界可能逐渐形成围绕你的利益网络。人才、资源与机会会通过这张网络持续汇聚，甚至有独立势力携带其人手和资源主动寻求归附。",
    "boundary": "人才有独立人格、立场与利益。投奔不代表绝对忠诚，更不代表永久不会背叛。不能强制无关联的优秀 NPC 凭空出现，不能直接把陌生人登记成已经效忠的部下。"
  },
  {
    "id": "cyber_tyrant",
    "name": "赛博暴君",
    "coreDomain": "软件、AI、网络与数字技术",
    "mechanismName": "数字统御",
    "introduction": "你对数字世界拥有近乎恐怖的理解与掌控能力。\n\n无论复杂的软件架构、人工智能算法、网络系统还是电子技术，你都具备远超常人的学习速度、分析能力与创造力。\n\n许多需要专业团队才能完成的技术工作，你可能凭借惊人的天赋独立解决其中最核心的部分。",
    "mechanism": "在计算机、AI 与数字技术领域拥有极高的学习、研发和创新上限，更容易发现数字系统的技术突破口。",
    "longTermImpact": "你所创造的软件、算法、数字平台与人工智能系统可能逐渐形成独立的技术生态，持续改变商业运作、信息流动和社会生活，甚至推动整个行业的技术变革。",
    "boundary": "技术天赋不等于全知或无限计算资源，也不会凭空获得其他系统的访问权限。它偏数字系统，与「天工奇才」偏实体工程严格区分。"
  },
  {
    "id": "golden_edict",
    "name": "黄金律令",
    "coreDomain": "财富、商业和资本",
    "mechanismName": "财富炼成",
    "introduction": "财富在你眼中并不是简单的数字，而是一套可以理解、分析和运用的规则。\n\n你拥有惊人的商业嗅觉，对市场需求、资产价值、资本流动与商业机会极其敏锐。\n\n即使面对有限资源，你也更容易找到能够产生巨大经济价值的经营方式。",
    "mechanism": "更容易识别被低估的资产、发现商业机会，并通过投资、经营、收购和资源整合创造超常的经济收益。",
    "longTermImpact": "你的商业决策可能逐渐形成企业集团、产业链、资本网络和长期投资布局。这些经济结构可以持续产生收益、吸引合作伙伴，并对相关行业的竞争格局产生影响。",
    "boundary": "不凭空创造资金，不保证每笔投资获利；资金不足、市场变化和竞争对手依然具有实际影响。重点是经济价值，不能替代「权柄猎手」取得职位。"
  },
  {
    "id": "power_hunter",
    "name": "权柄猎手",
    "coreDomain": "机构内的职位、联盟和决策权",
    "mechanismName": "权力攫取",
    "introduction": "你对权力有着非凡的直觉，能够迅速理解组织内部复杂的利益关系、职位结构和决策机制。\n\n你善于发现权力体系中的关键节点，并通过联盟、谈判、资源交换与组织运作，逐渐取得对局势的实际影响力。",
    "mechanism": "更擅长发现获取决策权的机会，在复杂组织中建立影响、争取职位、组织联盟并运用制度性权力。",
    "longTermImpact": "你可能逐渐建立跨越多个机构、企业与社会组织的长期影响网络。曾经获得的职位、联盟和组织资源，能够持续影响后续博弈与重大决策。",
    "boundary": "不能无视制度、程序和既有权力关系；获得权力也不意味着能够无限制支配所有人。重点是机构内部实际决策权，不等于「众声主宰」的公众认同，也不等于「千机谋主」的战术指挥。"
  },
  {
    "id": "public_sovereign",
    "name": "众声主宰",
    "coreDomain": "公众认知、舆论与社会话语权",
    "mechanismName": "众声共振",
    "introduction": "你拥有洞悉大众心理与社会传播规律的非凡才能。\n\n你能够敏锐捕捉公众关心的议题，理解不同社会群体的情绪与诉求，并通过言论、传播、公众活动和社会关系影响广泛的社会认知。\n\n你的声音更容易被听见，你所参与的事件也更容易引发广泛关注。",
    "mechanism": "更擅长扩大公共传播、塑造社会叙事、建立公众声望，并使原本分散的社会关注形成有影响力的公共议题。",
    "longTermImpact": "你可能逐渐建立庞大的公众影响网络。媒体关注、社群认同、社会声望和公共议题的持续传播，可以不断影响企业形象、组织行动与社会舆论格局。",
    "boundary": "公众拥有独立判断，舆论可以反转，也可能形成反对力量。影响认知不等于控制思想。它作用于公开社会与公众领域，绝不能与「枭雄光环」的地下世界人才投奔混为一谈，也不能以单个 NPC 好感值代替社会风向。"
  },
  {
    "id": "engineering_genius",
    "name": "天工奇才",
    "coreDomain": "实体科研、材料、机械与工程",
    "mechanismName": "天工造物",
    "introduction": "你拥有超越常人的科学直觉和工程创造能力。\n\n机械结构、材料特性、能源系统、制造工艺和复杂工程难题，在你眼中往往蕴藏着常人难以察觉的解决路径。\n\n你不仅善于理解已有技术，更可能创造出改变现有技术路线的发明成果。",
    "mechanism": "拥有惊人的实体科技研发能力，更容易提出突破性的工程方案、研发创新工艺和创造高水平的物理设备。",
    "longTermImpact": "你的发明可能逐渐转化为专利、先进设备、生产体系与产业技术。成熟的科技成果能够持续推动制造效率、产业发展和现实基础设施的改变。",
    "boundary": "科学与物理规律仍然有效。重大研发需要材料、设备、资金、时间及实际验证。重点是物理技术、制造与科学实验，不与「赛博暴君」的数字领域合并。"
  },
  {
    "id": "tactical_mastermind",
    "name": "千机谋主",
    "coreDomain": "战术部署、行动规划和临场指挥",
    "mechanismName": "千机推演",
    "introduction": "你拥有近乎恐怖的战术思维和行动规划能力。\n\n面对复杂局势，你能够迅速整理信息，分析人员、时间、空间与资源之间的关系，并制定令人意想不到却切实可行的行动方案。\n\n即使手中的资源并不占优，你也可能通过高明的部署与指挥创造局部优势。",
    "mechanism": "能够设计更高质量的行动计划、协调复杂任务、发现对手部署中的漏洞，并在局势变化时迅速调整战术。",
    "longTermImpact": "你的行动经验可能逐渐沉淀为成熟的指挥体系、组织协作方式和战术方法，使你领导的团队能够更有效地开展复杂行动，形成长期的组织执行优势。",
    "boundary": "无法预知未来，也不能凭空知道敌人的秘密；战术优势仍受到情报准确性、实际资源和执行能力限制。强项是行动部署而非组织职位、公众舆论或随意豪赌。"
  },
  {
    "id": "desperate_gambler",
    "name": "绝命赌徒",
    "coreDomain": "主动承担高风险后的惊人逆转",
    "mechanismName": "逆命豪赌",
    "introduction": "你天生拥有一种令人难以理解的豪赌天赋。\n\n当别人因为风险而犹豫不决时，你却能够敏锐察觉到逆转命运的微小机会。\n\n越是在局势不利、失败代价巨大、胜利收益惊人的情况下，你越有可能完成超乎常人想象的逆转。",
    "mechanism": "当玩家主动承担真实的重大风险，并押上具有实际价值的筹码时，能够获得显著高于普通人的成功机会。成功可能产生远超常规行动的收益。",
    "longTermImpact": "一次重大豪赌可能彻底改变人物命运：获得财富、地位、重要盟友，甚至重塑组织或城市的势力格局。过去豪赌带来的成功与失败，也会持续影响主角的名声、人际关系和未来能够参与的博弈。",
    "boundary": "不保证胜利，失败代价真实存在。只有玩家主动做出冒险选择才会触发，不得由 AI 替玩家押注。本批绝对不增加一个虚构的百分比胜率；后续如要数学意义上的加成，须另行设计可验证的判定器。"
  }
] as const;

// Records contain only scalar strings: freezing each entry and the array is sufficient.
export const talentDefinitions = Object.freeze(definitions.map(definition => Object.freeze(definition)));
export type TalentDefinition = (typeof talentDefinitions)[number];
export const TalentIdSchema = z.enum(talentDefinitions.map(definition => definition.id));
export type TalentId = z.infer<typeof TalentIdSchema>;

/** Safe lookup only; persisted IDs still require strict schema validation. */
export function getTalentDefinition(id: unknown): TalentDefinition | undefined {
  const parsed = TalentIdSchema.safeParse(id);
  return parsed.success ? talentDefinitions.find(definition => definition.id === parsed.data) : undefined;
}
