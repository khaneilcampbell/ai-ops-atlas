import {flightClearance} from './flightClearance';
import {DistrictLife} from './DistrictLife';
import {financialDimensions} from './financialArchitecture';
import {StreetLights} from './StreetLights';
import {HillsCommunity,CommunityRail} from './HillsCommunity';
import {COMMUNITY_BUILDINGS,communityKey,COMMUNITY} from './hillsCommunityPlan';
import {FinancialDistrict} from "./FinancialDistrict";
import {FINANCIAL_KEY,FINANCIAL_PARK_KEY,financialKey} from "./financialPlan";
import AtlasHills from "./AtlasHills";
import {HILLS,HILLS_KEY} from "./hillsPlan";
import {AIRPORT_BUILDINGS,airportBuildingKey} from "./airportBuildings";
import {Dealership} from "./Dealership";
import {DEALERSHIP_KEY,DEALERSHIP} from "./dealershipPlan";
import {VenueBridge} from "./VenueBridge";
import {Freight} from "./FreightModel";
import {Stadium,STADIUM_KEY} from "./Stadium";
import { Airport } from "./LogisticsAirport";
import { AIRPORT_KEY, airportPoint, AIRPORT_LAYOUT } from "./airport";
import { SkylineFerrisWheel } from "./SkylineFerrisWheel";
import {skylineBuildingKey} from "../../catalog/buildings";
import {skylineProjectAnchor} from "./landmarks";
import { TOOL_OFFICE_TOP, toolOfficeHeight } from "./toolBrand";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LEVELS, resetGovernor, useQualityLevel } from "../../lib/governor";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { residentsLabel } from "../../catalog/roles";
import type { Status } from "../../catalog/types";
import type { Health, Verified } from "../../lib/derive";
import { Bloom, Sky, Traffic, Vehicles, type LightMode } from "./living";
import { statusLabel } from "../../components/bits";
import { placeLabels, type Layout } from "../mapLayout";
import { clip, measure, SANS, wrap } from "../mapText";
import type { ConnectionStatus } from "../../lib/connections";
import type { ConnectionType } from "../../catalog/types";
import { focus as focusLevel, focusCount, focusRects, FOCUS_MAX, time } from "./materials";
import { Network, type NetLink } from "./network";
import { AtlasHq } from "./AtlasHq";
import { RibbonTower } from "./RibbonTower";
import { isRibbonTower } from "./ribbonTowerPlan";
import { FLOOR_BASE, Skyline, Bridges, Houses, Kiosks, Landscape, Terrain, Towers, towerTop, useGeometries, useMaterials, type Pick, type PickHandlerSet } from "./models";
import { buildScene, TERRACE_H, WATER_Y, type Scene3D } from "./scene";
import { ENTER_MS, LEAVE_MS, useOffice } from "../office/store";
import { useBuildingActivity, type Illumination } from "../office/activity";
import { ActivityGlow } from "./activity";
import { PHONE_QUERY, useMedia } from "../../lib/media";
import { usePowerProfile, wake, type PowerProfile } from "../../lib/power";
import { FramePacer } from "./pacer";

export interface Map3DApi {
  zoom: (factor: number) => void;
  fit: () => void;
  /** Glide to a grid point, optionally zooming in to at least neighborhood level. */
  reveal: (gx: number, gz: number, closer?: boolean) => void;
  /** Turn the view around its center by this many degrees, counterclockwise seen from above. */
  rotate: (deg: number) => void;
}

type Sel = { kind: "repo" | "agent" | "project" | "service"; id: string };

/** A connection as the map needs it: the building keys and projects at both ends. */
export interface MapLink {
  id: string;
  type: ConnectionType;
  status: ConnectionStatus;
  directed: boolean;
  /** Building keys (project:…, repo:… for uncataloged resources, or agent:…) and the projects they belong to. */
  a: string;
  b: string;
  pa?: string;
  pb?: string;
}

interface Props {
  layout: Layout;
  /** Share of the view covered from below by a sheet; selections are framed above it. */
  cover?: number;
  selKey: string | null;
  selectedDistrict?: string;
  focus: string;
  showAgentLabels: boolean;
  reduced: boolean;
  onSelect: (sel: Sel, projectId?: string) => void;
  onFocus: (projectId: string) => void;
  tipFor: (key: string) => { title: string; sub: string } | null;
  /** Verified repository health, for the discreet mark on each nameplate. */
  healthFor: (repository: string) => { kind: Verified; label: string; stale: boolean; health: Health };
  /** Day or night lighting. */
  light: LightMode;
  /** Connections to draw, already filtered by the toolbar; empty when they are switched off. */
  links: MapLink[];
  linkSel: string | null;
  onLinkSelect: (id: string) => void;
  linkTip: (id: string) => { title: string; sub: string } | null;
  /** Selecting a building shows only its connections and fades the rest of the map. */
  linkFocus: boolean;
  /** Draw links inside one project even when zoomed out (the Agent network and Automation flow views). */
  showLocal?: boolean;
  /** Connection particles move; off when paused in the toolbar or for reduced motion. */
  linksMoving: boolean;
  /** Decorative vehicles on the districts' paths; the toolbar's Traffic toggle. */
  traffic: boolean;
}

// Camera looks down from +x+z, matching the isometric map, at a miniature-photography angle.
const ELEVATION = (42 * Math.PI) / 180;
const DIR = new THREE.Vector3(Math.cos(ELEVATION) * Math.SQRT1_2, Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.SQRT1_2);
const DIR_UPRIGHT = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
const FOV = 30;
/**
 * Portrait views keep this width-to-height ratio's horizontal angle, so a change in height (Safari's
 * toolbar, the keyboard, a strip below the map) shows a little more or less sky and sea instead of
 * zooming the whole map in or out.
 */
const PORTRAIT_ASPECT = 0.75;

const STATUS_DOT: Record<Status, string> = { active: "#7fbf7a", idle: "#a9b4a0", paused: "#c4b07c", attention: "#e2b55a", retired: "#7d857a" };

interface LabelSpec {
  id: string;
  key: string;
  pos: THREE.Vector3;
  w: number;
  h: number;
  priority: number;
  node: React.ReactNode;
  className: string;
  onClick?: () => void;
  title?: string;
}

const selOf = (key: string): Sel => {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as Sel["kind"], id: key.slice(i + 1) };
};

