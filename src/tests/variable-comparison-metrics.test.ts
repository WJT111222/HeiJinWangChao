import { it, expect } from 'vitest';

it('实模统计区分提出、接受、已执行和结算时隔离', async () => {
  const modulePath = '../../scripts/variable-comparison-metrics.mjs';
  const {fixtureMetrics} = await import(modulePath);
  const expense = {type:'SpendFunds',commandId:'expense',account:'cash',amount:3000};
  const isolated = {type:'UpdateNpc',commandId:'late',npcId:'scene'};
  const report = {settled:true,stages:[
    {stage:'entities',proposed:['set npc[scene].lastInteractionAt = "2026-10-18T12:00:00+08:00"'],result:{commands:[isolated]}},
    {stage:'variables',proposed:['add economy.cash = -3000'],result:{commands:[expense]}},
  ],executedCommands:[expense],settlement:{entities:{accepted:0,skipped:[{commandIndex:0,reason:'time'}]}}};
  const metrics=fixtureMetrics(report,[expense]);
  expect(metrics).toMatchObject({counts:{proposed:2,accepted:2,executed:1,skipped:1},otherCommands:[],skippedCommands:1});
});

it('历史归一化整条忽略与逐条隔离分别计数，部分保留的实际写入只计一次', async () => {
  const modulePath = '../../scripts/variable-comparison-metrics.mjs';
  const {fixtureMetrics} = await import(modulePath);
  const clock = {type:'SetWorldClock',commandId:'clock',worldClock:'2026-10-18T00:10:00Z'};
  const normalized = {type:'RecordOrgRelation',commandId:'duplicate'};
  const invalid = {type:'UpdateNpc',commandId:'invalid'};
  const kept = {type:'SaveEvent',commandId:'kept',event:{backgroundText:'后台登记北楼为备用场地'}};
  const metrics = fixtureMetrics({settled:true,stages:[
    {stage:'variables',proposed:['set worldClock'],result:{commands:[clock]}},
    {stage:'world',proposed:[normalized,invalid,kept],result:{eventCommands:[kept]}},
  ],settlement:{world:{skipped:[{commandIndex:1,reason:'permission'}]}},executedCommands:[clock,kept]},[
    {type:'SetWorldClock',worldClock:'2026-10-18T08:10:00+08:00'},
    {type:'SaveEvent',event:{backgroundText:{$contains:'北楼'}}},
  ]);
  expect(metrics).toMatchObject({counts:{proposed:4,accepted:2,executed:2,skipped:2},
    skipped:[{commandIndex:1},{commandIndex:0,commandId:'duplicate'}],
    missing:[],incorrect:[],duplicates:[],otherCommands:[]});
});
