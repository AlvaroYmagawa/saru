import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { launch, readJson, type Launched, close } from "./helpers";

let l: Launched | undefined;
test.afterEach(async () => {
  await close(l);
  l = undefined;
});
const criterion = (text: string) => test.info().annotations.push({ type: "criterion", description: text });

test("Each person shows their own list of rules", async () => {
  criterion("R9 — every person has a list of rules in the app");
  l = await launch();
  await test.step("Open People and pick Hana", async () => {
    await l!.main.getByTestId("tab-people").click();
    await l!.main.getByTestId("person-hana-mori").click();
  });
  await expect(l.main.getByTestId("person-name")).toHaveText("Hana Mori");
  await expect(l.main.getByTestId("rule-text")).toHaveText(["Numbered lists for decisions."]);
});

test("Each channel kind and named channel shows its rules", async () => {
  criterion("R10 — every channel kind and named channel has a list of rules in the app");
  l = await launch();
  await l.main.getByTestId("tab-channels").click();
  await test.step("Every Email has its default rules", async () => {
    await l!.main.getByTestId("channel-email").click();
    await expect(l!.main.getByTestId("channel-name")).toHaveText("Every Email");
    await expect(l!.main.getByTestId("rule-text").first()).toContainText("greeting line");
  });
  await test.step("A named Slack channel has its own", async () => {
    await l!.main.getByTestId("channel-x-acme-dev").click();
    await expect(l!.main.getByTestId("channel-name")).toHaveText("#x-acme-dev");
    await expect(l!.main.getByTestId("rule-text")).toHaveText(["First name only."]);
  });
});

test("Pressing + and writing a sentence adds a structured rule straight away", async () => {
  criterion("R11 — + opens a box, the agent structures the rule and it is saved at once");
  l = await launch();
  await l.main.getByTestId("person-hana-mori").click();
  await test.step("Press + and say the rule in a sentence", async () => {
    await l!.main.getByTestId("rule-add").click();
    await l!.main.getByTestId("rule-request").fill("never use kindly with her");
    await l!.main.getByTestId("rule-request").press("Enter");
  });
  await test.step("The new rule shows up, highlighted, with its category", async () => {
    await expect(l!.main.getByTestId("rule")).toHaveCount(2);
    await expect(l!.main.getByTestId("rules-avoid").locator(".rule.fresh")).toHaveCount(1);
  });
  await test.step("It is saved in Hana's file", async () => {
    const hana = readJson(l!, "people/hana-mori.json");
    expect(hana.rules).toHaveLength(2);
    expect(hana.rules[1]).toMatchObject({ category: "avoid", text: expect.stringContaining("kindly") });
  });
});

test("A request that isn't a writing rule saves nothing and says why", async () => {
  criterion("R12 — an unusable rule request writes nothing and shows the reason");
  l = await launch();
  await l.main.getByTestId("person-hana-mori").click();
  await l.main.getByTestId("rule-add").click();
  await l.main.getByTestId("rule-request").fill("she is the CFO now");
  await l.main.getByTestId("rule-request").press("Enter");
  await expect(l.main.getByTestId("toast")).toContainText("not a writing rule");
  expect(readJson(l, "people/hana-mori.json").rules).toHaveLength(1);
});

test("A broken answer from Claude saves nothing", async () => {
  criterion("R12 — an unusable rule request writes nothing and shows the reason");
  l = await launch({ claudeMode: "invalid" });
  await l.main.getByTestId("person-hana-mori").click();
  await l.main.getByTestId("rule-add").click();
  await l.main.getByTestId("rule-request").fill("always sign off with cheers");
  await l.main.getByTestId("rule-request").press("Enter");
  await expect(l.main.getByTestId("toast")).toContainText("wasn't JSON");
  expect(readJson(l, "people/hana-mori.json").rules).toHaveLength(1);
});

test("Editing a rule in place saves it; deleting it is undoable", async () => {
  criterion("R13 — editing a rule inline saves at once; deleting is direct with undo");
  l = await launch();
  await l.main.getByTestId("person-hana-mori").click();
  await test.step("Click the rule, change it and press Enter", async () => {
    await l!.main.getByTestId("rule-text").click();
    await l!.main.getByTestId("rule-edit").fill("Numbered lists for every decision, max five items.");
    await l!.main.getByTestId("rule-edit").press("Enter");
    await expect(l!.main.getByTestId("rule-text")).toHaveText(["Numbered lists for every decision, max five items."]);
    expect(readJson(l!, "people/hana-mori.json").rules[0].text).toBe("Numbered lists for every decision, max five items.");
  });
  await test.step("Delete it: it's gone from the file", async () => {
    await l!.main.getByTestId("rule").hover();
    await l!.main.getByTestId("rule-delete").click();
    await expect(l!.main.getByTestId("confirm")).toContainText("Delete this rule?");
    await l!.main.getByTestId("confirm-ok").click();
    await expect(l!.main.getByTestId("rule")).toHaveCount(0);
    expect(readJson(l!, "people/hana-mori.json").rules).toHaveLength(0);
  });
  await test.step("Undo brings it back", async () => {
    await l!.main.getByTestId("toast-undo").click();
    await expect(l!.main.getByTestId("rule-text")).toHaveText(["Numbered lists for every decision, max five items."]);
    expect(readJson(l!, "people/hana-mori.json").rules).toHaveLength(1);
  });
});

