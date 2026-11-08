"""Ticket data model: column names, allowed values and SLA targets.

See docs/data-model.md for the field-by-field description.
"""

from __future__ import annotations

STATUSES = ("New", "In Progress", "On Hold", "Resolved", "Closed")
OPEN_STATUSES = ("New", "In Progress", "On Hold")
PRIORITIES = ("P1", "P2", "P3", "P4")
CATEGORIES = ("Access", "Email", "Hardware", "Network", "Software")
CHANNELS = ("Chat", "Email", "Phone", "Portal")
FIRST_LINE_GROUP = "Service Desk"
ASSIGNMENT_GROUPS = (
    FIRST_LINE_GROUP,
    "Desktop Support",
    "Identity and Access",
    "Network Operations",
    "Applications",
)

# Resolution targets in calendar hours, measured from opened_at to resolved_at.
SLA_TARGET_HOURS = {"P1": 4, "P2": 8, "P3": 24, "P4": 72}

COLUMNS = (
    "ticket_id",
    "opened_at",
    "resolved_at",
    "status",
    "priority",
    "category",
    "short_description",
    "channel",
    "assignment_group",
    "assignee",
    "reassignment_count",
    "kb_article_id",
)

ENUM_COLUMNS = {
    "status": STATUSES,
    "priority": PRIORITIES,
    "category": CATEGORIES,
    "channel": CHANNELS,
    "assignment_group": ASSIGNMENT_GROUPS,
}
