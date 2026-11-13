import {YACHT,YACHT_SCALE,yachtBerth} from '../map3d/yachtPlan';
import {TERRACE_H,WATER_Y} from '../map3d/scene';
import {hullHalf} from '../map3d/yachtGeometry';

/**
 * Inside Atlas: all four decks from Khaneil's reference deck plan (2026-11-13: "For the interior all
 * four decks"), in metres. x runs along the length (stern -29, bow +29), z across (port negative).
 * Rooms are measured off the reference plan's proportions; the furniture is schematic.
 * People on board are visitors and crew figures only: no agents are assigned (Khaneil, 2026-11-13:
 * "just add people dont assign agent yet to the yacht").
 */
export const YACHT_INTERIOR={length:58,deckH:3.2,wall:2.5,lowWall:1,explode:5.2} as const;
/** Metres per map unit. */
export const K=YACHT_INTERIOR.length/YACHT.length;
/** Half the hull's beam at x (metres), from the same lines as the map model. */
export const halfBeam=(x:number)=>hullHalf(x/K)*K;

export const DECKS=['Lower deck','Main deck','Bridge deck','Sun deck'] as const;
export type Deck=0|1|2|3;
/** Each deck's extent along the length; the deck plate follows the hull outline inside it. */
export const DECK_SPAN:Record<Deck,[number,number]>={0:[-29,28],1:[-29,28],2:[-23.5,25],3:[-19.8,9.5]};
/** Inset of each deck's edge from the hull side (side decks and overhangs). */
export const DECK_INSET:Record<Deck,number>={0:.25,1:.2,2:.25,3:.6};

export type Furniture='lounge'|'dining'|'bed'|'twin'|'bar'|'bath'|'engine'|'stair'|'helm'|'galley'|'jacuzzi'|'sunbeds'|'desk'|'storage'|'tender'|'sauna'|'none';
export interface Room {id:string;deck:Deck;name:string;what:string;x0:number;x1:number;z0:number;z1:number;floor:string;kind:Furniture;open?:boolean}

