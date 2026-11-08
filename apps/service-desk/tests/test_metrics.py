import pandas as pd
import pytest

from service_desk_dashboard import metrics
from service_desk_dashboard.data import validate_tickets

AS_OF = pd.Timestamp("2026-03-10 00:00")


def ticket(i, opened, resolved=None, **overrides):
    row = {
        "ticket_id": f"INC{i:07d}",
        "opened_at": opened,
        "resolved_at": resolved,
        "status": "Closed" if resolved else "In Progress",
        "priority": "P3",
        "category": "Access",
        "short_description": "Password reset",
        "channel": "Phone",
        "assignment_group": "Service Desk",
        "assignee": "SD-Agent-01",
        "reassignment_count": 0,
        "kb_article_id": None,
    }
    row.update(overrides)
    return row


@pytest.fixture
def small():
    rows = [
        # P3 target 24h: met, first contact, KB linked.
        ticket(1, "2026-03-01 09:00", "2026-03-01 10:00", kb_article_id="KB01001"),
        # P3 resolved in 30h: breached, reassigned to second line.
        ticket(
            2,
            "2026-03-01 09:00",
            "2026-03-02 15:00",
            assignment_group="Identity and Access",
            assignee="IA-Agent-01",
            reassignment_count=1,
        ),
        # P1 target 4h: met, but second line so not first contact.
        ticket(
            3,
            "2026-03-02 09:00",
            "2026-03-02 11:00",
            priority="P1",
            category="Network",
            short_description="VPN will not connect",
            assignment_group="Network Operations",
            assignee="NO-Agent-01",
            reassignment_count=1,
        ),
        # Open P2 opened 9 days before as_of: past its 8h target.
        ticket(4, "2026-03-01 00:00", priority="P2"),
        # Open P4 opened 12h before as_of: within its 72h target.
        ticket(5, "2026-03-09 12:00", priority="P4", status="New"),
    ]
    return validate_tickets(pd.DataFrame(rows))


def test_kpis(small):
    k = metrics.kpis(small, AS_OF)
    assert (k.opened, k.resolved, k.open_backlog, k.open_breached) == (5, 3, 2, 1)
    assert k.sla_compliance_pct == pytest.approx(66.7)
    assert k.fcr_pct == pytest.approx(33.3)
    assert k.kb_coverage_pct == pytest.approx(33.3)
    assert k.median_resolve_hours == 2.0


def test_rates_are_none_without_resolved_tickets(small):
    k = metrics.kpis(small[small["status"] != "Closed"], AS_OF)
    assert k.sla_compliance_pct is None
    assert k.fcr_pct is None
    assert k.kb_coverage_pct is None
    assert k.median_resolve_hours is None


def test_empty_selection(small):
    empty = small.iloc[0:0]
    assert metrics.kpis(empty, AS_OF).opened == 0
    assert metrics.daily_flow(empty, AS_OF).empty
    assert metrics.top_issues(empty).empty
    assert metrics.open_sla_breaches(empty, AS_OF).empty


def test_daily_flow(small):
    flow = metrics.daily_flow(small, AS_OF).set_index("date")
    assert flow.loc["2026-03-01", "opened"] == 3
    assert flow.loc["2026-03-01", "resolved"] == 1
    assert flow.loc["2026-03-01", "backlog"] == 2
    assert flow.loc["2026-03-02", "backlog"] == 1
    assert flow.loc["2026-03-10", "backlog"] == 2
    assert flow["opened"].sum() == 5


def test_daily_flow_backlog_matches_open_count(synthetic):
    as_of = pd.Timestamp("2026-01-31")
    flow = metrics.daily_flow(synthetic, as_of)
    assert flow["backlog"].iloc[-1] == metrics.is_open(synthetic).sum()


def test_backlog_ageing(small):
    ageing = metrics.backlog_ageing(small, AS_OF)
    counts = ageing.groupby("age_bucket")["tickets"].sum()
    assert counts["< 1 day"] == 1
    assert counts["7-14 days"] == 1
    assert counts.sum() == 2


def test_sla_by_priority(small):
    table = metrics.sla_by_priority(small).set_index("priority")
    assert table.loc["P3", "resolved"] == 2
    assert table.loc["P3", "compliance_pct"] == 50.0
    assert table.loc["P1", "compliance_pct"] == 100.0
    assert pd.isna(table.loc["P2", "compliance_pct"])


def test_open_sla_breaches(small):
    breaches = metrics.open_sla_breaches(small, AS_OF)
    assert list(breaches["ticket_id"]) == ["INC0000004"]
    assert breaches.loc[0, "overrun_hours"] == pytest.approx(9 * 24 - 8)


def test_top_issues(small):
    top = metrics.top_issues(small, n=1)
    assert top.loc[0, "short_description"] == "Password reset"
    assert top.loc[0, "tickets"] == 4
    assert top.loc[0, "kb_linked_pct"] == 50.0


def test_kb_coverage_by_category(small):
    cov = metrics.kb_coverage_by_category(small).set_index("category")
    assert cov.loc["Access", "coverage_pct"] == 50.0
    assert cov.loc["Network", "coverage_pct"] == 0.0


def test_workload(small):
    by_group = metrics.workload(small, AS_OF).set_index("assignment_group")
    assert by_group.loc["Service Desk", "open"] == 2
    assert by_group.loc["Service Desk", "open_breached"] == 1
    assert by_group.loc["Service Desk", "resolved"] == 1
    with pytest.raises(ValueError):
        metrics.workload(small, AS_OF, by="category")


def test_data_as_of(small):
    assert metrics.data_as_of(small) == pd.Timestamp("2026-03-09 12:00")
