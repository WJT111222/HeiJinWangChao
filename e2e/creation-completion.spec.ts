import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

const url = 'https://creation-completion.mock.invalid/v1';
const appearanceText = '身形高大，站姿挺拔。方形眼镜下目光专注，衣着素净，偏爱深色外套和轻便皮鞋。';
const personalityText = '她冷静谨慎，处理争议时先核实事实，再列出计划。对自己认定的方向有野心，也愿意调整手段。';
const backgroundText = '她在社区长大，常随家人整理旧报和文书。学生时代参加社区服务，后来学习法律并开始在事务所工作。';
const defaultJob = {
  professionDescription:'整理来访咨询、审核合同并向客户解释风险。需要熟悉程序，准确区分事实与假设。',
  professionSkills:['合同审阅','法律检索','证据梳理','咨询访谈'],
  professionLongTermImpact:'长期工作会积累专业判断、同行协作经验和稳定的信息检索习惯。事务高峰期也会带来时间安排压力。',
};
const longJob = {...defaultJob,professionSkills:[...defaultJob.professionSkills,'谈判支持','合规复核']};
const person = (page:Page,label:string)=>page.getByLabel(label,{exact:true});
const button = (page:Page,label:string)=>page.getByRole('button',{name:'AI补全'+label.replace('（可选）',''),exact:true});
const next = (page:Page)=>page.getByRole('button',{name:/下一步/}).click();

async function start(page:Page) {
  await page.addInitScript((baseUrl)=>{
    const channel={id:'creation-story',name:'正文测试渠道',baseUrl,protocol:'openai',defaultModel:'wrong-default',
      parameters:{temperature:0.68,maxOutputTokens:9000},compatibility:{temperature:true,maxOutputTokens:true,jsonMode:true,cotMode:'confirmation',cotModels:[]}};
    localStorage.setItem('heijin.ai.v1',JSON.stringify({version:1,channels:[channel],
      routes:{story:{channelId:channel.id,modelId:'story-creation-mock'},variables:{mode:'follow-story'},world:{mode:'follow-story'},memory:{mode:'follow-story'}}}));
    sessionStorage.setItem('heijin.credential.v1:'+channel.id,'fixture-browser-creation-key');
  },url);
  await page.goto('/');
  await page.getByRole('button',{name:/开始新游戏/}).click();
  await person(page,'姓名').fill('林舟');
  await person(page,'年龄').fill('30');
  await page.getByRole('radio',{name:'女性',exact:true}).check();
}

async function checkPlacement(page:Page,label:string) {
  await expect(button(page,label)).toBeVisible();
  const inputBounds=await person(page,label).boundingBox(), buttonBounds=await button(page,label).boundingBox();
  expect(inputBounds).not.toBeNull(); expect(buttonBounds).not.toBeNull();
  const input=inputBounds!, action=buttonBounds!;
  expect(action.x).toBeGreaterThan(input.x+input.width/2);
  expect(Math.abs(action.x+action.width-input.x-input.width)).toBeLessThan(4);
  expect(action.y).toBeGreaterThanOrEqual(input.y+input.height-1);
  expect(action.y-(input.y+input.height)).toBeLessThan(18);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

function reply(content:string) {
  return {choices:[{message:{content},finish_reason:'stop'}]};
}

test('四个独立入口，原样传入已有要求，职业默认与显式技能数量一次补齐',async({page},info)=>{
  const requests: {system:string;input:Record<string,string>}[]=[];
  let resumeAppearance!:()=>void;
  const holdAppearance=new Promise<void>(resolve=>{resumeAppearance=resolve;});
  await page.route(url+'/**',async route=>{
    const body=route.request().postDataJSON();
    expect(route.request().headers().authorization).toBe('Bearer fixture-browser-creation-key');
    expect(JSON.stringify(body)).not.toContain('fixture-browser-creation-key');
    expect(body).toMatchObject({model:'story-creation-mock',temperature:0.68,stream:false});
    const [system,user]=body.messages, input=JSON.parse(user.content) as Record<string,string>;
    requests.push({system:system.content,input});
    let text: string;
    if ('appearance' in input) { await holdAppearance; text=appearanceText; }
    else if ('background' in input) text=backgroundText;
    else if ('professionSkills' in input) text=JSON.stringify(input.professionSkills.includes('6 项')?longJob:defaultJob);
    else text=personalityText;
    await route.fulfill({json:reply(text)});
  });
  await start(page);
  const appearances=person(page,'外貌'), personality=person(page,'性格');
  await appearances.fill('身材高大，戴眼镜，帮我写 300 字。');
  await personality.fill('冷静谨慎、有野心，简单描述，100 字。');
  await checkPlacement(page,'外貌');
  await checkPlacement(page,'性格');
  expect(requests).toHaveLength(0);
  try {
    await button(page,'外貌').evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
    await expect(button(page,'外貌')).toBeDisabled();
    await expect(button(page,'外貌')).toHaveText('生成中…');
    await expect(button(page,'性格')).toBeEnabled();
    await expect.poll(()=>requests.length).toBe(1);
    await person(page,'姓名').fill('林舟改');
    await button(page,'性格').click();
    await expect(personality).toHaveValue(personalityText);
    await expect(appearances).toHaveValue('身材高大，戴眼镜，帮我写 300 字。');
  } finally { resumeAppearance(); }
  await expect(appearances).toHaveValue(appearanceText);
  await expect(personality).toHaveValue(personalityText);
  await expect(person(page,'姓名')).toHaveValue('林舟改');
  expect(requests[0]).toMatchObject({system:expect.stringContaining('150–200'),input:{appearance:'身材高大，戴眼镜，帮我写 300 字。'}});
  expect(requests[1]).toMatchObject({system:expect.stringContaining('性格补全'),input:{personality:'冷静谨慎、有野心，简单描述，100 字。'}});
  await button(page,'外貌').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('basic.png')});

  await next(page);
  const job=person(page,'职业名称'), description=person(page,'职业介绍');
  const skills=person(page,'内置职业技能'), impact=person(page,'长期影响');
  await expect(button(page,'职业介绍')).toBeDisabled();
  await job.fill('社区律师');
  await expect(description).toHaveValue(''); await expect(skills).toHaveValue(''); await expect(impact).toHaveValue('');
  await checkPlacement(page,'职业介绍');
  await button(page,'职业介绍').click();
  await expect(description).toHaveValue(defaultJob.professionDescription);
  await expect(skills).toHaveValue(defaultJob.professionSkills.join('\n'));
  await expect(impact).toHaveValue(defaultJob.professionLongTermImpact);
  await expect(job).toHaveValue('社区律师');
  expect(requests[2]).toMatchObject({system:expect.stringMatching(/150–200[\s\S]*4 项[\s\S]*100–150/u),
    input:{profession:'社区律师',professionDescription:'',professionSkills:'',professionLongTermImpact:''}});
  await description.fill('保留合同工作，介绍写 200 字。');
  await skills.fill('技能 6 项');
  await impact.fill('保留客户沟通，长期影响写 180 字。');
  await button(page,'职业介绍').click();
  await expect(skills).toHaveValue(longJob.professionSkills.join('\n'));
  await expect(job).toHaveValue('社区律师');
  expect(requests[3].input).toEqual({profession:'社区律师',professionDescription:'保留合同工作，介绍写 200 字。',
    professionSkills:'技能 6 项',professionLongTermImpact:'保留客户沟通，长期影响写 180 字。'});
  await button(page,'职业介绍').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('profession.png')});

  await next(page);
  const backgroundLabel='人物背景（可选）';
  await person(page,backgroundLabel).fill('社区长大，扩写到 800 字。');
  await checkPlacement(page,backgroundLabel);
  await button(page,backgroundLabel).click();
  await expect(person(page,backgroundLabel)).toHaveValue(backgroundText);
  expect(requests[4]).toMatchObject({system:expect.stringContaining('300–500'),
    input:{background:'社区长大，扩写到 800 字。',profession:'社区律师',personality:personalityText}});
  await button(page,backgroundLabel).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('background.png')});
  await page.reload();
  await expect(person(page,backgroundLabel)).toHaveValue(backgroundText);
  expect(requests).toHaveLength(5);
});

