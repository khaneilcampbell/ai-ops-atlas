# n8n workflow

`job-intake.workflow.json`: **Job link form → `jobflow analyze --json` → worth tailoring?**

It needs a self-hosted n8n (the Execute Command node is not available on n8n Cloud)
running on the machine that has this repository and your `private/` folder.

1. Set two environment variables for the n8n process: `JOBFLOW_HOME` (path to this
   repository) and `ANTHROPIC_API_KEY`.
2. In n8n, **Import from file** and choose `job-intake.workflow.json`.
3. Open the form URL from the **Job link form** node and paste a job link.

The run adds a row to your tracker and ends with a `next_step` message: either the
command to tailor the resume, or a note that the job scored below your threshold.
The workflow never generates or sends an application on its own.
