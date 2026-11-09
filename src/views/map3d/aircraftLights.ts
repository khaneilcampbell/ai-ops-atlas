/** Night lighting for the airport's jets, laid out like a real airliner. Aircraft-local coordinates:
 * the nose points to -z and the pilot's left wing is -x. Pure data so tests can check the pattern. */
type V3=[number,number,number];
export interface AircraftLight {p:V3;s:V3;c:string}

/** Position lights: red on the left wingtip, green on the right, white on the tail cone. Always on. */
export const NAV_RED="#ff2a2a",NAV_GREEN="#2bff6a",STROBE_WHITE="#ffffff",LANDING_WHITE="#fff4d6";
const TIP={x:1.33,y:.27,z:.43} as const;

export const AIRCRAFT_LIGHTS={
  nav:[
    {p:[-TIP.x,TIP.y,TIP.z],s:[.05,.04,.05],c:NAV_RED},
    {p:[TIP.x,TIP.y,TIP.z],s:[.05,.04,.05],c:NAV_GREEN},
    {p:[0,.38,1.41],s:[.04,.04,.04],c:STROBE_WHITE},
  ] as AircraftLight[],
  /** Red anti-collision beacons: top of the fuselage, the belly and the fin tip. */
  beacon:[
    {p:[0,.545,-.15],s:[.05,.035,.05],c:NAV_RED},
    {p:[0,.095,.15],s:[.05,.035,.05],c:NAV_RED},
    {p:[0,.97,1.19],s:[.045,.04,.05],c:NAV_RED},
  ] as AircraftLight[],
  /** White strobes on both wingtips and the tail cone. */
  strobe:[
    {p:[-TIP.x-.02,TIP.y,TIP.z+.07],s:[.04,.035,.04],c:STROBE_WHITE},
    {p:[TIP.x+.02,TIP.y,TIP.z+.07],s:[.04,.035,.04],c:STROBE_WHITE},
    {p:[0,.4,1.44],s:[.035,.035,.035],c:STROBE_WHITE},
  ] as AircraftLight[],
  /** Landing lights in the wing roots and on the nose gear: the "headlights". */
  landing:[
    {p:[-.26,.25,-.14],s:[.06,.04,.04],c:LANDING_WHITE},
    {p:[.26,.25,-.14],s:[.06,.04,.04],c:LANDING_WHITE},
    {p:[0,.16,-.92],s:[.05,.04,.04],c:LANDING_WHITE},
  ] as AircraftLight[],
};

/** Forward beam from the nose: a cone whose tip sits at the landing light and opens ahead of the jet. */
export const LANDING_BEAM={length:1.5,radius:.32,y:.18,z:-.92} as const;

/** Cockpit windscreen: two front panes either side of the centre post, and a side window each side. */
export const COCKPIT_PANES:{p:V3;s:V3;r?:number}[]=[
  {p:[-.05,.45,-1.24],s:[.085,.042,.02],r:.35},
  {p:[.05,.45,-1.24],s:[.085,.042,.02],r:-.35},
  {p:[-.143,.45,-1.1],s:[.02,.038,.09]},
  {p:[.143,.45,-1.1],s:[.02,.038,.09]},
];

const BEACON_PERIOD=1.1,BEACON_ON=.14,STROBE_PERIOD=1.3,FLASH=.06,DOUBLE_GAP=.16;
const frac=(t:number,period:number)=>((t%period)+period)%period;

/** Which blinking lights are lit at time t. Each jet gets its own phase so the fleet doesn't flash in step. */
export function blinkState(t:number,phase:number){
  const b=frac(t+phase,BEACON_PERIOD);
  const s=frac(t+phase*1.7,STROBE_PERIOD);
  return {beacon:b<BEACON_ON,strobe:s<FLASH||(s>=DOUBLE_GAP&&s<DOUBLE_GAP+FLASH)};
}

/** A stable, well spread phase per aircraft slot. */
export const lightPhase=(slot:number)=>frac(slot*.618034*BEACON_PERIOD,BEACON_PERIOD);
