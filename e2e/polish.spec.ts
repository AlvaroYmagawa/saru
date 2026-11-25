import { expect, test } from "@playwright/test";
import { claudeCalls, launch, pasted, trigger, type Launched, close } from "./helpers";

let l: Launched | undefined;
test.afterEach(async () => {
  await close(l);
  l = undefined;
});

const criterion = (text: string) => test.info().annotations.push({ type: "criterion", description: text });
const describe = (text: string) => test.info().annotations.push({ type: "description", description: text });

test("A Slack DM draft is polished for Hana; Enter alone never pastes, ⌘↵ does", async () => {
  criterion("R4 — the shortcut reads the message box and the window it's in");
  criterion("R7 — the panel shows original, draft, recipient and channel; ⌘↵ or the Paste button pastes");
  criterion("R24 — a plain Enter never pastes, so the draft can't be sent by accident");
  describe("Presses the shortcut in a pretend Slack DM with Hana Mori, checks the panel, presses Enter (nothing happens) and then ⌘↵ (pastes).");
  l = await launch();
  await test.step("Press the shortcut in a Slack DM with Hana", async () => trigger(l!));
  await test.step("The panel shows Saru's mark, where it's going, the original and Saru's version", async () => {
    await expect(l!.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
    await expect(l!.panel.getByTestId("panel-step")).toHaveText("Ready to paste");
    await expect(l!.panel.locator(".panel-mark svg")).toHaveCount(1);
    await expect(l!.panel.getByTestId("panel-channel")).toHaveText("Slack DM · Hana Mori");
    await expect(l!.panel.getByTestId("panel-recipient")).toHaveText("for Hana Mori");
    await expect(l!.panel.getByTestId("panel-original")).toContainText("da pra mover o release");
    await expect(l!.panel.getByTestId("panel-draft")).toContainText("could we move the release to Monday?");
    await expect(l!.panel.getByTestId("panel-paste")).toHaveText(/Paste into Slack/);
  });
  await test.step("Enter alone pastes nothing and says how to paste", async () => {
    await l!.panel.getByTestId("panel-change").press("Enter");
    await expect(l!.panel.getByTestId("panel-hint")).toContainText("To paste, press ⌘↵");
    await l!.panel.waitForTimeout(500);
    expect(pasted(l!)).toEqual([]);
  });
  await test.step("⌘↵ pastes Saru's version", async () => {
    await l!.panel.getByTestId("panel-change").press("Meta+Enter");
    await expect.poll(() => pasted(l!)).toEqual([{ app: "Slack", text: expect.stringContaining("move the release to Monday") }]);
  });
});

test("The Paste button pastes Saru's version", async () => {
  criterion("R7 — the panel shows original, draft, recipient and channel; ⌘↵ or the Paste button pastes");
  l = await launch();
  await trigger(l);
  await expect(l.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
  await l.panel.getByTestId("panel-paste").click();
  await expect.poll(() => pasted(l!)).toEqual([{ app: "Slack", text: expect.stringContaining("move the release to Monday") }]);
});

test("Typing a change rewrites the draft in the same conversation", async () => {
  criterion("R7 — a typed change continues the same conversation and replaces the draft");
  l = await launch();
  await trigger(l);
  await expect(l.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
  await test.step("Ask for it shorter", async () => {
    await l!.panel.getByTestId("panel-change").fill("shorter");
    await l!.panel.getByTestId("panel-change").press("Enter");
  });
  await test.step("A new full draft replaces the old one", async () => {
    await expect(l!.panel.getByTestId("panel-draft")).toContainText("can we move the release to Monday?");
    await expect(l!.panel.getByTestId("panel-note")).toHaveText("Made it shorter.");
  });
  await test.step("The change resumed the first call's session", async () => {
    const calls = claudeCalls(l!);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args).toEqual(expect.arrayContaining(["-p", "Change: shorter", "--resume", "fake-session-1"]));
  });
});

test("The prompt carries Hana's, the DM's and the channel's rules, and Claude gets no tools", async () => {
  criterion("R6 — the prompt holds your, the person's and the channel's rules; claude runs with no tools");
  criterion("R5 — a named Slack channel is recognised from the window title");
  l = await launch({ title: "#x-acme-dev (Channel) - Acme - Slack" });
  await trigger(l);
  await expect(l.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
  await expect(l.panel.getByTestId("panel-channel")).toHaveText("Slack channel · #x-acme-dev");
  const args = claudeCalls(l)[0]!.args;
  const prompt = args[args.indexOf("-p") + 1]!;
  await test.step("Claude runs with no tools and none of the user's settings", async () => {
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toEqual(expect.arrayContaining(["--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands"]));
    expect(args.join(" ")).not.toContain("Bash");
  });
  await test.step("The prompt has the channel kind's, the named channel's and Hana's rules", async () => {
    expect(prompt).toContain("Give a little more context than in a DM");
    expect(prompt).toContain("First name only.");
    expect(prompt).toContain("Numbered lists for decisions.");
  });
});

for (const [name, opts, expected] of [
  ["Claude fails", { claudeMode: "fail" as const }, "Claude exited with status 1. API Error: overloaded"],
  ["Claude answers garbage", { claudeMode: "invalid" as const }, "Claude's answer wasn't JSON."],
  ["the message box is empty", { draft: "   " }, "Nothing to polish: the message box is empty."],
  ["claude isn't installed", { settings: { claudePath: "/nonexistent/claude" } }, "Couldn't run /nonexistent/claude."],
] as const) {
  test(`The panel explains it when ${name}`, async () => {
    criterion("R8 — failures show in the panel and nothing is pasted");
    l = await launch(opts);
    await trigger(l);
    await expect(l.panel.getByTestId("panel")).toHaveAttribute("data-phase", "error");
    await expect(l.panel.getByTestId("panel-error")).toHaveText(expected);
    await expect(l.panel.getByTestId("panel-paste")).toBeDisabled();
    await l.panel.keyboard.press("Meta+Enter");
    expect(pasted(l)).toEqual([]);
  });
}

test("A Notion comment keeps its mentions: named from People, and pasted back as real mentions", async () => {
  criterion("R36 — Notion @mentions are recovered from Notion's own clipboard data and pasted back as mentions");
  l = await launch({
    appName: "Notion",
    title: "App release | Notion",
    draft: "HI @Anonymous and @Anonymous ",
    custom: require("node:path").join(__dirname, "..", "test", "fixtures", "notion-copy.bin"),
  });
  await trigger(l);
  await expect(l.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
  await test.step("Saru sees who was mentioned, not @Anonymous", async () => {
    await expect(l!.panel.getByTestId("panel-original")).toHaveText("HI @Hana Mori and @Notion person 1");
    await expect(l!.panel.getByTestId("panel-draft")).toContainText("Hi @Hana Mori and @Notion person 1,");
  });
  await test.step("Pasting writes Notion's data back with both mentions", async () => {
    await l!.panel.getByTestId("panel-paste").click();
    await expect.poll(() => pasted(l!).length).toBe(1);
    const editing = JSON.parse(pasted(l!)[0]!.custom!["text/_notion-text-production"]!).editing;
    expect(editing.filter((s: unknown[]) => s[0] === "‣").map((s: [string, [string, string][]]) => s[1][0]![1])).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ]);
  });
});
