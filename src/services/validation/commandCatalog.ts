import { z } from 'zod';
import { DomainCommandSchema } from '../../domain/commands';
import type { AiStage } from '../ai/configuration';
export const worldTypes = ['CreateNpc', 'CreateOrganization', 'RecordOrgRelation'] as const;
export function commandCatalog(stage: Exclude<AiStage, 'story'>) {
  const options = DomainCommandSchema.options.filter(
    (option) =>
      stage === 'variables' ||
      [...worldTypes, 'SaveTask', 'SaveEvent'].includes(option.shape.type.value),
  );
  return {
    currencyUnit: 'CNY_FEN_INTEGER',
    commandTypes: options.map((option) => option.shape.type.value),
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      oneOf: options.map((option) =>
        z.toJSONSchema(option, { target: 'draft-7', unrepresentable: 'any' }),
      ),
    },
    stagePermissions:
      stage === 'variables'
        ? '只提议正文已成立的现场结果；新 NPC 必须实际在场。'
        : {
            worldCommands: worldTypes,
            taskCommands: ['SaveTask'],
            eventCommands: ['SaveEvent'],
            actorBoundary: '只推进场外 NPC/组织；禁止主角交易、现场重复行动、独立推进时钟。',
          },
    rules: [
      '严格使用各 type 的同级字段，不接受 group/entityId/payload 包装或旧别名。',
      'evidence 引用已提供事实原文；金额为整数人民币分，price/amount 等正值限制以 Schema 为准。',
      '不存在的更新操作列入 unresolved；CreateNpc/CreateOrganization 不是更新命令。',
      'Schema 仅描述结构；仍须进行权限、证据、引用、金额、时间、版本与幂等校验。',
    ],
  };
}
