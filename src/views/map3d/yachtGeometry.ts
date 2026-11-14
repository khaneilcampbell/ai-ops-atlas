import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {YACHT} from './yachtPlan';

/**
 * Atlas's exterior as six merged meshes, one per finish: the grey hull, the dark boot top and
 * underbody, white superstructure, black glazing, teak decks and dark steel. Built once, in the
 * yacht's local frame (bow +x, starboard +z, y from the waterline), about 3,000 triangles.
 */
export type YachtGeometry=Record<'hull'|'boot'|'white'|'glass'|'teak'|'steel',THREE.BufferGeometry>;
type Pt=[number,number];

const {length:L,beam:B,hull:H,deckH:DH,main:M,bridge:BR,sun:S,platform:P}=YACHT;
const STERN=-L/2,BOW=L/2;
export const MAIN_Y=H.deck,BRIDGE_Y=H.deck+DH,SUN_Y=H.deck+DH*2;

/** Half the beam at x: a fine stern, parallel midbody, and a long fine entry to the bow. */
export function hullHalf(x:number,beam=B){
 const half=beam/2;
 if(x<STERN+.6)return half*(H.transom+(1-H.transom)*Math.max(0,(x-STERN)/.6));
 if(x<=H.parallelTo)return half;
 const t=Math.min(1,(x-H.parallelTo)/(BOW-H.parallelTo));
 return half*Math.max(.02,1-t**1.9);
}

/** The hull's plan outline from x0 to x1, inset by `inset`, as a closed polygon. */
export function hullPlan(x0=STERN,x1=BOW,inset=0,steps=14):Pt[]{
 const xs=Array.from({length:steps+1},(_,i)=>x0+(x1-x0)*i/steps);
 const side=xs.map(x=>[x,Math.max(.01,hullHalf(x)-inset)] as Pt);
 return [...side.map(([x,z]):Pt=>[x,-z]),...side.reverse()];
}

/** A vertical prism of a plan polygon (x, z points) from y0 to y1, non-indexed for merging. */
function prism(points:Pt[],y0:number,y1:number){
 const shape=new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,z)));
 const g=new THREE.ExtrudeGeometry(shape,{depth:y1-y0,bevelEnabled:false,curveSegments:1});
 g.rotateX(Math.PI/2);g.translate(0,y1,0);
 return g.index?g.toNonIndexed():g;
}
function box(x:number,y:number,z:number,sx:number,sy:number,sz:number){
 const g=new THREE.BoxGeometry(sx,sy,sz).toNonIndexed();g.translate(x,y,z);return g;
}
function ball(x:number,y:number,z:number,r:number){
 const g=new THREE.SphereGeometry(r,12,8).toNonIndexed();g.translate(x,y,z);return g;
}
/** Both sides of the hull: one box per side, mirrored across the centre line. */
const pair=(x:number,y:number,z:number,sx:number,sy:number,sz:number)=>[box(x,y,z,sx,sy,sz),box(x,y,-z,sx,sy,sz)];
/** A guard rail from (x0,z0) to (x1,z1) at deck height y: a steel cap rail on slim stanchions. */
function rail(out:THREE.BufferGeometry[],x0:number,z0:number,x1:number,z1:number,y:number,h=.09){
 const len=Math.hypot(x1-x0,z1-z0),n=Math.max(1,Math.round(len/.18)),cap=new THREE.BoxGeometry(len,.008,.008).toNonIndexed();
 cap.rotateY(-Math.atan2(z1-z0,x1-x0));cap.translate((x0+x1)/2,y+h,(z0+z1)/2);out.push(cap);
 for(let i=0;i<=n;i++){const t=i/n;out.push(box(x0+(x1-x0)*t,y+h/2,z0+(z1-z0)*t,.008,h,.008));}
}
/** A plan polygon tapered from a full half width to a rounded nose. */
function taperPlan(x0:number,xTaper:number,x1:number,half:number,nose:number):Pt[]{
 return [[x0,-half],[xTaper,-half],[x1,-nose],[x1,nose],[xTaper,half],[x0,half]];
}

/** Raise the hull's top edge toward the bow (the sheer line in the reference profile). */
function sheer(g:THREE.BufferGeometry,top:number){
 const p=g.getAttribute('position');
 for(let i=0;i<p.count;i++)if(p.getY(i)>top-.001){const x=p.getX(i),t=Math.max(0,Math.min(1,(x-0)/(BOW-0)));p.setY(i,p.getY(i)+H.sheer*t*t*(3-2*t));}
 p.needsUpdate=true;g.computeVertexNormals();return g;
}

