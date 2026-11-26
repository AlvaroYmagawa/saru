import { describe, expect, it } from "vitest";
import type { ProcessRunner } from "../src/core/claude";
import { Settings } from "../src/core/config";
import { Channel, Person } from "../src/core/schema";
import { channelMatches, personMatches } from "../src/core/search";
import { translate, TRANSLATE_SYSTEM } from "../src/core/translate";

const hana = Person.parse({ slug: "hana-mori", fullName: "Hana Mori", aliases: ["HM"], role: "Head of Product", org: "Acme (client)", intimacy: 2 });
const joao = Person.parse({ slug: "joao-silva", fullName: "João Silva", aliases: [], intimacy: 3 });
const acme = Channel.parse({ id: "x-acme-dev", kind: "slack-channel", name: "#x-acme-dev", match: "#x-acme-dev", about: "Internal dev channel." });
const email = Channel.parse({ id: "email", kind: "email", name: "Email" });

describe("Search on People and Channels", () => {
  it("matches people by name, alias, role and org, in any case and order", () => {
    expect(personMatches(hana, "hana")).toBe(true);
    expect(personMatches(hana, "hm")).toBe(true);
    expect(personMatches(hana, "product acme")).toBe(true);
    expect(personMatches(hana, "mori legal")).toBe(false);
    expect(personMatches(hana, "  ")).toBe(true);
  });

  it("ignores accents and a leading @ or #", () => {
    expect(personMatches(joao, "joao")).toBe(true);
    expect(personMatches(joao, "@João")).toBe(true);
    expect(channelMatches(acme, "#acme")).toBe(true);
    expect(channelMatches(acme, "x-acme")).toBe(true);
  });

  it("matches channels by name, kind label and about", () => {
    expect(channelMatches(email, "email")).toBe(true);
    expect(channelMatches(acme, "slack")).toBe(true);
    expect(channelMatches(acme, "internal")).toBe(true);
    expect(channelMatches(acme, "whatsapp")).toBe(false);
  });
});

describe("Translate the selected text", () => {
  const answer = (structured: unknown): { run: ProcessRunner; calls: string[][] } => {
    const calls: string[][] = [];
    const run: ProcessRunner = async (_exe, args) => {
      calls.push(args);
      return { status: 0, stderr: "", stdout: JSON.stringify({ is_error: false, session_id: "s", structured_output: structured }) };
    };
    return { run, calls };
  };
  const env = (run: ProcessRunner) => ({ claudePath: "/bin/claude", model: "haiku", timeoutSeconds: 30, run });

  it("asks Claude, with no tools, for the text in the chosen language", async () => {
    const { run, calls } = answer({ translation: "Podemos mover o release para segunda?", from: "English" });
    const t = await translate("  Can we move the release to Monday?  ", "pt-BR", env(run));
    expect(t).toEqual({ translation: "Podemos mover o release para segunda?", from: "English" });
    const args = calls[0]!;
    expect(args[args.indexOf("-p") + 1]).toBe("Translate into: pt-BR\n\n<<<TEXT\nCan we move the release to Monday?\nTEXT>>>");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(TRANSLATE_SYSTEM);
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
  });

  it("refuses an empty selection without calling Claude", async () => {
    const { run, calls } = answer({ translation: "x", from: null });
    await expect(translate(" \n ", "pt-BR", env(run))).rejects.toThrow(/select some text/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an answer with no translation", async () => {
    const { run } = answer({ translation: "  ", from: null });
    await expect(translate("Hello", "pt-BR", env(run))).rejects.toThrow(/no translation/);
  });

  it("defaults to PT-BR with ⌥⌘T, and a language is required", () => {
    const s = Settings.parse({});
    expect(s.translateTo).toBe("pt-BR");
    expect(s.translateShortcut).toBe("Alt+Command+T");
    expect(Settings.safeParse({ translateTo: "  " }).success).toBe(false);
  });
});
