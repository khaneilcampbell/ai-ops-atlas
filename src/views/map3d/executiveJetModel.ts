import type {Inst} from "./models";

/**
 * The executive jet on the airport loop (Khaneil, 2026-11-15: "add wheels to private jet and design upgrade").
 * Built nose -z like the airliners, ground at y 0, so it rests on its own landing gear. Same footprint as before
 * (about 2.1 long, 2.3 wingspan) so the north stand, taxi routes and runway clearances are unchanged.
 * A business-jet layout: slim tube with a pointed nose and long tail cone, low swept wings with winglets,
 * two rear fuselage engines on pylons, a swept T-tail, oval cabin windows and a gold cheatline.
 */
export const JET_FUSELAGE={radius:.1,y:.25,from:-.7,to:.55} as const;
/** Top of the gear bay: the gear group folds up into the belly about this height. */
export const JET_GEAR_TOP=JET_FUSELAGE.y-JET_FUSELAGE.radius;

const WHITE="#f6f3ea",PEARL="#e9e4d6",GREEN="#29483b",GOLD="#c9a35a",GLASS="#233f4c",DARK="#2f3a3d",TYRE="#1d262c",STRUT="#b9bfbd";
const NOSE_GEAR_Z=-.62,MAIN_GEAR={x:.17,z:.1} as const;

function build(){
  const R=JET_FUSELAGE.radius,y0=JET_FUSELAGE.y,{from,to}=JET_FUSELAGE,fin=.5;
  const tubes:Inst[]=[
    {p:[0,y0,from],s:[2*R,to-from,2*R],rx:Math.PI/2,c:WHITE},
    // Rear engines: nacelle, dark intake face and a short exhaust.
    ...[-1,1].flatMap(side=>[
      {p:[side*.21,y0+.07,.24],s:[.13,.36,.13],rx:Math.PI/2,c:PEARL},
      {p:[side*.21,y0+.07,.235],s:[.105,.012,.105],rx:Math.PI/2,c:DARK},
      {p:[side*.21,y0+.07,.6],s:[.08,.06,.08],rx:Math.PI/2,c:DARK},
    ] as Inst[]),
  ];
  const balls:Inst[]=[
    // Pointed nose and a long, slightly upswept tail cone.
    {p:[0,y0,from],s:[R,R*.96,.34],c:WHITE},
    {p:[0,y0+.015,to],s:[R*.92,R*.85,.48],c:WHITE},
    // Engine intake lips.
    ...[-1,1].map(side=>({p:[side*.21,y0+.07,.24],s:[.066,.066,.03],c:PEARL} as Inst)),
    // Oval cabin windows, seven a side.
    ...[-1,1].flatMap(side=>Array.from({length:7},(_,i)=>({p:[side*(R+.001),y0+.025,-.46+i*.1],s:[.006,.026,.019],c:GLASS} as Inst))),
  ];
  const finAt=(t:number):[number,number,number]=>[0,y0+R*.5+t*Math.cos(fin),.62+t*Math.sin(fin)];
  const tipX=.55+.48*Math.cos(.45),tipZ=.02+.48*Math.sin(.45);
  const boxes:Inst[]=[
    // Gold cheatline and a green belly line, nose to tail cone.
    ...[-1,1].flatMap(side=>[
      {p:[side*(R+.002),y0-.018,(from+to)/2-.05],s:[.006,.012,(to-from)+.25],c:GOLD},
      {p:[side*(R*.82+.002),y0-.055,(from+to)/2],s:[.006,.018,(to-from)],c:GREEN},
    ] as Inst[]),
    // Wing-to-body fairing, then low swept wings with upturned winglets.
    {p:[0,y0-.085,.02],s:[.2,.06,.52],c:PEARL},
    ...[-1,1].flatMap(side=>[
      {p:[side*.55,y0-.09,.02],s:[.96,.03,.27],r:side*-.45,c:WHITE},
      {p:[side*tipX,y0-.03,tipZ+.04],s:[.02,.13,.1],rx:-.35,c:GREEN},
      // Engine pylons.
      {p:[side*.14,y0+.06,.42],s:[.09,.025,.16],c:PEARL},
    ] as Inst[]),
    // Swept fin in Atlas green with a gold band, and the T-tail on top.
    {p:finAt(0),s:[.03,.44,.3],rx:fin,c:GREEN},
    {p:finAt(.12),s:[.034,.045,.29],rx:fin,c:GOLD},
    ...[-1,1].map(side=>({p:[side*.19,y0+R*.5+.4*Math.cos(fin),.62+.4*Math.sin(fin)+.05],s:[.38,.022,.15],r:side*-.35,c:WHITE} as Inst)),
  ];
  // Landing gear: twin nose wheels and two twin-wheel main legs under the wing roots, struts up to the belly.
  const gearBalls:Inst[]=[
    ...[-1,1].map(side=>({p:[side*.024,.034,NOSE_GEAR_Z],s:[.018,.034,.034],c:TYRE} as Inst)),
    ...[-1,1].flatMap(side=>[-1,1].map(k=>({p:[side*MAIN_GEAR.x+k*.028,.045,MAIN_GEAR.z],s:[.02,.045,.045],c:TYRE} as Inst))),
  ];
  const strut=(x:number,z:number,from:number):Inst=>({p:[x,(from+JET_GEAR_TOP)/2,z],s:[.018,JET_GEAR_TOP-from+.01,.018],c:STRUT});
  const gearBoxes:Inst[]=[
    strut(0,NOSE_GEAR_Z,.034),
    {p:[0,.034,NOSE_GEAR_Z],s:[.06,.01,.012],c:STRUT},
    ...[-1,1].flatMap(side=>[strut(side*MAIN_GEAR.x,MAIN_GEAR.z,.045),{p:[side*MAIN_GEAR.x,.045,MAIN_GEAR.z],s:[.07,.012,.014],c:STRUT} as Inst]),
    // Gear doors hanging open beside each leg.
    ...[-1,1].map(side=>({p:[side*(MAIN_GEAR.x+.05),.11,MAIN_GEAR.z],s:[.008,.08,.1],c:WHITE} as Inst)),
  ];
  // Wraparound windscreen and side cockpit windows: glass by day, lit from inside at night.
  const cockpit:Inst[]=[
    {p:[0,y0+.068,from-.05],s:[.12,.018,.1],rx:-.4,c:GLASS},
    ...[-1,1].map(side=>({p:[side*.075,y0+.04,from-.06],s:[.012,.035,.1],c:GLASS} as Inst)),
  ];
  return {tubes,balls,boxes,cockpit,gear:{balls:gearBalls,boxes:gearBoxes}};
}

