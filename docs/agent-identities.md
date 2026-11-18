# Agent identities

Seventeen Atlas agents have a persona: a display name next to their functional role, one
portrait, an accent color, a short introduction and a communication style. The persona is for
display only. The agent's stable id, tasks, permissions, workflow connections and history are
unchanged, and everywhere a persona shows it also says **AI agent**.

## Where it is stored

Each identity sits under the agent's `registry.identity` in `catalog/*.yaml`, against the stable id:

```yaml
registry:
  identity:
    display_name: Claire Dubois
    accent: "#E11D48"
    intro: "..."         # only what the agent can actually do today
    voice: "..."         # communication style
    appearance: "..."    # fixed appearance details, the input to the portrait prompt
    portrait:
      path: agents/benjaire-inquiry-manager.webp   # under public/, named after the id
      model: soul_2
      job_id: <Higgsfield job id>
      prompt_version: 1
      generated_at: 2026-11-18
```

The parser is `src/registry/manifest.ts`, the JSON Schema `catalog/schema/atlas-v2.schema.json`.
`src/registry/identity.ts` resolves what to show for any agent id:

| Agent | Shows |
| --- | --- |
| Has its own identity | Its persona, portrait and role |
| Automation with `owned_by` | Its owner's persona, "via" the automation |
| n8n Agent skill (Product Lab) | The lead agent it depends on (Leila Haddad), "via" the skill |
| Retired or no persona | Initials of its own name, neutral grey |
| Id no longer in the catalog | The name saved on the task, on initials |

A retired agent with its own identity keeps it, so past work still shows who did it.

## Status

`src/registry/agentStatus.ts` maps execution data to Ready, Working, Waiting for input,
Completed or Failed: an agent's runtime state from observed runs (`runtimeFor`), or a task's
lifecycle status. Stale, Off and Not connected stay visible; an agent Atlas can't hear from is
never shown as Ready. An owning agent with no runs of its own takes the most urgent state of
its automations and names the one it came from.

## Portraits

Portraits were generated once on Higgsfield Soul 2.0 (1:1, 2k), two variants per agent, 34
images for 4.08 credits on 2026-11-18. One was picked per agent and saved as a 384 px WebP
(about 10 KB). Nothing in Atlas generates portraits; a task never creates one. If a portrait
fails to load, the initials show instead.

To regenerate one, use the prompt below unchanged (`portraitPrompt(appearance)` builds it),
then bump `prompt_version` and update `job_id` and `generated_at`. Keep the appearance
fixed so the agent looks the same.

**House style** (`PORTRAIT_HOUSE_STYLE`): head-and-shoulders, natural skin, relaxed expression,
smart casual clothing, soft lighting, neutral background, no glamour, no stock poses.

## New agents

A new agent gets an identity when it is added to the catalog: a unique display name, an accent
far enough from the others, an appearance line and one portrait from the house style.
`src/registry/identity.test.ts` checks names are unique, accents are valid and distinct, every
portrait file exists and is small, and no introduction claims memory or learning. Agent Factory
drafting identities in its proposals is a later step that needs Khaneil's OK to publish.

## Per-agent prompts (prompt_version 1)

### Samuel Asante · Repository Intelligence Analyst

Id `repo-intelligence` · accent `#C026D3` · portrait `public/agents/repo-intelligence.webp` (Higgsfield job `1e63ce4a-62b0-4f5d-a926-e3fb40bee710`)

> Photorealistic portrait of a fictional Ghanaian man in his early 30s, dark skin, short two-strand twists, thin wire-frame glasses, burgundy quarter-zip over a white t-shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Margaret Lindqvist · Senior Engineering Reviewer

Id `atlas-engineering-review` · accent `#475569` · portrait `public/agents/atlas-engineering-review.webp` (Higgsfield job `e64b3def-50e3-402d-b23c-8b6d3f556d52`)

> Photorealistic portrait of a fictional Swedish woman in her late 50s, fair skin with natural fine lines, short silver pixie cut, tortoiseshell glasses, black fine-knit turtleneck under a grey wool blazer. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Tomás Herrera · Atlas Production Coordinator

Id `atlas-production-coordinator` · accent `#D97706` · portrait `public/agents/atlas-production-coordinator.webp` (Higgsfield job `cc767d98-c41b-46d5-a375-4a0d775c63f3`)

> Photorealistic portrait of a fictional Mexican man in his late 30s, light olive skin, wavy dark brown hair, rimless glasses, light stubble, olive overshirt over a grey t-shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Hana Kobayashi · Release Coordinator

Id `atlas-release-coordinator` · accent `#7C3AED` · portrait `public/agents/atlas-release-coordinator.webp` (Higgsfield job `3d7e8c23-b3e4-424b-bfba-3023f9d36a84`)

> Photorealistic portrait of a fictional Japanese woman in her late 20s, fair skin, straight black chin-length bob, light-wash denim shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Daniel Okafor · Atlas Release Manager

Id `atlas-release-manager` · accent `#2563EB` · portrait `public/agents/atlas-release-manager.webp` (Higgsfield job `ab703322-ff86-4f4f-809f-93e48db7b729`)

