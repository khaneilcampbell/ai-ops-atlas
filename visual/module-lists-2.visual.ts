import {LISTS,moduleListTests} from './module-lists';
// Second half of the module lists; the first half is in module-lists-1.visual.ts.
moduleListTests(LISTS.slice(Math.ceil(LISTS.length/2)));