/** Where each clickable thing sits and how big it is, for highlights, labels and camera moves. */
function anchorsOf(scene: Scene3D, layout: Layout) {
  const m = new Map<string, { x: number; z: number; y0: number; y1: number; w: number; d: number; project?: string }>();
  for (const t of scene.towers) m.set(t.key, { x: t.x, z: t.z, y0: TERRACE_H, y1: towerTop(t), w: t.size, d: t.size, project: t.projectId });
  for(const shop of scene.retail){
    const anchor={x:shop.x,z:shop.z,y0:TERRACE_H,y1:TERRACE_H+toolOfficeHeight(shop.name)+0.4,w:shop.size,d:shop.size*0.8,project:"skyline"};
    m.set(skylineBuildingKey(shop.name),anchor);m.set(shop.key,anchor);
  }
  if(scene.airport)for(const b of AIRPORT_BUILDINGS)m.set(airportBuildingKey(b.id),{x:airportPoint(scene.airport,b.x,b.z)[0],z:scene.airport.z+b.z,y0:TERRACE_H,y1:TERRACE_H+b.h,w:b.w,d:b.d});
  if(scene.financial){const f=scene.financial;m.set(FINANCIAL_KEY,{x:f.x+f.w/2,z:f.z+f.d/2,y0:TERRACE_H,y1:TERRACE_H+Math.max(...f.buildings.map(b=>b.height))+1.2,w:f.w,d:f.d});for(const b of f.buildings)m.set(financialKey(b.id),{x:f.x+b.x,z:f.z+b.z,y0:TERRACE_H,y1:TERRACE_H+b.height+1.2,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d});m.set(FINANCIAL_PARK_KEY,{x:f.x+f.park.x+f.park.w/2,z:f.z+f.park.z+f.park.d/2,y0:TERRACE_H,y1:TERRACE_H+1.5,w:f.park.w,d:f.park.d});}
  if(scene.hills)m.set(HILLS_KEY,{x:scene.hills.x+scene.hills.w/2,z:scene.hills.z+scene.hills.d/2,y0:TERRACE_H,y1:TERRACE_H+5,w:scene.hills.w,d:scene.hills.d});
  if(scene.community)for(const b of COMMUNITY_BUILDINGS)m.set(communityKey(b.id),{x:scene.community.x+b.x,z:scene.community.z+b.z,y0:TERRACE_H,y1:TERRACE_H+b.h,w:b.w,d:b.d});
  if(scene.communityRail){const [x,z]=scene.communityRail.financial;m.set("service:financial-station",{x,z,y0:TERRACE_H,y1:TERRACE_H+COMMUNITY.platformRise+1.5,w:8,d:8});}
  if(scene.airport)m.set(AIRPORT_KEY,{x:airportPoint(scene.airport,AIRPORT_LAYOUT.terminalX,AIRPORT_LAYOUT.terminalZ)[0],z:scene.airport.z+AIRPORT_LAYOUT.terminalZ,y0:TERRACE_H,y1:TERRACE_H+3.4,w:3.8,d:10.5});
  if(scene.stadium)m.set(STADIUM_KEY,{x:scene.stadium.x+4,z:scene.stadium.z+3.5,y0:TERRACE_H,y1:TERRACE_H+2.3,w:8,d:7});
  if(scene.dealership)m.set(DEALERSHIP_KEY,{x:scene.dealership.x+5,z:scene.dealership.z+2.1,y0:TERRACE_H,y1:TERRACE_H+DEALERSHIP.height+.15,w:7.85,d:3.45});
  const skyline=skylineProjectAnchor(scene);
  if(skyline)m.set("project:skyline",skyline);
  // AI agents work inside their headquarters, so they share its anchor.
  for (const d of layout.districts) {
    const hq = m.get(`project:${d.project.id}`);
    for(const a of d.crew){
      const workplace=a.workplace&&scene.retail.find(k=>k.name===a.workplace!.building);
      const anchor=workplace?m.get(skylineBuildingKey(workplace.name)):hq;
      if(anchor)m.set(`agent:${a.id}`,anchor);
    }
  }
  for (const h of scene.houses) m.set(h.key, { x: h.x, z: h.z, y0: TERRACE_H, y1: TERRACE_H + h.h + h.roofH + 0.03, w: h.w + 0.14, d: h.d + 0.16, project: h.projectId });
  for (const k of scene.kiosks) m.set(k.key, { x: k.x, z: k.z, y0: TERRACE_H, y1: TERRACE_H + TOOL_OFFICE_TOP, w: k.size, d: k.size * 0.8, project: k.projectId });
  for (const s of scene.strays) m.set(s.key, { x: s.x, z: s.z, y0: 0, y1: Math.max(2, Math.round(s.height / 0.3)) * 0.3 + 0.06, w: s.size, d: s.size });
  return m;
}

