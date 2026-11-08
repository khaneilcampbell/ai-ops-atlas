"""Streamlit dashboard.

Run with:  streamlit run streamlit_app.py  (or this file directly)
"""

from __future__ import annotations

import os
from datetime import date

import pandas as pd
import plotly.express as px
import streamlit as st

from service_desk_dashboard import metrics
from service_desk_dashboard.data import TicketDataError, load_tickets, validate_tickets
from service_desk_dashboard.generate import generate_tickets
from service_desk_dashboard.model import ASSIGNMENT_GROUPS, CATEGORIES, PRIORITIES

METRICS_DOC = (
    "https://github.com/khancam15/Service-Desk-Intelligence-Dashboard/blob/main/docs/metrics.md"
)
PRIORITY_COLORS = {"P1": "#c0392b", "P2": "#e67e22", "P3": "#2e86c1", "P4": "#7f8c8d"}


@st.cache_data(show_spinner="Loading tickets...")
def _load_csv(path: str, mtime: float) -> pd.DataFrame:
    # mtime is part of the cache key so an updated file is picked up.
    return load_tickets(path)


@st.cache_data(show_spinner="Generating synthetic tickets...")
def _synthetic(days: int, seed: int, end: date) -> pd.DataFrame:
    return validate_tickets(generate_tickets(days=days, seed=seed, end=end))


def load_data() -> tuple[pd.DataFrame, pd.Timestamp, str]:
    csv_path = os.environ.get("TICKETS_CSV", "").strip()
    if csv_path:
        try:
            df = _load_csv(csv_path, os.path.getmtime(csv_path))
        except (OSError, TicketDataError) as exc:
            st.error(f"Could not load ticket data from `TICKETS_CSV`.\n\n{exc}")
            st.stop()
        return df, metrics.data_as_of(df), f"File: {os.path.basename(csv_path)}"

    days = int(os.environ.get("SYNTHETIC_DAYS", "120"))
    seed = int(os.environ.get("SYNTHETIC_SEED", "42"))
    today = date.today()
    df = _synthetic(days, seed, today)
    return df, pd.Timestamp(today), "Synthetic data (no real tickets)"


def _fmt(value: float | int | None, suffix: str = "") -> str:
    return "n/a" if value is None else f"{value:,}{suffix}"


def sidebar_filters(df: pd.DataFrame) -> pd.DataFrame:
    st.sidebar.header("Filters")
    if df.empty:
        return df
    first = df["opened_at"].min().date()
    last = df["opened_at"].max().date()
    picked = st.sidebar.date_input(
        "Opened between", value=(first, last), min_value=first, max_value=last
    )
    start, end = picked if isinstance(picked, tuple) and len(picked) == 2 else (first, last)
    priorities = st.sidebar.multiselect("Priority", PRIORITIES, default=list(PRIORITIES))
    categories = st.sidebar.multiselect("Category", CATEGORIES, default=list(CATEGORIES))
    groups = st.sidebar.multiselect(
        "Assignment group", ASSIGNMENT_GROUPS, default=list(ASSIGNMENT_GROUPS)
    )
    opened = df["opened_at"].dt.date
    mask = (
        (opened >= start)
        & (opened <= end)
        & df["priority"].isin(priorities)
        & df["category"].isin(categories)
        & df["assignment_group"].isin(groups)
    )
    return df[mask]


def kpi_row(k: metrics.Kpis) -> None:
    row1 = st.columns(4)
    row1[0].metric("Tickets opened", _fmt(k.opened))
    row1[1].metric("Tickets resolved", _fmt(k.resolved))
    row1[2].metric("Open backlog", _fmt(k.open_backlog))
    row1[3].metric("Open and past SLA", _fmt(k.open_breached))
    row2 = st.columns(4)
    row2[0].metric("SLA compliance", _fmt(k.sla_compliance_pct, "%"))
    row2[1].metric("First contact resolution", _fmt(k.fcr_pct, "%"))
    row2[2].metric("Knowledge coverage", _fmt(k.kb_coverage_pct, "%"))
    row2[3].metric("Median time to resolve", _fmt(k.median_resolve_hours, " h"))


