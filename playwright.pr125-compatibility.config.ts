import { defineConfig } from '@playwright/test';
const runName=process.env.PR125_RUN_NAME||'chromium';

// Exactly two NPC cases per platform plus one phone home-to-workflow smoke.
export default defineConfig({
  testDir:'./e2e',
  grep:/手动仅一人一批；普通界面不暴露身份、原文、总结和秘密条数；来源完整且刷新不重复收费|跨标签拒绝重复付费；取消\/迟到\/429不删除来源，明确手动重试可成功|#125 兼容：车票主按钮/,
  projects:[
    {name:'mobile',testMatch:['npc-memory.spec.ts','pr125-compatibility.spec.ts']},
    {name:'desktop',testMatch:'npc-memory.spec.ts',use:{viewport:{width:1440,height:900},isMobile:false,hasTouch:false}},
  ],
  workers:1,retries:0,timeout:35000,
  reporter:[['list'],['json',{outputFile:`docs/mobile-batch3/pr120-compatibility/${runName}-results.json`}]],
  outputDir:`test-results/pr125-compatibility-${runName}`,
  use:{baseURL:'http://127.0.0.1:5261',viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:'/usr/bin/chromium'}},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5261 --strictPort',url:'http://127.0.0.1:5261',reuseExistingServer:false},
});
