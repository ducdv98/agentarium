# 04: Keep settings and temp files restricted

**What to build:** The settings file, which holds the bearer token, keeps its restrictive permissions through install, rewrite and cleanup. Fresh settings and temp files are created restrictively from the start.

**Blocked by:** 03

**Status:** resolved

- [x] An existing settings file keeps its mode after a rewrite
- [x] Fresh settings and temp files are created with restrictive permissions under a restrictive umask
- [x] Failure cleanup leaves no temp files behind
- [x] Windows ACL expectations are defined separately, and rename and restore are verified on Windows

**Known limits:** on Windows, file modes don't apply. Settings, temps and backups inherit the config directory's ACL, so a custom explicit ACL on `settings.json` is not preserved across a rewrite (see README security notes). The POSIX mode and umask tests skip on Windows and run only in CI on Linux and macOS.
