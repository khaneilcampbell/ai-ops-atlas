import pandas as pd
import pytest

from service_desk_dashboard.data import TicketDataError, load_tickets, validate_tickets


def test_round_trip_through_csv(synthetic, tmp_path):
    path = tmp_path / "tickets.csv"
    synthetic.to_csv(path, index=False)
    loaded = load_tickets(path)
    assert len(loaded) == len(synthetic)
    assert loaded["reassignment_count"].dtype == "int64"
    assert pd.api.types.is_datetime64_any_dtype(loaded["opened_at"])
    assert loaded["kb_article_id"].notna().sum() == synthetic["kb_article_id"].notna().sum()


def test_missing_file():
    with pytest.raises(TicketDataError, match="not found"):
        load_tickets("does/not/exist.csv")


def test_missing_columns(synthetic):
    with pytest.raises(TicketDataError, match="Missing required columns: priority"):
        validate_tickets(synthetic.drop(columns=["priority"]))


def test_reports_every_problem(synthetic):
    bad = synthetic.head(20).astype(object)
    bad.loc[0, "priority"] = "P9"
    bad.loc[1, "ticket_id"] = bad.loc[2, "ticket_id"]
    bad.loc[3, "opened_at"] = "not a date"
    bad.loc[4, "reassignment_count"] = -1
    with pytest.raises(TicketDataError) as exc:
        validate_tickets(bad)
    message = str(exc.value)
    for expected in ("priority", "duplicates", "opened_at", "reassignment_count"):
        assert expected in message


def test_status_and_resolved_at_must_agree(synthetic):
    bad = synthetic.copy()
    closed = bad.index[bad["status"] == "Closed"][0]
    bad.loc[closed, "resolved_at"] = pd.NaT
    with pytest.raises(TicketDataError, match="must have resolved_at"):
        validate_tickets(bad)


def test_resolved_before_opened(synthetic):
    bad = synthetic.copy()
    closed = bad.index[bad["status"] == "Closed"][0]
    bad.loc[closed, "resolved_at"] = bad.loc[closed, "opened_at"] - pd.Timedelta(hours=1)
    with pytest.raises(TicketDataError, match="earlier than opened_at"):
        validate_tickets(bad)