const TEAK='#b98c5f',CREAM='#e9e3d3',SAND='#e2d6bd',GREY='#9aa1a4',STONE='#cfd2cf',SAGE='#c4cdb8';
/** Every space on board. `open` spaces are outside decks, drawn with rails instead of walls. */
export const ROOMS:Room[]=[
 // Lower deck
 {id:'beach-club',deck:0,name:'Beach club',what:'Opens onto the swim platform: lounge, wet bar, sauna and day head',x0:-29,x1:-18.3,z0:-4.2,z1:4.2,floor:TEAK,kind:'lounge'},
 {id:'sauna',deck:0,name:'Sauna',what:'Beside the beach club',x0:-22.5,x1:-19.3,z0:2.2,z1:4.2,floor:'#a77b52',kind:'sauna'},
 {id:'engine',deck:0,name:'Engine room',what:'Twin engines, generators and the tech room',x0:-18.3,x1:-8,z0:-4.6,z1:4.6,floor:GREY,kind:'engine'},
 {id:'vip',deck:0,name:'VIP cabin',what:'Full-beam guest suite with bathroom',x0:-8,x1:-2.6,z0:-4.9,z1:4.9,floor:SAND,kind:'bed'},
 {id:'double-1',deck:0,name:'Double cabin 1',what:'Guest double with bathroom',x0:-2.6,x1:3.4,z0:-4.9,z1:-1.2,floor:SAND,kind:'bed'},
 {id:'double-2',deck:0,name:'Double cabin 2',what:'Guest double with bathroom',x0:-2.6,x1:3.4,z0:1.2,z1:4.9,floor:SAND,kind:'bed'},
 {id:'guest-lobby',deck:0,name:'Guest lobby',what:'Spiral stair up to the main deck lobby',x0:-2.6,x1:3.4,z0:-1.2,z1:1.2,floor:CREAM,kind:'stair'},
 {id:'twin-1',deck:0,name:'Twin cabins',what:'Two twin guest cabins, each with a bathroom',x0:3.4,x1:8.9,z0:-4.9,z1:4.9,floor:SAND,kind:'twin'},
 {id:'crew',deck:0,name:'Crew quarters',what:'Crew cabins, mess and laundry',x0:8.9,x1:20,z0:-3.4,z1:3.4,floor:STONE,kind:'twin'},
 // Main deck
 {id:'aft-deck',deck:1,name:'Aft deck',what:'Outdoor lounge and the passerelle gate from the dock',x0:-29,x1:-16.2,z0:-4.7,z1:4.7,floor:TEAK,kind:'lounge',open:true},
 {id:'saloon',deck:1,name:'Main saloon',what:'Day lounge and dining for twelve',x0:-16.2,x1:.2,z0:-4.6,z1:4.6,floor:CREAM,kind:'dining'},
 {id:'main-lobby',deck:1,name:'Main lobby',what:'Spiral stair linking all four decks',x0:.2,x1:4.7,z0:-4.6,z1:4.6,floor:STONE,kind:'stair'},
 {id:'galley',deck:1,name:'Galley and pantry',what:'Galley, cold room, food lift and crew lobby',x0:4.7,x1:9.7,z0:-4.6,z1:4.6,floor:'#d9dcd6',kind:'galley'},
 {id:'owner',deck:1,name:"Owner's suite",what:'Bedroom, office, dressing room and his and hers bathrooms',x0:9.7,x1:18,z0:-4,z1:4,floor:'#e6d3a8',kind:'bed'},
 {id:'owner-office',deck:1,name:"Owner's office",what:'Desk looking out over the water',x0:9.7,x1:13.5,z0:-4,z1:-1.4,floor:'#e6d3a8',kind:'desk'},
 {id:'bow-store',deck:1,name:'Bow storage',what:'Anchor gear and stores',x0:18,x1:23.5,z0:-1.9,z1:1.9,floor:GREY,kind:'storage'},
 // Bridge deck
 {id:'bridge-aft',deck:2,name:'Bridge aft deck',what:'Alfresco dining for twelve under the sun deck overhang',x0:-23.5,x1:-7.2,z0:-4.6,z1:4.6,floor:TEAK,kind:'dining',open:true},
 {id:'bridge-saloon',deck:2,name:'Bridge saloon',what:'Second saloon with a lounge and media wall',x0:-7.2,x1:.2,z0:-4.3,z1:4.3,floor:'#ece6d4',kind:'lounge'},
 {id:'captain',deck:2,name:"Captain's cabin",what:'Captain cabin and bathroom beside the bridge pantry',x0:.2,x1:6,z0:1,z1:4.3,floor:SAGE,kind:'bed'},
 {id:'bridge-lobby',deck:2,name:'Bridge lobby',what:'Spiral stair, pantry and food lift',x0:.2,x1:6,z0:-4.3,z1:1,floor:STONE,kind:'stair'},
 {id:'wheelhouse',deck:2,name:'Wheelhouse',what:'Helm, navigation and engine monitoring',x0:6,x1:11.3,z0:-3.6,z1:3.6,floor:'#5c656a',kind:'helm'},
 {id:'foredeck',deck:2,name:'Foredeck lounge',what:'Sofas, sunpads and the jet ski and tender stowage',x0:11.3,x1:21,z0:-3.1,z1:3.1,floor:TEAK,kind:'tender',open:true},
 // Sun deck
 {id:'sun-aft',deck:3,name:'Sun lounge',what:'Sunbeds and day beds facing aft',x0:-19.8,x1:-7.6,z0:-4.4,z1:4.4,floor:TEAK,kind:'sunbeds',open:true},
 {id:'sun-bar',deck:3,name:'Bar',what:'Bar with stools and a day head',x0:-7.6,x1:-1.5,z0:-4.4,z1:4.4,floor:TEAK,kind:'bar',open:true},
 {id:'jacuzzi',deck:3,name:'Jacuzzi',what:'Jacuzzi under the hard top, with seating round it',x0:-1.5,x1:9.5,z0:-3.8,z1:3.8,floor:TEAK,kind:'jacuzzi',open:true},
];
export const STATUS='Planned · Visual yacht · No agents assigned';

/** A room's centre. */
export const roomCentre=(r:Room):[number,number]=>[(r.x0+r.x1)/2,(r.z0+r.z1)/2];
/** True when the room fits inside its deck's hull outline (with the deck inset). */
export function roomInsideHull(r:Room){
 const [a,b]=DECK_SPAN[r.deck];if(r.x0<a-1e-6||r.x1>b+1e-6)return false;
 for(let i=0;i<=8;i++){const x=r.x0+(r.x1-r.x0)*i/8,h=halfBeam(x)-DECK_INSET[r.deck]*.5;if(Math.max(-r.z0,r.z1)>h+.05)return false;}
 return true;
}

