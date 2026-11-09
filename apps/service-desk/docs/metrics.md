# Metric definitions

Every number on the dashboard is computed from the loaded tickets with the definitions below (code: `src/service_desk_dashboard/metrics.py`). When a rate has nothing to divide by, the dashboard shows `n/a` rather than a value.

**Selection.** Sidebar filters select tickets by the date they were opened, priority, category and assignment group. All metrics use only the selected tickets.

**As of.** The moment the data describes. For synthetic data it is midnight at the start of today. For a loaded file it is the latest `opened_at` or `resolved_at` in the file. Ages and open breaches are measured to this moment.

**Open / resolved.** Open means status `New`, `In Progress` or `On Hold`. Resolved means `Resolved` or `Closed`.

## Headline figures

| Metric | Definition |
| --- | --- |
| Tickets opened | Number of selected tickets. |
| Tickets resolved | Selected tickets that are resolved. |
| Open backlog | Selected tickets that are open. |
| Open and past SLA | Open tickets whose age (as of minus `opened_at`) exceeds their priority's resolution target. |
| SLA compliance | Resolved tickets with resolution time ≤ target, divided by resolved tickets. Resolution time is `resolved_at` minus `opened_at` in calendar hours. |
| First contact resolution | Resolved tickets with `assignment_group` = `Service Desk` and `reassignment_count` = 0, divided by resolved tickets. This is a first line resolution measure; it does not know whether the fix happened during the first call. |
| Knowledge coverage | Resolved tickets with a `kb_article_id`, divided by resolved tickets. |
| Median time to resolve | Median resolution time of resolved tickets, in hours. |

## Volume and backlog

- **Opened and resolved per week**: count of `opened_at` and `resolved_at` per calendar week starting Monday. The current week is partial.
- **Open backlog at end of day**: for each day, selected tickets opened on or before that day minus those resolved on or before it.
- **Contact channel**: share of selected tickets by `channel`.

## SLA

- **By priority**: resolved count, count within target, compliance %, median and 90th percentile resolution hours.
- **Open tickets past SLA**: open tickets past target, with age, target and overrun (age minus target) in hours, largest overrun first.

## Backlog ageing

Open tickets bucketed by age: under 1 day, 1 to 3, 3 to 7, 7 to 14 and 14 days or more (lower bound inclusive), split by priority.

## Issues and knowledge

- **Top recurring issues**: the ten most frequent `category` and `short_description` pairs, their share of selected tickets, and the share of their resolved tickets that link a knowledge article. A frequent issue with low KB linking is a candidate for a new or improved article.
- **Knowledge coverage by category**: knowledge coverage as defined above, per category.

## Workload

Per assignment group and per assignee: open tickets, open tickets past SLA and resolved tickets. Open tickets count against the group that currently holds them; resolved tickets against the group that resolved them.
