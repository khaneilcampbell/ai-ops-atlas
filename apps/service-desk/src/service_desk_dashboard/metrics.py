"""Metric calculations. Every metric here is defined in docs/metrics.md.

All functions are pure: they take a validated tickets DataFrame (see data.py)
and return plain values or DataFrames. Rates return ``None`` when there is
nothing to divide by, so the dashboard never shows a made-up number.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .model import FIRST_LINE_GROUP, OPEN_STATUSES, SLA_TARGET_HOURS

AGE_BUCKETS = ("< 1 day", "1-3 days", "3-7 days", "7-14 days", "14+ days")
_AGE_EDGES_DAYS = (0, 1, 3, 7, 14, float("inf"))


def _pct(numerator: int | float, denominator: int | float) -> float | None:
    return None if denominator == 0 else round(100.0 * numerator / denominator, 1)


def data_as_of(df: pd.DataFrame) -> pd.Timestamp:
    """The latest moment the data describes: the newest open or resolve timestamp."""
    if df.empty:
        return pd.Timestamp.now().floor("s")
    latest = df["opened_at"].max()
    latest_resolved = df["resolved_at"].max()
    if pd.notna(latest_resolved) and latest_resolved > latest:
        latest = latest_resolved
    return latest


def is_open(df: pd.DataFrame) -> pd.Series:
    return df["status"].isin(OPEN_STATUSES)


def resolved(df: pd.DataFrame) -> pd.DataFrame:
    return df[~is_open(df)]


def resolution_hours(df: pd.DataFrame) -> pd.Series:
    return (df["resolved_at"] - df["opened_at"]).dt.total_seconds() / 3600.0


def sla_target_hours(df: pd.DataFrame) -> pd.Series:
    return df["priority"].map(SLA_TARGET_HOURS).astype(float)


def sla_met(df: pd.DataFrame) -> pd.Series:
    """True where a resolved ticket was resolved within its priority's target."""
    r = resolved(df)
    return resolution_hours(r) <= sla_target_hours(r)


def first_contact_resolved(df: pd.DataFrame) -> pd.Series:
    """True where a resolved ticket was closed by the first line with no reassignment."""
    r = resolved(df)
    return (r["assignment_group"] == FIRST_LINE_GROUP) & (r["reassignment_count"] == 0)


def open_age_hours(df: pd.DataFrame, as_of: pd.Timestamp) -> pd.Series:
    o = df[is_open(df)]
    return (as_of - o["opened_at"]).dt.total_seconds() / 3600.0


@dataclass(frozen=True)
class Kpis:
    opened: int
    resolved: int
    open_backlog: int
    open_breached: int
    sla_compliance_pct: float | None
    fcr_pct: float | None
    kb_coverage_pct: float | None
    median_resolve_hours: float | None


def kpis(df: pd.DataFrame, as_of: pd.Timestamp) -> Kpis:
    r = resolved(df)
    o = df[is_open(df)]
    hours = resolution_hours(r)
    breached = open_age_hours(df, as_of) > sla_target_hours(o)
    return Kpis(
        opened=len(df),
        resolved=len(r),
        open_backlog=len(o),
        open_breached=int(breached.sum()),
        sla_compliance_pct=_pct(int(sla_met(df).sum()), len(r)),
        fcr_pct=_pct(int(first_contact_resolved(df).sum()), len(r)),
        kb_coverage_pct=_pct(int(r["kb_article_id"].notna().sum()), len(r)),
        median_resolve_hours=None if r.empty else round(float(hours.median()), 1),
    )


