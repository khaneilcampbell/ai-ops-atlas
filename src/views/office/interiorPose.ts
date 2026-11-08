/** "All floors" camera for a lobby plus `maxFloor` levels, stacked 4 units apart. Up to 4 floors keeps the original pose. */
export function allFloorsPose(maxFloor:number){const e=Math.max(0,maxFloor-4);return {position:[24+3*e,17+4*e,30+3.5*e] as [number,number,number],target:8+2*e};}
