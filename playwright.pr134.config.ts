import base from './playwright.config';
import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
const baseline=process.env.PR134_BASELINE_ROOT;
const port=baseline?5282:5182;
export default defineConfig({...base,
 testDir:baseline?resolve(baseline,'e2e'):base.testDir,
 use:{...base.use,baseURL:`http://127.0.0.1:${port}`},
 webServer:{command:`npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,cwd:baseline??process.cwd(),url:`http://127.0.0.1:${port}`,reuseExistingServer:true}});
