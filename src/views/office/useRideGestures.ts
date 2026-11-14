import {useEffect} from 'react';
import {wake} from '../../lib/power';
import {likelyMacTrackpad} from '../map3d/trackpad';

/** The ride camera's turn and zoom, shared by the gold jet and the yacht (goldJetRide, yachtRide). */
export interface RideLook {yaw:number;pitch:number;zoom:number}

/**
 * Turns and zooms a ride camera from drags, a mouse wheel, Mac trackpad scrolls and pinches, and a two-finger pinch on a
 * phone. The map underneath draws the view; this only moves it and wakes the map to redraw.
 */
export function useRideGestures(el:React.RefObject<HTMLElement|null>,reduced:boolean,look:RideLook){
 useEffect(()=>{
  const node=el.current;if(!node)return;
  const trackpad=likelyMacTrackpad(navigator),pts=new Map<number,{x:number;y:number}>();let pinch=0;
  const turn=(dx:number,dy:number)=>{look.yaw-=dx*.005;look.pitch=Math.max(-1.6,Math.min(1.6,look.pitch+dy*.004));wake(reduced?60:250);};
  const zoom=(f:number)=>{look.zoom=Math.max(.35,Math.min(3,look.zoom*f));wake(reduced?60:250);};
  const spread=()=>{const [a,b]=[...pts.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
  const isControl=(t:EventTarget|null)=>t instanceof Element&&!!t.closest('button,a,aside,header,nav');
  const down=(e:PointerEvent)=>{if(isControl(e.target))return;node.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});pinch=spread();};
  const move=(e:PointerEvent)=>{const p=pts.get(e.pointerId);if(!p)return;
   if(pts.size>1){pts.set(e.pointerId,{x:e.clientX,y:e.clientY});const s=spread();if(pinch&&s)zoom(pinch/s);pinch=s;return;}
   turn(e.clientX-p.x,e.clientY-p.y);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});};
  const up=(e:PointerEvent)=>{pts.delete(e.pointerId);pinch=spread();};
  const wheel=(e:WheelEvent)=>{if(isControl(e.target))return;e.preventDefault();
   if(e.ctrlKey)zoom(Math.exp(e.deltaY*.01));else if(trackpad)turn(-e.deltaX,-e.deltaY);else zoom(Math.exp(e.deltaY*.0015));};
  node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);node.addEventListener('wheel',wheel,{passive:false});
  return()=>{node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',up);node.removeEventListener('wheel',wheel);};
 },[el,reduced,look]);
}
