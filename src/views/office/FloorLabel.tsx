import {Html} from "@react-three/drei";

/** Every cutaway uses the same marker at the left edge of its floor slab. */
export default function FloorLabel({level,width,depth}:{level:number;width:number;depth:number}){
  return <Html position={[-width/2-0.6,0.2,depth/2+0.2]} center zIndexRange={[6,0]} style={{pointerEvents:"none"}}>
    <span className="skyline-room-label building-floor-label" data-floor-label={level}>{level===0?"Lobby":`Floor ${level}`}</span>
  </Html>;
}
