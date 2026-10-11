# 07: Overview of Rooms

**What to build:** An Overview lists every Room, built from `RoomSummary`, ordered with Needs-input Rooms first and then by last activity. Each Room is named by its repository folder, with the full path on hover, and shows how many of its Agents need the user. Choosing a Room pins it as the Followed room and goes to the scene. Auto-follow acts only in the scene view and never takes the user out of the Overview; there, a Room that needs the user moves to the top and is highlighted. The page still opens on the scene. The Overview is a list, not live miniature scenes (spec, Decisions).

**Blocked by:** None (can start immediately)

**Status:** needs-triage. Stays here until the usage week ends; entries in `.scratch/daily-use/usage-log.md` can change it (spec, Gate).

- [ ] The Overview lists every Room, Needs-input Rooms first and then by most recent activity, and re-orders live
- [ ] Each Room shows its folder name, its full path on hover, its Agent count and how many need the user
- [ ] A Room that needs the user is highlighted, and it is never moved off the Overview by auto-follow
- [ ] Choosing a Room pins it as the Followed room and shows the scene; the existing pin can still be cleared
- [ ] The page opens on the scene, and the Overview is reachable by mouse and keyboard
- [ ] Two Rooms with the same folder name can be told apart
