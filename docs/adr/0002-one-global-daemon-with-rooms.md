# One global daemon, one room per repository

Agent hook config is per file, not per process, so a daemon per repo would need a port per repo and give no cross-project view. We run one daemon on one well-known local port, and partition by Room (derived from the git root, resolved through the git common directory so worktrees share a room). The v1 UI shows a single room; the data model keeps rooms from day 0.
