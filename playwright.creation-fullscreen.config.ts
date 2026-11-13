import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',testMatch:'creation-fullscreen.spec.ts',workers:1,retries:0,timeout:30000,
 reporter:[['list'],['json',{outputFile:process.env.CREATION_LAYOUT_RESULT??'test-results/creation-fullscreen-results.json'}]],
 outputDir:'test-results/creation-fullscreen',
 use:{baseURL:'http://127.0.0.1:5311',reducedMotion:'reduce',trace:'retain-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5311 --strictPort',url:'http://127.0.0.1:5311',reuseExistingServer:false},
});
