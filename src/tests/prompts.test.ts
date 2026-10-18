import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import manifest from '../../prompts/manifest.json';
import sources from '../../prompts/sources.lock.json';
import { promptManifest, PromptManifestSchema } from '../prompts/manifest';
import { defaultSettings } from '../ui/settings/model';

const root = resolve(import.meta.dirname, '../../prompts');
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const text = (path: string) => readFileSync(resolve(root, path), 'utf8');
const moduleById = (id: string) => promptManifest.modules.find((module) => module.id === id)!;
function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? files(path) : [relative(root, path)];
  });
}
function altered(id: string, patch: object) {
  const copy = structuredClone(manifest);
  Object.assign(
    copy.modules.find((module) => module.id === id)!,
    patch,
  );
  return copy;
}

describe('M3-P1 静态资源注册（不是提示词组装或 API 请求）', () => {
  it('全部文件完整注册、路径有效，元数据对应完整正文而非截断摘要', () => {
    const actual = files(root)
      .filter((path) => !['manifest.json', 'sources.lock.json'].includes(path))
      .sort();
    expect(promptManifest.modules.map((module) => module.path).sort()).toEqual(actual);
    for (const module of promptManifest.modules) {
      const fullPath = resolve(root, module.path);
      expect(fullPath.startsWith(root + '/')).toBe(true);
      const bytes = readFileSync(fullPath);
      const content = bytes.toString('utf8');
      expect(bytes.length, module.id).toBeGreaterThan(0);
      expect(sha(bytes), module.id).toBe(module.contentSha256);
      expect(Array.from(content).length, module.id).toBe(module.characters);
      expect(
        [
          ...new Set([...content.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)].map((m) => m[1])),
        ].sort(),
        module.id,
      ).toEqual(module.placeholders);
    }
    expect(
      readFileSync(resolve(root, 'worldbooks/heijin/02_modern_underworld.md')).length,
    ).toBeGreaterThan(12000);
  });
  it('稳定 ID、路径不能重复注册', () => {
    const duplicateId = structuredClone(manifest);
    duplicateId.modules[1].id = duplicateId.modules[0].id;
    expect(PromptManifestSchema.safeParse(duplicateId).success).toBe(false);
    const duplicatePath = structuredClone(manifest);
    duplicatePath.modules[1].path = duplicatePath.modules[0].path;
    expect(PromptManifestSchema.safeParse(duplicatePath).success).toBe(false);
  });
  it.each([
    '../outside.md',
    '/tmp/outside.md',
    'shared/../../outside.md',
    'shared\\outside.md',
    'https://example.com/prompt.md',
  ])('拒绝非法资源路径 %s', (path) => {
    expect(PromptManifestSchema.safeParse(altered('identity.fusheng', { path })).success).toBe(
      false,
    );
  });
  it('身份/双世界书顺序固定且现代逻辑早于其它核心/共享规则', () => {
    const [identity, world, logic] = promptManifest.ordering.lockedPrefix.map(moduleById);
    expect([identity.defaultOrder, world.defaultOrder, logic.defaultOrder]).toEqual([0, 10, 20]);
    for (const module of promptManifest.modules.filter(
      (m) => m.activation !== 'never' && ['shared', 'narrative_core'].includes(m.category),
    ))
      expect(module.defaultOrder).toBeGreaterThan(logic.defaultOrder);
    expect(PromptManifestSchema.safeParse(altered(world.id, { defaultOrder: 0 })).success).toBe(
      false,
    );
    expect(
      PromptManifestSchema.safeParse(altered('writing.nsfw', { defaultOrder: 5 })).success,
    ).toBe(false);
    expect(moduleById('shared.00_world').activation).toBe('never');
  });
  it.each(['opening', 'regular'] as const)(
    '静态 %s 作用域各自只有一个主模板，正文协议不流入变量/世界',
    (mode) => {
      for (const stage of ['story', 'variables', 'world'] as const) {
        // 只检查注册声明，不生成消息或拼接任何正文。
        const eligible = promptManifest.modules.filter(
          (module) =>
            module.activation !== 'never' &&
            module.applicableStages.includes(stage) &&
            module.modes.includes(mode),
        );
        expect(eligible.filter((m) => m.category === 'stage').map((m) => m.id)).toEqual([
          `stages.${mode}.${stage}`,
        ]);
        expect(
          eligible
            .filter((m) => m.category === 'output')
            .map((m) => m.id)
            .sort(),
        ).toEqual(
          stage === 'story'
            ? ['shared.06_story_output', 'shared.09_dialogue_labels']
            : [stage === 'variables' ? 'shared.07_command_output' : 'shared.08_world_output'],
        );
        if (stage !== 'story')
          expect(
            eligible.some((m) =>
              ['identity', 'writing', 'narrative_core', 'compatibility'].includes(m.category),
            ),
          ).toBe(false);
      }
    },
  );
  it('错误的开局/普通作用域、输出协议和小说规则配置被拒绝', () => {
    for (const [id, patch] of [
      ['stages.opening.story', { modes: ['opening', 'regular'] }],
      ['shared.06_story_output', { applicableStages: ['variables'] }],
      ['writing.natural_prose', { applicableStages: ['variables'] }],
    ] as const)
      expect(PromptManifestSchema.safeParse(altered(id, patch)).success).toBe(false);
  });
  it('九个变量组各保留 init/update/offscreen，五项记忆仍为独立按需任务', () => {
    const groups = promptManifest.modules.filter((m) => m.category === 'variable_group');
    const domains = [
      'protagonist',
      'npc_ordinary',
      'npc_special',
      'items',
      'economy',
      'org_gang',
      'org_government',
      'org_civil',
      'org_business',
    ];
    expect(groups).toHaveLength(27);
    expect([...new Set(groups.map((m) => m.domain))].sort()).toEqual(domains.sort());
    for (const domain of domains) {
      const init = moduleById(`variableGroups.${domain}.init`);
      const update = moduleById(`variableGroups.${domain}.update`);
      const offscreen = moduleById(`variableGroups.${domain}.offscreen`);
      expect(init.modes).toEqual(['opening']);
      expect(update.modes).toEqual(['regular']);
      expect(update.applicableStages).toEqual(['variables']);
      expect(offscreen.applicableStages).toEqual(['world']);
      expect(offscreen.modes).toEqual(['opening', 'regular']);
      expect([init, update, offscreen].every((m) => m.activation === 'relevant-domain')).toBe(true);
    }
    const memory = promptManifest.modules.filter((m) => m.category === 'memory');
    expect(memory).toHaveLength(5);
    expect(
      memory.every((m) => m.activation === 'memory-task' && m.applicableStages.join() === 'memory'),
    ).toBe(true);
  });
  it('七项设置保留，NSFW/自愿边界独立常驻且无隐藏关闭条件', () => {
    expect(Object.keys(defaultSettings().prompts).sort()).toEqual(
      [
        'perspective',
        'style',
        'minNarrativeChars',
        'noControl',
        'naturalProse',
        'actionOptions',
        'realWorld',
      ].sort(),
    );
    expect(JSON.stringify(defaultSettings())).not.toMatch(/nsfw/i);
    const toggles = promptManifest.modules
      .filter((m) => m.toggle !== null)
      .map((m) => m.toggle!.split(':')[0]);
    expect([...new Set(toggles)].sort()).toEqual(Object.keys(defaultSettings().prompts).sort());
    expect(JSON.stringify(promptManifest.globalDefaults)).not.toMatch(/nsfw/i);
    for (const id of ['writing.nsfw', 'writing.intimacy_boundaries']) {
      expect(moduleById(id)).toMatchObject({
        permanent: true,
        configurable: false,
        activation: 'always',
        toggle: null,
        applicableStages: ['story'],
        modes: ['opening', 'regular'],
        reorderable: false,
      });
      expect(
        PromptManifestSchema.safeParse(
          altered(id, {
            activation: 'setting',
            toggle: 'noControl:true',
            permanent: false,
            configurable: true,
          }),
        ).success,
      ).toBe(false);
      expect(text(moduleById(id).path)).not.toMatch(
        /启用NSFW模式|enableNSFW|disableNSFW|ASD|亲密边界档案/,
      );
    }
    expect(promptManifest.contentGaps).toContainEqual(
      expect.objectContaining({ id: 'nsfw-verbatim-import', status: 'not-completed' }),
    );
  });
  it('原七项写作配置各有资源，三人称互斥选项仍完整', () => {
    const perspective = promptManifest.modules.filter((m) => m.toggle?.startsWith('perspective:'));
    expect(perspective.map((m) => m.toggle).sort()).toEqual([
      'perspective:first',
      'perspective:second',
      'perspective:third',
    ]);
    expect(
      perspective.every((m) => m.activation === 'setting' && m.applicableStages.join() === 'story'),
    ).toBe(true);
    expect(moduleById('writing.min_length').activation).toBe('always');
    expect(text('writing/no_control.md')).toContain('NoControl');
    expect(text('writing/action_options.md')).toContain('3～5');
  });
  it('文档、演示、历史汇编、原 COT 模板永不注入；未来扩展无运行实例', () => {
    for (const module of promptManifest.modules.filter((m) => m.kind !== 'prompt'))
      expect(module).toMatchObject({
        activation: 'never',
        applicableStages: [],
        modes: [],
        permanent: false,
        messageRole: null,
      });
    expect(
      PromptManifestSchema.safeParse(
        altered('reference.cot_legacy', {
          activation: 'always',
          permanent: true,
          applicableStages: ['story'],
          modes: ['opening'],
          messageRole: 'assistant',
        }),
      ).success,
    ).toBe(false);
    expect(promptManifest.futureExtensions.map((e) => e.id)).toEqual([
      'npc_private_archive',
      'special_nsfw_traits',
    ]);
    expect(
      promptManifest.modules.some((m) =>
        /npc_private_archive|special_nsfw_traits|名器录/.test(m.id + m.path + m.title),
      ),
    ).toBe(false);
  });
  it('COT 仅为正文 assistant 兼容资源，不输出 thinking 或旧剧情规划', () => {
    expect(moduleById('compatibility.cot_format_ack')).toMatchObject({
      messageRole: 'assistant',
      activation: 'protocol-compatibility',
      permanent: false,
      configurable: false,
      applicableStages: ['story'],
    });
    const adapted = text('compatibility/cot_format_ack.md');
    expect(adapted).not.toMatch(/<think>|<thinking>|<剧情规划>|<judge>/);
    expect(adapted).toContain('{{playerName}}');
    expect(adapted).toContain('万界叙事官·浮生');
    expect(text('reference/cot_legacy.txt')).toContain('<thinking>');
    expect(moduleById('reference.cot_legacy').activation).toBe('never');
  });
  it('可移动模块只限本组槽位，无法移动到身份/世界书或变更消息角色', () => {
    for (const [id, patch] of [
      ['identity.fusheng', { reorderable: true }],
      ['writing.conflict_pacing', { defaultOrder: 0 }],
      ['writing.natural_prose', { orderGroup: 'identity' }],
      ['writing.natural_prose', { messageRole: 'assistant' }],
    ] as const)
      expect(PromptManifestSchema.safeParse(altered(id, patch)).success).toBe(false);
  });
});

