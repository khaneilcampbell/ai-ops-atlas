import {Box,Person} from "./InteriorPrimitives";

/**
 * Circa's ground-floor lobby inside "Enter building", matching the lobby seen through the glass on the map.
 * A stylized, unofficial take on a modern residential lobby, with no signage or logos:
 * - Back: a walnut elevator vestibule on grey stone tile, framed by two sculptural pillars.
 * - West wall: faceted white marble. East wall: a sculpted wavy walnut wall.
 * - Reception: a marble-and-walnut desk under hanging light rods.
 * - Centre: a diamond chandelier over a round flower table.
 * - Front: two lounges. One has black leather chairs on a hide-pattern rug; the other a navy sofa with
 *   cognac chairs and an arc lamp on a blue-grey rug.
 * Room: x -8..8, z -6..6. The street entrance is at z +5.85 and the shared lift at x +7.5, z 0.
 * Keep the walk from the door to the lift (x 0 from the door to the centre, then z 0 east) clear.
 */
const marble="#f3efe8",vein="#b9b4ad",walnut="#5b3a26",walnutLight="#76503a",black="#1b1b1d",tile="#a6a49f",grout="#8e8c87",slat="#8d8e8f";

function Glow({p,s,night,rotation}:{p:[number,number,number];s:[number,number,number];night:boolean;rotation?:[number,number,number]}) {
  return <mesh position={p} rotation={rotation}><boxGeometry args={s}/><meshStandardMaterial color="#fff6e6" emissive="#ffe2b0" emissiveIntensity={night?1.6:0.5}/></mesh>;
}
function Round({p,r,h,color}:{p:[number,number,number];r:number;h:number;color:string}) {
  return <mesh position={p} castShadow receiveShadow><cylinderGeometry args={[r,r,h,24]}/><meshStandardMaterial color={color} roughness={0.5}/></mesh>;
}

