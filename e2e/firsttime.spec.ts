import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { claudeCalls, close, launch, readJson, trigger, type Launched } from "./helpers";

let l: Launched | undefined;
test.afterEach(async () => {
  await close(l);
  l = undefined;
});
const criterion = (text: string) => test.info().annotations.push({ type: "criterion", description: text });

test("Writing to someone new: the panel offers to add them, and rewrites with their notes", async () => {
  criterion("R26 — a first message to someone not in People is added from the panel in one step and rewritten");
  l = await launch({ title: "Bo Chen (DM) - Acme - Slack" });
  await test.step("Polish a DM to Bo, who isn't in People", async () => {
    await trigger(l!);
    await expect(l!.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
    await expect(l!.panel.getByTestId("new-person")).toContainText("Bo Chen isn't in People yet.");
  });
  await test.step("Add Bo with a one-line hint", async () => {
    await l!.panel.getByTestId("new-person-open").click();
    await l!.panel.getByTestId("new-person-hint").fill("client at Acme, keep it formal");
    await l!.panel.getByTestId("new-person-hint").press("Enter");
  });
  await test.step("Bo is saved and the draft is rewritten with his notes", async () => {
    await expect(l!.panel.getByTestId("panel-added")).toHaveText("Added Bo Chen. Rewritten with their notes.");
    await expect(l!.panel.getByTestId("panel-draft")).toContainText("Bo's notes applied");
    await expect(l!.panel.getByTestId("new-person")).toHaveCount(0);
    const bo = readJson(l!, "people/bo-chen.json");
    expect(bo).toMatchObject({ fullName: "Bo Chen", role: "Client" });
    expect(bo.rules.length).toBeGreaterThan(0);
  });
});

test("Writing in a channel Saru doesn't know: it's added from the panel", async () => {
  criterion("R27 — a first message in a channel not in Channels is added from the panel in one step");
  l = await launch({ title: "#x-new-client (Channel) - Acme - Slack" });
  await trigger(l);
  await expect(l.panel.getByTestId("new-channel")).toContainText("#x-new-client isn't in Channels yet.");
  await l.panel.getByTestId("new-channel-open").click();
  await l.panel.getByTestId("new-channel-add").click();
  await expect(l.panel.getByTestId("panel-added")).toHaveText("Added #x-new-client. Rewritten with its notes.");
  expect(readJson(l, "channels/x-new-client.json")).toMatchObject({ kind: "slack-channel", match: "#x-new-client" });
});

test("With no profile, Saru learns your voice from your Slack messages, read-only", async () => {
  criterion("R28 — with no profile, Saru learns it from the user's own Slack messages, read-only");
  criterion("R29 — the profile is shown in the app and changes by prompt");
  process.env.SARU_E2E_LEARN = "1";
  try {
    l = await launch();
  } finally {
    delete process.env.SARU_E2E_LEARN;
  }
  await test.step("It opens on You and fills the profile from Slack", async () => {
    await expect(l!.main.getByTestId("learn-status")).toHaveText("Learned your style from 38 of your Slack messages.", { timeout: 15_000 });
    const you = readJson(l!, "profile.json");
    expect(you).toMatchObject({ name: "Kai", outputLanguage: "en-GB", about: "Short, direct messages; warm with teammates." });
    expect(you.rules.map((r: { text: string }) => r.text)).toEqual(["Sign off with just K.", "Never use exclamation marks."]);
  });
  await test.step("Claude could only read Slack: sending is denied, nothing else is allowed", async () => {
    const args = claudeCalls(l!).find((c) => c.args.includes("--permission-mode"))!.args;
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    const allow = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"));
    const deny = args.slice(args.indexOf("--disallowedTools") + 1);
    expect(allow.every((t) => /slack_(search|read|list)/.test(t))).toBe(true);
    expect(deny).toEqual(expect.arrayContaining(["mcp__plugin_slack_slack__slack_send_message", "mcp__claude_ai_Slack__slack_send_message"]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
  await test.step("Tell Saru about yourself in a sentence", async () => {
    await l!.main.getByTestId("you-tell").fill("I never use exclamation marks");
    await l!.main.getByTestId("you-tell").press("Enter");
    await expect(l!.main.getByTestId("toast")).toContainText("Updated your profile.");
  });
});

test("The theme can be set to light or dark in Settings", async () => {
  criterion("R30 — Settings switches between the light and dark themes");
  l = await launch();
  await l.main.getByTestId("tab-settings").click();
  await l.main.getByTestId("theme-light").click();
  await expect(l.main.getByTestId("theme-light")).toHaveAttribute("aria-checked", "true");
  expect(await l.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("light");
  // Electron's themeSource drives the windows' prefers-color-scheme (Playwright pins the media query, so the source is checked).
  await l.main.getByTestId("theme-dark").click();
  await expect.poll(() => l!.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("dark");
  expect(JSON.parse(readFileSync(l.configFile, "utf8")).theme).toBe("dark");
});
