import {HILLS_DISTRICT_NAME,MANSION_NAME} from '../views/map3d/hillsPlan';
import {matches} from './search';
/**
 * Atlas Hills and Atlas Mansion share one detail panel (the district panel, which enters the mansion),
 * so search returns at most one row and names it after whichever place the query asked for.
 */
export function hillsSearchResult(query:string){
 if(!query.trim())return;
 const mansion=matches(query,MANSION_NAME,'mansion estate house'),district=matches(query,HILLS_DISTRICT_NAME,'residential community');
 if(!mansion&&!district)return;
 return mansion&&!district
  ?{title:MANSION_NAME,aliases:[HILLS_DISTRICT_NAME],meta:`${HILLS_DISTRICT_NAME} · Planned estate · Not connected`}
  :{title:HILLS_DISTRICT_NAME,aliases:[MANSION_NAME],meta:'Residential district · Planned · Not connected'};
}