def volume_tab(df: pd.DataFrame, as_of: pd.Timestamp) -> None:
    flow = metrics.daily_flow(df, as_of)
    if flow.empty:
        st.info("No tickets in the current selection.")
        return
    weekly = flow.set_index("date")[["opened", "resolved"]].resample("W-MON", label="left").sum()
    fig = px.bar(
        weekly.reset_index().melt(id_vars="date", var_name="flow", value_name="tickets"),
        x="date",
        y="tickets",
        color="flow",
        barmode="group",
        title="Tickets opened and resolved per week",
        labels={"date": "Week starting", "tickets": "Tickets", "flow": ""},
    )
    st.plotly_chart(fig)
    fig = px.line(
        flow,
        x="date",
        y="backlog",
        title="Open backlog at end of day",
        labels={"date": "Date", "backlog": "Open tickets"},
    )
    st.plotly_chart(fig)
    mix = metrics.channel_mix(df)
    st.plotly_chart(
        px.pie(mix, names="channel", values="tickets", title="Contact channel", hole=0.5),
    )


def sla_tab(df: pd.DataFrame, as_of: pd.Timestamp) -> None:
    table = metrics.sla_by_priority(df)
    st.dataframe(
        table,
        hide_index=True,
        column_config={
            "target_hours": "Target (h)",
            "compliance_pct": st.column_config.NumberColumn("Compliance %", format="%.1f"),
            "median_hours": "Median (h)",
            "p90_hours": "90th pct (h)",
        },
    )
    chartable = table.dropna(subset=["compliance_pct"])
    if not chartable.empty:
        fig = px.bar(
            chartable,
            x="priority",
            y="compliance_pct",
            color="priority",
            color_discrete_map=PRIORITY_COLORS,
            range_y=[0, 100],
            title="Resolution SLA compliance by priority (%)",
            labels={"priority": "Priority", "compliance_pct": "Compliance %"},
        )
        st.plotly_chart(fig)
    breaches = metrics.open_sla_breaches(df, as_of)
    st.subheader(f"Open tickets past SLA ({len(breaches)})")
    st.dataframe(breaches, hide_index=True)


def ageing_tab(df: pd.DataFrame, as_of: pd.Timestamp) -> None:
    ageing = metrics.backlog_ageing(df, as_of)
    if ageing["tickets"].sum() == 0:
        st.info("No open tickets in the current selection.")
        return
    fig = px.bar(
        ageing,
        x="age_bucket",
        y="tickets",
        color="priority",
        color_discrete_map=PRIORITY_COLORS,
        category_orders={"age_bucket": list(metrics.AGE_BUCKETS), "priority": list(PRIORITIES)},
        title="Open backlog by age",
        labels={"age_bucket": "Age", "tickets": "Open tickets", "priority": "Priority"},
    )
    st.plotly_chart(fig)


def issues_tab(df: pd.DataFrame) -> None:
    st.subheader("Top recurring issues")
    st.dataframe(
        metrics.top_issues(df, n=10),
        hide_index=True,
        column_config={
            "short_description": "Issue",
            "share_pct": "Share %",
            "kb_linked_pct": "KB linked %",
        },
    )
    coverage = metrics.kb_coverage_by_category(df).dropna(subset=["coverage_pct"])
    if not coverage.empty:
        fig = px.bar(
            coverage,
            x="coverage_pct",
            y="category",
            orientation="h",
            range_x=[0, 100],
            title="Knowledge coverage by category (%)",
            labels={"coverage_pct": "Resolved with a KB article %", "category": ""},
        )
        st.plotly_chart(fig)


def workload_tab(df: pd.DataFrame, as_of: pd.Timestamp) -> None:
    by_group = metrics.workload(df, as_of, by="assignment_group")
    fig = px.bar(
        by_group.melt(
            id_vars="assignment_group", value_vars=["open", "open_breached"], var_name="measure"
        ),
        x="assignment_group",
        y="value",
        color="measure",
        barmode="group",
        title="Open tickets by assignment group",
        labels={"assignment_group": "", "value": "Tickets", "measure": ""},
    )
    st.plotly_chart(fig)
    st.subheader("By assignee")
    st.dataframe(metrics.workload(df, as_of, by="assignee"), hide_index=True)


def main() -> None:
    st.set_page_config(page_title="Service Desk Intelligence", page_icon="📊", layout="wide")
    df, as_of, source = load_data()
    st.title("Service Desk Intelligence")
    st.caption(
        f"{source} · data as of {as_of:%Y-%m-%d %H:%M} · [Metric definitions]({METRICS_DOC})"
    )

    selection = sidebar_filters(df)
    kpi_row(metrics.kpis(selection, as_of))

    tabs = st.tabs(
        ["Volume and backlog", "SLA", "Backlog ageing", "Issues and knowledge", "Workload"]
    )
    with tabs[0]:
        volume_tab(selection, as_of)
    with tabs[1]:
        sla_tab(selection, as_of)
    with tabs[2]:
        ageing_tab(selection, as_of)
    with tabs[3]:
        issues_tab(selection)
    with tabs[4]:
        workload_tab(selection, as_of)


if __name__ == "__main__":
    main()