test("A person's details change by prompt, and a new person can be added the same way", async () => {
  criterion("R14 — a person's fields change by prompt; a new person is added by prompt");
  l = await launch();
  await l.main.getByTestId("person-hana-mori").click();
  await test.step("Tell Saru Hana is the CFO now", async () => {
    await l!.main.getByTestId("tell").fill("Hana is our CFO now");
    await l!.main.getByTestId("tell").press("Enter");
    await expect(l!.main.getByTestId("toast")).toContainText("Updated Hana Mori");
    await expect(l!.main.getByTestId("person-role")).toHaveValue("CFO");
    const hana = readJson(l!, "people/hana-mori.json");
    expect(hana.role).toBe("CFO");
    expect(hana.rules).toHaveLength(1);
  });
  await test.step("Add someone new", async () => {
    await l!.main.getByTestId("tell").fill("new: Ana Lima, legal at Acme, keep it formal");
    await l!.main.getByTestId("tell").press("Enter");
    await expect(l!.main.getByTestId("person-name")).toHaveText("Ana Lima");
    expect(readJson(l!, "people/ana-lima.json")).toMatchObject({ fullName: "Ana Lima", intimacy: 1 });
  });
});

test("A named channel can be added by prompt", async () => {
  criterion("R10 — every channel kind and named channel has a list of rules in the app");
  l = await launch();
  await l.main.getByTestId("tab-channels").click();
  await l.main.getByTestId("channel-add").click();
  await l.main.getByTestId("channel-request").fill("#x-acme-ops, the client's ops channel");
  await l.main.getByTestId("channel-request").press("Enter");
  await expect(l.main.getByTestId("channel-name")).toHaveText("#x-acme-ops");
  expect(readJson(l, "channels/x-acme-ops.json")).toMatchObject({ kind: "slack-channel", match: "#x-acme-ops" });
});

test("Right-click offers Delete on a person, a channel and a rule, always after a confirmation", async () => {
  criterion("R31 — anything deletable has a right-click menu with Delete, and deleting asks first");
  l = await launch();
  await test.step("Right-click Hana, choose Delete, then cancel: she stays", async () => {
    await l!.main.getByTestId("person-hana-mori").click({ button: "right" });
    await l!.main.getByTestId("context-menu").getByRole("menuitem", { name: "Delete Hana Mori…" }).click();
    await expect(l!.main.getByTestId("confirm")).toContainText("Delete Hana Mori?");
    await l!.main.getByTestId("confirm-cancel").click();
    await expect(l!.main.getByTestId("confirm")).toHaveCount(0);
    expect(existsSync(path.join(l!.dataDir, "people", "hana-mori.json"))).toBe(true);
  });
  await test.step("Right-click a rule and delete it after confirming", async () => {
    await l!.main.getByTestId("rule").click({ button: "right" });
    await l!.main.getByTestId("context-menu").getByRole("menuitem", { name: "Delete rule…" }).click();
    await l!.main.getByTestId("confirm-ok").click();
    await expect(l!.main.getByTestId("rule")).toHaveCount(0);
    expect(readJson(l!, "people/hana-mori.json").rules).toHaveLength(0);
  });
  await test.step("Right-click Hana again and confirm: she's deleted", async () => {
    await l!.main.getByTestId("person-hana-mori").click({ button: "right" });
    await l!.main.getByTestId("context-menu").getByRole("menuitem", { name: "Delete Hana Mori…" }).click();
    await l!.main.getByTestId("confirm-ok").click();
    await expect(l!.main.getByTestId("person-hana-mori")).toHaveCount(0);
    expect(existsSync(path.join(l!.dataDir, "people", "hana-mori.json"))).toBe(false);
  });
  await test.step("Right-click a named channel and delete it; a kind's defaults can't be deleted", async () => {
    await l!.main.getByTestId("tab-channels").click();
    await l!.main.getByTestId("channel-email").click({ button: "right" });
    await expect(l!.main.getByTestId("context-menu").getByRole("menuitem")).toBeDisabled();
    await l!.main.keyboard.press("Escape");
    await l!.main.getByTestId("channel-x-acme-dev").click({ button: "right" });
    await l!.main.getByTestId("context-menu").getByRole("menuitem", { name: "Delete #x-acme-dev…" }).click();
    await expect(l!.main.getByTestId("confirm")).toContainText("Delete #x-acme-dev?");
    await l!.main.getByTestId("confirm-ok").click();
    await expect(l!.main.getByTestId("channel-x-acme-dev")).toHaveCount(0);
    expect(existsSync(path.join(l!.dataDir, "channels", "x-acme-dev.json"))).toBe(false);
  });
});
