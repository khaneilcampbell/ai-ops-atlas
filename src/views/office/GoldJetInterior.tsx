import {useEffect,useMemo,useRef,useState} from 'react';
import {wake} from '../../lib/power';
import {useReducedMotion} from '../../lib/motion';
import type {LightMode} from '../map3d/living';
import {AIRPORT_LANDING_RUNWAY,AIRPORT_LAYOUT} from '../map3d/airport';
import {fleetPose} from '../map3d/flightSchedule';
import {GOLD_JET_KEY,GOLD_JET_NAME,GOLD_JET_PASSENGERS,GOLD_JET_SLOT,goldJetLive,goldJetRoute,goldJetState} from '../map3d/goldJetPlan';
import {goldJetRide} from '../map3d/goldJetIds';
import {useRideGestures} from './useRideGestures';
import {buildingDisplayName} from '../../modules/names';
import {lookHint} from './useInteriorTrackpad';
import {leaveBuilding} from './store';
import {fitRoute} from './goldJetInteriorPlan';
import '../../styles/skyline.css';
import '../../styles/goldJet.css';

const shown=()=>buildingDisplayName(GOLD_JET_KEY,GOLD_JET_NAME);
export type JetView='cutaway'|'window';

/** The airport clock as the map is running it, read twice a second for the labels and the moving map. */
function useFlightClock(){
 const [now,setNow]=useState(goldJetLive.clock);
 useEffect(()=>{const id=window.setInterval(()=>setNow(goldJetLive.clock),500);return()=>window.clearInterval(id);},[]);
 return now;
}

/** The in-flight moving map: the loop the jet really flies on the map, the airport's runways, where it is now. */
function RouteMap({seconds}:{seconds:number}){
 const W=280,H=190,circuit=goldJetLive.circuit,west=!!goldJetLive.west;
 const route=useMemo(()=>goldJetRoute(circuit),[circuit]);
 const fit=useMemo(()=>fitRoute(route,W,H,14,west,AIRPORT_LAYOUT.mirrorWidth),[route,west]);
 const path=(air:boolean)=>{let d='',pen=false;for(const p of route){const on=(p.y>.05)===air;if(on){const [x,y]=fit(p.x,p.z);d+=`${pen?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;pen=true;}else pen=false;}return d;};
 const rect=(cx:number,cz:number,w:number,d:number)=>{const [ax,ay]=fit(cx-w/2,cz-d/2),[bx,by]=fit(cx+w/2,cz+d/2);return {x:Math.min(ax,bx),y:Math.min(ay,by),width:Math.abs(bx-ax),height:Math.abs(by-ay)};};
 const pose=fleetPose(seconds,GOLD_JET_SLOT,circuit),[px,py]=fit(pose.x,pose.z),state=goldJetState(seconds,circuit);
 // Heading on screen: the jet's nose is -z at yaw 0, turned by yaw (mirrored on a west airport).
 const deg=(west?1:-1)*pose.yaw*180/Math.PI;
 const L=AIRPORT_LANDING_RUNWAY;
 return <aside className="gold-jet-route" aria-label="Flight route">
  <strong>Flight route</strong>
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The loop round the city. Now: ${state.label}`}>
   <rect {...rect(AIRPORT_LAYOUT.runwayX,AIRPORT_LAYOUT.runwayZ,AIRPORT_LAYOUT.runwayWidth,AIRPORT_LAYOUT.runwayLength)} className="runway"/>
   <rect {...rect(L.x,L.z,L.width,L.length)} className="runway"/>
   <rect {...rect(AIRPORT_LAYOUT.terminalX,AIRPORT_LAYOUT.terminalZ,3,10)} className="terminal"/>
   <path d={path(false)} className="ground"/>
   <path d={path(true)} className="air"/>
   <g transform={`translate(${px.toFixed(1)},${py.toFixed(1)}) rotate(${deg.toFixed(0)})`}><path d="M0,-7 L4.5,5 L0,2.6 L-4.5,5 Z" className="jet"/></g>
  </svg>
  <p>{state.label}{pose.y>.05?` · ${Math.round(pose.y*900).toLocaleString()} ft (scaled)`:''}</p>
  <span>Simulated loop on the airport clock, not a real flight</span>
 </aside>;
}

/**
 * Inside the gold private jet. The map keeps drawing underneath and its camera rides in the jet's open cabin
 * (GoldJetRide in the map's scene), so the real Atlas city, airport, sky and the other planes go by outside. This layer
 * holds the controls, the moving map and the passenger count, and turns the view with your drags.
 */
export default function GoldJetInterior({light}:{light:LightMode}){
 const [view,setView]=useState<JetView>('cutaway');
 const reduced=useReducedMotion(),layer=useRef<HTMLElement>(null);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 // Each visit starts from the view's own framing.
 useEffect(()=>{Object.assign(goldJetRide,{view,yaw:0,pitch:0,zoom:1});wake(400);},[view]);
 useRideGestures(layer,reduced,goldJetRide);
 // The map's own titles, plaques and view menus would sit over the ride: tuck them away while you are aboard.
 useEffect(()=>{document.body.classList.add('gold-jet-riding');return()=>document.body.classList.remove('gold-jet-riding');},[]);
 const seconds=useFlightClock();
 const state=goldJetState(seconds,goldJetLive.circuit);
 return <section ref={layer} className={`skyline-interior gold-jet-interior riding ${light==='night'?'night':''}`} aria-label={`${shown()} interior`}>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${shown()} and return to the airport`}>← Exit aircraft</button><div><small>{shown().toUpperCase()} · PRIVATE JET</small><h2>{view==='window'?'Window seat · Up front':'Main cabin · Open cutaway'}</h2></div><button className="gold-jet-view" onClick={()=>setView(v=>v==='window'?'cutaway':'window')} aria-pressed={view==='window'}>{view==='window'?'Cabin cutaway':'Window seat view'}</button></header>
  <RouteMap seconds={seconds}/>
  <aside className="skyline-interior-note">{`${state.aboard} of ${GOLD_JET_PASSENGERS} passengers on board · ${state.label} · ${lookHint()}`}<span>Decorative flight · Passengers are unnamed figures who boarded at the gate, not agents · A schematic, not a fitted model</span></aside>
 </section>;
}
