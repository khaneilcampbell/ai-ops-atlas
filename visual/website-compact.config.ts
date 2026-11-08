import {defineConfig} from '@playwright/test';
import base from './properties.config';
export default defineConfig({...base,testMatch:'website-compact.web.ts'});
