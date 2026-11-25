import type { Person } from "./schema";

/**
 * Notion's own clipboard data. Copying in Notion (desktop or web) puts the text as plain text with
 * every @mention replaced by "@Anonymous", and the real content in Chromium's "web custom data":
 * a map whose `text/_notion-text-production` entry holds the text as segments, a mention being
 * `["‣", [["u", "<notion user id>"]]]`. Saru reads that to know who was mentioned, and writes it
 * back on paste so the mentions come back as real mentions.
 */

/** The macOS pasteboard type Chromium (and Electron) use for "web custom data". */
export const WEB_CUSTOM_DATA = 'electron application/osclipboard;format="org.chromium.web-custom-data"';
export const NOTION_TEXT = "text/_notion-text-production";
export const NOTION_SOURCE = "text/_notion-page-source-production";
const MENTION_MARK = "‣";

/** Chromium's pickled map of string16 → string16: [size][count] then (len, UTF-16, pad to 4) pairs. */
export function parseCustomData(buf: Uint8Array): Map<string, string> {
  const b = Buffer.from(buf);
  const out = new Map<string, string>();
  if (b.length < 8) return out;
  let o = 4;
  const u32 = () => {
    if (o + 4 > b.length) throw new Error("truncated");
    const v = b.readUInt32LE(o);
    o += 4;
    return v;
  };
  const s16 = () => {
    const n = u32();
    if (o + n * 2 > b.length) throw new Error("truncated");
    const s = b.subarray(o, o + n * 2).toString("utf16le");
    o += n * 2;
    o = (o + 3) & ~3;
    return s;
  };
  try {
    const count = u32();
    for (let i = 0; i < count && i < 64; i++) out.set(s16(), s16());
  } catch {
    return new Map();
  }
  return out;
}

export function buildCustomData(map: Map<string, string>): Buffer {
  const parts: Buffer[] = [];
  const u32 = (v: number) => {
    const x = Buffer.alloc(4);
    x.writeUInt32LE(v);
    parts.push(x);
  };
  const s16 = (s: string) => {
    u32(s.length);
    const data = Buffer.from(s, "utf16le");
    parts.push(data);
    const pad = (4 - (data.length % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
  };
  u32(map.size);
  for (const [k, v] of map) {
    s16(k);
    s16(v);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

type Segment = [string] | [string, unknown[]];

export interface NotionCopy {
  /** The draft with each mention written as "@Full Name". */
  text: string;
  /** "@Full Name" → Notion user id, for every mention in the draft. */
  mentions: Map<string, string>;
  /** Where it was copied from; written back with the paste. */
  source?: string;
}

function mentionId(seg: Segment): string | undefined {
  if (seg[0] !== MENTION_MARK || !Array.isArray(seg[1])) return undefined;
  for (const a of seg[1]) if (Array.isArray(a) && a[0] === "u" && typeof a[1] === "string") return a[1];
  return undefined;
}

/** Reads Notion's clipboard data; undefined when it isn't there or has no mentions to recover. */
export function readNotionCopy(data: Map<string, string>, people: Person[]): NotionCopy | undefined {
  const raw = data.get(NOTION_TEXT);
  if (!raw) return undefined;
  let editing: Segment[];
  try {
    editing = (JSON.parse(raw) as { editing?: Segment[] }).editing ?? [];
  } catch {
    return undefined;
  }
  const mentions = new Map<string, string>();
  let unknown = 0;
  const byId = new Map(people.filter((p) => p.notionUserId).map((p) => [p.notionUserId!, p]));
  const text = editing
    .map((seg) => {
      const id = mentionId(seg);
      if (!id) return typeof seg[0] === "string" ? seg[0] : "";
      const known = [...mentions].find(([, v]) => v === id)?.[0];
      if (known) return known;
      const person = byId.get(id);
      const label = person ? `@${person.fullName}` : `@Notion person ${++unknown}`;
      mentions.set(label, id);
      return label;
    })
    .join("");
  if (!mentions.size) return undefined;
  return { text, mentions, source: data.get(NOTION_SOURCE) };
}

/** The polished message as Notion clipboard data, with each "@Full Name" a real mention again. */
export function writeNotionCopy(message: string, copy: NotionCopy): Map<string, string> {
  const labels = [...copy.mentions.keys()].sort((a, b) => b.length - a.length);
  const editing: Segment[] = [];
  let rest = message;
  while (rest) {
    let at = -1;
    let hit = "";
    for (const l of labels) {
      const i = rest.indexOf(l);
      if (i >= 0 && (at < 0 || i < at)) {
        at = i;
        hit = l;
      }
    }
    if (at < 0) {
      editing.push([rest]);
      break;
    }
    if (at > 0) editing.push([rest.slice(0, at)]);
    editing.push([MENTION_MARK, [["u", copy.mentions.get(hit)!]]]);
    rest = rest.slice(at + hit.length);
  }
  const out = new Map<string, string>();
  if (copy.source) out.set(NOTION_SOURCE, copy.source);
  out.set(NOTION_TEXT, JSON.stringify({ editing, selection: { startIndex: 0, endIndex: message.length }, action: "copy" }));
  return out;
}