const Map3D = forwardRef<Map3DApi, Props>(function Map3D(props, ref) {
  const { layout, selKey, selectedDistrict, focus, showAgentLabels, onSelect, tipFor, healthFor, links, linkSel, linkFocus, showLocal } = props;
  const scene = useMemo(() => buildScene(layout), [layout]);
  const anchors = useMemo(() => anchorsOf(scene, layout), [scene, layout]);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const [near, setNear] = useState<"far" | "mid" | "near">("far");
  const api = useRef<Map3DApi | null>(null);
  const wrapEl = useRef<HTMLDivElement>(null);
  const labelEls = useRef(new Map<string, HTMLDivElement>());

  useImperativeHandle(ref, () => ({
    zoom: (f) => api.current?.zoom(f),
    fit: () => api.current?.fit(),
    reveal: (x, z, c) => api.current?.reveal(x, z, c),
    rotate: (deg) => api.current?.rotate(deg),
  }));

  const select = (key: string) => {
    const a = anchors.get(key);
    onSelect(selOf(key), a?.project);
  };
  const hoverDistrict = hover?.startsWith("district:") ? hover.slice(9) : hover ? anchors.get(hover)?.project : undefined;
  const [hoverLink, setHoverLink] = useState<string | null>(null);

  // Which connections show, and how strongly. A selected connection wins; then a selected
  // building, whose own connections light up while the rest fade or hide.
  const net = useMemo(() => {
    const touches = (l: MapLink) =>
      !!selKey && (l.a === selKey || l.b === selKey || (selKey.startsWith("project:") && !!selectedDistrict && (l.pa === selectedDistrict || l.pb === selectedDistrict)));
    // A link between a headquarters and an AI agent inside it has nowhere to run.
    const placed = links.filter((l) => anchors.has(l.a) && anchors.has(l.b) && anchors.get(l.a) !== anchors.get(l.b));
    const picked = linkSel ? placed.find((l) => l.id === linkSel) : undefined;
    const inHand = (p?: string) => !!p && p === focus;
    const shown: { l: MapLink; level: NetLink["level"] }[] = [];
    for (const l of placed) {
      if (picked) {
        if (l === picked) shown.push({ l, level: "selected" });
        else if (!linkFocus && near === "near") shown.push({ l, level: "dim" });
        continue;
      }
      if (selKey) {
        if (touches(l)) shown.push({ l, level: "strong" });
        else if (!linkFocus && near === "near") shown.push({ l, level: "dim" });
        continue;
      }
      // The overview belongs to the buildings. Reveal local connections only up close.
      if (!showLocal && (near !== "near" || (!inHand(l.pa) && !inHand(l.pb)))) continue;
      shown.push({ l, level: l.status === "unhealthy" ? "strong" : "weak" });
    }
    // Many links at once: keep only failures at full strength so the map stays readable.
    if (!picked && !selKey && shown.length > 24) for (const s of shown) if (s.level === "strong" && s.l.status !== "unhealthy") s.level = "weak";
    // The projects in focus: both ends of the picked link, or the selected building's project and its partners.
    let focusSet: Set<string> | null = null;
    if (picked) focusSet = new Set([picked.pa, picked.pb].filter((p): p is string => !!p));
    else if (selKey && linkFocus && links.length) {
      focusSet = new Set(selectedDistrict ? [selectedDistrict] : []);
      for (const s of shown) for (const p of [s.l.pa, s.l.pb]) if (p) focusSet.add(p);
    }
    return { shown, picked, focusSet };
  }, [links, anchors, linkSel, selKey, selectedDistrict, focus, near, linkFocus, showLocal]);

  // Labels: project plaques always, agent pills once zoomed in (or for the hovered or selected agent).
  const labels = useMemo(() => {
    const out: LabelSpec[] = [];
    // Selecting a project reveals its residents at any zoom. Otherwise names require a
    // close view; a district hover alone never expands a whole neighborhood of labels.
    const showResidents = (projectId: string) => projectId === selectedDistrict || (showAgentLabels && near === "near");
    for (const t of scene.towers) {
      const state = t.key === selKey || t.projectId === selectedDistrict ? "selected" : t.key === hover || hoverDistrict === t.projectId ? "hover" : "";
      const health = healthFor(t.repository);
      const mark = <b className={`hm hm-${health.kind}${health.stale ? " stale" : ""}`} title={health.label} aria-label={health.label} />;
      // A compact nameplate by default; the full name and details on hover or selection.
      if (state !== "selected") {
        const name = clip(t.name, 12, 168);
        out.push({
          id: `hq:${t.projectId}`,
          key: t.key,
          pos: new THREE.Vector3(t.x, towerTop(t) + 0.3, t.z),
          w: measure(name, 12, SANS, 600) + 40,
          h: 34,
          priority: t.projectId === focus ? 2 : 3 + 1 / (1 + t.agents),
          className: `m3-plaque compact ${state}${net.focusSet && !net.focusSet.has(t.projectId) ? " dim" : ""}`,
          onClick: () => select(t.key),
          title: `${t.name} · ${health.label}`,
          node: (
            <div className="t">
              {name}
              {mark}
            </div>
          ),
        });
        continue;
      }
      const lines = wrap(t.name, 13, SANS, 230, 600);
      const sub = `${residentsLabel(t.agents, t.automations)} · ${statusLabel(t.status)}`;
      const w = Math.max(...lines.map((l) => measure(l, 13, SANS, 600)), measure(sub, 11, SANS) + 14, measure(health.label, 11, SANS) + 14) + 26;
      const h = lines.length * 17 + 48;
      out.push({
        id: `hq:${t.projectId}`,
        key: t.key,
        pos: new THREE.Vector3(t.x, towerTop(t) + 0.3, t.z),
        w,
        h: h + 8,
        priority: 0,
        className: `m3-plaque ${state}`,
        onClick: () => select(t.key),
        node: (
          <>
            {lines.map((l, i) => (
              <div key={i} className="t">
                {l}
              </div>
            ))}
            <div className="s">
              <i className={t.status === "attention" ? "pulse" : undefined} style={{ background: STATUS_DOT[t.status] }} />
              {sub}
            </div>
            <div className="s">
              {mark}
              {health.label}
            </div>
          </>
        ),
      });
    }
    for (const h of scene.houses) {
      const urgent = h.key === selKey || h.key === hover;
      if (!urgent && !showResidents(h.projectId)) continue;
      const a = h.agent;
      const text = a.status === "attention" ? `${a.name} · needs attention` : a.name;
      out.push({
        id: h.key,
        key: h.key,
        pos: new THREE.Vector3(h.x, TERRACE_H + h.h + h.roofH + 0.12, h.z),
        w: measure(text, 11.5, SANS, 500) + 22,
        h: 28,
        priority: urgent ? 0.5 : h.projectId === hoverDistrict || h.projectId === selectedDistrict ? 2.5 : 6,
        className: `m3-pill ${a.status === "attention" ? "gold" : ""} ${h.key === selKey ? "selected" : h.key === hover ? "hover" : ""}${net.focusSet && !net.focusSet.has(h.projectId) ? " dim" : ""}`,
        onClick: () => select(h.key),
        node: text,
      });
    }
    for (const k of scene.kiosks) {
      const urgent = k.key === hover || k.key === selKey;
      if (!urgent && !showResidents(k.projectId)) continue;
      out.push({
        id: k.key,
        key: k.key,
        pos: new THREE.Vector3(k.x, TERRACE_H + TOOL_OFFICE_TOP, k.z),
        w: measure(k.name, 11.5, SANS, 500) + 22,
        h: 28,
        priority: urgent ? 0.5 : 6.5,
        className: `m3-pill quiet ${k.key === selKey ? "selected" : urgent ? "hover" : ""}${net.focusSet && !net.focusSet.has(k.projectId) ? " dim" : ""}`,
        onClick: () => select(k.key),
        node: k.name,
      });
    }
    for (const s of scene.strays) {
      const text = s.name.split("/")[1] ?? s.name;
      out.push({
        id: s.key,
        key: s.key,
        pos: new THREE.Vector3(s.x, Math.max(2, Math.round(s.height / 0.3)) * 0.3 + 0.3, s.z),
        w: measure(text, 11.5, SANS, 500) + 22,
        h: 28,
        priority: s.key === selKey || s.key === hover ? 0.5 : 5,
        className: `m3-pill ${s.key === selKey ? "selected" : s.key === hover ? "hover" : ""}`,
        onClick: () => select(s.key),
        node: text,
      });
    }
    // Neighborhood names when the map is grouped, at the back corner of each landmass.
    for (const n of layout.neighborhoods) {
      // Tag groups usually hold one project each, so their "CLAUDE · 1" pills read like error badges.
      if (!n.label || layout.neighborhoods.length < 2 || n.key.startsWith("t:")) continue;
      // Districts are a fixed set, so their names stand alone; other groupings show how many they hold.
      const district = n.key.startsWith("d:");
      const text = district ? n.label.toUpperCase() : `${n.label.toUpperCase()} · ${n.count}`;
      out.push({ id: `nb:${n.key}`, key: n.key, pos: new THREE.Vector3(n.ox + n.w / 2, 0.2, n.oy - 1.2), w: measure(text, 11.5, SANS, 500) + 34, h: 28, priority: 1.5, className: `m3-pill hood${district ? " district" : ""}`, node: text, title: district ? `${n.label} district · ${n.count} ${n.count === 1 ? "project" : "projects"}` : undefined });
    }
    if(scene.financial){
      const f=scene.financial,planned=<b className="hm hm-unverified" title="Planned · No verified operations" aria-label="Planned · No verified operations"/>;
      out.push({id:FINANCIAL_KEY,key:FINANCIAL_KEY,pos:new THREE.Vector3(f.x+f.w/2,TERRACE_H+Math.max(...f.buildings.map(b=>b.height))+1.5,f.z+f.d/2),w:measure("Financial District",12,SANS,600)+40,h:34,priority:selKey===FINANCIAL_KEY?0:2,className:`m3-plaque compact${selKey===FINANCIAL_KEY?" selected":""}`,node:<div className="t">Financial District{planned}</div>,onClick:()=>select(FINANCIAL_KEY),title:"Financial District · Planned waterfront"});
      for(const b of f.buildings)if(near==="near"||selKey===FINANCIAL_KEY||selKey===financialKey(b.id))out.push({id:financialKey(b.id),key:financialKey(b.id),pos:new THREE.Vector3(f.x+b.x,TERRACE_H+b.height+1.3,f.z+b.z),w:measure(b.name,12,SANS,600)+40,h:34,priority:selKey===financialKey(b.id)?0:7,className:`m3-plaque compact${selKey===financialKey(b.id)?" selected":""}`,node:<div className="t">{b.name}{planned}</div>,onClick:()=>select(financialKey(b.id)),title:`${b.name} · Planned workspace`});
      if(near==="near"||selKey===FINANCIAL_KEY||selKey===FINANCIAL_PARK_KEY)out.push({id:FINANCIAL_PARK_KEY,key:FINANCIAL_PARK_KEY,pos:new THREE.Vector3(f.x+f.park.x+f.park.w/2,TERRACE_H+1.6,f.z+f.park.z+f.park.d/2),w:measure("Financial Park",12,SANS,600)+40,h:34,priority:selKey===FINANCIAL_PARK_KEY?0:7,className:`m3-plaque compact${selKey===FINANCIAL_PARK_KEY?" selected":""}`,node:<div className="t">Financial Park{planned}</div>,onClick:()=>select(FINANCIAL_PARK_KEY),title:"Financial Park · Planned public space"});
    }
    if(scene.community&&(near==="near"||selKey===HILLS_KEY||selKey?.startsWith("service:hills:")))for(const b of COMMUNITY_BUILDINGS){const key=communityKey(b.id);out.push({id:key,key,pos:new THREE.Vector3(scene.community.x+b.x,TERRACE_H+b.h+.35,scene.community.z+b.z),w:measure(b.name,12,SANS,600)+30,h:28,priority:selKey===key?0:8,className:`m3-plaque compact${selKey===key?" selected":""}`,node:<div className="t">{b.name}</div>,onClick:()=>select(key),title:`${b.name} · Planned community`});}
    if(scene.communityRail&&(near==="near"||selKey==="service:financial-station")){const [x,z]=scene.communityRail.financial,key="service:financial-station";out.push({id:key,key,pos:new THREE.Vector3(x,TERRACE_H+COMMUNITY.platformRise+1.6,z),w:185,h:28,priority:selKey===key?0:8,className:"m3-plaque compact",node:<div className="t">Financial District Station</div>,onClick:()=>select(key),title:"Financial District Station · Visual simulation"});}
    if(scene.hills)out.push({id:HILLS_KEY,key:HILLS_KEY,pos:new THREE.Vector3(scene.hills.x+HILLS.mansion.x,TERRACE_H+3.8,scene.hills.z+HILLS.mansion.z),w:125,h:28,priority:2,className:"m3-plaque compact",node:<div className="t">Atlas Hills</div>,onClick:()=>select(HILLS_KEY),title:"Atlas Hills · Planned community"});
    if(scene.dealership)out.push({id:DEALERSHIP_KEY,key:DEALERSHIP_KEY,pos:new THREE.Vector3(scene.dealership.x+DEALERSHIP.showroomX,TERRACE_H+DEALERSHIP.height+.55,scene.dealership.z+DEALERSHIP.showroomZ),w:140,h:28,priority:2,className:"m3-plaque compact",node:<div className="t">BMW</div>,onClick:()=>select(DEALERSHIP_KEY),title:"BMW · Planned visual district"});
    if(scene.stadium)out.push({id:STADIUM_KEY,key:STADIUM_KEY,pos:new THREE.Vector3(scene.stadium.x+4,TERRACE_H+2.3,scene.stadium.z+3.5),w:100,h:28,priority:2,className:"m3-plaque compact",node:<div className="t">Stadium</div>,onClick:()=>select(STADIUM_KEY),title:"Stadium · Planned venue"});
    if(scene.airport)for(const b of AIRPORT_BUILDINGS.filter(b=>near==="near"||selKey===airportBuildingKey(b.id)))out.push({id:airportBuildingKey(b.id),key:airportBuildingKey(b.id),pos:new THREE.Vector3(airportPoint(scene.airport,b.x,b.z)[0],TERRACE_H+b.h+.35,scene.airport.z+b.z),w:measure(b.name,11,SANS,500)+24,h:26,priority:selKey===airportBuildingKey(b.id)?0:7,className:"m3-plaque compact secondary",node:<div className="t">{b.name}</div>,onClick:()=>select(airportBuildingKey(b.id)),title:`${b.name} · Planned workspace`});
    if(scene.airport)out.push({id:AIRPORT_KEY,key:AIRPORT_KEY,pos:new THREE.Vector3(airportPoint(scene.airport,AIRPORT_LAYOUT.terminalX,AIRPORT_LAYOUT.terminalZ)[0],TERRACE_H+3.5,scene.airport.z+AIRPORT_LAYOUT.terminalZ),w:125,h:28,priority:2,className:"m3-plaque compact",node:<div className="t">Atlas Airport</div>,onClick:()=>select(AIRPORT_KEY),title:"Atlas Airport · Planned visual district"});
    for(const shop of scene.retail.filter(shop=>near==="near"||hover===shop.key||selKey===skylineBuildingKey(shop.name))) out.push({id:shop.key,key:shop.key,pos:new THREE.Vector3(shop.x,TERRACE_H+toolOfficeHeight(shop.name)+0.4,shop.z),w:measure(shop.name,11,SANS,500)+24,h:26,priority:selKey===skylineBuildingKey(shop.name)?0:hover===shop.key?0.5:7,className:`m3-plaque compact secondary${selKey===skylineBuildingKey(shop.name)?" selected":""}`,node:<div className="t">{shop.name}</div>,onClick:()=>select(skylineBuildingKey(shop.name)),title:`${shop.name} · khaneilcampbell/skyline`});
    for (const p of scene.parks) {
      if(near!=="near") out.push({id:`district:${p.id}`,key:`district:${p.id}`,pos:new THREE.Vector3(p.x+p.w/2,TERRACE_H+0.1,p.z-0.5),w:measure("SKYLINE",11.5,SANS,500)+34,h:28,priority:1.5,className:"m3-pill hood district",node:"SKYLINE",title:"Skyline district"});
      const skylineHealth=healthFor("khaneilcampbell/skyline");
      out.push({ id: p.id, key: p.id, pos: new THREE.Vector3(p.x + p.w / 2, TERRACE_H + 5.3, p.z + p.d / 2), w: measure(p.label, 12, SANS, 600) + 40, h: 34, priority: selKey==="project:skyline"?0:3, className: `m3-plaque compact${selKey==="project:skyline"?" selected":""}`, onClick:()=>select("project:skyline"), title: `skyline · ${skylineHealth.label}`, node: <div className="t">{p.label}<b className={`hm hm-${skylineHealth.kind}${skylineHealth.stale ? " stale" : ""}`} title={skylineHealth.label} aria-label={skylineHealth.label}/></div> });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- select only reads anchors and onSelect
  }, [scene, layout, near, showAgentLabels, selKey, selectedDistrict, hover, hoverDistrict, focus, anchors, onSelect, healthFor, net.focusSet]);

  const pick: PickHandlerSet = {
    of: (keys) => ({
      keys,
      over: (k, e) => {
        setHover(k);
        const r = wrapEl.current!.getBoundingClientRect();
        const t = tipFor(k);
        setTip(t ? { x: e.nativeEvent.clientX - r.left, y: e.nativeEvent.clientY - r.top, ...t } : null);
      },
      out: () => {
        setHover(null);
        setTip(null);
      },
      click: (k, e) => {
        if (e.delta > 4) return;
        select(k);
      },
    }),
  };
  // Tool buildings are selected like project buildings; purpose belongs in the inspector.
  const kioskPick: PickHandlerSet = {
    of: (keys) => ({
      ...pick.of(keys),
      over: (key) => { setHover(key); setTip(null); },
      click:(key,e)=>{if(e.delta>4)return;const shop=scene.retail.find(k=>k.key===key);select(shop?skylineBuildingKey(shop.name):key);},
    }),
  };
  const terracePick: Pick = {
    keys: scene.terraces.map((t) => t.id),
    over: (id) => !id.startsWith("park:") && setHover(`district:${id}`),
    out: () => setHover((h) => (h?.startsWith("district:") ? null : h)),
    click: (id, e) => {
      if (e.delta > 4 || id.startsWith("park:")) return;
      props.onFocus(id);
    },
  };

  // Health accents on each headquarters, from the same verified data as the inspector.
  const health = useMemo(() => new Map(scene.towers.map((t) => [t.key, healthFor(t.repository).health])), [scene, healthFor]);
  // Stop rendering while the window is hidden; nothing on the map needs to move then.
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  // The map is fully covered while a building's office is open, so it stops rendering then.
  const officePhase = useOffice().phase;
  // Phones get a lighter scene: fewer pixels and a smaller shadow map keep frames steady.
  const phone = useMedia(PHONE_QUERY);
  // Buildings light up while their agents are observed working.
  const activity = useBuildingActivity();
  // Frame rate, pixels and shadow detail follow the Performance setting.
  const power = usePowerProfile();
  // When frames run slow the governor lowers pixel ratio, then shadow detail, to keep it smooth.
  const quality = LEVELS[useQualityLevel()];
  const maxDpr = Math.min(power.maxDpr, quality.maxDpr);
  const drawing = visible && officePhase !== "inside";
  // If the graphics driver drops the WebGL context (a frame took too long, or the GPU reset) and the
  // browser doesn't hand it back, start a fresh canvas instead of leaving the map blank.
  const [glKey, setGlKey] = useState(0);
  useEffect(() => resetGovernor(), [power, glKey]);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);
  const restarts = useRef(0);
  const onGlCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const c = gl.domElement;
    glCanvas.current = c;
    let timer = 0;
    c.addEventListener("webglcontextlost", () => {
      timer = window.setTimeout(() => {
        if (glCanvas.current !== c || restarts.current >= 3) return;
        restarts.current += 1;
        setGlKey((k) => k + 1);
      }, 2000);
    });
    c.addEventListener("webglcontextrestored", () => window.clearTimeout(timer));
  }, []);

  return (
    <div className="map3d" ref={wrapEl}>
      <Canvas key={glKey} onCreated={onGlCreated} shadows dpr={phone ? [1, Math.min(1.5, maxDpr)] : [1, maxDpr]} frameloop={drawing ? "demand" : "never"} camera={{ fov: FOV, near: 0.5, far: 800 }} gl={{ antialias: true }}>
        <FramePacer profile={power} running={drawing} />
        <World
          power={power}
          light={props.light}
          health={health}
          net={net}
          hoverLink={hoverLink}
          linksMoving={props.linksMoving}
          traffic={props.traffic}
          onLinkHover={(id, e) => {
            setHoverLink(id);
            const t = id ? props.linkTip(id) : null;
            if (!t || !e) return setTip(null);
            const r = wrapEl.current!.getBoundingClientRect();
            setTip({ x: e.nativeEvent.clientX - r.left, y: e.nativeEvent.clientY - r.top, ...t });
          }}
          onLinkPick={props.onLinkSelect}
          hoods={layout.neighborhoods.length}
          scene={scene}
          anchors={anchors}
          labels={labels}
          labelEls={labelEls}
          hover={hover}
          selKey={selKey}
          hoverDistrict={hoverDistrict}
          selectedDistrict={selectedDistrict}
          api={api}
          pick={pick}
          landmarkSelect={()=>select("project:skyline")}
          kioskPick={kioskPick}
          terracePick={terracePick}
          reduced={props.reduced}
          activity={activity}
          onNear={setNear}
          onMoved={() => setTip(null)}
          phone={phone}
          cover={props.cover ?? 0}
        />
      </Canvas>
      <div
        className="m3-labels"
        // Labels sit over the canvas; pass the wheel through so zooming works anywhere.
        onWheel={(e) => wrapEl.current?.querySelector("canvas")?.dispatchEvent(new WheelEvent("wheel", e.nativeEvent))}
      >
        {labels.map((l) => (
          <div
            key={l.id}
            ref={(el) => {
              if (el) labelEls.current.set(l.id, el);
              else labelEls.current.delete(l.id);
            }}
            className={l.className}
            title={l.title}
            style={{ width: l.w }}
            role={l.onClick?"button":undefined}
            tabIndex={l.onClick?0:undefined}
            onKeyDown={e=>{if(l.onClick&&(e.key==="Enter"||e.key===" ")){e.preventDefault();e.stopPropagation();l.onClick();}}}
            onClick={l.onClick}
            onMouseEnter={l.onClick ? () => setHover(l.key) : undefined}
            onMouseLeave={l.onClick ? () => setHover(null) : undefined}
          >
            {l.node}
          </div>
        ))}
      </div>
      {tip && (
        <div className="map-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="t">{tip.title}</div>
          <div className="s">{tip.sub}</div>
        </div>
      )}
    </div>
  );
});