export const EXECUTIVE_JET_MODEL=build();

/** Night lighting (Khaneil, 2026-11-15: "add lights to cockpit of the jet and headlights").
 * cockpit: warm instrument glow behind the windscreen. landing: the "headlights", one in each wing root and one
 * on the nose gear leg; they burn while the gear is down and fold away with it. beam: forward cone from the nose. */
const COCKPIT_GLOW="#ffd89a",LANDING="#fff4d6";
export const JET_LIGHTS={
  cockpit:[
    {p:[0,JET_FUSELAGE.y+.045,JET_FUSELAGE.from-.03],s:[.1,.02,.05],c:COCKPIT_GLOW},
    ...[-1,1].map(side=>({p:[side*.072,JET_FUSELAGE.y+.04,JET_FUSELAGE.from-.06],s:[.008,.028,.08],c:COCKPIT_GLOW} as Inst)),
  ] as Inst[],
  landing:[
    ...[-1,1].map(side=>({p:[side*.15,JET_FUSELAGE.y-.09,-.1],s:[.04,.022,.02],c:LANDING} as Inst)),
    {p:[0,.09,NOSE_GEAR_Z-.012],s:[.03,.022,.02],c:LANDING},
  ] as Inst[],
  beam:{length:1.1,radius:.22,y:.1,z:NOSE_GEAR_Z-.02},
} as const;
