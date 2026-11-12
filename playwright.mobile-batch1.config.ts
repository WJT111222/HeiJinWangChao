import {defineConfig} from '@playwright/test';
const smoke=process.env.MOBILE_WORKFLOW_SMOKE==='1';
export default defineConfig({
 testDir:'./e2e',testMatch:smoke?'action-workflow.spec.ts':'mobile-main-batch1.spec.ts',
 grep:smoke?/(一次创角确认自动执行开局三阶段，StrictMode和重复点击不重复请求|发送行动只结算一次并自动串联下一轮，刷新及再次读档不补发)/:undefined,
 workers:1,retries:0,timeout:45000,
 reporter:[['list'],['json',{outputFile:`docs/mobile-main-batch1/${process.env.MOBILE_REPORT_NAME||(smoke?'workflow-smoke':'chromium')}-results.json`}]],
 outputDir:`test-results/mobile-main-batch1${smoke?'-workflow':''}`,
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5231 --strictPort',url:'http://127.0.0.1:5231',reuseExistingServer:true},
 use:{baseURL:'http://127.0.0.1:5231',viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}},
 projects:smoke?[{name:'mobile'},{name:'desktop',use:{viewport:{width:1440,height:900},isMobile:false,hasTouch:false}}]:undefined,
});
