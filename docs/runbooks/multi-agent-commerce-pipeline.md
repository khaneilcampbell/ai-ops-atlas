# Runbooks: Multi-Agent Commerce Pipeline

Repository: [khaneilcampbell/multi-agent-commerce-pipeline](https://github.com/khaneilcampbell/multi-agent-commerce-pipeline). Everything except CI runs on the Linux VPS from the repository folder (`/root/multi-agent-commerce-pipeline` in the documented setup). Commands come from `run.sh`, `loop.sh`, the README and `docs/threat-model.md`. Atlas has no live data for the VPS agents yet, so check them on the VPS.

## Common checks

- Service: `systemctl status commerce-pipeline`
- Logs: `tail -f logs/loop.log` and `logs/loop_errors.log`
- Daily summary: `./run.sh phase7` (publishes, failure rate, stuck queue rows, undelivered orders)
- Credentials: `./run.sh preflight` (exit 0 fine, 1 needs a person, 75 network, try later)
- Database: `sqlite3 outputs/pipeline.db ".tables"`; if locked, `fuser outputs/pipeline.db`

## Autonomous Loop

`loop.sh`, run by the `commerce-pipeline` systemd unit (`commerce-pipeline.service`).

- **Healthy:** `systemctl status commerce-pipeline` is active and `logs/loop.log` has a cycle in the last hour (or says maintain mode until Monday).
- **Run it:** `systemctl start commerce-pipeline`, or one cycle by hand with `./loop.sh --once`.
- **When it fails:** a stopped service with exit 78 is a configuration error (bad credential or missing `.env`); fix what `logs/loop.log` names and `systemctl restart commerce-pipeline`. systemd gives up after 5 crashes in 10 minutes. An alert email arrives after a phase fails twice in a row.
- **Stop it:** `systemctl stop commerce-pipeline` (or `kill $(cat logs/loop.pid)` when run by hand).

## Brand Builder crew

`scripts/brand_crew.py`: the six CrewAI agents (Niche Scout, Market Research Analyst, Brand Strategist, Visual Identity Director, Copywriter and SEO Strategist, Launch Asset Planner) run together as Phase 1.

- **Healthy:** `outputs/brand_guide.md` is updated at most every 7 days and `run_log` has a recent Phase 1 success.
- **Run it:** `./run.sh phase1`.
- **When it fails:** it exits at once if `ANTHROPIC_API_KEY` or `SERPER_API_KEY` is missing from `.env`. Otherwise read the CrewAI output in `logs/loop.log`. Each agent has a `max_iter` cap, so a stuck agent ends instead of looping.
- **Stop it:** stop the loop. The crew changes nothing outside `outputs/`.

## Canva Mockup Generator

`scripts/canva_image_generator.py` (Phase 3).

- **Healthy:** each build or design cycle designs one product and adds a queue row.
- **Run it:** `./run.sh phase3 "<product>"`.
- **When it fails:** needs `ANTHROPIC_API_KEY` and a Canva token (`./run.sh canva-auth` sets it up). A product that fails Phases 3B to 5 is retried at lower priority and marked failed after 3 attempts.
- **Stop it:** stop the loop.

## Stripe Publisher

`scripts/stripe_publisher.py` (Phase 5). Saves each product as a draft.

- **Healthy:** drafts appear in `./run.sh approve --list`; nothing goes live without approval while `STORE_PUBLISH_STATUS=draft`.
- **Run it:** `./run.sh phase5 "<product>"`. Review with `./run.sh approve --preview "<product>"`, then `./run.sh approve "<product>"`.
- **When it fails:** it refuses to publish a product with no template link. Retries are safe: it searches Stripe for the queue id and sends an idempotency key.
- **Stop it:** stop the loop, or lower `WEEKLY_PUBLISH_LIMIT` in `.env`.

## SEO Maintainer

`scripts/seo_analyzer.py` (Phase 6).

- **Healthy:** `seo_review` rows record before and after tags for each published listing.
- **Run it:** `./run.sh phase6 "<product>"` (analyzes, saves tags and rebuilds the storefront). To see suggestions without saving them, run `.venv/bin/python scripts/seo_analyzer.py "<product>" --analyze-only`.
- **When it fails:** without `SERPER_API_KEY` it skips competitor research. A bad change can be reverted from the storefront's `gh-pages` history.
- **Stop it:** stop the loop.

## Health Dashboard Report

`scripts/health_dashboard.py` (Phase 7).

- **Run it:** `./run.sh phase7`.
- **When it fails:** "No database found" means `./run.sh db-init` has not run.

## Order Delivery

`scripts/order_delivery.py`. Emails buyers their template link.

- **Healthy:** every paid checkout has a `deliveries` row; `./run.sh phase7` lists undelivered orders.
- **Run it:** `./run.sh deliver` (add `--dry-run` to see what would be sent). The loop runs it every cycle and every 10 minutes while sleeping.
- **When it fails:** check `EMAIL_FROM`, `EMAIL_SMTP_PASS` and `SMTP_HOST` in `.env`. Failed sends retry on the next cycle; a checkout line is never emailed twice.
- **Stop it:** stopping the loop also stops delivery, so paying buyers wait. Prefer fixing SMTP.

## Sales Sync, Daily Email Digest and Database Backup

`scripts/sales_tracker.py`, `scripts/email_digest.py`, `scripts/backup_db.py`. Run once per UTC day from the loop.

- **Run them:** `./run.sh sales` (`--full` to resync), `./run.sh digest`, `./run.sh backup`.
- **Backups:** dated copies in `backups/`, 14 days kept (`BACKUP_KEEP_DAYS`). They stay on the VPS until copied elsewhere.

## Pipeline Tests

`.github/workflows/tests.yml`: compile, ruff, shell syntax, pytest.

- **Healthy:** latest run on `main` is green.
- **When it fails:** reproduce with `.venv/bin/pytest -q` and `.venv/bin/python -m compileall -q scripts tests`.
- **Stop it:** disable the workflow in Actions.