def daily_flow(df: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    """Tickets opened and resolved per day, and the open backlog at the end of each day."""
    columns = ["date", "opened", "resolved", "backlog"]
    if df.empty:
        return pd.DataFrame(columns=columns)
    days = pd.date_range(df["opened_at"].min().normalize(), as_of.normalize(), freq="D")
    opened = df["opened_at"].dt.normalize().value_counts()
    closed = df["resolved_at"].dropna().dt.normalize().value_counts()
    out = pd.DataFrame({"date": days})
    out["opened"] = out["date"].map(opened).fillna(0).astype(int)
    out["resolved"] = out["date"].map(closed).fillna(0).astype(int)
    # Backlog at the end of day D = opened up to D minus resolved up to D.
    out["backlog"] = (out["opened"].cumsum() - out["resolved"].cumsum()).astype(int)
    return out[columns]


def backlog_ageing(df: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    """Open tickets bucketed by age, split by priority."""
    o = df[is_open(df)].copy()
    o["age_days"] = open_age_hours(df, as_of) / 24.0
    o["age_bucket"] = pd.cut(
        o["age_days"], bins=list(_AGE_EDGES_DAYS), labels=list(AGE_BUCKETS), right=False
    )
    table = (
        o.groupby(["age_bucket", "priority"], observed=False).size().rename("tickets").reset_index()
    )
    table["age_bucket"] = table["age_bucket"].astype(str)
    return table


def sla_by_priority(df: pd.DataFrame) -> pd.DataFrame:
    r = resolved(df).copy()
    r["met"] = sla_met(df)
    r["hours"] = resolution_hours(r)
    rows = []
    for priority, target in SLA_TARGET_HOURS.items():
        p = r[r["priority"] == priority]
        rows.append(
            {
                "priority": priority,
                "target_hours": target,
                "resolved": len(p),
                "met": int(p["met"].sum()),
                "compliance_pct": _pct(int(p["met"].sum()), len(p)),
                "median_hours": None if p.empty else round(float(p["hours"].median()), 1),
                "p90_hours": None if p.empty else round(float(p["hours"].quantile(0.9)), 1),
            }
        )
    return pd.DataFrame(rows)


def open_sla_breaches(df: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    """Open tickets already past their resolution target, oldest overrun first."""
    o = df[is_open(df)].copy()
    o["age_hours"] = open_age_hours(df, as_of)
    o["target_hours"] = sla_target_hours(o)
    o = o[o["age_hours"] > o["target_hours"]]
    o["overrun_hours"] = (o["age_hours"] - o["target_hours"]).round(1)
    o["age_hours"] = o["age_hours"].round(1)
    cols = [
        "ticket_id",
        "priority",
        "category",
        "short_description",
        "assignment_group",
        "assignee",
        "status",
        "age_hours",
        "target_hours",
        "overrun_hours",
    ]
    return o.sort_values("overrun_hours", ascending=False)[cols].reset_index(drop=True)


def kb_coverage_by_category(df: pd.DataFrame) -> pd.DataFrame:
    r = resolved(df)
    g = r.groupby("category").agg(
        resolved=("ticket_id", "size"), with_kb=("kb_article_id", lambda s: int(s.notna().sum()))
    )
    g["coverage_pct"] = [_pct(w, n) for w, n in zip(g["with_kb"], g["resolved"], strict=True)]
    return g.reset_index().sort_values("coverage_pct")


def top_issues(df: pd.DataFrame, n: int = 10) -> pd.DataFrame:
    """Most frequent issues, with how often each is resolved with a KB article."""
    if df.empty:
        return pd.DataFrame(
            columns=["category", "short_description", "tickets", "share_pct", "kb_linked_pct"]
        )
    g = df.groupby(["category", "short_description"])
    out = g.size().rename("tickets").reset_index()
    r = resolved(df)
    kb = r.groupby(["category", "short_description"]).agg(
        resolved=("ticket_id", "size"), with_kb=("kb_article_id", lambda s: int(s.notna().sum()))
    )
    out = out.merge(kb.reset_index(), on=["category", "short_description"], how="left")
    out[["resolved", "with_kb"]] = out[["resolved", "with_kb"]].fillna(0).astype(int)
    out["share_pct"] = [_pct(t, len(df)) for t in out["tickets"]]
    out["kb_linked_pct"] = [
        _pct(w, n) for w, n in zip(out["with_kb"], out["resolved"], strict=True)
    ]
    out = out.sort_values(["tickets", "short_description"], ascending=[False, True]).head(n)
    return out[
        ["category", "short_description", "tickets", "share_pct", "kb_linked_pct"]
    ].reset_index(drop=True)


def workload(df: pd.DataFrame, as_of: pd.Timestamp, by: str = "assignment_group") -> pd.DataFrame:
    """Open, breached and resolved counts per assignment group or assignee."""
    if by not in ("assignment_group", "assignee"):
        raise ValueError("by must be 'assignment_group' or 'assignee'")
    open_mask = is_open(df)
    breached = pd.Series(False, index=df.index)
    breached[open_mask] = open_age_hours(df, as_of) > sla_target_hours(df[open_mask])
    frame = pd.DataFrame(
        {
            by: df[by],
            "open": open_mask.astype(int),
            "open_breached": breached.astype(int),
            "resolved": (~open_mask).astype(int),
        }
    )
    out = frame.groupby(by).sum().reset_index()
    return out.sort_values(["open", "resolved"], ascending=False).reset_index(drop=True)


def channel_mix(df: pd.DataFrame) -> pd.DataFrame:
    out = df["channel"].value_counts().rename_axis("channel").rename("tickets").reset_index()
    out["share_pct"] = [_pct(t, len(df)) for t in out["tickets"]]
    return out
