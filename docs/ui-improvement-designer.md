# AI UI Improvement Designer

Atlas-owned specialist in the OpenAI building, Floor 4, Suite 402. Select the agent and copy its Codex review prompt to request a focused design review. Supply current screenshots and a small scope (for example Skyline labels or lobby navigation).

The agent is idle until explicitly requested. It returns at most three evidence-backed recommendations and does not modify code. Existing model-free system-improvement reports and CI evidence are reused: this registration creates no extra scheduled jobs, API calls, or model runs. Manual Codex reviews use account allowance. No review has been started as part of setup.

Review instructions: `ops/system-improvements/ui-design-prompt.md`. Implementation and merging require a separate request.
