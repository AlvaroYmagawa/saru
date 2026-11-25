import type { Channel, ChannelKind, Person } from "./schema";

/** Where the message is going, read from the focused app and its window title. */
export interface WindowContext {
  app: string;
  title: string;
  kind: ChannelKind;
  /** The DM's name(s) or a channel as `#name`; absent when the title doesn't say. */
  name?: string;
}

const EMAIL_APPS = ["mail", "microsoft outlook", "outlook", "spark", "spark desktop", "superhuman", "mimestream", "airmail", "thunderbird"];

export function parseWindow(app: string, rawTitle: string): WindowContext {
  const title = rawTitle.trim();
  const appName = app.trim();
  const appLower = appName.toLowerCase();

  // Slack: `<name> (DM) - <workspace> - Slack`, `#<channel> (Channel) - <workspace> - Slack`,
  // sometimes prefixed by an unread marker such as `* ` or `(3) `.
  let head = title.split(" - ")[0] ?? title;
  head = head.replace(/^(\*\s*|\(\d+\)\s*)+/, "");
  const dm = head.match(/^(.*?)\s*\(DM\)\s*$/i);
  if (dm) return withName({ app: appName, title, kind: "slack-dm" }, dm[1]);
  const channel = head.match(/^(.*?)\s*\(Channel\)\s*$/i);
  if (channel) {
    const name = channel[1]?.trim();
    return withName({ app: appName, title, kind: "slack-channel" }, name && !name.startsWith("#") ? `#${name}` : name);
  }

  if (appLower === "whatsapp" || /(^|\s)WhatsApp\s*$/.test(title)) return { app: appName, title, kind: "whatsapp" };
  if (appLower === "notion" || /\s[-|–]\s?Notion\s*$/.test(title) || /^Notion\s*[-|–]/.test(title)) return { app: appName, title, kind: "notion" };
  if (EMAIL_APPS.includes(appLower) || /\s-\s(Gmail|Outlook)(\s|$)/.test(title) || /Outlook\s*$/.test(title)) {
    return { app: appName, title, kind: "email" };
  }
  return { app: appName, title, kind: "other" };
}

function withName(ctx: WindowContext, name: string | undefined): WindowContext {
  const n = name?.trim();
  return n ? { ...ctx, name: n } : ctx;
}

/** The kind's defaults, plus the named channel when one matches; specific last so its rules win. */
export function channelsFor(ctx: WindowContext, channels: Channel[]): Channel[] {
  const kindDefaults = channels.find((c) => c.id === ctx.kind && c.match === undefined);
  const named = ctx.name
    ? channels.find((c) => c.kind === ctx.kind && c.match !== undefined && same(c.match, ctx.name!))
    : undefined;
  return [kindDefaults, named].filter((c): c is Channel => c !== undefined);
}

/** Resolves a name to people: full name, then alias, then slug's first word. */
export function findPeople(name: string, people: Person[]): Person[] {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  const byFull = people.filter((p) => p.fullName.toLowerCase() === n);
  if (byFull.length) return byFull;
  const byAlias = people.filter((p) => p.aliases.some((a) => a.toLowerCase() === n));
  if (byAlias.length) return byAlias;
  const first = n.split(/\s+/)[0] ?? n;
  return people.filter((p) => p.slug.split("-")[0] === first);
}

/** Group DMs list several names: `Ana, Bruno (DM)`. */
export function dmNames(ctx: WindowContext): string[] {
  if (ctx.kind !== "slack-dm" || !ctx.name) return [];
  return ctx.name.split(",").map((s) => s.trim()).filter(Boolean);
}

function same(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/^#/, "");
  return norm(a) === norm(b);
}
