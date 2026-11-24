# Adding to Atlas

One checklist for every addition, so a new agent, automation or building shows up everywhere at
once: on the map, in the Agents tabs (Team, Roster, Directory), in Overview and in the Output
Library. Do all of it in the same pull request as the addition (CLAUDE.md, "Keep the dashboard tabs
current"). `src/catalog/newAgentChecklist.test.ts` fails, naming the agent and the missing step,
when an AI agent is incomplete, so CI catches what this list misses.

Everything below reads from the catalog. Add data, not special cases in view code.

## A new AI agent

Do these even when the agent starts paused or as a draft, so nothing is missing the day it is
switched on.

1. **Catalog entry** in its project's `catalog/<project>.yaml`: `status`, `trigger`, `last_run`,
   `history` and links matching what is live (published in n8n = `active`, draft = `paused` with
   "draft" in the trigger). Link every n8n workflow it runs, labelled with "n8n".
2. **Identity**: `registry.identity` (display name, accent, appearance, portrait record) and the
   avatar `public/agents/<id>.webp` (under 40 KB). See `docs/agent-identities.md`.
3. **City figure**: an entry in `src/registry/cityFigures.ts` that matches the avatar.
4. **Team role**: add its id to a role in `ESSENTIAL_ROLES` (`src/catalog/essentialRoles.ts`). A new
   role is Khaneil's call; ask before adding one.
5. **Place on the map**, one of:
   - a desk in its project's building (the default: nothing to add once `projectId` is set);
   - a `workplace` room (Marketplace or Marketing Agency);
   - `agents` on a landmark in `catalog/workspace/workspace.yaml`.
   A desk never resizes a district or moves a building. Leave outside services out of
   `registry.responsibilities.tools` unless Khaneil wants a new tool building
   (`dashboardData.test.ts` pins the tool buildings).

## A new automation or n8n workflow

1. Catalog entry as above, with an `n8n workflow` link for n8n.
2. `owned_by`: a current AI agent. The automation then shows on that agent's desk, in its role,
   and under its persona everywhere. No identity or city figure of its own.

## A new building or map object

`catalog/workspace/buildings.yaml` (names), `workspace.yaml` (module, agents), and
`src/inventory/mapInventory.ts` for new map objects.

## Hosting or spend caps

`src/infra/hosts.ts`, `src/finance/caps.ts`, `catalog/workspace/finance.yaml`.

## Counts that are pinned on purpose

These tests list or count the team by hand so an addition is always a deliberate, reviewed change.
Expect to update them, and say so in the pull request:

- `src/registry/identity.test.ts` (the agents with an identity) and `src/registry/cityFigures.test.ts` (how many);
- `src/registry/registry.test.ts` (projects and agents), `src/catalog/organization.test.ts`,
  `src/catalog/essentialRoles.test.ts` (roles), `src/views/office/model.test.ts` (office order);
- `visual/team.visual.ts` and `visual/essential-roles.visual.ts` (role cards, Inactive counts).

## Before you push

`npm run lint`, `npm run typecheck`, `npm test`. A new agent changes the screen (map desk, Team,
Roster), so take before and after screenshots at desktop and iPhone width (`docs/visual-testing.md`).
