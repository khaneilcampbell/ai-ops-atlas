# Direct city startup

Projects waits for graphics initialization, not repository refresh. Its first draw previously used full configured Retina resolution and was covered by a loading mask until a later callback.

Remove startup loading messages, overlays and the slow-start timer. Let the first city frame become visible immediately when rendered. Night mode keeps a matching dark background while graphics initialize. Navigation and normal error recovery remain available.

Draw the first city frame at DPR 1, then restore saved/adaptive quality after the first-frame callback. On a 2× Retina canvas the first draw has one quarter as many output pixels. The retained renderer avoids repeating cold setup when returning to Projects. No new timers, polling, model calls, dependencies or recurring tasks.

Cold starts still incur procedural-planning and shader-compilation costs. Removing the message does not make those costs disappear. No native M5/WebKit startup-time improvement percentage is claimed.

Validation covers absence of startup messages with a deliberately delayed module, usable navigation, first draw at 1× then restored quality, repeated Projects entry without rebuilding the renderer, and generated reports not reloading the preview. Not merged or deployed.
