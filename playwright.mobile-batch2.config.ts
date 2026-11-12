import {defineConfig} from '@playwright/test';
const business=process.env.MOBILE_BUSINESS==='1';
export default defineConfig({testDir:'./e2e',testMatch:business?'memory-summary-v2.spec.ts':'mobile-batch2.spec.ts',grep:business?/NPC先失败也不阻断公共两类，失败重试仅一次；暂停只保存本类关闭/:undefined,projects:business?[{name:'mobile'},{name:'desktop',use:{viewport:{width:1440,height:900},isMobile:false,hasTouch:false}}]:undefined,workers:1,retries:0,timeout:45000,
 reporter:[['list'],['json',{outputFile:`docs/mobile-batch2/${process.env.MOBILE_REPORT_NAME||(business?'memory-business':'chromium')}-results.json`}]],outputDir:'test-results/mobile-batch2',
 use:{baseURL:'http://127.0.0.1:5241',viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5241 --strictPort',url:'http://127.0.0.1:5241',reuseExistingServer:true}});