function World({
  power,
  light: lightMode,
  health,
  net,
  hoverLink,
  linksMoving,
  traffic,
  onLinkHover,
  onLinkPick,
  hoods,
  scene,
  anchors,
  labels,
  labelEls,
  hover,
  selKey,
  hoverDistrict,
  selectedDistrict,
  api,
  pick,
  kioskPick,
  landmarkSelect,
  terracePick,
  reduced,
  activity,
  onNear,
  onMoved,
  phone,
  cover,
}: {
  power: PowerProfile;
  light: LightMode;
  health: Map<string, Health>;
  net: { shown: { l: MapLink; level: NetLink["level"] }[]; picked?: MapLink; focusSet: Set<string> | null };
  hoverLink: string | null;
  linksMoving: boolean;
  traffic: boolean;
  onLinkHover: (id: string | null, e?: { nativeEvent: PointerEvent }) => void;
  onLinkPick: (id: string) => void;
  hoods: number;
  scene: Scene3D;
  anchors: ReturnType<typeof anchorsOf>;
  labels: LabelSpec[];
  labelEls: React.MutableRefObject<Map<string, HTMLDivElement>>;
  hover: string | null;
  selKey: string | null;
  hoverDistrict?: string;
  selectedDistrict?: string;
  api: React.MutableRefObject<Map3DApi | null>;
  pick: PickHandlerSet;
  kioskPick: PickHandlerSet;
  landmarkSelect: ()=>void;
  terracePick: Pick;
  reduced: boolean;
  activity: Map<string, Illumination>;
  onNear: (near: "far" | "mid" | "near") => void;
  onMoved: () => void;
  phone: boolean;
  cover: number;
}) {
  const { camera, gl, size, scene: three, invalidate } = useThree();
  // Draw once after every update: much of what changes (labels, focus, day and night) is read in frames.
  useEffect(() => invalidate());
  // Before anything measures the view: in portrait, hold the horizontal angle steady (see PORTRAIT_ASPECT).
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const t = Math.tan((FOV * Math.PI) / 360);
    cam.fov = aspect < PORTRAIT_ASPECT ? Math.min(60, (Math.atan((t * PORTRAIT_ASPECT) / aspect) * 360) / Math.PI) : FOV;
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  const g = useGeometries();
  const m = useMaterials();
  const railRoads=useMemo(()=>[scene.freight?.highway??[],scene.freight?.route??[],scene.freight?.cityAccess??[],...(scene.freight?.access.flatMap(a=>[a.collector,...a.ramps])??[]),...scene.transportConnections.map(c=>c.road)],[scene]);
  const controls = useMemo(() => {
    const c = new MapControls(camera, gl.domElement);
    // Turn all the way around (right drag, two fingers, or Shift with the left button), but stay
    // above the ground and short of straight down.
    c.enableRotate = true;
    c.rotateSpeed = 0.6;
    c.minPolarAngle = (12 * Math.PI) / 180;
    c.maxPolarAngle = (72 * Math.PI) / 180;
    c.enableDamping = true;
    c.dampingFactor = 0.14;
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.zoomSpeed = 1.2;
    return c;
  }, [camera, gl]);
  const touched = useRef(false);
  const fitDist = useRef(30);
  const anim = useRef<{ t0: number; ms: number; from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3] } | null>(null);
  /** The selection the camera is framing, until the person moves the camera themselves. */
  const framing = useRef<string | null>(null);
  const center = useMemo(() => {
    const b = scene.bounds;
    return new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  }, [scene]);
  const ext = Math.max(scene.bounds.x1 - scene.bounds.x0, scene.bounds.z1 - scene.bounds.z0) / 2 + 4;

  const movedRef = useRef(onMoved);
  movedRef.current = onMoved;
  useEffect(() => {
    const start = () => {
      wake();
      touched.current = true;
      anim.current = null;
      framing.current = null;
      movedRef.current();
    };
    // Reconnect on every mount: React's development double-mount would otherwise leave them detached.
    controls.disconnect();
    controls.connect(gl.domElement);
    // Damping eases the camera on after a release; keep drawing every frame until it settles.
    const change = () => wake(200);
    controls.addEventListener("start", start);
    controls.addEventListener("change", change);
    return () => {
      controls.removeEventListener("start", start);
      controls.removeEventListener("change", change);
      controls.disconnect();
    };
  }, [controls, gl]);

  /**
   * The angle the map is first seen from. A tall phone screen looks along the island's side
   * instead of across its corner, so the island spans the narrow width side to side rather than
   * corner to corner and draws about a third larger.
   */
  const homeDir = () => (phone && size.width < size.height ? DIR_UPRIGHT : DIR);

  /** Distance from the target at which the whole landmass fits the view, by bisection on its corners. */
  const computeFit = () => {
    // Fit actual ground and building envelopes, not empty elevated corners of a bounding box.
    const corners = scene.land.flatMap(r=>[r.x,r.x+r.w].flatMap(x=>[r.z,r.z+r.d].map(z=>new THREE.Vector3(x,WATER_Y,z))));
    for(const [x,z]of scene.freight?.highway??[])corners.push(new THREE.Vector3(x,TERRACE_H+.5,z));
    for(const a of anchors.values())for(const x of [a.x-a.w/2,a.x+a.w/2])for(const z of [a.z-a.d/2,a.z+a.d/2])corners.push(new THREE.Vector3(x,a.y1+.3,z));
    const cam = (camera as THREE.PerspectiveCamera).clone();
    cam.aspect = size.width / Math.max(1, size.height);
    cam.updateProjectionMatrix();
    let lo = 2;
    let hi = 600;
    const v = new THREE.Vector3();
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(center).addScaledVector(homeDir(), mid);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      const ok = corners.every((c) => {
        v.copy(c).project(cam);
        return Math.abs(v.x) <= 0.97 && v.y <= 0.84 && v.y >= -0.9;
      });
      if (ok) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  /** The way the camera looks from, so moves keep whatever angle the person turned to. */
  const viewDir = () => camera.position.clone().sub(controls.target).normalize();

  const goto = (target: THREE.Vector3, dist: number, instant = false, ms = 420, dir = viewDir()) => {
    const to: [THREE.Vector3, THREE.Vector3] = [target.clone(), target.clone().addScaledVector(dir, dist)];
    wake(ms + 100);
    if (instant || reduced) {
      controls.target.copy(to[0]);
      camera.position.copy(to[1]);
      anim.current = null;
      return;
    }
    anim.current = { t0: performance.now(), ms, from: [controls.target.clone(), camera.position.clone()], to };
  };

  const fitNow = (instant = false) => {
    fitDist.current = computeFit();
    controls.maxDistance = fitDist.current * 1.8;
    controls.minDistance = 4;
    // Expanded cities include every transport corner; retain the original crop for small maps.
    goto(center, fitDist.current * (scene.communityRail ? 1 : hoods > 1 ? 0.9 : homeDir() === DIR_UPRIGHT ? 0.8 : 0.7), instant, 420, homeDir());
  };

  // Fit on first show and when the layout changes; refit on resize until the person moves the camera.
  useEffect(() => {
    touched.current = false;
    fitNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  const lastSize = useRef(size);
  useEffect(() => {
    const prev = lastSize.current;
    lastSize.current = size;
    // Only the height changed (Safari's toolbar or the keyboard on a phone): the horizontal angle
    // holds, so leave the camera where it is rather than jump to a new fit.
    const heightOnly = phone && prev !== size && Math.abs(prev.width - size.width) < 2;
    if (heightOnly) fitDist.current = computeFit();
    else if (framing.current) frame(framing.current);
    else if (!touched.current) fitNow(true);
    else fitDist.current = computeFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  api.current = {
    zoom: (f) => {
      touched.current = true;
      const d = camera.position.distanceTo(controls.target);
      goto(controls.target, THREE.MathUtils.clamp(d / f, controls.minDistance, controls.maxDistance));
    },
    fit: () => {
      touched.current = false;
      fitNow();
    },
    rotate: (deg) => {
      touched.current = true;
      const d = camera.position.distanceTo(controls.target);
      goto(controls.target, d, false, 520, viewDir().applyAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180));
    },
    reveal: (x, z, closer) => {
      touched.current = true;
      const d = camera.position.distanceTo(controls.target);
      goto(new THREE.Vector3(x, TERRACE_H, z), closer ? Math.min(d, fitDist.current * 0.5) : d);
    },
  };

  /** Glide to a selected building, close enough to read its signs, with the whole building in view. */
  function frame(key: string) {
    const a = anchors.get(key);
    if (!a) return;
    touched.current = true;
    const h = a.y1 - a.y0;
    const dist = THREE.MathUtils.clamp(Math.max(h * 3.4, Math.max(a.w, a.d) * 5) + 3, controls.minDistance, fitDist.current * 0.45);
    const target = new THREE.Vector3(a.x, a.y0 + h * 0.42, a.z);
    const dir = viewDir();
    if (cover > 0 && dir.y > 0.2) {
      // Raise the building into the middle of the part a sheet leaves uncovered, by sliding the
      // point the camera looks at toward the viewer along the ground.
      const lift = cover * dist * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360);
      target.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), lift / dir.y);
    }
    goto(target, dist, false, 900, dir);
  }

  // Frame every selection, wherever it was made (map, search, inspector). The docked inspector
  // resizes the canvas a moment later, so the resize handler frames it again.
  useEffect(() => {
    framing.current = selKey && anchors.has(selKey) ? selKey : null;
    if (framing.current) frame(framing.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, anchors, cover]);

  // Entering a building: remember the view, glide in toward its headquarters, and glide back to
  // the same view on the way out.
  const office = useOffice();
  const saved = useRef<[THREE.Vector3, THREE.Vector3] | null>(null);
  useEffect(() => {
    const { phase, projectId } = office;
    if ((phase === "entering" || phase === "inside") && projectId && !saved.current) {
      saved.current = [controls.target.clone(), camera.position.clone()];
      framing.current = null;
      const t = scene.towers.find((x) => x.projectId === projectId);
      const a = t && anchors.get(t.key);
      if (a && phase === "entering") {
        const h = a.y1 - a.y0;
        goto(new THREE.Vector3(a.x, a.y0 + h * 0.35, a.z), Math.max(h * 1.3, a.w * 2.4), false, ENTER_MS);
      }
    } else if ((phase === "leaving" || !phase) && saved.current) {
      const to = saved.current;
      saved.current = null;
      if (reduced || !phase) {
        controls.target.copy(to[0]);
        camera.position.copy(to[1]);
        anim.current = null;
      } else anim.current = { t0: performance.now(), ms: LEAVE_MS + 300, from: [controls.target.clone(), camera.position.clone()], to };
      wake(LEAVE_MS + 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office.phase, office.projectId]);

  // Light and shadows sized to the whole map.
  const light = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.position.copy(center).add(new THREE.Vector3(-ext * 0.7, ext * 1.2, ext * 0.25));
    l.target.position.copy(center);
    three.add(l.target);
    const c = l.shadow.camera;
    c.left = -ext * 1.2;
    c.right = ext * 1.2;
    c.top = ext * 1.2;
    c.bottom = -ext * 1.2;
    c.near = 1;
    c.far = ext * 5;
    c.updateProjectionMatrix();
    return () => {
      three.remove(l.target);
    };
  }, [center, ext, three]);

  // Three keeps the old shadow texture when the size changes; drop it so the next frame makes one.
  const quality = LEVELS[useQualityLevel()];
  const shadowSize = Math.min(phone ? 2048 : power.shadowMap, quality.shadowMap);
  const firstShadow = useRef(true);
  useEffect(() => {
    if (firstShadow.current) return void (firstShadow.current = false);
    const l = light.current;
    if (!l?.shadow.map) return;
    l.shadow.map.dispose();
    l.shadow.map = null;
    gl.shadowMap.needsUpdate = true;
    wake();
  }, [shadowSize, gl]);

  const fog = useMemo(() => new THREE.Fog("#d3e4de", 40, 120), []);
  useEffect(() => {
    three.fog = fog;
    return () => {
      three.fog = null;
    };
  }, [fog, three]);

  const lastSig = useRef("");
  const labelSig = useRef(0);
  useEffect(() => {
    labelSig.current++;
  }, [labels]);
  const nearRef = useRef<"far" | "mid" | "near">("far");
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!reduced) time.value = state.clock.elapsedTime;
    const a = anim.current;
    if (a) {
      wake(100);
      const p = Math.min(1, (performance.now() - a.t0) / a.ms);
      // Ease in and out so long glides start and land gently.
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      controls.target.lerpVectors(a.from[0], a.to[0], e);
      camera.position.lerpVectors(a.from[1], a.to[1], e);
      if (p >= 1) anim.current = null;
    }
    controls.update();
    const dist = camera.position.distanceTo(controls.target);
    fog.near = dist * 1.25;
    fog.far = dist * 3.2;
    const isNear = dist < fitDist.current * 0.4 ? "near" : dist < fitDist.current * 0.62 ? "mid" : "far";
    if (isNear !== nearRef.current) {
      nearRef.current = isNear;
      onNear(isNear);
    }

    // Re-place labels only when the view or the label set changed.
    const e = camera.matrixWorld.elements;
    const sig = `${e.map((n) => n.toFixed(3)).join(",")},${camera.projectionMatrix.elements.join(",")},${size.width},${size.height},${labelSig.current},${labelEls.current.size}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    const boxes = [];
    const screen = new Map<string, { x: number; y: number }>();
    for (const l of labels) {
      v.copy(l.pos).project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      screen.set(l.id, { x, y });
      boxes.push({ id: l.id, x, top: y - l.h, bottom: y, w: l.w, priority: l.priority, alts: [-(l.h * 0.55), -(l.h + 6)] });
    }
    const shown = placeLabels(boxes, 10);
    for (const l of labels) {
      const el = labelEls.current.get(l.id);
      if (!el) continue;
      const s = screen.get(l.id);
      const dy = shown.get(l.id);
      if (!s || dy === undefined) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${Math.round(s.x - l.w / 2)}px, ${Math.round(s.y + dy - l.h)}px)`;
      el.style.setProperty("--stem", `${Math.max(0, -dy)}px`);
    }
  });

  // Focus mode fades everything outside the terraces in focus; the shader reads these rectangles.
  const focusTarget = net.focusSet ? 1 : 0;
  useEffect(() => {
    const ts = net.focusSet ? scene.terraces.filter((t) => net.focusSet!.has(t.id)).slice(0, FOCUS_MAX) : [];
    ts.forEach((t, i) => focusRects.value[i].set(t.x - 0.2, t.z - 0.2, t.x + t.w + 0.2, t.z + t.d + 0.2));
    if (ts.length) focusCount.value = ts.length;
  }, [net.focusSet, scene]);
  useEffect(() => () => void (focusLevel.value = 0), []);
  useFrame((_, delta) => {
    const f = focusLevel.value;
    if (f === focusTarget) return;
    wake(100);
    focusLevel.value = reduced ? focusTarget : THREE.MathUtils.clamp(f + Math.sign(focusTarget - f) * delta * 3.5, 0, 1);
  });

  const netLinks = useMemo<NetLink[]>(() => {
    const at = (k: string) => {
      const a = anchors.get(k)!;
      return new THREE.Vector3(a.x, a.y1 + 0.04, a.z);
    };
    // Highest headquarters roof near the straight line between the ends, for the arc to clear.
    const clearance = (p: THREE.Vector3, q: THREE.Vector3) => {
      let h = 0;
      const seg = new THREE.Line3(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(q.x, 0, q.z));
      const c = new THREE.Vector3();
      for (const t of scene.towers) {
        const o = new THREE.Vector3(t.x, 0, t.z);
        if (o.distanceTo(seg.start) < 0.1 || o.distanceTo(seg.end) < 0.1) continue;
        seg.closestPointToPoint(o, true, c);
        if (c.distanceTo(o) < t.size * 0.8) h = Math.max(h, towerTop(t) + 0.6);
      }
      return Math.round(h * 100) / 100;
    };
    return net.shown.map(({ l, level }) => {
      const from = at(l.a);
      const to = at(l.b);
      return { id: l.id, type: l.type, status: l.status, from, to, clear: clearance(from, to), level, flow: l.directed && l.status === "active" && level !== "dim" };
    });
  }, [net, anchors, scene]);

  // Frame both ends of a selected connection.
  useEffect(() => {
    const l = net.picked;
    const a = l && anchors.get(l.a);
    const b = l && anchors.get(l.b);
    if (!a || !b) return;
    framing.current = null;
    touched.current = true;
    const span = Math.hypot(a.x - b.x, a.z - b.z);
    const dist = THREE.MathUtils.clamp(span * 1.7 + Math.max(a.y1, b.y1) * 2, controls.minDistance, fitDist.current * 0.8);
    goto(new THREE.Vector3((a.x + b.x) / 2, TERRACE_H + 0.5, (a.z + b.z) / 2), dist, false, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.picked?.id]);

  const safeFlight=useMemo(()=>flightClearance(scene),[scene]);
  const hl = (key: string | null) => (key ? anchors.get(key) : undefined);
  const terraceOf = (id?: string) => (id ? scene.terraces.find((t) => t.id === id) : undefined);
  return (
    <>
      <Sky mode={lightMode} reduced={reduced} m={m} sun={light} fog={fog} />
      <Bloom />
      <Traffic scene={scene} g={g} m={m} moving={!reduced} />
      {traffic && <Vehicles scene={scene} g={g} m={m} moving={!reduced} />}
      <directionalLight ref={light} castShadow intensity={2.5} color="#fff0d2" shadow-mapSize={[shadowSize, shadowSize]} shadow-bias={-0.0004} shadow-normalBias={0.03} />
      <Terrain scene={scene} g={g} m={m} onTerrace={terracePick} />
      <Bridges scene={scene} g={g} m={m} />
      <Kiosks kiosks={scene.retail} g={g} m={m} pick={kioskPick} />
      <SkylineFerrisWheel parks={scene.parks} reduced={reduced} />
      <Skyline parks={scene.parks} g={g} m={m} onSelect={landmarkSelect} />
      <VenueBridge scene={scene} g={g} m={m}/>
      <DistrictLife scene={scene} g={g} m={m} moving={!reduced&&traffic&&office.phase===null}/>
      <FinancialDistrict plan={scene.financial} g={g} m={m} night={lightMode==="night"} pick={kioskPick}/>
      <AtlasHills plan={scene.hills} g={g} m={m} night={lightMode==="night"} pick={kioskPick.of([HILLS_KEY])}/>
      <HillsCommunity plan={scene.community} g={g} m={m} pick={kioskPick} night={lightMode==="night"}/>
      <CommunityRail plan={scene.communityRail} roads={railRoads} g={g} m={m} pick={kioskPick} moving={!reduced&&traffic} night={lightMode==="night"}/>
      <Dealership night={lightMode==="night"} traffic={traffic} reduced={reduced} plan={scene.dealership} g={g} m={m} pick={kioskPick.of([DEALERSHIP_KEY])}/>
      <Freight plan={scene.freight} g={g} m={m} moving={!reduced&&traffic} visible={traffic}/>
      <StreetLights scene={scene} g={g} m={m} night={lightMode==="night"}/>
      <Stadium night={lightMode==="night"} plan={scene.stadium} g={g} m={m} pick={kioskPick.of([STADIUM_KEY])}/>
      <Airport night={lightMode==="night"} flightAltitude={safeFlight.altitude} bounds={scene.bounds} plan={scene.airport} g={g} m={m} moving={!reduced&&traffic} pick={kioskPick.of([AIRPORT_KEY])} />
      <Landscape scene={scene} g={g} m={m} />
      <Houses houses={scene.houses} g={g} m={m} pick={pick} />
      <Kiosks kiosks={scene.kiosks} g={g} m={m} pick={kioskPick} />
      <Towers towers={scene.towers} strays={scene.strays} health={health} g={g} m={m} pick={pick} />
      {scene.towers.filter((t) => t.identity.landmark).map((t) => <AtlasHq key={t.key} tower={t} base={FLOOR_BASE} g={g} m={m} pick={pick.of([t.key])} night={lightMode === "night"} />)}
      {scene.towers.filter((t) => isRibbonTower(t.projectId)).map((t) => <RibbonTower key={t.key} tower={t} base={FLOOR_BASE} g={g} m={m} pick={pick.of([t.key])} night={lightMode === "night"} />)}
      <ActivityGlow towers={scene.towers} houses={scene.houses} states={activity} g={g} m={m} reduced={reduced} />
      <Outline a={hl(hover !== selKey ? hover : null)} color="#fff6d8" />
      <Outline a={hl(selKey)} color="#c9a35a" ring />
      {net.picked && <Outline a={hl(net.picked.a)} color="#c9a35a" />}
      {net.picked && <Outline a={hl(net.picked.b)} color="#c9a35a" />}
      {netLinks.length > 0 && <Network links={netLinks} hover={hoverLink} moving={linksMoving && !reduced} onHover={onLinkHover} onPick={onLinkPick} />}
      <TerraceGlow t={terraceOf(selectedDistrict)} strong />
      {hoverDistrict !== selectedDistrict && <TerraceGlow t={terraceOf(hoverDistrict)} />}
    </>
  );
}

