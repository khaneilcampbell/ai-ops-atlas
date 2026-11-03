export const FLOOR_HEIGHT = 4;
/** Each stop takes this long: doors open for the first 5 s, then 3 s to the next landing. */
export const LIFT_STOP_SECONDS = 8;
/**
 * One timeline drives the car, landing doors and arriving visitors. The car runs from the lobby up to `top` and back,
 * stopping at every landing; `offset` shifts a second lift's timeline so two cars don't move in step.
 */
export function elevatorAt(seconds:number,top=4,offset=0){
  const stops=[...Array.from({length:top+1},(_,i)=>i),...Array.from({length:top},(_,i)=>top-1-i)],period=top*2*LIFT_STOP_SECONDS;
  const cycle=(((seconds+offset)%period)+period)%period,stop=Math.floor(cycle/LIFT_STOP_SECONDS),phase=cycle%LIFT_STOP_SECONDS;
  const t=Math.max(0,(phase-5)/3),smooth=t*t*(3-2*t);
  return {height:(stops[stop]+(stops[stop+1]-stops[stop])*smooth)*FLOOR_HEIGHT,landing:phase<5?stops[stop]:null,phase};
}
