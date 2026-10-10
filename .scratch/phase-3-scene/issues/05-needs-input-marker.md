# 05: Needs-input marker drawn by the Renderer

**What to build:** The Renderer draws its own marker above every agent with the Needs-input flag, such as a badge or ring, whatever the Theme art is. Themes only set its colour (`palette.alert`). Build it in the dot-grid Renderer now, as a contract the isometric Renderer (10) must also meet.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The marker shows for an agent waiting on the user, and for a lead whose descendant is waiting
- [ ] The marker stays visible however the Theme styles the agent, including when a theme's waiting style is missing
- [ ] A Renderer contract test that 10 must also pass