test('失败保留数据，编辑和跨步骤的迟到响应失效，普通建档不多发请求',async({page})=>{
  let resume!:()=>void;
  const responses:Promise<void>[]=[];
  let requests=0;
  await page.route(url+'/**',async route=>{
    const index=++requests;
    if(index<=2) await new Promise<void>(resolve=>{resume=resolve;});
    const response=index===3?{json:reply(JSON.stringify({professionDescription:'不得局部写入'}))}:
      index===4?{status:500,body:''}:{json:reply('本段迟到文字绝不能覆盖表单。')};
    const completion=route.fulfill(response).catch(()=>{ /* 本测试故意取消早期请求。 */ });
    responses.push(completion);
    await completion;
  });
  await start(page);
  const appearances=person(page,'外貌'), personality=person(page,'性格');
  await appearances.fill('原简短外貌');
  await button(page,'外貌').click();
  await expect.poll(()=>requests).toBe(1);
  await appearances.fill('手动编辑后要保留');
  resume();
  await expect.poll(()=>responses.length).toBe(1);
  await expect(appearances).toHaveValue('手动编辑后要保留');
  await expect(button(page,'外貌')).toBeEnabled();

  await personality.fill('原简短性格');
  await button(page,'性格').click();
  await expect.poll(()=>requests).toBe(2);
  await next(page);
  resume();
  await expect.poll(()=>responses.length).toBe(2);
  await page.getByRole('button',{name:'上一步',exact:true}).click();
  await expect(personality).toHaveValue('原简短性格');
  await next(page);

  await person(page,'职业名称').fill('手动职业');
  await person(page,'职业介绍').fill('原介绍');
  await person(page,'内置职业技能').fill('原技能一\n原技能二');
  await person(page,'长期影响').fill('原影响');
  await button(page,'职业介绍').click();
  await expect(page.getByRole('alert').filter({hasText:'返回内容格式不正确'})).toBeVisible();
  await expect(person(page,'职业名称')).toHaveValue('手动职业');
  await expect(person(page,'职业介绍')).toHaveValue('原介绍');
  await expect(person(page,'内置职业技能')).toHaveValue('原技能一\n原技能二');
  await expect(person(page,'长期影响')).toHaveValue('原影响');

  await next(page);
  const backgroundLabel='人物背景（可选）';
  await person(page,backgroundLabel).fill('保留的短背景');
  await button(page,backgroundLabel).click();
  await expect(page.getByRole('alert').filter({hasText:'AI 补全失败'})).toBeVisible();
  await expect(person(page,backgroundLabel)).toHaveValue('保留的短背景');
  await page.getByRole('button',{name:'跳过背景，继续'}).click();
  await page.getByRole('button',{name:'跳过同伴，继续'}).click();
  // Remove only the Mock credential. Creating a save without an available model
  // follows the existing manual creation path and cannot reach the mock endpoint.
  await page.evaluate(()=>sessionStorage.removeItem('heijin.credential.v1:creation-story'));
  await page.getByRole('button',{name:'确认并创建存档',exact:true}).click();
  await expect(page.locator('.game-layout')).toBeVisible();
  expect(requests).toBe(4);
});
