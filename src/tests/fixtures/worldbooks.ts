/**
 * 世界书导入测试样本：全部为本项目自行编写的虚构内容，不含任何第三方发布的世界书。
 * 每次调用返回新对象，测试之间互不影响。
 */

/** 每个字段都给非默认值的酒馆条目（含保留字段、扩展和一个未知字段）。 */
export function fullSillyTavernEntry() {
  return {
    uid: 0,
    key: ['码头', '/港口\\d+号/i'],
    keysecondary: ['夜里'],
    comment: '码头',
    content: '{{user}}常去的码头，入夜后由搬运帮把守。',
    constant: true,
    vectorized: true,
    selective: false,
    selectiveLogic: 3,
    addMemo: true,
    order: 250,
    position: 4,
    disable: true,
    ignoreBudget: true,
    excludeRecursion: true,
    preventRecursion: true,
    matchPersonaDescription: true,
    matchCharacterDescription: true,
    matchCharacterPersonality: true,
    matchCharacterDepthPrompt: true,
    matchScenario: true,
    matchCreatorNotes: true,
    delayUntilRecursion: 2,
    probability: 35,
    useProbability: false,
    depth: 6,
    outletName: 'harbor',
    group: '码头,夜景',
    groupOverride: true,
    groupWeight: 55,
    scanDepth: 7,
    caseSensitive: true,
    matchWholeWords: false,
    useGroupScoring: true,
    automationId: 'auto-1',
    role: 2,
    sticky: 3,
    cooldown: 4,
    delay: 5,
    characterFilter: { isExclude: true, names: ['阿青'], tags: [] },
    triggers: ['normal', 'swipe'],
    displayIndex: 9,
    extensions: { custom: { nested: [1, 2] } },
    customFlag: '未知字段',
  };
}

/** 酒馆世界书（entries 为对象）。条目只写了部分字段，用来验证“缺省字段导出时不凭空增加”。 */
export function sillyTavernDictBook() {
  return {
    name: '江城夜话',
    description: '测试用虚构城市设定',
    bookLevelUnknown: { keep: true },
    entries: {
      0: fullSillyTavernEntry(),
      1: { uid: 1, key: ['/a(b+)+c/', '/渡口/g', '/a/b/', '张三'], keysecondary: [], content: '张三在渡口摆摊。', order: 50 },
      5: { uid: 5, key: ['李四'], content: '李四是茶楼老板。' },
      7: { uid: 7, key: [], content: '没有关键词的条目。' },
    },
  };
}

/** 同样内容的数组形式。 */
export function sillyTavernArrayBook() {
  const dict = sillyTavernDictBook();
  return { ...dict, entries: Object.values(dict.entries) };
}

/** 需要宽松读法的条目：数字字符串、0/1 真假值。 */
export function looseSillyTavernBook() {
  return { entries: { 3: { uid: 3, key: ['阿九'], content: '阿九', order: '12', probability: ' 40 ', disable: 1, constant: 0 } } };
}

/** 角色卡 V2 整张卡。 */
export function characterCardV2() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '阿青',
      description: '角色描述，不应导入',
      first_mes: '你好，不应导入',
      character_book: {
        name: '阿青的世界书',
        description: '茶馆一带的设定',
        scan_depth: 5,
        token_budget: 500,
        recursive_scanning: true,
        extensions: {},
        entries: [
          {
            keys: ['茶馆'], content: '茶馆白天人多。', enabled: true, insertion_order: 10,
            case_sensitive: true, name: '茶馆', priority: 3, id: 12, comment: '茶馆', selective: true,
            secondary_keys: ['白天'], constant: false, position: 'before_char',
            extensions: { position: 4, depth: 2, group_weight: 30, probability: 60, sticky: 2, match_whole_words: true, vendorField: 'x' },
          },
          { keys: ['码头'], content: '码头的夜班。', extensions: {}, enabled: false, insertion_order: 20, position: 'after_char' },
          { keys: ['渡船'], content: '渡船', extensions: {}, insertion_order: 1, futureField: 1 },
        ],
      },
    },
  };
}
