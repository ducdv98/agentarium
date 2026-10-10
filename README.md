# Agentarium

Agentarium is a live view of your AI agents. Every agent it observes appears as a character in a shared scene, and what the agent is doing shows up as behaviour. Its main job is triage: seeing at a glance which agent is waiting on you.

It currently observes Claude Code, including sub-agents. Each repository gets its own room, and the view switches to a room where an agent is waiting on you, unless you have picked a room yourself. Everything runs locally on one machine.

## Install

Requires Node.js 22.18 or later.

```sh
npx @agentarium/cli init
npx @agentarium/cli start
```

Or install it globally and use the `agentarium` command:

```sh
npm install -g @agentarium/cli
agentarium init
agentarium start
```

`start` prints a URL with your token in it. Open it in a browser and keep the tab open. Claude Code sessions started after `init` are picked up automatically.

## Commands

| Command | What it does |
| --- | --- |
| `agentarium init` | Adds Agentarium's hooks to your user-level Claude Code settings file (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`). Backs up the existing file once, to `settings.json.agentarium-backup`, before its first change. Safe to run again. |
| `agentarium start` | Starts the daemon in the background on `127.0.0.1:47821` and prints the URL to open. If it is already running, prints the URL again. |
| `agentarium stop` | Stops the daemon. |
| `agentarium uninstall` | Removes Agentarium's hooks from the Claude Code settings file and leaves your other settings alone. If removing the hooks leaves exactly what the backup holds, the backup file is restored as it was; otherwise the backup is left in place. |

`init` and `uninstall` re-read settings before committing and retry if another writer changed them. This guard only narrows the race: Claude Code and editors do not cooperate through locking, so a change between the final re-read and rename (or delete) can still be replaced. The remaining window is a single re-read plus rename (or delete).

The daemon does not start on login; run `agentarium start` after a reboot.

Settings, read from the environment:

- `AGENTARIUM_PORT`: port for the daemon (default `47821`). Run `init` again after changing it, so the hooks point at the new port.
- `AGENTARIUM_HOME`: where Agentarium keeps its token, event log and daemon log (default `~/.agentarium`).
- `CLAUDE_CONFIG_DIR`: the Claude Code configuration directory, if it is not `~/.claude`.

## Security notes

- The daemon listens on `127.0.0.1` only and is not reachable from other machines.
- It rejects requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`, and browser requests from any other origin. This blocks DNS rebinding and other web pages.
- Hook events and the live view require a bearer token, created on first use in `~/.agentarium/token`.
- `init` writes that token **in plain text** into the Claude Code settings file, since hooks send it with each request. The token protects against other local processes and web pages, not against anyone who can read your files: any process running as you could read it from wherever it was stored.
- The URL printed by `start` contains the token. Do not share it.

## Upgrading

`start` refuses to run next to a daemon of a different version. After upgrading the package, stop the old daemon, then start the new one:

```sh
agentarium stop
agentarium start
```

## Removing

Run `agentarium uninstall` (and `agentarium stop`) **before** you uninstall the package:

```sh
agentarium stop
agentarium uninstall
npm uninstall -g @agentarium/cli
```

If you remove the package first, its hooks stay in your Claude Code settings file. They are harmless, as they fail quickly and silently when the daemon is gone, but they stay there until you remove them by hand or run `npx @agentarium/cli uninstall`. Delete `~/.agentarium` to remove the token and the event log.

## Licence

MIT. See [LICENSE](LICENSE).
