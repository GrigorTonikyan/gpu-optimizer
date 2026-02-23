---
trigger: always_on
---

# Runtime & Package Manager

- **Bun** is the ONLY runtime and package manager for this project.
- Use `bun` for all commands: `bun install`, `bun run`, `bun test`, etc.
- The project has a `bun run bundle` script which uses `bun build --compile` to create a single-file standalone executable.
- Do NOT use npm, yarn, pnpm, or node directly.
