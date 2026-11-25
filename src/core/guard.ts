import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The send guard: in Claude Code, a message to a person may only go out through a tool (Slack,
 * Notion comment, Gmail) if its text went through Saru's polish first. Polishing marks the text;
 * the PreToolUse hook lets a send through only when its text carries a mark.
 */

/** How long a polished text stays sendable. */
export const MARK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MARKS = 300;

export function marksFile(): string {
  return process.env.SARU_MARKS_FILE ?? path.join(os.homedir(), ".local", "state", "saru", "polished.json");
}

/**
 * The words of a message, without what differs between the copy Saru wrote and what a tool posts:
 * markup (HTML, Markdown, Slack/Notion mention tags), @mentions, punctuation, case, spacing.
 */
export function normalise(text: string): string {
  return text
    .replace(/<mention[^>]*\/?>(?:<\/mention>)?/gi, " ")
    .replace(/<[@#!][^>]*>/g, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, " ")
    .replace(/@[\p{Lu}][\p{L}'’.-]*(?:[  ][\p{Lu}][\p{L}'’.-]*){0,2}/gu, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function fingerprint(text: string): string {
  return createHash("sha256").update(normalise(text)).digest("hex");
}

type Marks = Record<string, number>;

async function readMarks(file = marksFile()): Promise<Marks> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Marks;
  } catch {
    return {};
  }
}

/** Records that `text` is a message Saru wrote (or one the user chose to send word for word). */
export async function mark(text: string, now = Date.now(), file = marksFile()): Promise<string> {
  const marks = await readMarks(file);
  const fp = fingerprint(text);
  marks[fp] = now;
  const kept = Object.entries(marks)
    .filter(([, at]) => now - at < MARK_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MARKS);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(kept)));
  await fs.rename(tmp, file);
  return fp;
}

export async function isMarked(text: string, now = Date.now(), file = marksFile()): Promise<boolean> {
  const at = (await readMarks(file))[fingerprint(text)];
  return at !== undefined && now - at < MARK_TTL_MS;
}

/** The text of a message a tool is about to send, or undefined when the call sends no new text. */
export function messageText(toolName: string, input: Record<string, unknown>): string | undefined {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const tool = toolName.split("__").pop() ?? toolName;
  if (/^slack_(send_message|send_message_draft|schedule_message)$/.test(tool)) return str(input.message);
  if (tool === "notion-create-comment") {
    if (str(input.markdown)) return str(input.markdown);
    if (Array.isArray(input.rich_text)) {
      const parts = input.rich_text.map((r) => {
        const t = (r as { text?: { content?: unknown } }).text?.content;
        return typeof t === "string" ? t : "";
      });
      return str(parts.join(""));
    }
    return undefined;
  }
  if (/^(send_message|create_draft|reply|update_draft)$/.test(tool) && /gmail/i.test(toolName)) {
    if (tool === "send_message" && str(input.draftId)) return undefined; // the draft passed the guard when it was written
    return str(input.body) ?? str(input.htmlBody);
  }
  if (tool === "forward" && /gmail/i.test(toolName)) return str(input.forwardText) ?? str(input.htmlBody);
  return undefined;
}

export interface GuardDecision {
  allow: boolean;
  reason?: string;
}

export async function decide(toolName: string, input: Record<string, unknown>, now = Date.now(), file = marksFile()): Promise<GuardDecision> {
  if (process.env.SARU_GUARD === "off") return { allow: true };
  const text = messageText(toolName, input);
  if (text === undefined || !normalise(text)) return { allow: true };
  if (await isMarked(text, now, file)) return { allow: true };
  return {
    allow: false,
    reason:
      "Saru's send guard: this message hasn't been through Saru. Run the saru:polish skill on it " +
      "(it writes it in the user's voice with the recipient's and the channel's rules and marks it), " +
      "show the user the polished text, then send exactly that text. If the user asked to send their " +
      "own words unchanged, mark them first with `saru mark` (see saru:polish).",
  };
}
