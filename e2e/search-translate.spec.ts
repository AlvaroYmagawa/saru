import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { claudeCalls, close, launch, triggerTranslate, type Launched } from "./helpers";

let l: Launched | undefined;
test.afterEach(async () => {
  await close(l);
  l = undefined;
});
const criterion = (text: string) => test.info().annotations.push({ type: "criterion", description: text });
const config = (l: Launched) => JSON.parse(readFileSync(l.configFile, "utf8"));

test("People has a search bar that filters the list as you type", async () => {
  criterion("Search — People can be filtered by name, role or org; Esc clears it");
  l = await launch();
  writeFileSync(path.join(l.dataDir, "people", "bo-chen.json"), JSON.stringify({ slug: "bo-chen", fullName: "Bo Chen", aliases: ["Bo"], role: "Designer", org: "Globex", intimacy: 3, rules: [] }));
  const search = l.main.getByTestId("people-search");
  await expect(l.main.getByTestId("person-bo-chen")).toBeVisible();
  await search.fill("globex");
  await expect(l.main.getByTestId("person-bo-chen")).toBeVisible();
  await expect(l.main.getByTestId("person-hana-mori")).toHaveCount(0);
  await search.fill("head of product");
  await expect(l.main.getByTestId("person-hana-mori")).toBeVisible();
  await expect(l.main.getByTestId("person-bo-chen")).toHaveCount(0);
  await search.fill("nobody here");
  await expect(l.main.getByTestId("people-no-match")).toContainText("No one matches");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(l.main.getByTestId("person-hana-mori")).toBeVisible();
  await expect(l.main.getByTestId("person-bo-chen")).toBeVisible();
});

test("Channels has a search bar that filters named channels and kinds", async () => {
  criterion("Search — Channels can be filtered by name, kind or about");
  l = await launch();
  await l.main.getByTestId("tab-channels").click();
  const search = l.main.getByTestId("channels-search");
  await l.main.keyboard.press("Meta+f");
  await expect(search).toBeFocused();
  await search.fill("#acme");
  await expect(l.main.getByTestId("channel-x-acme-dev")).toBeVisible();
  await expect(l.main.getByTestId("channel-email")).toHaveCount(0);
  await search.fill("email");
  await expect(l.main.getByTestId("channel-email")).toBeVisible();
  await expect(l.main.getByTestId("channel-x-acme-dev")).toHaveCount(0);
  await search.fill("zzz");
  await expect(l.main.getByTestId("channels-no-match")).toBeVisible();
});

test("The translate shortcut shows the selected text in PT-BR and copies it", async () => {
  criterion("Translate — the shortcut translates the selection into the language set in Settings (PT-BR by default)");
  l = await launch({ selection: "Can we move the release to Monday?" });
  await triggerTranslate(l);
  await expect(l.panel.getByTestId("panel-draft")).toHaveText("[pt-BR] Can we move the release to Monday?");
  await expect(l.panel.getByTestId("panel-original")).toHaveText("Can we move the release to Monday?");
  await expect(l.panel.getByTestId("panel-channel")).toHaveText("Translate into pt-BR");
  await expect(l.panel.getByTestId("panel-step")).toHaveText("From English");
  await expect(l.panel.getByTestId("panel-change")).toHaveCount(0);
  const args = claudeCalls(l).at(-1)!.args;
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  await l.panel.getByTestId("panel-paste").click();
  expect(await l.main.evaluate(() => (window as any).saru.testClipboard())).toBe("[pt-BR] Can we move the release to Monday?");
});

test("An empty selection says so instead of calling Claude", async () => {
  criterion("Translate — nothing selected is explained, no call is made");
  l = await launch({ selection: "" });
  await triggerTranslate(l);
  await expect(l.panel.getByTestId("panel-error")).toContainText("select some text");
  expect(claudeCalls(l)).toHaveLength(0);
});

test("The translate shortcut and language are set in Settings and saved", async () => {
  criterion("Translate — its shortcut and its language are configurable in Settings");
  l = await launch({ selection: "Thanks for the update" });
  await l.main.getByTestId("tab-settings").click();
  await expect(l.main.getByTestId("translate-shortcut")).toHaveText("⌥⌘T");
  await test.step("Record ⌃⌥Y as the translate shortcut", async () => {
    await l!.main.getByTestId("translate-shortcut").click();
    await l!.main.keyboard.press("Control+Alt+KeyY");
    await expect(l!.main.getByTestId("translate-shortcut")).toHaveText("⌃⌥Y");
    expect(await l!.app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered("Control+Alt+Y"), globalShortcut.isRegistered("Alt+Command+T"), globalShortcut.isRegistered("Alt+Command+P")])).toEqual([true, false, true]);
    expect(config(l!).translateShortcut).toBe("Control+Alt+Y");
  });
  await test.step("The polish shortcut can't be reused for translating", async () => {
    await l!.main.getByTestId("translate-shortcut").click();
    await l!.main.keyboard.press("Alt+Meta+KeyP");
    await expect(l!.main.getByTestId("toast")).toContainText("already Saru's shortcut for polishing");
    await expect(l!.main.getByTestId("translate-shortcut")).toHaveText("⌃⌥Y");
  });
  await test.step("Switch the language to Spanish and translate", async () => {
    await l!.main.getByTestId("translate-to").fill("es");
    await l!.main.getByTestId("translate-to").press("Enter");
    await expect(l!.main.getByTestId("toast")).toHaveText("Saved.");
    expect(config(l!).translateTo).toBe("es");
    await triggerTranslate(l!);
    await expect(l!.panel.getByTestId("panel-draft")).toHaveText("[es] Thanks for the update");
  });
});
