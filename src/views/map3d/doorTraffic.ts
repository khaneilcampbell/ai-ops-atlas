/** Current pedestrian positions, shared by the crowd and entrance panels. */
const people: {x:number;z:number}[]=[];
export function beginPedestrianFrame(){people.length=0;}
export function reportPedestrian(x:number,z:number){people.push({x,z});}
export function entranceOccupied(x:number,z:number,radius=0.5){return people.some(p=>(p.x-x)**2+(p.z-z)**2<radius*radius);}
export function doorOpenness(current:number,occupied:boolean,dt:number){return current+((occupied?1:0)-current)*(1-Math.exp(-Math.min(Math.max(dt,0),0.1)*12));}

export function pedestrianAllowed(exclusion:{x:number;z:number;w:number;d:number}|undefined,x:number,z:number){return !exclusion||x<exclusion.x-0.15||x>exclusion.x+exclusion.w+0.15||z<exclusion.z-0.15||z>exclusion.z+exclusion.d+0.15;}
