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
