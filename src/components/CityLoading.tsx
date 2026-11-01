import {useEffect,useState} from 'react';
/** Honest stages, no invented percentages; a slow GPU must not trap the rest of Atlas. */
export function CityLoading({stage,onFlat}:{stage:'files'|'drawing';onFlat:()=>void}){
 const [slow,setSlow]=useState(false);
 useEffect(()=>{const timer=window.setTimeout(()=>setSlow(true),10000);return()=>window.clearTimeout(timer);},[]);
 return <div className="map-loading"><div className="city-loading-card">
  <span className="city-loading-brand">ATLAS</span>
  <p role="status" aria-live="polite">{stage==='files'?'Loading city…':'Preparing city…'}</p>
  <span>{slow?'The 3D city is taking longer than usual.':stage==='files'?'Loading the map view.':'Drawing buildings and streets.'}</span>
  {slow&&<button className="btn" onClick={onFlat}>Open flat map</button>}
 </div></div>;
}