export default function CircaLobby({night}:{night:boolean}) {
  const slats:number[]=[];for(let z=-5.9;z<-1.45;z+=.2)slats.push(z);for(let z=1.5;z<5.6;z+=.2)slats.push(z);
  return <group>
    {/* Floors: light marble, grey stone tiles in the elevator vestibule. */}
    <Box p={[0,.006,0]} s={[16,.012,12]} color={marble}/>
    <Box p={[0,.014,-4.8]} s={[16,.012,2.4]} color={tile}/>
    {[-6,-4,-2,0,2,4,6].map(x=><Box key={x} p={[x,.022,-4.8]} s={[.03,.004,2.4]} color={grout}/>)}
    <Box p={[0,.022,-4.8]} s={[16,.004,.03]} color={grout}/>
    {/* Elevator vestibule: walnut back wall in book-matched strips, two dark elevator doors in black frames. */}
    <Box p={[0,1.7,-5.92]} s={[16,3.4,.16]} color={walnut}/>
    {Array.from({length:32},(_,i)=>-7.75+i*.5).filter(x=>Math.abs(Math.abs(x)-1.4)>.9).map((x,i)=><Box key={x} p={[x,1.7,-5.83]} s={[.24,3.2,.02]} color={i%2?walnutLight:walnut}/>)}
    {[-1.4,1.4].map(x=><group key={x}><Box p={[x,1.2,-5.82]} s={[1.5,2.45,.05]} color={black}/><Box p={[x,1.15,-5.79]} s={[1.25,2.3,.03]} color="#3d3b38"/><Box p={[x,1.15,-5.77]} s={[.02,2.3,.02]} color="#26241f"/><Glow p={[x,2.5,-5.79]} s={[.5,.05,.02]} night={night}/></group>)}
    {/* Two sculptural pillars with stacked, textured rings. */}
    {[-3.6,3.6].map(x=><group key={x}>{Array.from({length:17},(_,i)=><Round key={i} p={[x,.1+i*.2,-3.9]} r={i%2?.32:.4} h={.2} color={i%2?"#cfc8bb":"#b9b1a3"}/>)}</group>)}
    {/* West wall: faceted white marble panels folded at alternating angles, with grey veins. */}
    {[-5.2,-3.6,-2,-.4,1.2,2.8,4.4].map((z,i)=><group key={z} position={[-7.7,1.7,z]} rotation={[0,i%2?.3:-.3,0]}>
      <Box p={[0,0,0]} s={[.12,3.4,1.65]} color={marble}/><Box p={[.07,.1,i%2?-.3:.25]} s={[.01,2.6,.03]} color={vein}/><Box p={[.07,-.4,i%2?.4:-.35]} s={[.01,1.6,.02]} color={vein}/>
    </group>)}
    {/* East wall: a sculpted wavy walnut wall of vertical slats; the shared lift sits in the gap at z 0. */}
    {/* Full height behind the lift; kept low on the near side so the open cutaway still shows the lounge. */}
    {slats.map((z,i)=>{const d=.15+.45*(1+Math.sin(i*.45))/2,h=z<0?3.4:1.2;return <Box key={z} p={[7.95-d/2,h/2,z]} s={[d,h,.14]} color={i%3?walnut:walnutLight}/>;})}
    {/* Slatted grey ceiling over the vestibule, with black spotlights. Kept to the back so the cutaway stays open. */}
    {Array.from({length:12},(_,i)=>-5.9+i*.2).map(z=><Box key={z} p={[0,3.35,z]} s={[15.6,.08,.08]} color={slat}/>)}
    {[-6,-3,0,3,6].map(x=><group key={x}><Round p={[x,3.26,-4.4]} r={.12} h={.1} color={black}/><Glow p={[x,3.2,-4.4]} s={[.14,.02,.14]} night={night}/></group>)}
    {/* Reception: white marble base, walnut top and a glow reveal, under a cluster of hanging light rods. */}
    <Box p={[3.6,.5,-2.5]} s={[2.8,1,.8]} color={marble}/><Box p={[3.6,1.04,-2.5]} s={[3,.08,1]} color={walnut}/><Glow p={[3.6,.06,-2.08]} s={[2.7,.04,.02]} night={night}/>
    <Person x={3.6} z={-3.2} color="#2b3440"/>
    {[-1.2,-.8,-.4,0,.4,.8,1.2].map((dx,i)=>{const len=.45+.2*(i%2);return <group key={dx}><Box p={[3.6+dx,3.4-(1.05-len)/2,-2.5]} s={[.01,1.05-len,.01]} color={black}/><Glow p={[3.6+dx,2.35+len/2,-2.5]} s={[.05,len,.05]} night={night}/></group>;})}
    {/* Centre: a round dark pedestal table with a white bouquet under a diamond chandelier. */}
    <Round p={[-3,.4,-2.3]} r={.18} h={.8} color="#2a2623"/><Round p={[-3,.83,-2.3]} r={.75} h={.06} color="#2a2623"/><Round p={[-3,1,-2.3]} r={.12} h={.3} color="#dcdcdc"/>
    <mesh position={[-3,1.4,-2.3]}><sphereGeometry args={[.32,12,10]}/><meshStandardMaterial color="#f7f4ee"/></mesh>
    <Box p={[-3,3,-2.3]} s={[.01,.8,.01]} color={black}/>
    <Glow p={[-3,2.4,-2.3]} s={[.5,.5,.5]} rotation={[Math.PI/4,0,Math.PI/4]} night={night}/>
    {/* West lounge: black tufted leather chairs facing across a glass table on a black-and-white hide rug. */}
    <Box p={[-4.6,.03,3]} s={[3.2,.02,2.3]} color="#efece6"/>
    {([[-5.4,2.5,.7,.5],[-4,3.4,.8,.6],[-3.6,2.3,.4,.35],[-5,3.7,.5,.3]] as const).map(([x,z,w,d])=><Box key={`${x}${z}`} p={[x,.045,z]} s={[w,.01,d]} color="#1c1c1c"/>)}
    {[-1,1].map(side=>{const x=-4.6+side*1.15;return <group key={side}><Box p={[x,.25,3]} s={[.85,.4,.9]} color={black}/><Box p={[x+side*.38,.7,3]} s={[.18,.6,.9]} color={black}/>{[2.75,3.25].map(z=><Box key={z} p={[x+side*.28,.75,z]} s={[.02,.2,.02]} color="#3a3a3c"/>)}</group>;})}
    <Box p={[-4.6,.2,3]} s={[.9,.36,.6]} color="#d4e9e6" opacity={.35}/><Box p={[-4.6,.39,3]} s={[.9,.02,.6]} color="#cfd6da"/>
    {/* East lounge: navy velvet sofa facing cognac leather sling chairs and a dark wood table on a metal base. */}
    <Box p={[4.4,.03,3.2]} s={[3.4,.02,2.6]} color="#7c8a96"/>
    <Box p={[4.4,.25,4.1]} s={[2.4,.4,.85]} color="#26314f"/><Box p={[4.4,.65,4.45]} s={[2.4,.5,.18]} color="#26314f"/>
    {[-.7,.7].map(dx=><Box key={dx} p={[4.4+dx,.6,4.25]} s={[.45,.3,.12]} color="#e9e4da"/>)}
    <Box p={[4.4,.15,3.2]} s={[.25,.28,.25]} color="#555a5f"/><Box p={[4.4,.32,3.2]} s={[1.2,.07,.6]} color="#3a2a1f"/>
    {[-.65,.65].map(dx=><group key={dx}><Box p={[4.4+dx,.1,2.2]} s={[.7,.06,.7]} color="#2a2a2a"/><Box p={[4.4+dx,.3,2.2]} s={[.62,.14,.58]} color="#9a5a2e"/><Box p={[4.4+dx,.6,1.92]} s={[.62,.5,.08]} color="#9a5a2e"/></group>)}
    {/* Arc floor lamp reaching over the east lounge. */}
    <Round p={[6.6,.03,4.3]} r={.25} h={.06} color="#2a2a2a"/><Round p={[6.6,1.1,4.3]} r={.03} h={2.2} color="#2a2a2a"/>
    {[0,1,2,3].map(i=><Box key={i} p={[6.4-i*.35,2.2-i*i*.06,4]} s={[.36,.03,.03]} color="#2a2a2a"/>)}
    <Glow p={[5.1,1.5,4]} s={[.4,.22,.4]} night={night}/>
    {/* Olive trees in stone pots at the storefront corners. */}
    {[-7,7].map(x=><group key={x}><Round p={[x,.3,5.2]} r={.35} h={.6} color="#e0d9cc"/><Box p={[x,.9,5.2]} s={[.06,.7,.06]} color="#6f5a43"/><mesh position={[x,1.55,5.2]}><sphereGeometry args={[.55,12,10]}/><meshStandardMaterial color="#8a9a6a"/></mesh></group>)}
  </group>;
}
