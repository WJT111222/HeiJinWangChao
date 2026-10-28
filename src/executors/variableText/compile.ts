import { z } from 'zod';
import { DomainCommandSchema, fingerprint } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import { GameTimeSchema, IdSchema } from '../../domain/common';
import { variableCommandSchemas } from '../../domain/variableCommands';
import { GameStateSchema, LocationSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { openingTimeBase, openingTimeSelection } from '../../domain/openingTime';
import { variableCommandsForTurn } from '../../domain/turnProjection';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { validateAst } from './ast';
import { digest, ExecutionContextSchema, failed } from './model';
import type { CommandOrigin, ExecutionResult, VariableExecutionContext, VariableExecutionPlan } from './model';

const textValue = z.string().trim().min(1).max(8192);
const memoryValue = z.strictObject({ text: textValue, knowledgeKind: z.enum(['observed', 'reported', 'suspected']),
  knowledgeSource: textValue, visibility: z.enum(['npc_private', 'internal', 'player_known']) });
const fields = new Map<string, Mapping>([
  ['protagonist.healthText', { operation: 'set', kind: 'protagonist', field: 'healthText' }],
  ['protagonist.emotionText', { operation: 'set', kind: 'protagonist', field: 'emotionText' }],
  ...['locationId', 'profession', 'publicStatus', 'legalStatus', 'skills'].map((field): [string, Mapping] =>
    [`protagonist.${field}`, { operation: 'set', kind: 'protagonist', field }]),
  ['worldClock', { operation: 'set', kind: 'clock', field: 'worldClock' }],
  ['locations', { operation: 'set', kind: 'location', field: 'location' }],
  ['npc.relationshipText', { operation: 'set', kind: 'npc', field: 'relationshipText' }],
  ['npc.healthText', { operation: 'set', kind: 'npc', field: 'healthText' }],
  ...['locationId', 'onScene', 'lastInteractionAt'].map((field): [string, Mapping] =>
    [`npc.${field}`, { operation: 'set', kind: 'npc', field }]),
  ['npc.memories', { operation: 'push', kind: 'memory', field: 'memories' }],
  ['items.quantity', { operation: 'add', kind: 'item', field: 'quantity' }],
  ['economy.cash', { operation: 'add', kind: 'expense', field: 'cash' }],
  ['economy.onlineBalance', { operation: 'add', kind: 'expense', field: 'onlineBalance' }],
] as const);
interface Mapping { operation: 'set' | 'add' | 'push'; kind: 'protagonist' | 'npc' | 'memory' | 'item' | 'expense' | 'clock' | 'location'; field: string }
function lookup(command: ParsedVariableCommand): { mapping: Mapping; id?: string } | undefined {
  const [root, middle, last] = command.path.nodes;
  if (command.path.nodes.length === 1 && root.name === 'worldClock') {
    const mapping = fields.get('worldClock');
    return mapping ? { mapping } : undefined;
  }
  if (command.path.nodes.length === 2 && root.name === 'locations' && middle?.kind === 'id' && IdSchema.safeParse(middle.id).success) {
    const mapping = fields.get('locations');
    return mapping ? { mapping, id: middle.id } : undefined;
  }
  if (command.path.nodes.length === 2 && middle?.kind === 'field') {
    const mapping = fields.get(`${root.name}.${middle.name}`);
    if (mapping && ['protagonist', 'expense'].includes(mapping.kind)) return { mapping };
  }
  if (command.path.nodes.length === 3 && middle?.kind === 'id' && last?.kind === 'field') {
    const mapping = fields.get(`${root.name}.${last.name}`);
    if (mapping && ['npc', 'memory', 'item'].includes(mapping.kind) && IdSchema.safeParse(middle.id).success) return { mapping, id: middle.id };
  }
}
function priorCommand(state: GameState, turnId: string, commandId: string) {
  const record = state.appliedCommands.find((entry) => entry.turnId === turnId && entry.commandId === commandId);
  if (!record) return undefined;
  // 指纹是既有幂等协议中的规范JSON，不把它当成任意代码或自由状态补丁。
  try { const parsed = DomainCommandSchema.safeParse(JSON.parse(record.fingerprint)); return parsed.success ? parsed.data : undefined; }
  catch { return undefined; }
}

export async function compileVariableCommands(input: readonly ParsedVariableCommand[], state: GameState,
  context: VariableExecutionContext): Promise<ExecutionResult<VariableExecutionPlan>> {
  try { return await compileChecked(input, state, context); }
  catch { return failed('transaction_failed'); }
}

async function compileChecked(input: readonly ParsedVariableCommand[], state: GameState,
  inputContext: VariableExecutionContext): Promise<ExecutionResult<VariableExecutionPlan>> {
  const checkedAst = validateAst(input);
  if (!checkedAst.ok) return checkedAst;
  const stateCheck = GameStateSchema.safeParse(state), contextCheck = ExecutionContextSchema.safeParse(inputContext);
  if (!stateCheck.success) return failed('domain_validation_failed');
  if (!contextCheck.success) return failed('type_mismatch');
  const current = stateCheck.data, context = contextCheck.data, draft = context.draft, ast = checkedAst.value;
  if (draft.saveId !== current.saveId || draft.baseSaveRevision !== context.expectedRevision
    || current.revision < context.expectedRevision || current.journal.some((entry) => entry.turnId === draft.turnId)) return failed('revision_conflict');
  if (current.revision !== context.expectedRevision && !current.appliedCommands.some((entry) => entry.turnId === draft.turnId)) return failed('revision_conflict');
  if (!draft.story || draft.stageStatus.story !== 'ready' || draft.storyRevision < 1
    || draft.turnKind !== (current.turnNumber === 0 ? 'opening' : 'regular')) return failed('domain_validation_failed');
  let base: GameState, clock: string, systemCommands: DomainCommand[];
  try {
    base = openingTimeBase(current, draft);
    clock = openingTimeSelection(current, draft)?.endAt ?? base.worldClock;
    systemCommands = variableCommandsForTurn(current, draft, []);
    // 开局投影的精确重放：占位标记已在模拟副本清除，但保留原程序时钟幂等凭据。
    // 仅用同一Story重新校验该凭据，不把早于当前时间的startAt应用到已执行副本。
    const priorClock = priorCommand(current, draft.turnId, `opening-clock:${draft.storyRevision}`);
    if (!current.openingTimePending && priorClock?.type === 'SetWorldClock') {
      const replay = variableCommandsForTurn({ ...current, openingTimePending: true }, draft, []);
      if (replay.length !== 1 || fingerprint(replay[0]) !== fingerprint(priorClock)) return failed('duplicate_or_conflicting_command');
      systemCommands = replay;
    }
  } catch { return failed('domain_validation_failed'); }
  const openingClock = systemCommands.find((command) => command.type === 'SetWorldClock');
  for (let i = 0; i < ast.length; i++) {
    const entry = ast[i];
    if (lookup(entry)?.mapping.kind !== 'clock') continue;
    const origin = { commandIndex: i + 1, source: entry.source };
    if (entry.operation !== 'set') return failed('unsupported_operation', origin);
    const time = GameTimeSchema.safeParse(entry.value);
    if (!time.success) return failed('type_mismatch', origin);
    // Story开局时间仍是唯一开局基线；等值文本不产生第二条时钟命令。
    if (openingClock && Date.parse(time.data) !== Date.parse(openingClock.worldClock)) return failed('domain_validation_failed', origin);
    clock = openingClock?.worldClock ?? time.data;
  }
  const commands: DomainCommand[] = [...systemCommands];
  const origins: Array<CommandOrigin | null> = systemCommands.map(() => null);
  const quantities = new Map<string, number>(), balances = new Map<string, number | null>();
  for (let i = 0; i < ast.length; i++) {
    const command = ast[i], origin = { commandIndex: i + 1, source: command.source };
    const found = lookup(command);
    if (!found) return failed('unsupported_path', origin);
    const { mapping, id } = found;
    if (mapping.operation !== command.operation) return failed('unsupported_operation', origin);
    const commandId = `text-v1:s${draft.storyRevision}:c${i + 1}`;
    const prior = priorCommand(current, draft.turnId, commandId);
    const common = { commandId, evidence: `文本变量指令第${i + 1}条` };
    let mapped: DomainCommand;
    if (mapping.kind === 'protagonist' || mapping.kind === 'npc') {
      if (['healthText', 'emotionText', 'relationshipText'].includes(mapping.field)
        && !textValue.safeParse(command.value).success) return failed('type_mismatch', origin);
      if (mapping.kind === 'protagonist') {
        const changes = variableCommandSchemas[0].shape.changes.safeParse({ [mapping.field]: command.value });
        if (!changes.success) return failed('type_mismatch', origin);
        mapped = { ...common, type: 'UpdateProtagonist', expectedRevision: context.expectedRevision,
          protagonistId: base.protagonist.id, changes: changes.data };
      } else {
        if (!id || !Object.hasOwn(base.npc, id)) return failed('entity_not_found', origin);
        const changes = variableCommandSchemas[1].shape.changes.safeParse({ [mapping.field]: command.value });
        if (!changes.success) return failed('type_mismatch', origin);
        mapped = { ...common, type: 'UpdateNpc', npcId: id, expectedRevision: context.expectedRevision, changes: changes.data };
      }
    } else if (mapping.kind === 'clock') {
      if (openingClock) continue;
      const time = GameTimeSchema.safeParse(command.value);
      if (!time.success) return failed('type_mismatch', origin);
      mapped = { ...common, type: 'SetWorldClock', worldClock: time.data };
    } else if (mapping.kind === 'location') {
      if (!id) return failed('unsupported_path', origin);
      const location = LocationSchema.omit({ id: true }).safeParse(command.value);
      if (!location.success) return failed('type_mismatch', origin);
      mapped = { ...common, type: 'CreateLocation', location: { ...location.data, id } };
    } else if (mapping.kind === 'item') {
      if (!id) return failed('unsupported_path', origin);
      const item = base.items[id];
      // 耗尽后的精确重放仅能复用已落入幂等指纹的前值，不能复活或新造物品。
      const lastItem = [...current.appliedCommands].reverse().filter((entry) => entry.turnId === draft.turnId)
        .map((entry) => priorCommand(current, draft.turnId, entry.commandId)).find((entry) => entry?.type === 'UpdateItem' && entry.itemId === id);
      if (!item && !(prior?.type === 'UpdateItem' && prior.itemId === id && lastItem?.type === 'UpdateItem' && lastItem.changes.quantity === 0)) return failed('entity_not_found', origin);
      const old = prior?.type === 'UpdateItem' ? prior.expectedQuantity : quantities.get(id) ?? item?.quantity;
      if (typeof command.value !== 'number' || !Number.isSafeInteger(command.value) || command.value === 0
        || old === undefined || !Number.isSafeInteger(old + command.value) || old + command.value < 0) return failed('invalid_quantity', origin);
      if (!prior && quantities.get(id) === 0) return failed('entity_not_found', origin);
      const quantity = old + command.value;
      mapped = { ...common, type: 'UpdateItem', itemId: id, expectedRevision: context.expectedRevision,
        expectedQuantity: old, changes: { quantity }, quantityReason: command.value > 0 ? 'gain' : 'consumption' };
      quantities.set(id, quantity);
    } else if (mapping.kind === 'expense') {
      const account = mapping.field === 'cash' ? 'cash' : 'onlineBalance';
      if (typeof command.value !== 'number' || !Number.isSafeInteger(command.value) || command.value === 0) return failed('invalid_amount', origin);
      // 正向收入需要完整IncomeRecord；本轮不构造虚假收入。
      if (command.value > 0) return failed('unsupported_operation', origin);
      const old = balances.has(account) ? balances.get(account) : base.economy[account];
      if (!prior && (old === null || old === undefined || !Number.isSafeInteger(old + command.value) || old + command.value < 0)) return failed('invalid_amount', origin);
      mapped = { ...common, type: 'SpendFunds', account, amount: -command.value, purpose: '剧情消费' };
      if (!prior && old !== null && old !== undefined) balances.set(account, old + command.value);
    } else {
      if (!id || !Object.hasOwn(base.npc, id)) return failed('entity_not_found', origin);
      const memory = await mapMemory(command, base, id, clock, context, common, i + 1);
      if (!memory.ok) return failed(memory.error.code, origin);
      mapped = memory.value;
    }
    const parsed = DomainCommandSchema.safeParse(mapped);
    if (!parsed.success) return failed('domain_validation_failed', origin);
    if (prior && fingerprint(prior) !== fingerprint(parsed.data)) return failed('duplicate_or_conflicting_command', origin);
    commands.push(parsed.data); origins.push(origin);
  }
  // 时间先应用，之后的互动/记忆统一使用本批最终时钟；其他指令保持文本顺序。
  // 不逐条提交或增加中间revision，倒退仍由原领域命令在整批模拟中拒绝。
  const entries = commands.map((command, index) => ({ command, origin: origins[index] }));
  const ordered = [...entries.filter((entry) => entry.command.type === 'SetWorldClock'),
    ...entries.filter((entry) => entry.command.type !== 'SetWorldClock')];
  const orderedCommands = ordered.map((entry) => entry.command);
  const priorTurn = current.appliedCommands.filter((entry) => entry.turnId === draft.turnId);
  const exactReplay = commands.length > 0 && commands.every((c) => priorTurn.some((old) => old.commandId === c.commandId && old.fingerprint === fingerprint(c)));
  if (priorTurn.length && (!exactReplay || priorTurn.length !== commands.length)) return failed('duplicate_or_conflicting_command');
  if (current.revision !== context.expectedRevision && !exactReplay) return failed('revision_conflict');
  return { ok: true, value: { version: 1, stateDigest: await digest(fingerprint(current)), contextDigest: await digest(fingerprint(context)),
    ast, commands: orderedCommands, origins: ordered.map((entry) => entry.origin) } };
}

async function mapMemory(command: ParsedVariableCommand, state: GameState, npcId: string,
  clock: string, context: VariableExecutionContext, common: { commandId: string; evidence: string }, index: number): Promise<ExecutionResult<DomainCommand>> {
  const value = memoryValue.safeParse(command.value);
  if (!value.success) return failed('type_mismatch');
  const memory = value.data;
  const prefix = memory.knowledgeKind === 'reported' ? '[转述]' : memory.knowledgeKind === 'suspected' ? '[推测]' : '';
  const text = prefix && !memory.text.startsWith(prefix) ? `${prefix}${memory.text}` : memory.text;
  const memoryId = `text-memory:${await digest([state.saveId, context.draft.turnId, context.draft.storyRevision, index, npcId])}`;
  return { ok: true, value: { ...common, type: 'RecordNpcMemory', npcId, expectedRevision: context.expectedRevision,
    knowledgeKind: memory.knowledgeKind, layer: 'personal', addToKnownInformation: false,
    memory: { id: memoryId, text, knowledgeKind: memory.knowledgeKind, knowledgeSource: memory.knowledgeSource,
      visibility: memory.visibility, sourceTurnIds: [context.draft.turnId], affectedEntityRefs: [{ kind: 'npc', id: npcId }], createdAtGameTime: clock } } };
}
