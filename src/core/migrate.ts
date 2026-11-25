import { Channel, Person, RuleCategory, slugify, type Rule } from "./schema";

/**
 * Imports the Markdown person and target notes used by the message-polisher skill before Saru
 * (frontmatter + `## Section` bullets) into Saru's JSON. Nothing is dropped silently: every
 * content line becomes a field, the `about` text or a rule, and anything else is reported.
 */

export interface MarkdownDoc {
  fields: Record<string, string | string[]>;
  sections: { title: string; lines: string[] }[];
}

export function parseMarkdownNote(text: string): MarkdownDoc {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const fields: MarkdownDoc["fields"] = {};
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    for (; i < lines.length && lines[i]!.trim() !== "---"; i++) {
      const m = lines[i]!.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) continue;
      fields[m[1]!] = parseYamlScalar(m[2]!);
    }
    i++;
  }
  const sections: MarkdownDoc["sections"] = [];
  let current: MarkdownDoc["sections"][number] | undefined;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      current = { title: h[1]!.trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      sections.push((current = { title: "", lines: [line] }));
    }
  }
  return { fields, sections };
}

function parseYamlScalar(raw: string): string | string[] {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
  }
  return unquote(v);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/** Bullets (continuation lines joined), paragraphs and table rows of a section, as plain items. */
export function sectionItems(lines: string[]): { bullets: string[]; paragraphs: string[]; ordered: string[] } {
  const bullets: string[] = [];
  const paragraphs: string[] = [];
  const ordered: { at: number; text: () => string }[] = [];
  let para: string[] = [];
  let inBullet = false;
  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      paragraphs.push(text);
      ordered.push({ at: ordered.length, text: () => text });
    }
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flushPara();
      bullets.push(bullet[1]!.trim());
      const i = bullets.length - 1;
      ordered.push({ at: ordered.length, text: () => bullets[i]! });
      inBullet = true;
    } else if (/^\s*\|/.test(line)) {
      flushPara();
      inBullet = false;
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length && !cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        bullets.push(cells.join(" → "));
        const i = bullets.length - 1;
        ordered.push({ at: ordered.length, text: () => bullets[i]! });
      }
    } else if (!line.trim()) {
      flushPara();
      inBullet = false;
    } else if (inBullet && /^\s+/.test(line)) {
      bullets[bullets.length - 1] += " " + line.trim();
    } else {
      inBullet = false;
      para.push(line.trim());
    }
  }
  flushPara();
  return { bullets, paragraphs, ordered: ordered.map((o) => o.text()) };
}

/** Table header rows (e.g. `Non-native → Native`) are kept too: they read as a rule's heading. */
export function categoryFor(sectionTitle: string): RuleCategory {
  const t = sectionTitle.toLowerCase();
  if (t.startsWith("tone") || t.includes("house rules") || t.includes("intimacy")) return "tone";
  if (t.includes("calque") || t.includes("tells") || t.includes("avoid") || t.includes("never")) return "avoid";
  if (t.includes("vocabulary") || t.includes("spell")) return "vocabulary";
  if (/(opening|closing|sending|mention|format|convention|structure)/.test(t)) return "format";
  return "context";
}

const ABOUT_SECTIONS = ["who they are", "what this target is"];

/** Deterministic rule ids, so re-running an import yields the same files. */
function ruleId(prefix: string, n: number): string {
  const base = slugify(prefix).replace(/-/g, "").slice(0, 10) || "rule";
  return `${base}${String(n).padStart(3, "0")}`.padEnd(6, "0").slice(0, 16);
}

function rulesAndAbout(doc: MarkdownDoc, idPrefix: string): { about: string; rules: Rule[] } {
  const about: string[] = [];
  const rules: Rule[] = [];
  for (const s of doc.sections) {
    const { ordered } = sectionItems(s.lines);
    if (ABOUT_SECTIONS.includes(s.title.toLowerCase())) {
      about.push(...ordered);
      continue;
    }
    const category = categoryFor(s.title);
    for (const text of ordered) {
      rules.push({ id: ruleId(idPrefix, rules.length + 1), category, text: clip(text) });
    }
  }
  return { about: about.join("\n\n"), rules };
}

