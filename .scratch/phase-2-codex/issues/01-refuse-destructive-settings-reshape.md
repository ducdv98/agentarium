# 01: Refuse destructive settings reshaping on init

**What to build:** When the user's Claude Code settings hold a hook shape Agentarium cannot safely change, `init` stops with an error that names the exact path, and the settings file's bytes stay exactly as they were. Well-formed unrelated values are preserved.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] A scalar or array `hooks` container makes `init` refuse, name the path, and leave the file unchanged
- [x] A malformed value at an installed event refuses before any write or backup
- [x] A malformed value under an unrelated event is preserved when init succeeds
- [x] Tests cover null, string, array and object values at the installed event fields
