# Runbooks: Project Intelligence Hub

Repository: [Atlas Intelligence Hub](https://github.com/khaneilcampbell/ai-ops-atlas/tree/main/docs/intelligence-hub). Run commands below from `docs/intelligence-hub`.

## Docs Builder

`10 — System Administration/Automation Scripts/build_docs.py`.

- **Needs:** pandoc 2.9 or newer and `pip install python-docx`.
- **Run it:** `python3 "10 — System Administration/Automation Scripts/build_docs.py" "<project folder>"`. The folder must hold `Source/project.json` and `Source/*.md`; one DOCX per Markdown file is written beside `Source/`.
- **When it fails:** a missing pandoc or python-docx stops it at once. Check `project.json` is valid JSON with `id`, `name`, `category`, `status`, `repo` and `last_verified`, and that the five source files exist (CI checks the same).
- **Undo it:** the DOCX files are committed, so `git checkout -- "<project folder>"/*.docx` restores them.

## Hub CI

`.github/workflows/ci.yml`. Checks every project's sources, then renders every project in the runner.

- **When it fails:** the `::error::` lines name the project and the missing field or file. Rendering errors reproduce with the Docs Builder command above.
- **Rendered documents:** run the workflow by hand with **documents** ticked and download the artifact.
- **Stop it:** disable the workflow in Actions.

## Agent Registry Sync

Three n8n workflows write the [Atlas Agent Registry sheet](https://docs.google.com/spreadsheets/d/1OcCD-k4ob_9lwpiQN3CazE7mkgQz0ExCzqLtHXrPAQA/edit): [Atlas · Agent Registry](https://khancam15.app.n8n.cloud/workflow/JCjTTvb7qZLpVXhs) every 4 hours (no model), [Atlas · Business Structure](https://khancam15.app.n8n.cloud/workflow/iY7mu26VL0xYElAP) daily at 7am New York time (no model) and [Atlas · Top 10 Agent Ideas](https://khancam15.app.n8n.cloud/workflow/bgebM33jnVhLPSTF) Sundays at 9am (one Claude call, $3 per 30 days). Details in [docs/agent-registry.md](../agent-registry.md).

- **Healthy:** no failed executions, and the sheet's rows match the Agents tab. Successful runs of the first two are not saved in n8n, so a quiet Executions list is normal.
- **Run it:** the Agents tab's **Refresh registry sheet** button, or run the workflow by hand.
- **When it fails:** "Flow · 0 Error alerts" emails ops. A Google Sheets quota error clears on the next run.
- **Stop it:** unpublish the workflow in n8n. Rows are never deleted, only marked Retired.

## Agent Factory

n8n workflow [Atlas · Agent Factory](https://khancam15.app.n8n.cloud/workflow/FTCanpGAYPIr3OGe): Mondays at 8am New York time it finds gaps in plain code, makes at most one Claude call to draft one agent spec and emails Khaneil Approve or Reject. Approving records the decision only; nothing is built.

- **Healthy:** one run each Monday (execution 733 on 2026-11-16) and at most one proposal a week in `agent_factory_proposals`.
- **When it fails:** a budget stop means the $2 per 30 days cap was hit. Error alerts name the step.
- **Stop it:** unpublish the workflow in n8n.

## Atlas Step Runner

n8n workflow [Atlas · Step Runner](https://khancam15.app.n8n.cloud/workflow/tGYMec2rp0twZFxv), started only by the Atlas site for six allow-listed research and planning steps. One model call per step, no tools; the site allows at most 20 steps a day. Details in [docs/workflow-execution.md](../workflow-execution.md).

- **Healthy:** each step the site sends gets one report back within a few seconds.
- **When it fails:** `401` means the site's `N8N_BRIDGE_TOKEN` and the workflow's header credential differ. The report back uses `N8N_BRIDGE_CALLBACK_TOKEN`.
- **Stop it:** the Atlas emergency stop (Mission Control) makes the site refuse to dispatch; or unpublish the workflow in n8n.

## Agent Operations Lead

An owning agent with no model of its own. Its automations are Agent Registry Sync, Agent Factory and Atlas Step Runner (sections above). Executive goal plans start only when Khaneil approves them in Mission Control; see [docs/executive-operations.md](../executive-operations.md).

## Documentation Lead

An owning agent with no model of its own. Its automations are Docs Builder and Hub CI (sections above).
