# Security

Saru reads the text box you're writing in, sends it with your notes to Claude through your own
Claude Code, and pastes the answer back. The parts that matter for security:

- **Claude has no tools.** Every call runs `claude -p` with `--tools ""`, no user settings,
  plugins, hooks or MCP servers, and Saru's own system prompt. A draft or a rule request that
  tries to give instructions can at worst change the text Saru proposes, which you see before it
  is pasted or saved, and can undo.
- **Answers are validated** against a schema before anything is pasted or written.
- **Credentials:** Saru never asks for, reads or stores a Claude login, API key or GitHub token.
  Claude Code and git use their own.
- **Your notes** stay in a local folder and, if you set one, a private GitHub repo. Saru refuses
  to sync to a public repo.
- **Permissions:** Accessibility and control of System Events, used only when you press the
  shortcut, to copy the focused text box and paste into it.

## Reporting a problem

Please don't open a public issue for a vulnerability. Use GitHub's
[private vulnerability reporting](https://github.com/AlvaroYmagawa/saru/security/advisories/new)
with what you found and how to reproduce it. You'll get an answer within a week.
