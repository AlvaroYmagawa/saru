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
    expect(ch.items.map((c) => c.id).sort()).toEqual(["email", "notion", "other", "slack-channel", "slack-dm", "whatsapp"]);
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

describe("R25 — @mentions survive the polish", () => {
  it("finds mentions, including full names, and reports the ones the message lost", async () => {
    const { mentionsIn, missingMentions } = await import("../src/core/agents");
    const draft = "Hi @Rob Marriott ,\n\nGlad to hear that. cc @Ana and @Bo Chen";
    expect(mentionsIn(draft)).toEqual(["@Rob Marriott", "@Ana", "@Bo Chen"]);
    expect(missingMentions(draft, "Hi @Rob Marriott, cc @Ana and @Bo Chen")).toEqual([]);
    expect(missingMentions(draft, "Hi @Anonymous, cc @Ana and Bo")).toEqual(["@Rob Marriott", "@Bo Chen"]);
  });

  it("recognises a Notion window as a Notion comment", () => {
    expect(parseWindow("Notion", "Release plan").kind).toBe("notion");
    expect(parseWindow("Google Chrome", "Release plan | Notion").kind).toBe("notion");
  });
});

describe("R32 — the send guard lets only Saru's messages out", () => {
  it("normalises away markup, mentions and punctuation, so the posted form matches the polished one", async () => {
    const { fingerprint } = await import("../src/core/guard");
    const polished = "Hi @Rob Marriott,\n\nGlad to hear that. We'll release it to the stores.\n\nThanks";
    expect(fingerprint('Hi <mention url="user://abc" />,\n\n**Glad** to hear that. We\'ll release it to the stores.\nThanks')).toBe(fingerprint(polished));
    expect(fingerprint("Hi <@U123>, glad to hear that. We'll release it to the stores. Thanks")).toBe(fingerprint(polished));
    expect(fingerprint("Hi Rob, glad to hear that. We will ship it.")).not.toBe(fingerprint(polished));
  });

  it("reads the text of every sending tool, and ignores sends with no new text", async () => {
    const { messageText } = await import("../src/core/guard");
    expect(messageText("mcp__plugin_slack_slack__slack_send_message", { channel_id: "C1", message: "hi" })).toBe("hi");
    expect(messageText("mcp__claude_ai_Slack__slack_send_message_draft", { message: "hi" })).toBe("hi");
    expect(messageText("mcp__notion__notion-create-comment", { page_id: "p", markdown: "hi" })).toBe("hi");
    expect(messageText("mcp__notion__notion-create-comment", { page_id: "p", rich_text: [{ text: { content: "h" } }, { text: { content: "i" } }] })).toBe("hi");
    expect(messageText("mcp__claude_ai_Gmail__reply", { messageId: "m", body: "hi" })).toBe("hi");
    expect(messageText("mcp__claude_ai_Gmail__send_message", { draftId: "d" })).toBeUndefined();
    expect(messageText("mcp__claude_ai_Gmail__forward", { messageId: "m", forwardText: "fyi" })).toBe("fyi");
  });

  it("denies an unmarked message, allows it once marked, and forgets marks after a day", async () => {
    const { decide, mark } = await import("../src/core/guard");
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "saru-guard-")), "marks.json");
    const send = { channel_id: "C1", message: "Quick one: could we move the release to Monday?" };
    const t0 = Date.parse("2026-11-25T12:00:00Z");
    expect((await decide("mcp__plugin_slack_slack__slack_send_message", send, t0, file)).allow).toBe(false);
    await mark("Quick one: could we move the release to Monday?", t0, file);
    expect((await decide("mcp__plugin_slack_slack__slack_send_message", send, t0 + 60_000, file)).allow).toBe(true);
    expect((await decide("mcp__plugin_slack_slack__slack_send_message", send, t0 + 25 * 3600_000, file)).allow).toBe(false);
  });
});

describe("R36 — Notion mentions are read from Notion's own clipboard data and written back", () => {
  const fixture = () => readFileSync(path.join(__dirname, "fixtures", "notion-copy.bin"));
  it("reads and rebuilds Chromium's custom data byte for byte", async () => {
    const { buildCustomData, parseCustomData } = await import("../src/core/notion");
    const map = parseCustomData(fixture());
    expect([...map.keys()]).toEqual(["text/_notion-page-source-production", "text/_notion-text-production"]);
    expect(Buffer.compare(buildCustomData(map), fixture())).toBe(0);
  });

  it("names each mention from People, and turns names back into mentions on paste", async () => {
    const { parseCustomData, readNotionCopy, writeNotionCopy } = await import("../src/core/notion");
    const hana = Person.parse({ slug: "hana-mori", fullName: "Hana Mori", intimacy: 2, notionUserId: "00000000-0000-4000-8000-000000000003" });
    const copy = readNotionCopy(parseCustomData(fixture()), [hana])!;
    expect(copy.text).toBe("HI @Hana Mori and @Notion person 1 ");
    const back = writeNotionCopy("Hi @Hana Mori and @Notion person 1,\n\nThanks", copy);
    expect(JSON.parse(back.get("text/_notion-text-production")!).editing).toEqual([
      ["Hi "], ["‣", [["u", "00000000-0000-4000-8000-000000000003"]]], [" and "], ["‣", [["u", "00000000-0000-4000-8000-000000000004"]]], [",\n\nThanks"],
    ]);
    expect(back.get("text/_notion-page-source-production")).toContain("00000000-0000-4000-8000-000000000001");
  });

  it("ignores data that isn't Notion's or has no mentions", async () => {
    const { parseCustomData, readNotionCopy } = await import("../src/core/notion");
    expect(parseCustomData(new Uint8Array([1, 2, 3])).size).toBe(0);
    expect(readNotionCopy(new Map([["text/_notion-text-production", '{"editing":[["plain"]]}']]), [])).toBeUndefined();
  });
});
