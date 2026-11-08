import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
describe('Atlas Orbit brand assets',()=>{
 it('uses the same orbital artwork in the header and app icon source',()=>{
  const mark=readFileSync('public/atlas-orbit.svg','utf8');
  const icon=readFileSync('src-tauri/icons/source.svg','utf8');
  const artwork=mark.slice(mark.indexOf('<g'),mark.lastIndexOf('</svg>')).trim();
  expect(icon).toContain(artwork);
  expect(readFileSync('src/components/Icon.tsx','utf8')).toContain('src="/atlas-orbit.svg"');
 });
 it('ships correctly sized PNG icons and native icon containers',()=>{
  for(const [file,size] of [['src-tauri/icons/32x32.png',32],['src-tauri/icons/128x128.png',128],['src-tauri/icons/128x128@2x.png',256],['public/icon-192.png',192],['public/icon-512.png',512],['public/apple-touch-icon.png',180]] as const){
   const b=readFileSync(file);expect(b.readUInt32BE(16)).toBe(size);expect(b.readUInt32BE(20)).toBe(size);
  }
  expect(readFileSync('src-tauri/icons/icon.icns').subarray(0,4).toString()).toBe('icns');
  expect(readFileSync('src-tauri/icons/icon.ico').readUInt16LE(2)).toBe(1);
 });
});
