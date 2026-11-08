import base from './playwright.config';import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testMatch:'map-controls.visual.ts',use:{...base.use,deviceScaleFactor:1}});