/** A slightly larger back-faced shell behind a building, which reads as an outline. */
const BOX_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

function Outline({ a, color, ring }: { a?: { x: number; z: number; y0: number; y1: number; w: number; d: number }; color: string; ring?: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const r = ringRef.current;
    if (!r) return;
    const t = (clock.elapsedTime % 1.8) / 1.8;
    r.scale.setScalar(0.85 + t * 0.45);
    (r.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
  });
  if (!a) return null;
  const pad = 0.12;
  return (
    <group>
      {/* Crisp edges rather than a solid silhouette, so the facade stays visible. */}
      <lineSegments position={[a.x, (a.y0 + a.y1) / 2, a.z]} scale={[a.w + pad, a.y1 - a.y0 + pad, a.d + pad]} geometry={BOX_EDGES} raycast={() => null}>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <mesh position={[a.x, (a.y0 + a.y1) / 2, a.z]} scale={[a.w + pad * 2, a.y1 - a.y0 + pad * 2, a.d + pad * 2]} raycast={() => null}>
        <boxGeometry />
        {/* A faint glaze; kept light so the building's signs and details stay readable. */}
        <meshBasicMaterial color={color} transparent opacity={ring ? 0.05 : 0.1} depthWrite={false} />
      </mesh>
      {ring && (
        <mesh ref={ringRef} position={[a.x, a.y0 + 0.05, a.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[Math.max(a.w, a.d) * 0.75, Math.max(a.w, a.d) * 0.75 + 0.08, 48]} />
          <meshBasicMaterial color="#c9a35a" transparent depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** A warm rim around a terrace when its project is hovered or selected. */
function TerraceGlow({ t, strong }: { t?: { x: number; z: number; w: number; d: number }; strong?: boolean }) {
  if (!t) return null;
  const y = TERRACE_H + 0.035;
  const k = 0.07;
  const bars: [number, number, number, number][] = [
    [t.x + t.w / 2, t.z, t.w, k],
    [t.x + t.w / 2, t.z + t.d, t.w, k],
    [t.x, t.z + t.d / 2, k, t.d],
    [t.x + t.w, t.z + t.d / 2, k, t.d],
  ];
  return (
    <group>
      {bars.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, y, z]} raycast={() => null}>
          <boxGeometry args={[w, 0.03, d]} />
          <meshBasicMaterial color={strong ? "#e2c27a" : "#fff3cf"} transparent opacity={strong ? 1 : 0.8} />
        </mesh>
      ))}
    </group>
  );
}

export default Map3D;
