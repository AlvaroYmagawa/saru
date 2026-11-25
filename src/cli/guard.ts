// Claude Code PreToolUse hook: refuses a Slack, Notion-comment or Gmail send whose text didn't go
// through Saru's polish. Reads the hook's JSON on stdin; prints a deny decision, or nothing to allow.
import { decide } from "../core/guard";

async function main(): Promise<void> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let event: { tool_name?: string; tool_input?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return; // not a hook event we understand: never block on our own parsing
  }
  const d = await decide(event.tool_name ?? "", event.tool_input ?? {});
  if (!d.allow) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason } }));
  }
}

main().catch(() => undefined);
