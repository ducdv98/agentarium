# 03: Guard settings writes against concurrent edits

**What to build:** Install, removal, restore and deletion re-read the settings file immediately before committing, and retry the change on fresh contents within a bounded budget. If another tool changed the file mid-operation, Agentarium retries or refuses, and never overwrites the other change.

**Blocked by:** 02

**Status:** resolved

- [x] Another tool's change made during preparation survives the operation, or the operation refuses
- [x] Temp files are uniquely and exclusively created, and cleaned up on failure
- [x] Retries stop at a bounded budget with a clear error
- [x] The residual race with uncooperative writers is documented

**Known limit:** the guard is compare-and-swap, not a lock. A writer that does not cooperate can still land a change between the final re-read and the rename (or delete), and that change is replaced. The window is one re-read plus one rename. This is documented in the README and on `compareAndSwap`.
