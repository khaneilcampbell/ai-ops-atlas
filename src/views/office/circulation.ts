export const FLOOR_HEIGHT = 4;
const STOPS = [0,1,2,3,4,3,2,1,0];
/** One timeline drives the car, landing doors and arriving visitors. */
export function elevatorAt(seconds:number){
  const cycle=((seconds%64)+64)%64,stop=Math.floor(cycle/8),phase=cycle%8;
  const t=Math.max(0,(phase-5)/3),smooth=t*t*(3-2*t);
  return {height:(STOPS[stop]+(STOPS[stop+1]-STOPS[stop])*smooth)*FLOOR_HEIGHT,landing:phase<5?STOPS[stop]:null,phase};
}

/** Lift colours. The default is the shared Atlas lift; a building can pass its own palette. */
export type LiftTheme={platform:string;back:string;sides:string;header:string;doors:string;button:string;carFloor:string;carBack:string;
  /** A thin lit floor indicator above the doors, when set. */ indicator?:string};
export const ATLAS_LIFT:LiftTheme={platform:"#d4c7aa",back:"#294c3e",sides:"#d4cbb8",header:"#b69b60",doors:"#7f9289",button:"#c5a35c",carFloor:"#bba36f",carBack:"#4f6b5d"};
/** Circa: black frames and header, walnut cab walls, warm grey stone platform, brushed bronze doors and call button. */
export const CIRCA_LIFT:LiftTheme={platform:"#9a9893",back:"#5b3a26",sides:"#5b3a26",header:"#1b1b1d",doors:"#8a6a45",button:"#8a6a45",carFloor:"#9a9893",carBack:"#5b3a26",indicator:"#ffd9a0"};
