import {LISTS,moduleListTests} from './module-lists';
// First half of the module lists; the rest are in module-lists-2.visual.ts.
moduleListTests(LISTS.slice(0,Math.ceil(LISTS.length/2)));