/**
 * Figures on board, per deck: visitors and crew only, placed in their rooms (seated in lounges, at
 * the bar, at the helm). Deterministic, so screenshots repeat. Never agents.
 */
export function peopleOnBoard():{deck:Deck;x:number;z:number;seated:boolean;room:string}[]{
 const spots:[string,number,number,boolean][]=[
  ['beach-club',-25,-1.5,true],['beach-club',-24,1.6,true],['vip',-5.5,-2,false],
  ['aft-deck',-25,0,true],['aft-deck',-21,-2.6,false],['saloon',-11,-2.2,true],['saloon',-10,2.2,true],['saloon',-4,0,false],['galley',7,0,false],['owner',15,1.5,false],
  ['bridge-aft',-16,-1.4,true],['bridge-aft',-14,1.4,true],['bridge-saloon',-4,-1.5,true],['wheelhouse',9.4,0,false],['foredeck',15,0,true],
  ['sun-aft',-14,-2.6,true],['sun-bar',-4.6,1.5,false],['jacuzzi',3.4,1.8,true],
 ];
 return spots.map(([room,x,z,seated])=>({deck:ROOMS.find(r=>r.id===room)!.deck,x,z,seated,room}));
}

/** A box in the interior scene: centre, size and colour (metres). */
export type AroundBox={p:[number,number,number];s:[number,number,number];c:string};
/**
 * Where Atlas lies, round the interior (Khaneil, 2026-11-13: "i want to see whats around the boat
 * where its located"): the marina cross dock her pontoon joins, the pier and stair up to the south
 * shore promenade, the seawall and railing, and the lawn behind. Laid out from the map's own marina
 * and berth (yachtBerth), scaled to the interior and lined up on the pontoon deck at `dockTop`.
 * Land runs down to the water plane at `water`. Port side (-z) faces the shore, as on the map.
 */
export function harbourAround(dockTop:number,water:number):AroundBox[]{
 const m={x:0,pierZ:0,shoreZ:-1.8,cityWalkZ:-2.6},b=yachtBerth(m),F=K/YACHT_SCALE;
 const mapDock=WATER_Y+.22,cityTop=TERRACE_H+.03,Y=(y:number)=>dockTop+(y-mapDock)*F;
 const X=(x:number)=>(x-b.x)*F,Z=(z:number)=>(z-b.z)*F;
 const out:AroundBox[]=[];
 // Top-aligned box from map values: x/z centre and size, top height, depth down (metres).
 const slab=(x:number,z:number,w:number,d:number,top:number,c:string,deep=.4)=>out.push({p:[X(x),top-deep/2,Z(z)],s:[w*F,deep,d*F],c});
 // Cross dock and pier, as on the map's marina, with piles.
 slab(m.x,m.pierZ+1.05,3.6,.38,dockTop,'#b89569');slab(m.x,m.pierZ+.55,.5,1.1,dockTop,'#a7835d');
 for(const x of [-1.72,-.9,.9])out.push({p:[X(m.x+x),(dockTop+water)/2,Z(m.pierZ+1.05)],s:[.4,dockTop-water,.4],c:'#54493f'});
 // Stair from the promenade down to the pier, twelve treads.
 const run=1.8,n=12,top=Y(cityTop);
 for(let i=0;i<n;i++){const t=top-(top-dockTop)*(i+1)/n,z=m.pierZ-run+(i+.5)*run/n;slab(m.x,z,.72,run/n+.015,t,i%2?'#aaa99e':'#bab7a8',t-water);}
 // Seawall and promenade along the shore, the lawn behind, and the railing (open at the stair).
 const shore=m.pierZ-run,span=26,land=5;
 slab(b.x,shore-.4,span,.8,top,'#c2bba5',top-water+.5);
 slab(b.x,shore-.8-land/2,span,land,top-.05,'#8fb07a',top-water+.5);
 for(const s of [-1,1]){const x0=s<0?b.x-span/2:m.x+.4,x1=s<0?m.x-.4:b.x+span/2;
  out.push({p:[X((x0+x1)/2),top+1.1,Z(shore)+.2],s:[(x1-x0)*F,.12,.12],c:'#76b5ae'});
  for(let x=x0;x<=x1;x+=1.2)out.push({p:[X(x),top+.55,Z(shore)+.2],s:[.1,1.1,.1],c:'#335b58'});}
 return out;
}
