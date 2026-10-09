# Ship as one scoped npm package, `@agentarium/cli`

The unscoped name `agentarium` is already taken on npm by an unrelated agent tool, so we publish under the `@agentarium` scope. The command is still called `agentarium`. The CLI, daemon, adapters, core and built UI are bundled into one package, and the workspace packages stay private, because install should be one command and there is no public API worth versioning yet. Splitting out packages such as `@agentarium/theme-*` is reconsidered when community themes or adapters become real; the scope keeps room for them.
