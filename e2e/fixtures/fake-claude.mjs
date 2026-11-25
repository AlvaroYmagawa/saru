#!/usr/bin/env node
// Stands in for `claude -p` in the e2e tests: answers from the prompt, deterministically.
// FAKE_CLAUDE_MODE: ok (default) | fail | invalid | slow. Every call's arguments are appended
// to FAKE_CLAUDE_LOG (JSON lines) so tests can check the flags.
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const prompt = get("-p") ?? "";
const system = get("--system-prompt") ?? "";
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, at: Date.now() }) + "\n");
const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
const between = (a, b) => { const i = prompt.indexOf(a); const j = prompt.indexOf(b); return i >= 0 && j > i ? prompt.slice(i + a.length, j).trim() : ""; };
const out = (structured, session = "fake-session-1") => {
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, session_id: session, structured_output: structured }));
};
await new Promise((r) => setTimeout(r, mode === "slow" ? 60_000 : 700));
if (mode === "fail") { process.stderr.write("API Error: overloaded\n"); process.exit(1); }
if (mode === "invalid") { process.stdout.write("not json"); process.exit(0); }

if (system.includes("Saru app mode")) {
  if (prompt.startsWith("Change:")) {
    out({ message: "Hi Hana,\n\nQuick one: can we move the release to Monday?\n\nThanks", recipient: "Hana Mori", note: "Made it shorter." });
  } else {
    const draft = between("<<<DRAFT", "DRAFT>>>");
    const dm = prompt.match(/## Recipients from the window title\n(.+)/)?.[1] ?? "";
    const named = dm.startsWith("(none") ? null : dm;
    const channel = prompt.match(/## Channel: .*— (#[\w-]+)/)?.[1];
    out({ message: `Hi Hana,\n\nQuick one: could we move the release to Monday?Happy to talk it through.\n\nThanks`, recipient: channel ?? named, note: named ? null : "No one matched; wrote it at intimacy 2." });
  }
} else if (system.includes("writing rules for Saru")) {
  const req = between("<<<REQUEST", "REQUEST>>>");
  if (/role|cfo/i.test(req)) out({ rules: [], note: "That's a detail about the person, not a writing rule." });
  else out({ rules: [{ text: `Never use “kindly” — ${req.replace(/^never use /i, "").slice(0, 40)}`.trim(), category: "avoid" }], note: null });
} else if (system.includes("list of people")) {
  const req = between("<<<REQUEST", "REQUEST>>>");
  if (/^new:/i.test(req)) out({ action: "create", slug: null, person: { fullName: "Ana Lima", aliases: ["Ana"], role: "Legal", org: "Acme (client)", intimacy: 1, nativeLanguage: null, outputLanguage: null, timezone: null, email: null, about: "Legal at Acme." }, note: "Assumed intimacy 1 from “keep it formal”." });
  else out({ action: "edit", slug: "hana-mori", person: { fullName: "Hana Mori", aliases: ["Hana", "HM"], role: "CFO", org: "Acme (client)", intimacy: 2, nativeLanguage: "en", outputLanguage: null, timezone: "Europe/London", email: null, about: "Product lead on the Acme side. Signs off every release." }, note: null });
} else if (system.includes("named place")) {
  out({ action: "create", kind: "slack-channel", match: "#x-acme-ops", intimacy: 2, about: "Client ops channel.", note: null });
} else {
  out({});
}
