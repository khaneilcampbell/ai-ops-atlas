# Runbooks: AI-Assisted SOC Brute Force Detection Lab

Repository: [khaneilcampbell/splunk-bruteforce-detection-lab](https://github.com/khaneilcampbell/splunk-bruteforce-detection-lab). Lab setup, the attack simulation and evidence are in its `WALKTHROUGH.md`. Run everything in the isolated lab network only.

## SOC Case Note Automation

`soc_automation.py`. Logs in to Splunk at `https://localhost:8089`, runs the brute-force search and writes a Markdown case note to `notes/`.

- **Run it:** on the Splunk lab VM, `export SPLUNK_USER=... SPLUNK_PASS=...` (a lab account), then `python3 soc_automation.py`.
- **When it fails:** "Set SPLUNK_USER and SPLUNK_PASS" means the variables are missing. A login error means the account or password is wrong or the Splunk management port isn't listening on 8089. No alerts means no account and source crossed 10 failures in any 5 minute bucket. The search sets no time range, so it covers all indexed data.
- **Tests:** `pip install -r requirements-dev.txt && pytest -q` (Splunk is mocked).

## Brute Force Detection Search

`queries/brute_force_detection.spl`. Flags 10 or more EventCode 4625 failures for one account from one source address in a 5 minute bucket, ignoring localhost.

- **Run it:** paste the query into Splunk Search on the lab instance.
- **When it finds nothing:** check the Windows VM's Universal Forwarder is sending `WinEventLog:Security` to `index=main` (`index=main sourcetype="WinEventLog:Security" | head 5`).

## SOC Lab CI

`.github/workflows/ci.yml`.

- **When it fails:** reproduce with `pip install -r requirements-dev.txt && ruff check --select F . && pytest -q`.
- **Stop it:** disable the workflow in Actions.

## Atlas Security Sheet

n8n workflow [Connor Walsh · Security Sheet](https://khancam15.app.n8n.cloud/workflow/ArdLbnah1KgzAh7B), owned by Connor Walsh (Security Detection Lead). Unpublished draft: it runs only when started by hand until Khaneil publishes it, then daily at 7:00am New York time. No AI step.

It reads the repositories in the Atlas catalog (retired ones left out), skips any GitHub doesn't return, archived repos and forks, then makes only GET requests: open Dependabot, code scanning and secret scanning alerts, default-branch protection and rulesets, and the last Actions run. It writes the **Atlas Security Data** Google Sheet (tabs Summary, Alerts, Branch Protection, CI, Run Log) and adds a version of the summary to the Output Library as "Atlas Security Data".

- **Run it:** open the workflow in n8n and press *Execute workflow* (the "Run by Hand" trigger).
- **The sheet:** made on the first run; its id is kept in the n8n data table `connor_security_sheet` (row `sheet_id`). Every later run reuses it. To start a new sheet, delete that row (the old sheet stays in Drive).
- **No duplicates:** Alerts rows are keyed by `alert_key` (`owner/repo:source:number`). A rerun rewrites the same rows. An alert no longer open on GitHub is kept and marked `closed` with `closed_seen_at`, never deleted, and only when that repo's feed answered the run. The Library item keeps one history: every run adds a version, and sending the same execution twice is answered as a duplicate.
- **Feeds not read:** the Summary tab lists them. "off" means GitHub answered 403 or 404, usually because code scanning isn't set up on that repo.
- **Secrets:** secret scanning rows carry the secret type, state and link only; the request asks GitHub to hide the secret value.
- **When it fails:** the n8n error workflow "Flow · 0 Error alerts" emails ops. A 401 from the Library step means the n8n "Atlas reports" credential no longer matches the site's `AGENT_FEED_TOKEN`; the sheet is still written and the Run Log says "Library not updated".
- **Stop it:** unpublish the workflow in n8n.
