# 01: Select an Agent and open its Inspector

**What to build:** The user clicks an Agent in the scene, or picks it in the roster with the keyboard, and an Inspector opens for it. The Inspector shows the Agent's State, Action category, tool, summary, Permission mode and how long it has been in its current State. A Lead links to its Members, and choosing a Member selects it. Every Renderer reports selection the same way: the `Renderer` interface gains `onSelect(agentKey)`, and the shared renderer contract gains a hit-test case. The Inspector reads `WorldState` only (spec, Decisions).

**Blocked by:** None (can start immediately)

**Status:** needs-triage. Stays here until the usage week ends; entries in `.scratch/daily-use/usage-log.md` can change it (spec, Gate).

- [ ] The renderer contract has a hit-test case: selecting at an Agent's drawn position reports that Agent's key, and empty space reports nothing. The dot-grid and isometric Renderers both pass it
- [ ] The roster selects an Agent by click and by keyboard, and shows which Agent is selected
- [ ] The Inspector shows State, Action category, tool, summary, Permission mode and time in the current State, and updates live as Events arrive
- [ ] Time in the current State comes from the reducer (when the State last changed), so a replay gives the same value
- [ ] A Lead's Inspector lists its Members and each one selects that Member; a Member links back to its Lead
- [ ] The selection clears, and the Inspector says so, when the selected Agent leaves the scene (lost and removed) or the Followed room changes
