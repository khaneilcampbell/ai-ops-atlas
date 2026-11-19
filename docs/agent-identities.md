# Agent identities

Seventeen Atlas agents have a persona: a display name next to their functional role, one
illustrated avatar, an accent color, a short introduction and a communication style. The persona is for
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
      model: gpt_image_2_6
      job_id: <Higgsfield job id>
      prompt_version: 2
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

## Avatars

Avatars are illustrations, not photos: Khaneil chose drawn avatars over real-looking faces on
2026-11-18. They were generated once on Higgsfield (`gpt_image_2_6`, 1:1), one per agent, 17
images for about 4.25 credits, each drawn on its accent color circle. They are saved as 384 px
WebP (about 10 KB). Nothing in Atlas generates avatars; a task never creates one. If an avatar
fails to load, the initials show instead. (A first photoreal set, prompt_version 1, was
replaced and is not used.)

To regenerate one, use the prompt below unchanged (`portraitPrompt(appearance, accent)` builds
it), then bump `prompt_version` and update `job_id` and `generated_at`. Keep the appearance
fixed so the agent looks the same.

**House style** (`PORTRAIT_HOUSE_STYLE`): flat vector editorial illustration, head and
shoulders, simple shapes and solid fills, minimal facial detail, the agent's accent as a solid
circle behind it. Never a photo.

## New agents

A new agent gets an identity when it is added to the catalog: a unique display name, an accent
far enough from the others, an appearance line and one illustrated avatar from the house style.
`src/registry/identity.test.ts` checks names are unique, accents are valid and distinct, every
portrait file exists and is small, and no introduction claims memory or learning. Agent Factory
drafting identities in its proposals is a later step that needs Khaneil's OK to publish.

## Per-agent prompts (prompt_version 2)

### Samuel Asante · Repository Intelligence Analyst

Id `repo-intelligence` · accent `#C026D3` · avatar `public/agents/repo-intelligence.webp` (Higgsfield job `bfe4e2a7-7f0f-4c9b-9a8e-30704a9f9465`)

> Flat vector illustrated avatar of a fictional character: Ghanaian man in his early 30s, dark skin, short two-strand twists, thin wire-frame glasses, burgundy quarter-zip over a white t-shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #C026D3 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Margaret Lindqvist · Senior Engineering Reviewer

Id `atlas-engineering-review` · accent `#475569` · avatar `public/agents/atlas-engineering-review.webp` (Higgsfield job `ddf918d0-1502-4812-bfb0-d149395e964e`)

> Flat vector illustrated avatar of a fictional character: Swedish woman in her late 50s, fair skin with natural fine lines, short silver pixie cut, tortoiseshell glasses, black fine-knit turtleneck under a grey wool blazer. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #475569 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Tomás Herrera · Atlas Production Coordinator

Id `atlas-production-coordinator` · accent `#D97706` · avatar `public/agents/atlas-production-coordinator.webp` (Higgsfield job `1286b3d1-e5d9-4f57-8228-e228513334fa`)

> Flat vector illustrated avatar of a fictional character: Mexican man in his late 30s, light olive skin, wavy dark brown hair, rimless glasses, light stubble, olive overshirt over a grey t-shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #D97706 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Hana Kobayashi · Release Coordinator

Id `atlas-release-coordinator` · accent `#7C3AED` · avatar `public/agents/atlas-release-coordinator.webp` (Higgsfield job `9c93621d-28cb-439b-a326-2e19fe86f0c3`)

> Flat vector illustrated avatar of a fictional character: Japanese woman in her late 20s, fair skin, straight black chin-length bob, light-wash denim shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #7C3AED on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Daniel Okafor · Atlas Release Manager

Id `atlas-release-manager` · accent `#2563EB` · avatar `public/agents/atlas-release-manager.webp` (Higgsfield job `24b50ca5-6aef-4f96-9caf-38bf77bbc4e3`)

