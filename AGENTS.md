# AGENTS.md

Rules for AI agents in this repository.

## Package Manager

- Always use `bun`.
- Use `bun install`, `bun run <script>`, `bun add <package>`, etc.
- Never use npm, yarn, or pnpm.

## Shell environment

- The interactive shell is **Nu (nushell)**.
- Always run commands with Bash syntax.
- Invoke Bash explicitly.

### Required rule

Run commands as:

- `bash -lc '<your command(s)>'`

`-l` loads PATH, `-c` runs the command string.

### Examples

- `bash -lc 'ls -la'`
- `bash -lc 'cd apps/api && bun install && bun test'`
- `bash -lc 'cat apps/api/package.json | jq .name'`
- `bash -lc 'for f in apps/*/package.json; do echo "$f"; done'`
- `bash -lc 'set -euo pipefail
  cd apps/api
  bun run lint
  bun test
  '

## Output formatting for agents

- When showing commands in messages, use fenced code blocks labeled `bash`.
- When executing from Nu, still use `bash -lc '…'`.

## Indentation

- Always use 4 spaces for indentation everywhere in this repository.
- Do not use tabs for indentation.

## Documentation updates

- Always update documentation in `/docs` after updating a feature.
- Create a new file in `/docs` only for an entirely new feature.

## Don’ts

- Don’t use Nu-specific pipelines/filters (`where`, `each`, `select`, etc.) in command suggestions.
- Don’t assume the terminal understands Bash syntax unless it is executed via `bash -lc`.
- Don't run interactive Bash sessions unless explicitly required.
- Never use emojis in documentation or messages.
