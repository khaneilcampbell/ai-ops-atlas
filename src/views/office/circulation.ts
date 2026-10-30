export const FLOOR_HEIGHT = 4;
const STOPS = [0,1,2,3,4,3,2,1,0];
/** One timeline drives the car, landing doors and arriving visitors. */
export function elevatorAt(seconds:number){
  const cycle=((seconds%64)+64)%64,stop=Math.floor(cycle/8),phase=cycle%8;
  const t=Math.max(0,(phase-5)/3),smooth=t*t*(3-2*t);
  return {height:(STOPS[stop]+(STOPS[stop+1]-STOPS[stop])*smooth)*FLOOR_HEIGHT,landing:phase<5?STOPS[stop]:null,phase};
}
