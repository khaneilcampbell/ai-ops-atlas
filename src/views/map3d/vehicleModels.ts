import type {VehicleKind} from "./vehicles";
import {TRANSPORT} from "./transportScale";
/** One box of a vehicle, in its own frame: forward is +x, up is +y, bottom-anchored. */
export type Part = { at: [number, number, number]; size: [number, number, number]; color: string | null };

/** Models are drawn at this size; the path lanes leave room for it. */
export const SCALE = TRANSPORT.vehicleScale;
const TIRE = "#262b2e";
const GLASS = "#3d4d55";
const TRIM = "#ece3cc";
const wheels = (dx: number): Part[] =>
  [-1, 1].flatMap((f) => [-1, 1].map((sd) => ({ at: [f * dx, 0, sd * 0.045], size: [0.044, 0.04, 0.022], color: TIRE }) as Part));

/** Low-poly models; null color means the vehicle's own paint. */
const BASE_MODELS: Record<Exclude<VehicleKind,"taxi"|"pickup"|"semi"|"gwagon"|"bmw"|"convertible">, { parts: Part[]; nose: number; lightY: number }> = {
  sports: {
    parts:[...wheels(0.074),
      {at:[0,0.012,0],size:[0.235,0.028,0.105],color:null},
      {at:[0.064,0.04,0],size:[0.105,0.012,0.1],color:null},
      {at:[-0.025,0.042,0],size:[0.098,0.025,0.083],color:GLASS},
      {at:[-0.03,0.067,0],size:[0.065,0.008,0.078],color:null},
      {at:[-0.096,0.062,0],size:[0.022,0.008,0.119],color:TIRE},
      {at:[-0.096,0.04,-0.035],size:[0.01,0.022,0.008],color:TIRE},
      {at:[-0.096,0.04,0.035],size:[0.01,0.022,0.008],color:TIRE},
      {at:[0.118,0.019,-0.018],size:[0.006,0.018,0.022],color:TIRE},
      {at:[0.118,0.019,0.018],size:[0.006,0.018,0.022],color:TIRE},
      {at:[0,0.012,-0.055],size:[0.2,0.008,0.008],color:TIRE},
      {at:[0,0.012,0.055],size:[0.2,0.008,0.008],color:TIRE}],
    nose:0.118,lightY:0.03
  },
  amazon: {parts:[...wheels(0.08),{at:[0,0.014,0],size:[0.25,0.11,0.106],color:null},{at:[0.097,0.07,0],size:[0.055,0.043,0.11],color:GLASS},{at:[-0.035,0.054,0],size:[0.13,0.012,0.11],color:"#55bde7"}],nose:0.125,lightY:0.04},
  ups: {parts:[...wheels(0.08),{at:[0,0.014,0],size:[0.25,0.12,0.106],color:null},{at:[0.1,0.075,0],size:[0.052,0.045,0.11],color:GLASS},{at:[-0.03,0.068,0],size:[0.14,0.014,0.11],color:"#dcaf4d"}],nose:0.125,lightY:0.04},
  bus: {parts:[...wheels(0.13),{at:[0,0.014,0],size:[0.35,0.12,0.108],color:null},{at:[0,0.07,0],size:[0.32,0.045,0.112],color:GLASS},{at:[0,0.052,0],size:[0.35,0.014,0.113],color:"#2473b9"},...[-0.1,-0.04,0.02,0.08,0.14].map(x=>({at:[x,0.07,0] as [number,number,number],size:[0.009,0.045,0.114] as [number,number,number],color:TRIM}))],nose:0.175,lightY:0.04},
  sedan: {
    parts: [
      ...wheels(0.06),
      { at: [0, 0.014, 0], size: [0.2, 0.044, 0.1], color: null },
      { at: [-0.012, 0.058, 0], size: [0.11, 0.038, 0.088], color: GLASS },
      { at: [-0.012, 0.096, 0], size: [0.096, 0.008, 0.078], color: null },
    ],
    nose: 0.1,
    lightY: 0.036,
  },
  van: {
    parts: [
      ...wheels(0.075),
      { at: [0, 0.014, 0], size: [0.24, 0.098, 0.106], color: null },
      { at: [0.106, 0.064, 0], size: [0.03, 0.036, 0.098], color: GLASS },
      { at: [0.065, 0.068, 0], size: [0.05, 0.03, 0.109], color: GLASS },
      { at: [-0.04, 0.05, 0], size: [0.12, 0.012, 0.109], color: TRIM },
    ],
    nose: 0.12,
    lightY: 0.04,
  },
  service: {
    parts: [
      ...wheels(0.08),
      { at: [0.07, 0.014, 0], size: [0.1, 0.088, 0.106], color: null },
      { at: [0.098, 0.064, 0], size: [0.046, 0.03, 0.109], color: GLASS },
      { at: [-0.056, 0.014, 0], size: [0.15, 0.05, 0.106], color: TRIM },
      { at: [-0.056, 0.064, 0], size: [0.11, 0.03, 0.08], color: "#7f8a83" },
      { at: [0.07, 0.102, 0], size: [0.026, 0.014, 0.05], color: "#c9a35a" },
    ],
    nose: 0.12,
    lightY: 0.04,
  },
};

