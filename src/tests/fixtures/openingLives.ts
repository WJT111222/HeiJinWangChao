/** Deterministic authored examples, not results from a real model. Amounts are CNY fen. */
export const openingLives = [
  {
    key: 'teacher', profession: '教师', age: '30', background: '普通家庭长大，在重庆工作。',
    narrative: '【旁白】林舟把教案放进帆布包，旧书桌仍是父亲当年亲手修过的那张。他在重庆北碚长大，母亲做过售货员，家里不阔绰，却总给他留一盏读书的灯。读师范时他喜欢历史，也爱在球场上消磨午后；毕业后教了几年书，最初板着脸管学生，吃过亏才学会先听人说话。\n【旁白】如今他在学校附近租一间小屋，工资能付房租、日常开销并留些积蓄，平时骑车上班，周末回父母家吃饭。稳定的工作并没有消除备课和考核的压力，他想学摄影，却总把时间留给卷子。今天桌上的家常早餐照旧，妹妹发来一张老相册照片，提醒他周末团聚。他笑着回复，随后看到同事邀他参加社区读书活动的消息；要不要去，还可以慢慢考虑。',
    cash: 30000, onlineBalance: 3200000, source: '学校教师工资', amount: 580000, scheduleText: '每月15日发薪',
  },
  {
    key: 'student', profession: '大学生', age: '20', background: '广州长大，父母关系和睦；重庆读建筑专业，喜欢速写，不要改成孤儿或失学。',
    narrative: '【旁白】宿舍桌上压着一张速写，林舟沿着街巷画的线条还带着珠江边旧家的影子。小时候父亲带他逛市场，母亲总会在他画歪的楼房旁认真签名；普通家庭的支持让他能来重庆读建筑，离家远了也仍每周打视频电话。专业课不轻松，他的空间感不错，却常在公开汇报时紧张。\n【旁白】没有固定工资的日子，他靠家里按月给的生活费安排食堂、交通和绘图材料，偶尔接校内海报设计，收入只在真正交稿收款后才算数。他住四人宿舍，步行去教室，习惯把零用结余留作采风费用。室友今天邀他一起走访老街；他想起上次错过展示的遗憾，收好画本，决定先听听具体安排。',
    cash: 8000, onlineBalance: 260000, source: '家庭生活费', amount: 180000, scheduleText: '每月月初由父母提供',
  },
  {
    key: 'between-jobs', profession: '暂未就业', age: '28', background: '与家人关系良好，刚结束一份工作，靠积蓄休整。',
    narrative: '【旁白】林舟洗完杯子，关掉已经不再响起的上班闹钟。他在县城长大，父母经营小店，姐姐教他做第一份简历；读大专学会修电脑后，他在城市做过几年设备维护。曾经解决故障带来的成就感还在，长期轮班让他决定离职休整，这不是破产，也没有谁在追赶他。\n【旁白】租住的小套间够放书架和工具箱，既有积蓄承担眼下房租和生活费。他暂时没有固定工资，买菜做饭、乘公交，计划把身体养好再找合适岗位。遇到问题爱独自硬撑是旧毛病，家人仍会问他近况。上午姐姐来电，说附近有人想了解电脑维修课程，他坐下来听，暂未答应授课或收取任何费用。',
    cash: 12000, onlineBalance: 1800000,
  },
  {
    key: 'comfortable', profession: '设计师', age: '27', background: '上海富裕家庭长大，父母健在，有稳定设计工作和个人积蓄，不强制家庭变故。',
    narrative: '【旁白】林舟从书架取下学生时代的作品集，封底还留着母亲陪他布展时写的鼓励。他在上海长大，父亲经营实业，母亲喜欢园艺，优裕的家庭让他从小接触绘画，却没有替他完成每一次考核。大学学设计时他受过批评，工作后才渐渐明白，耐心沟通和创意同样重要。\n【旁白】如今稳定的设计工作给他工资和自己的积蓄，他住在条件宽敞的家中，坐轨道交通去公司，周末游泳、与朋友看展。生活没有突如其来的灾难，项目修改和独立承担责任却仍让他疲惫。今天早餐桌上，父母谈起社区公益展，他想到一套尚未实现的设计，拿起手机询问朋友是否愿意一起了解；后续投入多少，仍由他自己决定。',
    cash: 150000, onlineBalance: 12800000, source: '设计岗位工资', amount: 1600000, scheduleText: '每月月底发薪',
  },
] as const;
export type OpeningLife = typeof openingLives[number];
export const openingStart = '2015-07-08T08:00:00+08:00';
export const openingEnd = '2015-07-08T08:05:00+08:00';
export function openingValues(life: OpeningLife) {
  return { weatherText: '夏日多云，晨间微热', environmentText: '住宅周围早餐店陆续开门，街巷响起邻里出门和公交到站的声音。',
    cash: life.cash, onlineBalance: life.onlineBalance,
    expectedIncomes: 'source' in life ? [{ id: `income-${life.key}`, source: life.source, amount: life.amount, status: 'expected', account: 'onlineBalance', scheduleText: life.scheduleText }] : [],
  };
}
