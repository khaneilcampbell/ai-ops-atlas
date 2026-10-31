import type {Page} from '@playwright/test';import type {RailPlan} from '../src/views/map3d/hillsCommunityPlan';import type {Pt} from '../src/views/map3d/roads';
/** Read the current pure planner through Vite, without test-only hooks in the application. */
export async function transportPlan(page:Page):Promise<{rail:RailPlan;highway:Pt[]}>{
 return page.evaluate(async()=>{
  const urls=['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts'];
  const [data,layout,planner]=await Promise.all(urls.map(url=>import(url)));
  const grouping=JSON.parse(localStorage.getItem('atlas:mapProjectGrouping')??'"district"');
  const scene=planner.buildScene(layout.layoutMap(data.catalog,[],grouping));
  return {rail:scene.communityRail,highway:scene.freight.highway};
 });
}
