import {defineConfig} from '@playwright/test';
const business=process.env.MOBILE_BUSINESS==='1', desktop=process.env.HOME_DESKTOP==='1';
export default defineConfig({testDir:'./e2e',testMatch:business?'npc-memory.spec.ts':desktop?['unreadable-saves.spec.ts','home-cover.spec.ts']:'mobile-home.spec.ts',
 grep:business?/手动仅一人一批|跨标签拒绝重复付费/:desktop?/下载 JSON 完整保留|二次确认取消不删数据|真实存档与封面/:undefined,
 projects:business?[{name:'mobile'},{name:'desktop',use:{viewport:{width:1440,height:900},isMobile:false,hasTouch:false}}]:undefined,
 workers:1,retries:0,timeout:35000,reporter:[['list'],['json',{outputFile:`docs/mobile-batch3/${process.env.MOBILE_RUN_TAG||(business?'privacy-billing':desktop?'desktop-business':'chromium')}-results.json`}]],outputDir:`test-results/mobile-batch3-${business?'business':desktop?'desktop':process.env.MOBILE_RUN_TAG||'home'}`,
 use:{baseURL:'http://127.0.0.1:5251',viewport:desktop?{width:1440,height:900}:{width:390,height:844},isMobile:!desktop,hasTouch:!desktop,reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:'/usr/bin/chromium'}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5251 --strictPort',url:'http://127.0.0.1:5251',reuseExistingServer:true}});