> Flat vector illustrated avatar of a fictional character: Nigerian-British man in his early 40s, deep brown skin, short cropped black hair greying at the temples, close-trimmed beard, navy crew-neck merino sweater over a white collared shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #2563EB on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Priya Raman · Atlas Health Monitor

Id `atlas-health-monitor` · accent `#0D9488` · avatar `public/agents/atlas-health-monitor.webp` (Higgsfield job `b288c85b-4f63-41cf-80d5-0da09c0b1c6e`)

> Flat vector illustrated avatar of a fictional character: South Indian woman in her mid 30s, medium brown skin, black hair in a low ponytail, small gold stud earrings, sage-green cardigan over a charcoal t-shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #0D9488 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Leila Haddad · Product Lab Lead

Id `benjaire-product-lab` · accent `#C2410C` · avatar `public/agents/benjaire-product-lab.webp` (Higgsfield job `793ebfb5-c40d-4708-87e3-0df6cfb83a7b`)

> Flat vector illustrated avatar of a fictional character: Lebanese woman in her mid 30s, light olive skin, long dark curly hair worn down, small hoop earrings, rust-terracotta blouse under a cream linen jacket. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #C2410C on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Claire Dubois · Client Inquiry Manager

Id `benjaire-inquiry-manager` · accent `#E11D48` · avatar `public/agents/benjaire-inquiry-manager.webp` (Higgsfield job `406afb79-3173-48a5-99f9-83d0b735a5ed`)

> Flat vector illustrated avatar of a fictional character: French-Canadian woman in her mid 40s, fair skin with light freckles, auburn hair in a loose low bun, cream cable-knit sweater. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #E11D48 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Mateo Rossi · Shop Order Manager

Id `benjaire-shop-manager` · accent `#0369A1` · avatar `public/agents/benjaire-shop-manager.webp` (Higgsfield job `c06f7285-2cc7-4b14-87f8-87ab7702e76e`)

> Flat vector illustrated avatar of a fictional character: Italian man in his late 20s, light skin, short curly brown hair, light stubble, chambray button-down shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #0369A1 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Andre Thompson · Business Operations Monitor

Id `benjaire-ops-monitor` · accent `#65A30D` · avatar `public/agents/benjaire-ops-monitor.webp` (Higgsfield job `2bc7ba93-6938-4e11-b543-064d11c9dd93`)

> Flat vector illustrated avatar of a fictional character: Jamaican man in his mid 40s, dark brown skin, shaved head, neat goatee with grey flecks, charcoal henley. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #65A30D on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Nina Petrova · Portfolio Web Developer

Id `site-builder` · accent `#EC4899` · avatar `public/agents/site-builder.webp` (Higgsfield job `0a224f04-13a6-4e15-9d29-107d4456ec16`)

> Flat vector illustrated avatar of a fictional character: Bulgarian woman in her early 30s, fair skin, straight light-blonde shoulder-length hair with a fringe, black rectangular glasses, navy-and-white striped boat-neck top. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #EC4899 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Jordan Reyes · GitHub Profile Manager

Id `github-profile-manager` · accent `#16A34A` · avatar `public/agents/github-profile-manager.webp` (Higgsfield job `8383d702-d9ca-43c0-9851-daf60bdc75bf`)

> Flat vector illustrated avatar of a fictional character: Filipino man around 30, light brown skin, black hair short on the sides, clean-shaven, grey unstructured blazer over a black crew-neck t-shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #16A34A on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Elijah Brooks · Development Hub Lead

Id `development-hub-lead` · accent `#1E3A8A` · avatar `public/agents/development-hub-lead.webp` (Higgsfield job `640de0bb-2045-4175-9db4-d5b6230b2ad5`)

> Flat vector illustrated avatar of a fictional character: African-American man in his late 30s, dark brown skin, short fade haircut, light full beard, navy knit polo. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #1E3A8A on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Sofia Mendes · Commerce Operations Manager

