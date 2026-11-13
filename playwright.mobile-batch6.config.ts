import base from './playwright.config';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,workers:1,retries:0,
 projects:base.projects!.map(p=>({...p,testMatch:p.name==='mobile'?['turn-changes.spec.ts','mobile-turn-changes.spec.ts','pr120-integration.spec.ts','mobile-home.spec.ts','mobile-batch4.spec.ts','mobile-archives.spec.ts']:['turn-changes.spec.ts'],use:{...p.use,deviceScaleFactor:1}})),
 use:{...base.use,baseURL:'http://127.0.0.1:5180',reducedMotion:'reduce'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',url:'http://127.0.0.1:5180',reuseExistingServer:true}});
