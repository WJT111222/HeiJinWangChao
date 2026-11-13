import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testMatch:['mobile-archives.spec.ts','pr120-integration.spec.ts','npc-directory.spec.ts'],workers:1,retries:0,
 projects:[{...base.projects![1],use:{...base.projects![1].use,deviceScaleFactor:1}}],use:{...base.use,baseURL:'http://127.0.0.1:5176',reducedMotion:'reduce'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5176 --strictPort',url:'http://127.0.0.1:5176',reuseExistingServer:true}});
