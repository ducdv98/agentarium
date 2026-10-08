# Event-sourced core with a pure reducer

All agent state is derived by a pure, I/O-free reducer over an append-only log of versioned Events. This buys replay, reconnect recovery, deterministic tests and a future network relay, at the cost of designing the event schema carefully up front. Identity includes the machine from day 0 (machine, provider, session, agent) because adding it later is a painful migration.
