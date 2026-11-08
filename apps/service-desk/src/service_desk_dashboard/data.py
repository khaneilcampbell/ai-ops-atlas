"""Load and validate ticket data."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .model import COLUMNS, ENUM_COLUMNS, OPEN_STATUSES


class TicketDataError(ValueError):
    """Raised when ticket data does not match the data model."""


def load_tickets(path: str | Path) -> pd.DataFrame:
    """Read a tickets CSV and return a validated, typed DataFrame."""
    path = Path(path)
    if not path.is_file():
        raise TicketDataError(f"Ticket file not found: {path}")
    raw = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[""])
    return validate_tickets(raw)


def validate_tickets(df: pd.DataFrame) -> pd.DataFrame:
    """Check ``df`` against the data model and return a typed copy.

    Raises ``TicketDataError`` listing every problem found.
    """
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise TicketDataError(f"Missing required columns: {', '.join(missing)}")

    out = df[list(COLUMNS)].copy()
    errors: list[str] = []

    if out["ticket_id"].isna().any():
        errors.append("ticket_id has empty values")
    dupes = out["ticket_id"][out["ticket_id"].duplicated()].dropna().unique()
    if len(dupes):
        errors.append(f"ticket_id has duplicates, e.g. {', '.join(map(str, dupes[:5]))}")

    for col in ("opened_at", "resolved_at"):
        parsed = pd.to_datetime(out[col], errors="coerce", format="mixed")
        bad = out[col].notna() & parsed.isna()
        if bad.any():
            errors.append(f"{col} has {int(bad.sum())} unparseable value(s)")
        out[col] = parsed
    if out["opened_at"].isna().any():
        errors.append("opened_at has empty values")

    for col, allowed in ENUM_COLUMNS.items():
        bad_values = sorted(set(out[col].dropna()) - set(allowed))
        if out[col].isna().any():
            errors.append(f"{col} has empty values")
        if bad_values:
            errors.append(f"{col} has unknown value(s): {', '.join(map(str, bad_values[:5]))}")

    counts = pd.to_numeric(out["reassignment_count"], errors="coerce")
    if counts.isna().any() or (counts < 0).any() or (counts % 1 != 0).any():
        errors.append("reassignment_count must be a whole number of 0 or more")
    else:
        out["reassignment_count"] = counts.astype("int64")

    is_open = out["status"].isin(OPEN_STATUSES)
    if (is_open & out["resolved_at"].notna()).any():
        errors.append("open tickets must not have resolved_at")
    if (~is_open & out["status"].notna() & out["resolved_at"].isna()).any():
        errors.append("Resolved and Closed tickets must have resolved_at")
    if (out["resolved_at"] < out["opened_at"]).any():
        errors.append("resolved_at is earlier than opened_at for some tickets")

    if errors:
        raise TicketDataError("Ticket data failed validation:\n- " + "\n- ".join(errors))

    return out.sort_values("opened_at", kind="stable").reset_index(drop=True)
