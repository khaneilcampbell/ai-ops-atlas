"""Synthetic ticket generator.

Produces realistic-looking but entirely fictional service desk tickets so the
dashboard can run without any real ITSM data. Output is deterministic for a
given seed and end date.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from .model import (
    CATEGORIES,
    CHANNELS,
    COLUMNS,
    FIRST_LINE_GROUP,
    OPEN_STATUSES,
    PRIORITIES,
)

PRIORITY_WEIGHTS = (0.03, 0.12, 0.55, 0.30)
CATEGORY_WEIGHTS = (0.30, 0.15, 0.20, 0.10, 0.25)
CHANNEL_WEIGHTS = (0.20, 0.25, 0.30, 0.25)

# Median hours to resolve, by priority, before any reassignment penalty.
MEDIAN_RESOLVE_HOURS = {"P1": 1.5, "P2": 3.5, "P3": 9.0, "P4": 28.0}

# Probability the first line resolves a ticket without passing it on.
FIRST_LINE_RESOLVE_PROB = {
    "Access": 0.75,
    "Email": 0.65,
    "Hardware": 0.35,
    "Network": 0.20,
    "Software": 0.45,
}

SECOND_LINE_GROUP = {
    "Access": "Identity and Access",
    "Email": "Applications",
    "Hardware": "Desktop Support",
    "Network": "Network Operations",
    "Software": "Applications",
}

KB_LINK_PROB = {"Access": 0.70, "Email": 0.60, "Hardware": 0.35, "Network": 0.25, "Software": 0.50}

# Issues per category, most common first. Frequencies follow a Zipf-like curve
# so a handful of issues dominate, as they do on a real service desk.
ISSUES = {
    "Access": (
        "Password reset",
        "Account locked out",
        "MFA device change",
        "Shared mailbox access request",
        "Group membership change",
        "New starter account setup",
    ),
    "Email": (
        "Mailbox full",
        "Outlook not syncing",
        "Phishing email reported",
        "Distribution list change",
        "Calendar delegation issue",
    ),
    "Hardware": (
        "Laptop running slowly",
        "Docking station not detected",
        "Printer not printing",
        "Monitor flickering",
        "Laptop battery not charging",
        "Headset not working",
    ),
    "Network": (
        "VPN will not connect",
        "Wi-Fi drops in office",
        "Cannot reach file share",
        "Slow internet connection",
    ),
    "Software": (
        "Application install request",
        "Teams call quality poor",
        "Licence assignment request",
        "Browser crashes on launch",
        "Excel add-in missing",
        "Software update failed",
    ),
}

AGENTS_PER_GROUP = {
    FIRST_LINE_GROUP: 8,
    "Desktop Support": 4,
    "Identity and Access": 3,
    "Network Operations": 3,
    "Applications": 4,
}

AGENT_PREFIX = {
    FIRST_LINE_GROUP: "SD",
    "Desktop Support": "DS",
    "Identity and Access": "IA",
    "Network Operations": "NO",
    "Applications": "AP",
}


def _zipf_weights(n: int) -> np.ndarray:
    w = 1.0 / np.arange(1, n + 1)
    return w / w.sum()


def _kb_id(category: str, issue_index: int) -> str:
    return f"KB{CATEGORIES.index(category) + 1:02d}{issue_index + 1:03d}"


def generate_tickets(
    days: int = 120,
    end: date | None = None,
    seed: int = 42,
    weekday_volume: float = 45.0,
    weekend_volume: float = 8.0,
) -> pd.DataFrame:
    """Generate ``days`` days of synthetic tickets ending just before ``end``.

    ``end`` is the as-of moment (midnight at the start of that date). Tickets whose
    simulated resolution falls after it are left open.
    """
    if days < 1:
        raise ValueError("days must be at least 1")
    end = end or date.today()
    as_of = datetime.combine(end, time.min)
    start = as_of - timedelta(days=days)
    rng = np.random.default_rng(seed)

    rows = []
    for d in range(days):
        day = start + timedelta(days=d)
        weekend = day.weekday() >= 5
        count = rng.poisson(weekend_volume if weekend else weekday_volume)
        for _ in range(count):
            if weekend:
                minutes = rng.integers(0, 24 * 60)
            else:
                # Mostly business hours, with a tail of out-of-hours tickets.
                minutes = (
                    rng.integers(8 * 60, 18 * 60)
                    if rng.random() < 0.9
                    else rng.integers(0, 24 * 60)
                )
            opened = day + timedelta(minutes=int(minutes), seconds=int(rng.integers(0, 60)))
            priority = rng.choice(PRIORITIES, p=PRIORITY_WEIGHTS)
            category = rng.choice(CATEGORIES, p=CATEGORY_WEIGHTS)
            issues = ISSUES[category]
            issue_index = int(rng.choice(len(issues), p=_zipf_weights(len(issues))))
            channel = rng.choice(CHANNELS, p=CHANNEL_WEIGHTS)

            # P1s always go straight to a resolver group.
            first_line = priority != "P1" and rng.random() < FIRST_LINE_RESOLVE_PROB[category]
            if first_line:
                group = FIRST_LINE_GROUP
                reassignments = 0
            else:
                group = SECOND_LINE_GROUP[category]
                reassignments = 1 + int(rng.poisson(0.35))

            agent_number = int(rng.integers(1, AGENTS_PER_GROUP[group] + 1))
            assignee = f"{AGENT_PREFIX[group]}-Agent-{agent_number:02d}"

            median = MEDIAN_RESOLVE_HOURS[priority] * (1.0 if first_line else 1.6)
            hours = float(rng.lognormal(np.log(median), 0.75))
            resolved = opened + timedelta(hours=hours)

            if resolved >= as_of:
                resolved_at = pd.NaT
                status = rng.choice(OPEN_STATUSES, p=(0.25, 0.55, 0.20))
                kb = None
            else:
                resolved_at = resolved
                status = "Closed" if as_of - resolved > timedelta(days=3) else "Resolved"
                kb = (
                    _kb_id(category, issue_index) if rng.random() < KB_LINK_PROB[category] else None
                )

            rows.append(
                {
                    "opened_at": opened,
                    "resolved_at": resolved_at,
                    "status": str(status),
                    "priority": str(priority),
                    "category": str(category),
                    "short_description": issues[issue_index],
                    "channel": str(channel),
                    "assignment_group": group,
                    "assignee": assignee,
                    "reassignment_count": reassignments,
                    "kb_article_id": kb,
                }
            )

    df = pd.DataFrame(rows, columns=[c for c in COLUMNS if c != "ticket_id"])
    df = df.sort_values("opened_at", kind="stable").reset_index(drop=True)
    df.insert(0, "ticket_id", [f"INC{10001 + i:07d}" for i in range(len(df))])
    df["opened_at"] = pd.to_datetime(df["opened_at"])
    df["resolved_at"] = pd.to_datetime(df["resolved_at"])
    df["reassignment_count"] = df["reassignment_count"].astype("int64")
    return df


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic service desk tickets.")
    parser.add_argument("--days", type=int, default=120, help="number of days to simulate")
    parser.add_argument("--seed", type=int, default=42, help="random seed")
    parser.add_argument(
        "--end",
        type=date.fromisoformat,
        default=None,
        help="as-of date, YYYY-MM-DD (default today)",
    )
    parser.add_argument(
        "--out", type=Path, default=Path("data/sample/tickets.csv"), help="output CSV path"
    )
    args = parser.parse_args(argv)

    df = generate_tickets(days=args.days, end=args.end, seed=args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} synthetic tickets to {args.out}")


if __name__ == "__main__":
    main()
