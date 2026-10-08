# Themes

The default scene is an office of agents, but the visualization is not tied to
it. A user can choose a theme: a farm (agents are farmhands), a construction
site (builders, masons), and so on. Terms follow [CONTEXT.md](../../CONTEXT.md).

## Requirement on the core

Theming is mostly a visualization concern, but it puts one hard rule on the
core: the core never speaks in theme terms. If "manager", "department" or
"desk" leaks into the event schema, the data model or an adapter, every new
theme becomes a rewrite.

Two layers:

- **Core (theme-neutral)**: agents, relationships, groups, states, action
  categories. Uses `lead`/`member`, `group`, `delegate`, and the category set
  below.
- **Theme (data + assets)**: a manifest mapping the core vocabulary to a scene.

## Vocabulary mapping examples

| Core concept | Office (default) | Farm | Construction site |
|---|---|---|---|
| `group` | Department | Field / barn | Work zone |
| `lead` | Head of department | Farm owner | Site foreman |
| `member` | Staff | Farmhand | Mason, electrician |
| `read` / `search` | Bookshelf | Checking the crops | Studying blueprints |
| `write` | Typing at a desk | Planting | Laying bricks |
| `exec` (shell, tests) | Machine with a status light | Tractor / irrigation | Crane / cement mixer |
| `wait` (needs the user) | Hand raised | Ringing the farm bell | Hard hat raised |
| `delegate` | Hands over a folder | Points to a field | Hands over a plan |
| `error` | Head in hands, red light | Broken fence | Warning sign, stopped crane |

## Technical implications

1. **The action category set is a public contract.** Themes can only express
   what the core emits. If a tool call is only "working", a farm cannot tell
   planting from harvesting. Initial set: `read`, `write`, `exec`, `search`,
   `network`, `delegate`, `think`, `wait`, `error`. Adding a category later
   breaks existing themes, so choose carefully now.
2. **Themes need a manifest format.** It covers:
   - Role and appearance mapping (character kinds by `agent_type`).
   - **Stations**: named scene locations per action category, with capacity
     (a bookshelf fits two, a tractor fits one).
   - One animation clip per state.
   - A layout per supported topology (see [topologies.md](topologies.md)).
   - Vocabulary strings for UI labels and tooltips ("foreman", "farmer").
   - Asset pack and license metadata.
3. **Layout is per theme and per topology.** A pipeline is an assembly line in
   an office, but field to barn to market on a farm. A theme may omit a
   topology; the core supplies a fallback layout.
4. **Capacity and overflow.** When more agents want a station than it holds,
   the theme declares a rule: queue, spread, or share.
5. **Identity stability.** Appearance comes from the agent's seed; the
   character kind comes from the theme. The same seed should not produce
   wildly different characters across themes (keep palette or build
   consistent where possible).
6. **Authoring and trust.** If third parties can make themes, the manifest is
   data only (no arbitrary code), validated against a schema, and sandboxed.
   Decide this early because it shapes the plugin story.
7. **Conformance testing.** Feed a standard event stream through each theme
   and check that every category, role and topology resolves to something or
   falls back.

## Responsibilities

| Component | Knows about themes? |
|---|---|
| Adapters | No |
| Event schema | No |
| Daemon / reducer | No |
| UI | Yes: loads one theme and resolves `agent + state + category` to `station + animation` through the manifest |

## Manifest sketch

Illustrative only; not a settled format.

```json
{
  "id": "farm",
  "name": "Farm",
  "vocabulary": { "lead": "Farm owner", "member": "Farmhand", "group": "Field" },
  "roles": { "reviewer": { "character": "inspector" }, "default": { "character": "farmhand" } },
  "stations": {
    "read":  { "id": "crop-check", "capacity": 2, "overflow": "spread" },
    "write": { "id": "planting-row", "capacity": 4, "overflow": "queue" },
    "exec":  { "id": "tractor", "capacity": 1, "overflow": "queue" }
  },
  "states": { "waiting": "ring-bell", "blocked": "broken-fence", "idle": "rest" },
  "layouts": { "groups": "fields", "pipeline": "field-to-market" },
  "assets": "assets/farm/"
}
```

## Scope

- **MVP**: one theme (office). It exercises the abstraction against something
  real.
- **Leak check**: ship a deliberately minimal second theme (colored dots on a
  grid). Anything that breaks reveals a theme assumption in the core. A full
  second theme can wait.
- **Later**: a theme gallery and community themes, once the manifest format
  and trust model are settled.

## Open questions

- Should themes be able to add their own action categories, with a fallback to
  the core set, or is the category set closed?
- 2D only, or can a theme choose its renderer (sprites, SVG, 3D)?
- How are licensed or generated assets distributed alongside the manifest?