/** Rake the stem: below the deck, the forward hull draws back aft toward the keel. */
function rake(g:THREE.BufferGeometry){
 const p=g.getAttribute('position'),from=1.6;
 for(let i=0;i<p.count;i++){const x=p.getX(i);if(x<=from)continue;const depth=Math.max(0,Math.min(1,(MAIN_Y-p.getY(i))/(MAIN_Y+H.draft)));p.setX(i,x-(x-from)*.42*depth);}
 p.needsUpdate=true;g.computeVertexNormals();return g;
}

export function yachtGeometry():YachtGeometry{
 const hull:THREE.BufferGeometry[]=[],boot:THREE.BufferGeometry[]=[],white:THREE.BufferGeometry[]=[],glass:THREE.BufferGeometry[]=[],teak:THREE.BufferGeometry[]=[],steel:THREE.BufferGeometry[]=[];

 // Hull: grey topsides on a dark boot top and underbody, the deck line rising to the bow.
 hull.push(rake(sheer(prism(hullPlan(),-H.draft,MAIN_Y),MAIN_Y)));
 boot.push(rake(prism(hullPlan(STERN,BOW-.02,-.006),-H.draft,H.bootTop+.005)));
 // A thin white rubbing strake just under the main deck, full length.
 white.push(sheer(prism(hullPlan(STERN,BOW-.08,-.008),MAIN_Y-.035,MAIN_Y-.015),MAIN_Y-.015));
 // Lower-deck guest cabin windows, grouped as in the reference (three, one, three, two, one).
 const groups=[[-1.45,3],[-1.0,1],[-.72,3],[-.25,2],[.1,1],[.45,3],[.95,2]] as const;
 for(const [x0,n] of groups)for(let k=0;k<n;k++){const x=x0+k*.075,z=hullHalf(x)+.002;glass.push(...pair(x,.24,z,.045,.075,.006));}
 // Long dark hull windows of the beach club and the main deck owner's suite.
 for(const [x0,x1,y,h] of [[-2.7,-1.7,.34,.035],[1.05,1.75,.34,.03]] as const){const x=(x0+x1)/2;glass.push(...pair(x,y,hullHalf(x)+.003,x1-x0,h,.006));}
 // Transom: the tender garage door and the beach club opening above the swim platform.
 glass.push(box(STERN-.003,.24,0,.006,.18,hullHalf(STERN)*1.3));
 // Swim platform and the stairs up both sides to the aft deck.
 teak.push(box((P.x0+P.x1)/2,P.y,0,P.x1-P.x0,.03,hullHalf(STERN)*2));
 for(const side of [-1,1])for(let k=0;k<5;k++)teak.push(box(STERN+.04+k*.045,P.y+.06+k*.055,side*(hullHalf(STERN)-.09),.05,.02,.16));

 // Main deck: teak aft deck and side decks, the saloon with its full-height glass band, the foredeck.
 teak.push(prism(hullPlan(STERN,M.x1,.03,6),MAIN_Y,MAIN_Y+.008));
 teak.push(sheer(prism(hullPlan(M.x1,BOW-.35,.06,6),MAIN_Y,MAIN_Y+.008),MAIN_Y+.008));
 const saloonHalf=B/2-M.side;
 glass.push(prism(taperPlan(M.aftDeck,1.35,M.x1-.03,saloonHalf-.03,.18),MAIN_Y,BRIDGE_Y-.06));
 // Slim white mullions between the big saloon windows.
 for(const x of [-1.1,-.3,.5,1.2])for(const s of [-1,1])white.push(box(x,(MAIN_Y+BRIDGE_Y-.06)/2,s*(saloonHalf-.025),.03,BRIDGE_Y-.06-MAIN_Y,.012));
 // Foredeck lounge: a sofa round a table, two sunpads (the foredeck render), and the anchor gear.
 white.push(box(2.2,MAIN_Y+.07,0,.06,.05,.36),box(2.05,MAIN_Y+.05,0,.12,.03,.18),box(2.45,MAIN_Y+.07,-.08,.14,.04,.12),box(2.45,MAIN_Y+.07,.08,.14,.04,.12));
 steel.push(box(2.75,MAIN_Y+H.sheer*.9+.02,0,.06,.04,.06));
 // Aft deck: a sofa and table, and the stairs up to the bridge deck on each side.
 white.push(box(-2.75,MAIN_Y+.05,0,.08,.05,.5),box(-2.55,MAIN_Y+.04,0,.16,.025,.2));
 for(const side of [-1,1])for(let k=0;k<6;k++)white.push(box(M.aftDeck-.08-k*.05,MAIN_Y+.03+k*.05,side*(saloonHalf-.06),.05,.015,.11));
 // Aft deck guard rail round the stern: glass panels under a steel cap.
 rail(steel,STERN+.02,-hullHalf(STERN)+.02,STERN+.02,hullHalf(STERN)-.02,MAIN_Y);
 for(const s of [-1,1])rail(steel,STERN+.02,s*(hullHalf(STERN)-.02),M.aftDeck,s*(B/2-.02),MAIN_Y);

 // Bridge deck: the white overhang slab over the aft deck, sweeping forward; glazed saloon and wheelhouse.
 const bridgeHalf=B/2-.02;
 white.push(prism([[BR.x0,-bridgeHalf+.06],[1.1,-bridgeHalf],[2.35,-.1],[2.35,.1],[1.1,bridgeHalf],[BR.x0,bridgeHalf-.06]],BRIDGE_Y-.065,BRIDGE_Y));
 glass.push(prism(taperPlan(BR.enclosed0,1.05,BR.x1,bridgeHalf-.12,.22),BRIDGE_Y,SUN_Y-.06));
 for(const x of [-.4,.3,.9])for(const s of [-1,1])white.push(box(x,(BRIDGE_Y+SUN_Y-.06)/2,s*(bridgeHalf-.115),.03,SUN_Y-.06-BRIDGE_Y,.012));
 teak.push(box((BR.x0+BR.enclosed0)/2,BRIDGE_Y+.004,0,BR.enclosed0-BR.x0-.04,.008,bridgeHalf*2-.16));
 // Aft bridge deck: the long dining table, and its rail.
 white.push(box(-1.6,BRIDGE_Y+.04,0,.5,.015,.14),box(-1.6,BRIDGE_Y+.02,0,.3,.03,.05));
 rail(steel,BR.x0+.02,-(bridgeHalf-.08),BR.x0+.02,bridgeHalf-.08,BRIDGE_Y);
 for(const side of [-1,1])rail(steel,BR.x0+.02,side*(bridgeHalf-.08),BR.enclosed0,side*(bridgeHalf-.06),BRIDGE_Y);

 // Sun deck: slab with its own forward swoop, teak lounge aft, bar, jacuzzi under the hard top.
 const sunHalf=B/2-.06;
 white.push(prism([[S.x0,-sunHalf],[.55,-sunHalf],[1.3,-.12],[1.3,.12],[.55,sunHalf],[S.x0,sunHalf]],SUN_Y-.06,SUN_Y));
 teak.push(box((S.x0+S.hardTop[0])/2,SUN_Y+.004,0,S.hardTop[0]-S.x0-.04,.008,sunHalf*2-.1));
 for(let k=0;k<4;k++)for(const side of [-1,1])white.push(box(-1.85+k*.17,SUN_Y+.025,side*.28,.13,.03,.07));
 white.push(box(-.75,SUN_Y+.05,-.2,.18,.07,.05),box(-.85,SUN_Y+.03,.18,.16,.04,.16));
 white.push(box(.15,SUN_Y+.045,0,.32,.07,.36));
 glass.push(box(.15,SUN_Y+.082,0,.26,.006,.3));
 for(const side of [-1,1])rail(steel,S.x0+.02,side*(sunHalf-.02),.55,side*(sunHalf-.02),SUN_Y);
 rail(steel,S.x0+.02,-(sunHalf-.02),S.x0+.02,sunHalf-.02,SUN_Y);
 // Hard top on slim posts, with the mast and two radomes above it.
 const topY=SUN_Y+.27;
 white.push(prism([[S.hardTop[0],-.42],[.6,-.42],[1.05,-.1],[1.05,.1],[.6,.42],[S.hardTop[0],.42]],topY,topY+.035));
 for(const side of [-1,1])steel.push(box(S.hardTop[0]+.05,(SUN_Y+topY)/2,side*.36,.025,topY-SUN_Y,.025));
 steel.push(prism([[S.mast-.14,-.07],[S.mast+.14,-.05],[S.mast+.05,-.03],[S.mast+.05,.03],[S.mast+.14,.05],[S.mast-.14,.07]],topY+.035,MAIN_Y+S.mastTop-.1));
 steel.push(box(S.mast,MAIN_Y+S.mastTop-.33,0,.03,.015,.36));
 white.push(ball(S.mast-.02,MAIN_Y+S.mastTop-.18,-.1,.07),ball(S.mast-.02,MAIN_Y+S.mastTop-.18,.1,.07));
 steel.push(box(S.mast+.02,MAIN_Y+S.mastTop-.05,0,.015,.12,.015));

 const merge=(list:THREE.BufferGeometry[])=>{
  const clean=list.map(g=>{const c=new THREE.BufferGeometry();c.setAttribute('position',g.getAttribute('position'));c.setAttribute('normal',g.getAttribute('normal'));return c;});
  const out=mergeGeometries(clean)!;for(const g of list)g.dispose();out.computeBoundingSphere();return out;
 };
 return {hull:merge(hull),boot:merge(boot),white:merge(white),glass:merge(glass),teak:merge(teak),steel:merge(steel)};
}