Id `commerce-operations-manager` · accent `#EAB308` · avatar `public/agents/commerce-operations-manager.webp` (Higgsfield job `2970526e-1d52-4752-9221-845a6fa7afd5`)

> Flat vector illustrated avatar of a fictional character: Brazilian woman in her mid 40s, tan skin, shoulder-length wavy brown hair with lighter highlights, small gold pendant, camel blazer over a white t-shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #EAB308 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Yusuf Demir · Agent Operations Lead

Id `agent-operations-lead` · accent `#9F1239` · avatar `public/agents/agent-operations-lead.webp` (Higgsfield job `45bacbc1-3785-4fd6-aff4-86359f49771f`)

> Flat vector illustrated avatar of a fictional character: Turkish man in his early 40s, light olive skin, short dark hair, short salt-and-pepper beard, navy overshirt over a light grey t-shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #9F1239 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Eleanor Park · Documentation Lead

Id `documentation-lead` · accent `#6B8F71` · avatar `public/agents/documentation-lead.webp` (Higgsfield job `f783d513-ba67-43bb-9787-8655200bb353`)

> Flat vector illustrated avatar of a fictional character: Korean-American woman in her early 50s, light skin, shoulder-length straight black hair with grey strands, thin gold necklace, cream silk blouse. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #6B8F71 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

### Connor Walsh · Security Detection Lead

Id `soc-detection-lead` · accent `#38BDF8` · avatar `public/agents/soc-detection-lead.webp` (Higgsfield job `a704bcd2-b729-420e-96f3-46e3a4698fd3`)

> Flat vector illustrated avatar of a fictional character: Irish man in his early 30s, fair skin with freckles, short ginger hair, light ginger stubble, dark grey merino zip sweater over a white t-shirt. Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile). Solid circular background in #38BDF8 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.

## City characters

Each of the 17 identities is also one character in the 3D city (`src/views/map3d/NamedAgents.tsx`), built from its avatar.

- **Appearance:** `src/registry/cityFigures.ts`, keyed by the same stable agent id as `registry.identity`. It holds skin, hair style and colour, facial hair, glasses, earrings, necklace, the visible top, collar and jacket, and a silhouette (height, shoulders). Trousers and shoes are not in the avatars, so they are quiet role-appropriate defaults. The avatar's coloured circle is only the badge ring, never skin or clothes. `cityFigures.test.ts` checks every identity has exactly one figure.
- **Rig:** `src/views/map3d/agentFigures.ts` hangs each figure's boxes and balls on one shared six-bone rig (body, head, legs, arms). All characters draw in four calls: boxes, balls, portrait badges (one atlas texture, a fixed size on screen) and activity rings.
- **Place:** `src/views/map3d/namedAgentPlan.ts` stands each persona in front of its real workplace from `agentJobs` (its project's headquarters, or the Marketing Agency for Leila Haddad), side by side with the others there. Agents with a commute walk it from their workday or saved presence schedule and are not drawn while at home. No other travel is drawn: Atlas has no handoff data between buildings yet.
- **One per identity:** automations and Product Lab skills show their persona in lists, but never add a second character. The AI agents no longer walk in the crowd mesh, so nobody appears twice.
- **Activity:** a thin ring above the head only while a task assigned to the persona (or one of its automations) is running, or verified telemetry says it is working.
- **Profile:** pointing names the character; a click or tap opens a card with the portrait, name, role, AI agent label, building, status and current task, with Open task (opens that task in the Task Center) and Full profile (the agent's detail panel).
- **Reduced motion:** no stride or idle movement; walkers move on every two seconds.

Limits: at normal city zoom a figure is about a centimetre tall on screen, so faces read from the portrait badge rather than the 3D head. Glasses, beards and hairstyles show in close-ups. Office desk figures are unchanged. Review shots: `NAMED_SHOTS=<dir> npx playwright test -c visual visual/named-agents.visual.ts`.
