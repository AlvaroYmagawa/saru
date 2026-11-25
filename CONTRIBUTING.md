# Contributing

Thanks for helping. Saru is small on purpose: a menu-bar app, a folder of notes, and Claude.

- **Before a big change**, open an issue to talk it through.
- **Setup:** `bun install`, then `bun run check` and `bun run e2e` should pass before and after
  your change. The e2e tests drive the real app with a stand-in for `claude`, so they need no
  account.
- **No real people in the repo.** Tests, fixtures and screenshots use made-up people (Hana Mori,
  Acme). Never commit someone's real name, email or Slack/Notion id.
- **How Saru writes** lives in `plugin/skills/polish/references/rules.md`, shared by the app and
  the Claude Code plugin. A change to it changes both.
- **The plugin's `scripts/saru.cjs` is generated** by `bun run build` from `src/cli`; commit it
  with the change that produced it (CI checks it's current).
- **Dependencies:** pin exact versions, and prefer none.
- macOS only for now. Keep anything OS-specific in `src/main/macos.ts`.
