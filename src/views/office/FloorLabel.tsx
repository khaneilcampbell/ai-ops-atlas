import {Html} from "@react-three/drei";

/** Every cutaway uses the same marker at the left edge of its floor slab. */
export default function FloorLabel({level,width}:{level:number;width:number}){
  return <Html position={[-width/2-0.6,0.3,0]} center zIndexRange={[6,0]} style={{pointerEvents:"none"}}>
    <span className="skyline-room-label building-floor-label" data-floor-label={level}>{level===0?"Lobby":`Floor ${level}`}</span>
  </Html>;
}
