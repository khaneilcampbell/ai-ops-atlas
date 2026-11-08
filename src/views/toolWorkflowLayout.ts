import type { ServiceUse } from "../catalog/roles";

/** Order tools by declared agent dependencies, with documented phase numbers as the tie-break. */
export function orderToolsForWorkflow(services: ServiceUse[]): ServiceUse[] {
  const phase = (service: ServiceUse) => Math.min(...service.users.map(a => {
    const text = `${a.registry?.execution?.schedule ?? ""} ${a.trigger ?? ""}`;
    const match = text.match(/phase\s*(\d+)/i);
    return match ? Number(match[1]) : Infinity;
  }));
  const compare = (a: ServiceUse, b: ServiceUse) => {
    const pa = phase(a), pb = phase(b);
    return pa < pb ? -1 : pa > pb ? 1 : a.name.localeCompare(b.name);
  };
  const deps = new Map(services.map(service => [service.id, new Set(services.filter(other => other.id !== service.id && service.users.some(a => other.users.some(b => a.registry?.responsibilities?.dependencies?.includes(b.id)))).map(other => other.id))]));
  const remaining = new Map(services.map(service => [service.id, service]));
  const ordered: ServiceUse[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter(service => [...deps.get(service.id)!].every(id => !remaining.has(id)));
    // A dependency cycle does not invent a sequence: use documented phase, then a stable name.
    const next = (ready.length ? ready : [...remaining.values()]).sort(compare)[0];
    ordered.push(next); remaining.delete(next.id);
  }
  return ordered;
}

/** Evenly spaced stations along the front perimeter, from the left of HQ to its right. */
export function workflowToolSpots(count: number, size: number): { gx: number; gy: number }[] {
  if (!count) return [];
  const lo = size / 6, hi = size * 5 / 6;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 1 : i * 2 / (count - 1);
    return t <= 1 ? { gx: lo + (hi - lo) * t, gy: hi } : { gx: hi, gy: hi - (hi - lo) * (t - 1) };
  });
}

export interface WorkflowRoutePoint { gx: number; gy: number }
interface RouteBox { gx: number; gy: number; size: number }

/** Short orthogonal links between front entrances, kept clear of every building footprint. */
export function toolWorkflowRoads(hq: RouteBox, tools: RouteBox[], endpoints?: WorkflowRoutePoint[]): WorkflowRoutePoint[][] {
  if (!tools.length && !endpoints) return [];
  const margin = 0.25;
  const boxes = [hq, ...tools].map(b => ({ x0: b.gx - margin, x1: b.gx + b.size + margin, y0: b.gy - margin, y1: b.gy + b.size + margin }));
  const stops = endpoints ?? [hq, ...tools].map(b => ({ gx: b.gx + b.size / 2, gy: b.gy + b.size + margin }));
  const xs = [...new Set([...boxes.flatMap(b => [b.x0, b.x1]), ...stops.map(p => p.gx)])].sort((a,b) => a-b);
  const ys = [...new Set([...boxes.flatMap(b => [b.y0, b.y1]), ...stops.map(p => p.gy)])].sort((a,b) => a-b);
  const blocked = (a: WorkflowRoutePoint, b: WorkflowRoutePoint) => boxes.some(r => Math.min(a.gx,b.gx) < r.x1 - 1e-7 && Math.max(a.gx,b.gx) > r.x0 + 1e-7 && Math.min(a.gy,b.gy) < r.y1 - 1e-7 && Math.max(a.gy,b.gy) > r.y0 + 1e-7);
  const points = xs.flatMap(gx => ys.map(gy => ({gx,gy})));
  const index = (p: WorkflowRoutePoint) => xs.indexOf(p.gx)*ys.length+ys.indexOf(p.gy);
  return stops.map((start, leg) => {
    const goal = stops[(leg+1)%stops.length], from = index(start), target = index(goal);
    const costs = new Map([[from,0]]), prev = new Map<number,number>(), open = new Set([from]);
    while(open.size) {
      const at = [...open].sort((a,b) => costs.get(a)!-costs.get(b)! || a-b)[0]; open.delete(at);
      if(at===target) break;
      const x=Math.floor(at/ys.length), y=at%ys.length;
      for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        if(nx<0||ny<0||nx>=xs.length||ny>=ys.length) continue;
        const next=nx*ys.length+ny;
        if(blocked(points[at],points[next])) continue;
        const cost=costs.get(at)!+Math.abs(points[at].gx-points[next].gx)+Math.abs(points[at].gy-points[next].gy);
        if(cost >= (costs.get(next)??Infinity)-1e-7) continue;
        costs.set(next,cost);prev.set(next,at);open.add(next);
      }
    }
    if(!costs.has(target)) return [];
    const path=[target];while(path[0]!==from) path.unshift(prev.get(path[0])!);
    return path.map(i=>points[i]).filter((p,i,all) => i===0||i===all.length-1||!((all[i-1].gx===p.gx&&p.gx===all[i+1].gx)||(all[i-1].gy===p.gy&&p.gy===all[i+1].gy)));
  });
}
