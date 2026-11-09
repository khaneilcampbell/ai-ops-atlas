# Data model

The dashboard reads one table of tickets. Each row is one incident or request. A CSV with these columns (header row required, any column order, extra columns ignored) can be loaded with `TICKETS_CSV=path/to/tickets.csv`. The loader validates every rule below and lists all problems before refusing the file.

| Column | Type | Required | Rules |
| --- | --- | --- | --- |
| `ticket_id` | text | yes | Unique, for example `INC0010001`. |
| `opened_at` | timestamp | yes | When the ticket was logged. ISO 8601 recommended (`2026-03-01 09:15:00`). |
| `resolved_at` | timestamp | for resolved tickets | When the ticket was resolved. Empty while the ticket is open. Must not be earlier than `opened_at`. |
| `status` | enum | yes | `New`, `In Progress`, `On Hold` (open) or `Resolved`, `Closed` (resolved). Open tickets must have no `resolved_at`; resolved ones must have one. |
| `priority` | enum | yes | `P1`, `P2`, `P3`, `P4`. Drives the SLA target. |
| `category` | enum | yes | `Access`, `Email`, `Hardware`, `Network`, `Software`. |
| `short_description` | text | yes | Normalised issue summary. Recurring issue analysis groups on this field, so use a consistent value per issue type (for example the ITSM "symptom" or template name), not free text. |
| `channel` | enum | yes | `Chat`, `Email`, `Phone`, `Portal`. |
| `assignment_group` | enum | yes | Group that resolved the ticket, or currently holds it if open: `Service Desk` (first line), `Desktop Support`, `Identity and Access`, `Network Operations`, `Applications`. |
| `assignee` | text | yes | Pseudonymous agent identifier. Do not use real names in shared data. |
| `reassignment_count` | integer | yes | Number of times the ticket moved between groups. 0 or more. |
| `kb_article_id` | text | no | Knowledge article linked at resolution. Empty if none. |

## SLA targets

Resolution targets in calendar hours from `opened_at` to `resolved_at`:

| Priority | Target |
| --- | --- |
| P1 | 4 h |
| P2 | 8 h |
| P3 | 24 h |
| P4 | 72 h |

Targets live in `src/service_desk_dashboard/model.py` (`SLA_TARGET_HOURS`). Business hours calendars, pauses while on hold and response (as opposed to resolution) targets are not modelled yet.

## Adapting to another ITSM tool

Allowed categories, channels and groups are defined in `model.py`. To load an export from ServiceNow, Jira Service Management or similar, map its fields to the columns above in a small preprocessing step, or adjust the enums in `model.py` to match your instance. Anonymise the export first: see [SECURITY.md](../SECURITY.md).

## Synthetic data

`sdd-generate` (or `python -m service_desk_dashboard.generate`) writes a fictional dataset that follows this model:

```bash
sdd-generate --days 180 --seed 42 --end 2026-10-28 --out data/sample/tickets.csv
```

The same seed and end date always produce the same tickets. The generator simulates weekday and weekend volume, a priority mix weighted towards P3 and P4, a small set of recurring issues per category, first line resolution rates per category, lognormal resolution times and knowledge article linking. None of it is drawn from real ticket data.
