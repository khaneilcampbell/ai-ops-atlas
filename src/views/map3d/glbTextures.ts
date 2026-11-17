import * as THREE from 'three';

/**
 * Decodes a GLB's embedded JPEG and PNG textures straight from its bytes with createImageBitmap.
 * GLTFLoader would make a blob: URL for each and fetch it, which the hosted CSP (img-src and
 * connect-src 'self') blocks, so the Command Center's baked textures would silently go missing.
 * Samplers, orientation and caching follow GLTFLoader's own loadTextureImage.
 */
export function decodeEmbeddedTextures(loader:Registers){loader.register(parser=>new EmbeddedTextures(parser));}

/** The parts of GLTFLoader's parser and plugin API used here (drei runs three-stdlib's copy of it). */
type Parser={json:unknown;getDependency(type:string,index:number):Promise<unknown>;associations:Map<unknown,unknown>};
type Plugin={name:string;loadTexture(index:number):Promise<THREE.Texture>|null};
type Registers={register(callback:(parser:Parser)=>Plugin):unknown};

const WRAP:Record<number,THREE.Wrapping>={33071:THREE.ClampToEdgeWrapping,33648:THREE.MirroredRepeatWrapping,10497:THREE.RepeatWrapping};
const FILTER:Record<number,THREE.TextureFilter>={9728:THREE.NearestFilter,9729:THREE.LinearFilter,9984:THREE.NearestMipmapNearestFilter,9985:THREE.LinearMipmapNearestFilter,9986:THREE.NearestMipmapLinearFilter,9987:THREE.LinearMipmapLinearFilter};
type Json={textures?:{source?:number;sampler?:number;name?:string}[];images?:{bufferView?:number;mimeType?:string;name?:string}[];samplers?:{magFilter?:number;minFilter?:number;wrapS?:number;wrapT?:number}[]};

class EmbeddedTextures implements Plugin{
 readonly name='ATLAS_embedded_textures';
 private cache=new Map<number,Promise<THREE.Texture>>();
 constructor(private parser:Parser){}
 loadTexture(index:number):Promise<THREE.Texture>|null{
  const json=this.parser.json as Json,def=json.textures?.[index],src=def?.source===undefined?undefined:json.images?.[def.source];
  if(!def||src?.bufferView===undefined||!/^image\/(jpeg|png)$/.test(src.mimeType??''))return null;
  const hit=this.cache.get(index);if(hit)return hit;
  const view=src.bufferView;
  const promise=(this.parser.getDependency('bufferView',view) as Promise<ArrayBuffer>)
   .then(buf=>createImageBitmap(new Blob([buf],{type:src.mimeType}),{premultiplyAlpha:'none'}))
   .then(bitmap=>{
    const t=new THREE.Texture(bitmap),s=json.samplers?.[def.sampler??-1]??{};
    t.flipY=false;t.name=def.name||src.name||'';
    t.magFilter=(FILTER[s.magFilter??0]??THREE.LinearFilter) as THREE.MagnificationTextureFilter;
    t.minFilter=FILTER[s.minFilter??0]??THREE.LinearMipmapLinearFilter;
    t.wrapS=WRAP[s.wrapS??0]??THREE.RepeatWrapping;t.wrapT=WRAP[s.wrapT??0]??THREE.RepeatWrapping;
    t.generateMipmaps=t.minFilter!==THREE.NearestFilter&&t.minFilter!==THREE.LinearFilter;
    t.needsUpdate=true;
    this.parser.associations.set(t,{textures:index});
    return t;
   });
  this.cache.set(index,promise);
  return promise;
 }
}
