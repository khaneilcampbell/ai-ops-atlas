import {useEffect,useMemo,useRef,useState} from 'react';
import {wake} from '../../lib/power';
import {useReducedMotion} from '../../lib/motion';
import type {LightMode} from '../map3d/living';
import {YACHT_KEY} from '../map3d/yachtPlan';
import {yachtRide,type YachtView} from '../map3d/yachtRide';
import {yachtCruiseState,yachtLive,yachtLivePose,yachtSailingNow} from '../map3d/yachtRidePlan';
import {buildingDisplayName} from '../../modules/names';
import {lookHint} from './useInteriorTrackpad';
import {useRideGestures} from './useRideGestures';
import {leaveBuilding} from './store';
import {DECKS,ROOMS,STATUS,peopleOnBoard} from './yachtInteriorPlan';
import '../../styles/skyline.css';
import '../../styles/yachtRide.css';

const shown=()=>buildingDisplayName(YACHT_KEY,'Atlas Yacht');
const clockText=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

/** Where she is on her cruise, read twice a second for the labels and the cruise map. */
function useCruise(){
 const read=()=>({t:yachtSailingNow(),pose:yachtLivePose()});
 const [now,setNow]=useState(read);
 useEffect(()=>{const id=window.setInterval(()=>setNow(read()),500);return()=>window.clearInterval(id);},[]);
 return now;
}

/** The cruise map: her course out to sea and back, the marina and the shore, and where she is now. */
function CruiseMap({pose,label}:{pose?:{x:number;z:number;yaw:number};label:string}){
 const W=280,H=170,course=yachtLive.course,berth=yachtLive.berth;
 const fit=useMemo(()=>{
  const pts=course??(berth?[berth]:[]);if(!pts.length||!berth)return undefined;
  const shore=berth.pontoon.z-2.9,xs=pts.map(p=>p.x),zs=[...pts.map(p=>p.z),shore-2];
  const x0=Math.min(...xs)-2,x1=Math.max(...xs)+2,z0=Math.min(...zs),z1=Math.max(...zs)+2,k=Math.min((W-20)/(x1-x0),(H-20)/(z1-z0));
  const ox=(W-(x1-x0)*k)/2,oz=(H-(z1-z0)*k)/2;
  return {at:(x:number,z:number):[number,number]=>[ox+(x-x0)*k,oz+(z-z0)*k],shore};
 },[course,berth]);
 if(!fit||!berth)return null;
 const d=(course??[]).map((p,i)=>{const [x,y]=fit.at(p.x,p.z);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join('');
 const [, shoreY]=fit.at(0,fit.shore),[px0,py]=fit.at(berth.pontoon.x0,berth.pontoon.z),[px1]=fit.at(berth.pontoon.x1,berth.pontoon.z);
 const [bx,by]=pose?fit.at(pose.x,pose.z):fit.at(berth.x,berth.z),deg=-(pose?.yaw??0)*180/Math.PI;
 return <aside className="yacht-cruise" aria-label="Cruise route">
  <strong>Cruise route</strong>
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Her cruise from the marina out to sea and back. Now: ${label}`}>
   <rect x="0" y="0" width={W} height={Math.max(0,shoreY)} className="land"/>
   <line x1={px0} y1={py} x2={px1} y2={py} className="pontoon"/>
   <path d={d} className="course"/>
   <g transform={`translate(${bx.toFixed(1)},${by.toFixed(1)}) rotate(${deg.toFixed(0)})`}><path d="M8,0 L-6,-3.6 L-6,3.6 Z" className="yacht"/></g>
  </svg>
  <p>{label}</p>
  <span>Simulated cruise on the travel loop clock, not a real voyage</span>
 </aside>;
}

/**
 * Inside the Atlas yacht. The map keeps drawing underneath and its camera rides with her (YachtRide in the map's scene),
 * so the real Atlas city, marina and sea go by around her open decks wherever she is on her cruise. This layer holds the
 * controls, the deck picker, the cruise map and the status line, and turns the view with your drags (Khaneil,
 * 2026-11-14: "Follow gold jet design rule when Im inside").
 */
export default function YachtInterior({light}:{light:LightMode}){
 const [view,setView]=useState<YachtView>(-1);
 const reduced=useReducedMotion(),layer=useRef<HTMLElement>(null);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 // Each view starts from its own framing.
 useEffect(()=>{Object.assign(yachtRide,{view,yaw:0,pitch:0,zoom:1});wake(400);},[view]);
 useRideGestures(layer,reduced,yachtRide);
 // The map's own titles, plaques and view menus would sit over the ride: tuck them away while you are aboard.
 useEffect(()=>{document.body.classList.add('yacht-riding');return()=>document.body.classList.remove('yacht-riding');},[]);
 const {t,pose}=useCruise();
 const state=yachtCruiseState(t,yachtLive.travel?.yacht?.period);
 const label=state.nextIn!==undefined?`${state.label} · Sails again in ${clockText(state.nextIn)}`:state.label;
 const title=view==='sundeck'?'Sun deck · Looking out':view===-1?'All decks · Open side':DECKS[view];
 const onDeck=typeof view==='number'&&view>=0?ROOMS.filter(r=>r.deck===view).map(r=>r.name).join(', '):'';
 const people=peopleOnBoard().length;
 return <section ref={layer} className={`skyline-interior yacht-interior riding ${light==='night'?'night':''}`} aria-label={`${shown()} interior`}>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${shown()} and return to the city`}>← Exit yacht</button><div><small>{shown().toUpperCase()} · YACHT</small><h2>{title}</h2></div><button className="yacht-view" onClick={()=>setView(v=>v==='sundeck'?-1:'sundeck')} aria-pressed={view==='sundeck'}>{view==='sundeck'?'Open side view':'Sun deck view'}</button></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${shown()} deck`}><strong>Deck navigation</strong>{([-1,3,2,1,0] as const).map(n=><button key={n} aria-pressed={view===n} onClick={()=>setView(n)}>{n===-1?'All':DECKS[n]}</button>)}</nav>
  <CruiseMap pose={pose} label={label}/>
  <aside className="skyline-interior-note">{`${onDeck?`${onDeck} · `:''}${people} people on board · ${state.label} · ${lookHint()}`}<span>{`${STATUS} · People on board are visitors and crew figures · A schematic from the deck plan, not a fitted model`}</span></aside>
 </section>;
}
