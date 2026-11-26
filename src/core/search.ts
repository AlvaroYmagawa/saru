import { KIND_LABELS, type Channel, type Person } from "./schema";

/** Lower case, no accents, no leading # or @: "João" and "joao" match, "#x-acme" and "x-acme" too. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function terms(query: string): string[] {
  return fold(query).split(/\s+/).map((t) => t.replace(/^[#@]+/, "")).filter(Boolean);
}

/** Every word of the query appears somewhere in the fields (in any order). */
function matches(fields: (string | undefined)[], query: string): boolean {
  const words = terms(query);
  if (!words.length) return true;
  const hay = fold(fields.filter(Boolean).join(" \u0000 "));
  return words.every((w) => hay.includes(w));
}

/** People search: name, nicknames, role, org and email. */
export function personMatches(p: Person, query: string): boolean {
  return matches([p.fullName, ...p.aliases, p.role, p.org, p.email, p.slug], query);
}

/** Channels search: the name the window shows, its kind and what it's about. */
export function channelMatches(c: Channel, query: string): boolean {
  return matches([c.name, c.match, c.id, KIND_LABELS[c.kind], c.about], query);
}
