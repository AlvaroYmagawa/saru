import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { channelsFor, findPeople, parseWindow } from "../src/core/channel";
import { buildContext, renderContext } from "../src/core/context";
import { contentItemCount, importPerson, importTarget } from "../src/core/migrate";
import { Person } from "../src/core/schema";
import { FileStore, StoreError } from "../src/core/store";

const fx = (p: string) => readFileSync(path.join(__dirname, "fixtures", "notes", p), "utf8");
const tmpStore = () => new FileStore(mkdtempSync(path.join(os.tmpdir(), "saru-test-")));

describe("R2 — data is stored as validated, structured files", () => {
  it("seeds the profile and one defaults channel per kind, idempotently", async () => {
    const s = tmpStore();
    await s.ensureSeed();
    await s.ensureSeed();
    const ch = await s.listChannels();
    expect(ch.items.map((c) => c.id).sort()).toEqual(["email", "other", "slack-channel", "slack-dm", "whatsapp"]);
    expect((await s.getProfile()).outputLanguage).toBe("en-GB");
  });

  it("refuses an invalid person (intimacy outside 1–5) and writes nothing", async () => {
    const s = tmpStore();
    const bad = { slug: "ana", fullName: "Ana", intimacy: 7, aliases: [], about: "", rules: [] } as unknown as Person;
    await expect(s.savePerson(bad)).rejects.toBeInstanceOf(StoreError);
    expect(await s.getPerson("ana")).toBeUndefined();
  });

  it("refuses a rule without text", async () => {
    const s = tmpStore();
    const bad = Person.safeParse({ slug: "ana", fullName: "Ana", intimacy: 2, rules: [{ id: "abcdef1", text: "  ", category: "tone" }] });
    expect(bad.success).toBe(false);
    await expect(s.savePerson({ slug: "ana", fullName: "Ana", intimacy: 2, aliases: [], about: "", rules: [{ id: "abcdef1", text: "", category: "tone" }] })).rejects.toThrow(/rule needs text/);
  });

  it("writes atomically: no temp files are left and the file is complete JSON", async () => {
    const s = tmpStore();
    await s.savePerson(Person.parse({ slug: "ana-lima", fullName: "Ana Lima", intimacy: 3 }));
    const files = readdirSync(path.join(s.dir, "people"));
    expect(files).toEqual(["ana-lima.json"]);
    expect(JSON.parse(readFileSync(path.join(s.dir, "people", "ana-lima.json"), "utf8")).fullName).toBe("Ana Lima");
  });

  it("reports a broken file instead of dropping it silently", async () => {
    const s = tmpStore();
    await s.ensureSeed();
    writeFileSync(path.join(s.dir, "people", "broken.json"), "{ nope");
    const loaded = await s.listPeople();
    expect(loaded.items).toEqual([]);
    expect(loaded.invalid[0]?.file).toBe("people/broken.json");
  });

  it("keeps a kind's defaults: they can't be deleted", async () => {
    const s = tmpStore();
    await s.ensureSeed();
    await expect(s.deleteChannel("email")).rejects.toThrow(/can't be deleted/);
  });
});

describe("R3 — importing the old Markdown notes loses nothing", () => {
  it("imports a person: fields, about, and every bullet as a rule", () => {
    const text = fx("people/hana-mori.md");
    const { value, unmapped } = importPerson("hana-mori", text);
    expect(value).toMatchObject({ fullName: "Hana Mori", aliases: ["Hana", "HM"], intimacy: 2, slackUserId: "U000TEST01", org: "Acme (client)" });
    expect(value.about).toBe("Product lead on the Acme side. Signs off every release.");
    expect(value.rules.map((r) => [r.category, r.text])).toEqual([
      ["context", "Prefers numbered lists for decisions."],
      ["context", "Reads on her phone between meetings, so keep it scannable."],
      ["tone", 'Never use "kindly".'],
      ["tone", "Dry humour is fine once you know her."],
    ]);
    expect(unmapped).toEqual(["favourite_tea"]);
    expect(value.rules.length + 1).toBe(contentItemCount(text));
  });

  it("imports a named channel with its members, Slack id and table rows", () => {
    const { value } = importTarget("x-acme-dev", fx("targets/x-acme-dev/config.md"));
    expect(value).toMatchObject({ id: "x-acme-dev", kind: "slack-channel", match: "#x-acme-dev", intimacy: 4, members: ["hana-mori"], slackChannelId: "C000TEST01" });
    expect(value.rules.map((r) => r.category)).toEqual(["format", "avoid", "avoid"]);
    expect(value.rules[2]?.text).toBe('"do the needful" → just ask');
  });

  it("turns the fallback target into the 'anywhere else' defaults, keeping stray paragraphs", () => {
    const text = fx("targets/misc/config.md");
    const { value } = importTarget("misc", text);
    expect(value.id).toBe("other");
    expect(value.match).toBeUndefined();
    expect(value.rules.map((r) => r.text)).toEqual(["No emoji.", "Plain paragraph rule here."]);
  });

  it("is deterministic: the same note gives the same rule ids", () => {
    const a = importPerson("hana-mori", fx("people/hana-mori.md")).value.rules.map((r) => r.id);
    const b = importPerson("hana-mori", fx("people/hana-mori.md")).value.rules.map((r) => r.id);
    expect(a).toEqual(b);
  });
});

describe("R5 — the channel is read from the window", () => {
  const cases: [string, string, string, string | undefined][] = [
    ["Slack", "Hana Mori (DM) - Acme - Slack", "slack-dm", "Hana Mori"],
    ["Slack", "* Ana, Bruno (DM) - Acme - Slack", "slack-dm", "Ana, Bruno"],
    ["Slack", "(3) #x-acme-dev (Channel) - Acme - Slack", "slack-channel", "#x-acme-dev"],
    ["Slack", "general (Channel) - Acme - Slack", "slack-channel", "#general"],
    ["Google Chrome", "Re: Release plan - me@example.com - Gmail", "email", undefined],
    ["Mail", "Release plan", "email", undefined],
    ["WhatsApp", "WhatsApp", "whatsapp", undefined],
    ["TextEdit", "Untitled", "other", undefined],
  ];
  it.each(cases)("%s · %s → %s", (app, title, kind, name) => {
    const ctx = parseWindow(app, title);
    expect(ctx.kind).toBe(kind);
    expect(ctx.name).toBe(name);
  });
});

describe("R6 — the prompt carries the right rules", () => {
  it("includes the kind's rules, the named channel's, the recipient's and yours", async () => {
    const s = tmpStore();
    await s.ensureSeed();
    await s.savePerson(importPerson("hana-mori", fx("people/hana-mori.md")).value);
    await s.saveChannel(importTarget("x-acme-dev", fx("targets/x-acme-dev/config.md")).value);
    const profile = await s.getProfile();
    await s.saveProfile({ ...profile, rules: [{ id: "you000001", category: "tone", text: "Never sound like a robot." }] });
    const [p, ch, ppl] = await Promise.all([s.getProfile(), s.listChannels(), s.listPeople()]);

    const inChannel = renderContext(buildContext(parseWindow("Slack", "#x-acme-dev (Channel) - Acme - Slack"), p, ch.items, ppl.items));
    expect(inChannel).toContain("Give a little more context than in a DM");
    expect(inChannel).toContain("First name only.");
    expect(inChannel).toContain("Never sound like a robot.");
    expect(inChannel).not.toContain("Keep it short: one paragraph");

    const inDm = buildContext(parseWindow("Slack", "Hana (DM) - Acme - Slack"), p, ch.items, ppl.items);
    expect(inDm.recipients.map((x) => x.fullName)).toEqual(["Hana Mori"]);
    expect(renderContext(inDm)).toContain('Never use "kindly".');
    expect(channelsFor(inDm.window, ch.items).map((c) => c.id)).toEqual(["slack-dm"]);
  });

  it("finds people by full name, alias, then first name", () => {
    const people = [Person.parse({ slug: "hana-mori", fullName: "Hana Mori", aliases: ["HM"], intimacy: 2 })];
    expect(findPeople("hana mori", people)).toHaveLength(1);
    expect(findPeople("HM", people)).toHaveLength(1);
    expect(findPeople("Hana", people)).toHaveLength(1);
    expect(findPeople("Bruno", people)).toHaveLength(0);
  });
});
