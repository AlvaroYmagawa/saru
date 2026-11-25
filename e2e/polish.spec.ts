import { expect, test } from "@playwright/test";
import { claudeCalls, launch, pasted, trigger, type Launched, close } from "./helpers";

let l: Launched | undefined;
test.afterEach(async () => {
  await close(l);
  l = undefined;
});

const criterion = (text: string) => test.info().annotations.push({ type: "criterion", description: text });
const describe = (text: string) => test.info().annotations.push({ type: "description", description: text });

test("A Slack DM draft is polished for Hana and pasted back on Enter", async () => {
  criterion("R4 — the shortcut reads the message box and the window it's in");
  criterion("R7 — the panel shows original, draft, recipient and channel; Enter pastes");
  describe("Presses the shortcut in a pretend Slack DM with Hana Mori and checks the panel, then pastes.");
  l = await launch();
  await test.step("Press the shortcut in a Slack DM with Hana", async () => trigger(l!));
  await test.step("The panel shows where it's going, the original and Saru's draft", async () => {
    await expect(l!.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
    await expect(l!.panel.getByTestId("panel-channel")).toHaveText("Slack DM · Hana Mori");
    await expect(l!.panel.getByTestId("panel-recipient")).toHaveText("for Hana Mori");
    await expect(l!.panel.getByTestId("panel-original")).toContainText("da pra mover o release");
    await expect(l!.panel.getByTestId("panel-draft")).toContainText("could we move the release to Monday?");
  });
  await test.step("Enter pastes the draft over the original", async () => {
    await l!.panel.getByTestId("panel-change").press("Enter");
    await expect.poll(() => pasted(l!)).toEqual([{ app: "Slack", text: expect.stringContaining("move the release to Monday") }]);
  });
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
    await l.panel.getByTestId("panel-change").press("Enter").catch(() => undefined);
    expect(pasted(l)).toEqual([]);
  });
}