export const MODELS:Record<VehicleKind,{parts:Part[];nose:number;lightY:number}>={
 ...BASE_MODELS,
 taxi:{...BASE_MODELS.sedan,parts:[...BASE_MODELS.sedan.parts,{at:[0,.108,0],size:[.05,.022,.055],color:'#edbd35'},...[-1,1].map(side=>({at:[0,.045,side*.051] as [number,number,number],size:[.11,.013,.004] as [number,number,number],color:'#252d30'}))]},
 pickup:{nose:.14,lightY:.04,parts:[...wheels(.09),{at:[0,.014,0],size:[.28,.055,.11],color:null},{at:[.055,.069,0],size:[.12,.065,.1],color:GLASS},{at:[.055,.134,0],size:[.12,.01,.105],color:null},{at:[-.09,.07,0],size:[.095,.01,.085],color:TIRE}]},
 gwagon:{nose:.125,lightY:.04,parts:[...wheels(.083),{at:[0,.014,0],size:[.25,.075,.112],color:null},{at:[-.025,.089,0],size:[.18,.06,.106],color:GLASS},{at:[-.025,.149,0],size:[.19,.012,.112],color:null},{at:[.127,.04,0],size:[.008,.045,.08],color:'#85939b'},{at:[-.132,.05,0],size:[.018,.065,.065],color:TIRE}]},
 bmw:BASE_MODELS.sports,
 convertible:{nose:.125,lightY:.03,parts:[...wheels(.08),{at:[0,.014,0],size:[.25,.04,.105],color:null},{at:[.052,.054,0],size:[.016,.045,.09],color:GLASS},{at:[-.034,.045,-.025],size:[.035,.034,.032],color:'#d3bb8a'},{at:[-.034,.045,.025],size:[.035,.034,.032],color:'#d3bb8a'},{at:[-.1,.054,0],size:[.05,.015,.1],color:null},...[-1,1].map(side=>({at:[.08,.055,side*.018] as [number,number,number],size:[.08,.004,.012] as [number,number,number],color:'#ece3cc'}))]},
 semi:{nose:.28,lightY:.045,parts:[{at:[.19,.015,0],size:[.18,.085,.11],color:null},{at:[.18,.1,0],size:[.08,.05,.105],color:GLASS},{at:[-.09,.05,0],size:[.34,.13,.11],color:'#d5d8d5'},...[-1,1].flatMap(side=>[{at:[.22,0,side*.046] as [number,number,number],size:[.04,.04,.02] as [number,number,number],color:TIRE},...[.09,.04,-.18,-.23].flatMap(x=>[.035,.057].map(z=>({at:[x,0,side*z] as [number,number,number],size:[.04,.04,.018] as [number,number,number],color:TIRE})))])]},
};


/** Exact body extents, also used by clearance checks instead of an unrelated truck size. */
export function vehicleBounds(kind:VehicleKind){
 const parts=MODELS[kind].parts;
 return {front:Math.max(...parts.map(p=>(p.at[0]+p.size[0]/2)*SCALE)),rear:Math.min(...parts.map(p=>(p.at[0]-p.size[0]/2)*SCALE)),halfWidth:Math.max(...parts.map(p=>(Math.abs(p.at[2])+p.size[2]/2)*SCALE))};
}