function clip(text: string): string {
  return text.length <= 600 ? text : text.slice(0, 597).trimEnd() + "…";
}

function str(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v.join(", ") : v;
  return s.trim() ? s.trim() : undefined;
}

function list(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean);
}

const KNOWN_PERSON_FIELDS = new Set([
  "full_name", "aliases", "role", "org", "intimacy", "native_language", "output_language",
  "timezone", "email", "slack_user_id", "notion_user_id",
]);

export interface Imported<T> {
  value: T;
  /** Source fields with no home in Saru's schema: listed so the import report shows them. */
  unmapped: string[];
}

export function importPerson(fileSlug: string, text: string): Imported<Person> {
  const doc = parseMarkdownNote(text);
  const f = doc.fields;
  const fullName = str(f.full_name) ?? fileSlug;
  const intimacy = Number(str(f.intimacy) ?? "2");
  const { about, rules } = rulesAndAbout(doc, fileSlug);
  const value = Person.parse({
    slug: fileSlug,
    fullName,
    aliases: list(f.aliases),
    role: str(f.role),
    org: str(f.org),
    intimacy: Number.isInteger(intimacy) && intimacy >= 1 && intimacy <= 5 ? intimacy : 2,
    nativeLanguage: str(f.native_language),
    outputLanguage: str(f.output_language),
    timezone: str(f.timezone),
    email: str(f.email),
    slackUserId: str(f.slack_user_id),
    notionUserId: str(f.notion_user_id),
    about,
    rules,
  });
  return { value, unmapped: Object.keys(f).filter((k) => !KNOWN_PERSON_FIELDS.has(k)) };
}

const KNOWN_TARGET_FIELDS = new Set(["target", "venue", "channel_name", "channel_id", "intimacy", "recipients", "audience"]);

/**
 * A target with a channel name becomes a named Slack channel; `misc` (the fallback) becomes the
 * "anywhere else" defaults; any other target becomes a named place of its venue's kind.
 */
export function importTarget(targetName: string, text: string): Imported<Channel> {
  const doc = parseMarkdownNote(text);
  const f = doc.fields;
  const { about, rules } = rulesAndAbout(doc, targetName);
  const audience = str(f.audience);
  const intimacy = Number(str(f.intimacy));
  const channelName = str(f.channel_name);
  const venue = (str(f.venue) ?? "").toLowerCase();
  const base = {
    intimacy: Number.isInteger(intimacy) && intimacy >= 1 && intimacy <= 5 ? intimacy : undefined,
    members: list(f.recipients).map(slugify).filter(Boolean),
    slackChannelId: str(f.channel_id),
    about: [audience ? `Audience: ${audience}` : "", about].filter(Boolean).join("\n\n"),
    rules,
  };
  let value: Channel;
  if (targetName === "misc") {
    value = Channel.parse({ ...base, id: "other", kind: "other", name: "Anywhere else" });
  } else {
    const kind = channelName || venue.includes("channel") ? "slack-channel" : venue === "email" ? "email" : "slack-dm";
    const match = channelName ?? (kind === "slack-channel" ? `#${targetName}` : targetName);
    value = Channel.parse({ ...base, id: slugify(targetName), kind, name: match, match });
  }
  return { value, unmapped: Object.keys(f).filter((k) => !KNOWN_TARGET_FIELDS.has(k)) };
}

/** Non-empty content lines in a note's body, for the before/after count. */
export function contentItemCount(text: string): number {
  const doc = parseMarkdownNote(text);
  return doc.sections.reduce((n, s) => {
    const { bullets, paragraphs } = sectionItems(s.lines);
    return n + bullets.length + paragraphs.length;
  }, 0);
}
