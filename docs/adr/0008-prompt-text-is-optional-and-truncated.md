# Prompt text enters Events optional, truncated and switchable

An Agent needs a label the user can match to a terminal, and `session 1a2b3c4d` is not one. The label is the worktree or branch name plus the start of the Agent's first prompt. So the `prompt` Event gains an optional field with the prompt's first characters, truncated by the Adapter before the Event reaches the Daemon. A config switch turns it off, and then Adapters leave the field out. The full prompt never enters an Event.

This is the first user-authored text in the event log. The JSON-lines log persists on disk and is replayed through the reducer (ADR 0003), so a prompt that was recorded stays recorded. That makes this hard to reverse, and it is why truncation happens in the Adapter rather than in the view.

## Considered options

- **Session id only.** Rejected: nobody can match a hex prefix to one of several terminals, which defeats triage.
- **Branch or worktree name only.** Not enough on its own: parallel agents often share a branch or a checkout.
- **The provider's session title.** Not every provider has one, and where one exists it is often generated from the prompt anyway. It can be used later when present.
- **Full prompt text.** Rejected: it puts whole user instructions, which may contain secrets or pasted content, into a persistent log for the sake of a label.
- **Read the prompt from the transcript at view time.** Rejected for now: it needs the Daemon to read transcripts for each provider on demand, which is a separate decision with its own privacy questions.
