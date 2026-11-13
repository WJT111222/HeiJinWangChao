import { defineConfig } from '@playwright/test';

// Only the two review requests; original batch evidence is never overwritten.
export default defineConfig({
  testDir:'./e2e',testMatch:'mobile-batch4-review.spec.ts',workers:1,retries:0,timeout:30000,
  reporter:[['list'],['json',{outputFile:'docs/mobile-batch4/review-r2/chromium-results.json'}]],
  outputDir:'test-results/mobile-batch4-review-r2',
  use:{baseURL:'http://127.0.0.1:5281',viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:'/usr/bin/chromium'}},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5281 --strictPort',url:'http://127.0.0.1:5281',reuseExistingServer:false},
});
