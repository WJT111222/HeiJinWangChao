import {defineConfig} from '@playwright/test';
const compat=process.env.MOBILE4_COMPAT==='1';
const business=process.env.MOBILE4_BUSINESS==='1',tag=process.env.MOBILE4_RUN||'chromium';
export default defineConfig({testDir:'./e2e',testMatch:compat?'pr125-compatibility.spec.ts':business?'opening-packs.spec.ts':'mobile-batch4.spec.ts',
 grep:compat?/#125 兼容/:business?/同名包独立管理|损坏包隔离/:undefined,
 projects:business?[{name:'desktop',use:{viewport:{width:1440,height:900},isMobile:false,hasTouch:false}}]:undefined,
 workers:1,retries:0,timeout:45000,reporter:[['list'],['json',{outputFile:`docs/mobile-batch4/${tag}-results.json`}]],outputDir:`test-results/mobile-batch4-${tag}`,
 use:{baseURL:'http://127.0.0.1:5271',viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:'/usr/bin/chromium'}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5271 --strictPort',url:'http://127.0.0.1:5271',reuseExistingServer:true}});
