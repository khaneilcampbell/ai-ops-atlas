from datetime import date

import pandas as pd

from service_desk_dashboard.data import validate_tickets
from service_desk_dashboard.generate import generate_tickets, main
from service_desk_dashboard.model import COLUMNS, OPEN_STATUSES


def test_generated_data_matches_model(synthetic):
    assert tuple(synthetic.columns) == COLUMNS
    validated = validate_tickets(synthetic)
    assert len(validated) == len(synthetic)
    assert synthetic["ticket_id"].is_unique


def test_generator_is_deterministic():
    a = generate_tickets(days=10, end=date(2026, 1, 1), seed=1)
    b = generate_tickets(days=10, end=date(2026, 1, 1), seed=1)
    pd.testing.assert_frame_equal(a, b)


def test_nothing_resolved_after_as_of(synthetic):
    as_of = pd.Timestamp("2026-01-31")
    assert (synthetic["opened_at"] < as_of).all()
    assert (synthetic["resolved_at"].dropna() < as_of).all()
    open_rows = synthetic[synthetic["status"].isin(OPEN_STATUSES)]
    assert not open_rows.empty
    assert open_rows["resolved_at"].isna().all()
    assert open_rows["kb_article_id"].isna().all()


def test_cli_writes_csv(tmp_path):
    out = tmp_path / "tickets.csv"
    main(["--days", "5", "--seed", "3", "--end", "2026-02-01", "--out", str(out)])
    assert len(pd.read_csv(out)) > 0