> Photorealistic portrait of a fictional Nigerian-British man in his early 40s, deep brown skin, short cropped black hair greying at the temples, close-trimmed beard, navy crew-neck merino sweater over a white collared shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Priya Raman · Atlas Health Monitor

Id `atlas-health-monitor` · accent `#0D9488` · portrait `public/agents/atlas-health-monitor.webp` (Higgsfield job `d027dd76-7129-488c-bfcd-3e0e93741067`)

> Photorealistic portrait of a fictional South Indian woman in her mid 30s, medium brown skin, black hair in a low ponytail, small gold stud earrings, sage-green cardigan over a charcoal t-shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Leila Haddad · Product Lab Lead

Id `benjaire-product-lab` · accent `#C2410C` · portrait `public/agents/benjaire-product-lab.webp` (Higgsfield job `8c95a365-89ce-44a3-ab15-8cacc6762fac`)

> Photorealistic portrait of a fictional Lebanese woman in her mid 30s, light olive skin, long dark curly hair worn down, small hoop earrings, rust-terracotta blouse under a cream linen jacket. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Claire Dubois · Client Inquiry Manager

Id `benjaire-inquiry-manager` · accent `#E11D48` · portrait `public/agents/benjaire-inquiry-manager.webp` (Higgsfield job `a0931c6f-46d6-4b1c-8641-156dc43fcab5`)

> Photorealistic portrait of a fictional French-Canadian woman in her mid 40s, fair skin with light freckles, auburn hair in a loose low bun, cream cable-knit sweater. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Mateo Rossi · Shop Order Manager

Id `benjaire-shop-manager` · accent `#0369A1` · portrait `public/agents/benjaire-shop-manager.webp` (Higgsfield job `796673e5-581d-4ab5-9621-abe4e9f0babf`)

> Photorealistic portrait of a fictional Italian man in his late 20s, light skin, short curly brown hair, light stubble, chambray button-down shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Andre Thompson · Business Operations Monitor

Id `benjaire-ops-monitor` · accent `#65A30D` · portrait `public/agents/benjaire-ops-monitor.webp` (Higgsfield job `182f0ff0-4334-4024-b773-c459fba42d1e`)

> Photorealistic portrait of a fictional Jamaican man in his mid 40s, dark brown skin, shaved head, neat goatee with grey flecks, charcoal henley. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Nina Petrova · Portfolio Web Developer

Id `site-builder` · accent `#EC4899` · portrait `public/agents/site-builder.webp` (Higgsfield job `b100d8c2-7516-4b74-9273-fcbf02f31961`)

> Photorealistic portrait of a fictional Bulgarian woman in her early 30s, fair skin, straight light-blonde shoulder-length hair with a fringe, black rectangular glasses, navy-and-white striped boat-neck top. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Jordan Reyes · GitHub Profile Manager

Id `github-profile-manager` · accent `#16A34A` · portrait `public/agents/github-profile-manager.webp` (Higgsfield job `50bfdf4e-c373-4962-9954-e2497221705c`)

> Photorealistic portrait of a fictional Filipino man around 30, light brown skin, black hair short on the sides, clean-shaven, grey unstructured blazer over a black crew-neck t-shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Elijah Brooks · Development Hub Lead

Id `development-hub-lead` · accent `#1E3A8A` · portrait `public/agents/development-hub-lead.webp` (Higgsfield job `3c9ea282-828c-4cc2-9aba-4f8bdd7ff4d9`)

> Photorealistic portrait of a fictional African-American man in his late 30s, dark brown skin, short fade haircut, light full beard, navy knit polo. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Sofia Mendes · Commerce Operations Manager

Id `commerce-operations-manager` · accent `#EAB308` · portrait `public/agents/commerce-operations-manager.webp` (Higgsfield job `43416d5b-7a9c-4d48-b510-0e11289d194c`)

> Photorealistic portrait of a fictional Brazilian woman in her mid 40s, tan skin, shoulder-length wavy brown hair with lighter highlights, small gold pendant, camel blazer over a white t-shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Yusuf Demir · Agent Operations Lead

Id `agent-operations-lead` · accent `#9F1239` · portrait `public/agents/agent-operations-lead.webp` (Higgsfield job `5ed7e54b-ae6d-4ba1-98dd-9da8eca247cb`)

> Photorealistic portrait of a fictional Turkish man in his early 40s, light olive skin, short dark hair, short salt-and-pepper beard, navy overshirt over a light grey t-shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Eleanor Park · Documentation Lead

Id `documentation-lead` · accent `#6B8F71` · portrait `public/agents/documentation-lead.webp` (Higgsfield job `9e5a6e75-d912-48b9-8528-8a215a31a090`)

> Photorealistic portrait of a fictional Korean-American woman in her early 50s, light skin, shoulder-length straight black hair with grey strands, thin gold necklace, cream silk blouse. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.

### Connor Walsh · Security Detection Lead

Id `soc-detection-lead` · accent `#38BDF8` · portrait `public/agents/soc-detection-lead.webp` (Higgsfield job `0678f18f-36d9-4be2-992a-db1e8a1f34b1`)

> Photorealistic portrait of a fictional Irish man in his early 30s, fair skin with freckles, short ginger hair, light ginger stubble, dark grey merino zip sweater over a white t-shirt. Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.
