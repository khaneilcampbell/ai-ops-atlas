import base from './playwright.config';import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testMatch:['compact-city.visual.ts','compact-commute.visual.ts'],webServer:undefined,use:{...base.use,baseURL:'http://127.0.0.1:1422/',deviceScaleFactor:1}});