describe('正式文本来源与旧架构保留', () => {
  it('全部运行资源有来源记录，确认原文和既有未改模块字节一致', () => {
    for (const module of promptManifest.modules.filter((m) => m.kind === 'prompt')) {
      const record = sources.resources[module.path as keyof typeof sources.resources];
      expect(record, module.path).toBeDefined();
      if (record.treatment === 'verbatim')
        expect(sha(readFileSync(resolve(root, module.path))), module.path).toBe(
          record.sourceSha256,
        );
    }
    expect(sources.archives).toHaveLength(2);
    expect(sources.reference.commit).toBe('70df74835b969a049c6512a81716eaa0f5591c5a');
    expect(sha(text('reference/cot_legacy.txt'))).toBe(
      sources.resources['reference/cot_legacy.txt'].fragmentSha256,
    );
  });
  it('六主模板仍完整：两篇正文仅调整阶段身份，其他四篇字节保留', () => {
    expect(promptManifest.modules.filter((m) => m.category === 'stage')).toHaveLength(6);
    for (const mode of ['opening', 'regular'] as const) {
      const path = `stages/${mode}/story.md` as const;
      const record = sources.resources[path];
      expect(sha(text(path).replace(record.replacement.to, record.replacement.from))).toBe(
        record.sourceSha256,
      );
    }
    expect(text('stages/opening/story.md')).toContain('不得死亡、背叛主角');
    expect(text('stages/regular/story.md')).toContain('不是开局');
    expect(text('shared/06_story_output.md')).toContain('<变量规划>');
  });
  it('NPC 补丁完整保留旧前缀，按对应任务追加审核文本，不臆造记忆命令', () => {
    for (const group of ['npc_ordinary', 'npc_special'] as const) {
      for (const mode of ['init', 'update', 'offscreen'] as const) {
        const path = `variableGroups/${group}/${mode}.md` as const;
        const record = sources.resources[path];
        const bytes = readFileSync(resolve(root, path));
        expect(sha(bytes.subarray(0, record.baselineBytes))).toBe(record.baselineSha256);
        const suffix = bytes.subarray(record.baselineBytes).toString('utf8');
        const section = suffix.split('补充规则：\n')[1].split('\n\n记忆写入受实际')[0];
        expect(sha(section)).toBe(record.sectionSha256);
        expect(suffix).toContain('<COMMAND_CATALOG>');
        expect(suffix).toContain('unresolved');
      }
    }
  });
  it('身份占位符、时间星期要求、双世界书产业分类均保留', () => {
    const identity = text('identity/fusheng.md');
    expect(identity).toContain('{{playerName}}');
    expect(identity).not.toContain('黑金王朝');
    expect(identity).not.toMatch(/COMMAND_CATALOG|commands|SetWorldClock/);
    const clock = text('shared/03_time_events.md');
    for (const required of [
      '{{worldClock}}',
      '{{worldWeekday}}',
      'Asia/Shanghai',
      '星期一至星期日',
      '不得把所有人默认为双休',
      '交通',
      '闰年',
    ])
      expect(clock).toContain(required);
    expect(moduleById('shared.03_time_events').placeholders).toEqual([
      'worldClock',
      'worldWeekday',
    ]);
    const ecology = text('worldbooks/heijin/02_modern_underworld.md');
    expect(ecology.match(/^\d+\. \*\*/gm)).toHaveLength(14);
    for (const required of [
      '合法商业',
      '灰色利益',
      '伪造货币',
      '假币流通',
      '内部斗争',
      '不同产业',
      '长期',
      '社会与地下世界持续存在',
    ])
      expect(ecology).toContain(required);
    expect(text('shared/02_knowledge.md')).toContain(
      '玩家若在特定调试/全知界面获得后台资料，也不会因此使主角或 NPC 自动知晓',
    );
  });
  it('运行资源没有正向加载旧战斗/判定/出生天赋池，审核包不作提示词注入', () => {
    const runtime = promptManifest.modules.filter((m) => m.activation !== 'never');
    expect(
      runtime.some((m) => /judge|combat|battle|birth|talent|review|审核包/i.test(m.path + m.id)),
    ).toBe(false);
    for (const module of runtime) {
      const content = text(module.path);
      expect(content, module.path).not.toMatch(
        /判定值\s*X|基础\s*B\s*\(|<judge>[\s\S]*?<\/judge>|30项出生|30项天赋|\b社交\[\d+\]/,
      );
    }
    expect(text('stages/regular/story.md')).not.toMatch(/出身候选|天赋候选/);
    expect(promptManifest.runtimeImplemented).toBe(false);
  });
});
