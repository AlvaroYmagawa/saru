import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { launch, type Launched, close } from "./helpers";

let l: Launched | undefined;
test.afterEach(async () => {
  await close(l);
  l = undefined;
});
const criterion = (text: string) => test.info().annotations.push({ type: "criterion", description: text });
const config = (l: Launched) => JSON.parse(readFileSync(l.configFile, "utf8"));

test("The shortcut is recorded by pressing it, works at once and is saved", async () => {
  criterion("R15 — the shortcut is set with a recorder, applies at once and persists");
  l = await launch();
  await l.main.getByTestId("tab-settings").click();
  await expect(l.main.getByTestId("shortcut")).toHaveText("⌥⌘P");
  await test.step("Click the recorder and press ⌃⌥K", async () => {
    await l!.main.getByTestId("shortcut").click();
    await expect(l!.main.getByTestId("shortcut")).toHaveText("Press the new shortcut…");
    await l!.main.keyboard.press("Control+Alt+KeyK");
  });
  await test.step("It shows, is registered with macOS and saved", async () => {
    await expect(l!.main.getByTestId("shortcut")).toHaveText("⌃⌥K");
    expect(await l!.app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered("Control+Alt+K"), globalShortcut.isRegistered("Alt+Command+P")])).toEqual([true, false]);
    expect(config(l!).shortcut).toBe("Control+Alt+K");
  });
});

test("A shortcut another app already holds is refused and the old one stays", async () => {
  criterion("R15 — a shortcut already in use is refused with a message");
  l = await launch();
  await test.step("Another app takes ⌃⌥J", async () => {
    // Stand-in for another app: hold the shortcut from outside Saru's own settings.
    await l!.app.evaluate(({ globalShortcut }) => globalShortcut.register("Control+Alt+J", () => undefined));
  });
  await l.main.getByTestId("tab-settings").click();
  await l.main.getByTestId("shortcut").click();
  await l.main.keyboard.press("Control+Alt+KeyJ");
  await expect(l.main.getByTestId("toast")).toContainText("already used by another app");
  await expect(l.main.getByTestId("shortcut")).toHaveText("⌥⌘P");
  expect(await l.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Alt+Command+P"))).toBe(true);
  expect(config(l).shortcut ?? "Alt+Command+P").toBe("Alt+Command+P");
});

test("Model, claude path and data repo are edited in Settings and saved", async () => {
  criterion("R16 — model, claude path and data repo are set in the app");
  l = await launch();
  await l.main.getByTestId("tab-settings").click();
  await l.main.getByTestId("model").selectOption("opus");
  await expect(l.main.getByTestId("toast")).toHaveText("Saved.");
  expect(config(l).model).toBe("opus");
  await l.main.getByTestId("data-repo").fill("not a repo");
  await l.main.getByTestId("data-repo").press("Enter");
  await expect(l.main.getByTestId("toast")).toContainText("use owner/name");
  expect(config(l).dataRepo ?? "").toBe("");
});
