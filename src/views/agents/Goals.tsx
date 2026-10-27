import { relative } from "../../lib/time";
import type { Kpi } from "../../registry/types";
import type { RegistryEntry } from "../../registry/registry";
import { meetsTarget, observeKpi, successTrend } from "../../registry/telemetry";
import { ClassBadge, NA } from "./parts";

/** Goals & Performance: each KPI's target next to what was actually observed. */
export function Goals({ entries, open }: { entries: RegistryEntry[]; open: (id: string) => void }) {
  // Agents with KPIs first; the rest show an explicit gap.
  const ordered = [...entries.filter((e) => e.profile.goals.kpis.length), ...entries.filter((e) => !e.profile.goals.kpis.length)];
  const rows = ordered.flatMap((e): { e: RegistryEntry; k: Kpi | null; first: boolean; span: number }[] =>
    e.profile.goals.kpis.length ? e.profile.goals.kpis.map((k, i) => ({ e, k, first: i === 0, span: e.profile.goals.kpis.length })) : [{ e, k: null, first: true, span: 1 }],
  );
  const measured = entries.filter((e) => e.profile.goals.kpis.some((k) => observeKpi(k, e.telemetry))).length;

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        Targets are written by people in each manifest; observed values come only from connected telemetry (GitHub Actions runs and the app's own run log). {measured} of {entries.length}{" "}
        items currently have an observed KPI value. Trends need at least six completed runs.
      </p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="table goals-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Objective</th>
              <th>KPI</th>
              <th>Target</th>
              <th>Observed</th>
              <th>Last measurement</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, k, first, span }) => {
              const t = e.telemetry;
              const o = k ? observeKpi(k, t) : null;
              const met = k ? meetsTarget(k, o?.value ?? null) : null;
              const trend = k?.measure === "run_success_rate" ? successTrend(t) : null;
              const missing = t.source ? "verified" : "connected";
              return (
                <tr key={`${e.profile.id}:${k?.name ?? "none"}`} onClick={() => open(e.profile.id)}>
                  {first && (
                    <>
                      <td rowSpan={span}>
                        <div className="title">{e.profile.title}</div>
                        <div className="meta">
                          <ClassBadge c={e.profile.classification} /> {e.profile.project.name}
                        </div>
                      </td>
                      <td rowSpan={span} className="small">
                        {e.profile.goals.objective ?? <NA />}
                      </td>
                    </>
                  )}
                  {k ? (
                    <>
                      <td className="small">{k.name}</td>
                      <td className="small">{k.target ?? <NA kind="set" />}</td>
                      <td className="small">{o ? <span className={met === null ? "" : met ? "kpi-met" : "kpi-missed"}>{o.display}</span> : <NA kind={k.measure ? missing : "connected"} />}</td>
                      <td className="small nowrap">{o && t.lastAnyRun ? relative(t.lastAnyRun.at) : <NA kind={k.measure ? missing : "connected"} />}</td>
                      <td className="small">{trend ? <span className={`trend trend-${trend}`}>{trend === "up" ? "Improving" : trend === "down" ? "Declining" : "Steady"}</span> : <span className="na">Not enough data</span>}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="small">
                      <NA /> <span className="muted">No KPIs defined for this agent.</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
