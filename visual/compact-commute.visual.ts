import {test} from '@playwright/test';
import {railJourney} from './rail-journey';
test.use({deviceScaleFactor:1});
// The approved loop replaced the Hills shuttle; retain real renderer and passenger checks.
test('Complete rendered commuter round trip',async({page})=>{await railJourney(page);});
