# 02: Uninstall removes only what we added

**What to build:** `uninstall` removes Agentarium's hook handlers and prunes only the containers those removals empty. Empty arrays and objects the user wrote stay, and a settings file Agentarium never touched stays byte-for-byte unchanged.

**Blocked by:** 01

**Status:** resolved

- [x] A user-authored empty event array survives uninstall
- [x] A container is pruned only when removing an Agentarium handler empties it
- [x] A never-installed settings file is unchanged byte-for-byte
- [x] Junk elements, matchers and extra fields survive uninstall

**Known limit:** containers present in the pre-install backup are kept even if emptied. An empty array the user creates at an installed event *after* the first install, and that is then filled by a reinstall, is indistinguishable from ours and is pruned. Fixing that would need an ownership marker in settings.
