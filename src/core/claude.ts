import { execFile, spawn } from "node:child_process";
import os from "node:os";

export class ClaudeError extends Error {
  constructor(
    readonly code: "not-found" | "timeout" | "failed" | "invalid-output" | "empty",
    message: string,
  ) {
    super(message);
  }
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a process; swapped for a fake in tests. */
export type ProcessRunner = (exe: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<RunResult>;

export const runProcess: ProcessRunner = (exe, args, timeoutMs, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new ClaudeError("not-found", `Couldn't run ${exe}.`) : e);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (timedOut) reject(new ClaudeError("timeout", `No answer within ${Math.round(timeoutMs / 1000)}s.`));
      else resolve({ status, stdout, stderr });
    });
  });

/** `claude` from the login shell's PATH (apps opened from Finder don't inherit it). */
export function findInLoginShell(command: string): Promise<{ path: string; envPath: string } | undefined> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(shell, ["-lc", `command -v ${command}; printf '%s' "$PATH"`], { timeout: 10_000, cwd: os.homedir() }, (err, out) => {
      if (err) return resolve(undefined);
      const [first, ...rest] = out.split("\n");
      const p = first?.trim();
      resolve(p && p.startsWith("/") ? { path: p, envPath: rest.join("\n").trim() } : undefined);
    });
  });
}

export interface ClaudeCall {
  claudePath: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  schema: object;
  timeoutSeconds: number;
  resume?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The flags every Saru call uses: no tools at all (the draft and requests are untrusted text and
 * the context travels in the prompt), none of the user's settings, plugins, hooks, MCP servers
 * or slash commands, and our system prompt in place of Claude Code's.
 */
export function claudeArgs(c: ClaudeCall): string[] {
  const args = [
    "-p", c.prompt,
    "--model", c.model,
    "--output-format", "json",
    "--json-schema", JSON.stringify(c.schema),
    "--tools", "",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--system-prompt", c.systemPrompt,
  ];
  if (c.resume) args.push("--resume", c.resume);
  return args;
}

export interface ClaudeAnswer<T> {
  value: T;
  sessionId?: string;
}

/** Runs `claude -p` with a schema and returns the structured output, or a ClaudeError. */
export async function callClaude<T>(c: ClaudeCall, run: ProcessRunner = runProcess): Promise<ClaudeAnswer<T>> {
  const res = await run(c.claudePath, claudeArgs(c), c.timeoutSeconds * 1000, c.env);
  if (res.status !== 0) {
    const detail = res.stderr.trim().split("\n").pop() || res.stdout.trim().split("\n").pop() || "";
    throw new ClaudeError("failed", `Claude exited with status ${res.status}. ${detail}`.trim());
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(res.stdout) as Record<string, unknown>;
  } catch {
    throw new ClaudeError("invalid-output", "Claude's answer wasn't JSON.");
  }
  if (obj.is_error === true) {
    throw new ClaudeError("invalid-output", typeof obj.result === "string" ? obj.result : "Claude reported an error.");
  }
  const out = obj.structured_output;
  if (out === null || typeof out !== "object") throw new ClaudeError("invalid-output", "Claude's answer had no structured output.");
  return { value: out as T, sessionId: typeof obj.session_id === "string" ? obj.session_id : undefined };
}
