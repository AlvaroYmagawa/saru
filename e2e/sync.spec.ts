import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, type Launched, close } from "./helpers";

let l: Launched | undefined;
test.afterEach(async () => {
  await close(l);
  l = undefined;
});
const criterion = (text: string) => test.info().annotations.push({ type: "criterion", description: text });

function bareRemote(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "saru-remote-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: dir });
  return dir;
}
const log = (remote: string) => execFileSync("git", ["log", "--format=%s", "main"], { cwd: remote, encoding: "utf8" }).trim().split("\n");

test("Connecting a private data repo pushes your notes, and every change follows", async () => {
  criterion("R17 — changes are committed and pushed to the data repo you set");
  const remote = bareRemote();
  l = await launch({ remote });
  await test.step("Set the private repo in Settings", async () => {
    await l!.main.getByTestId("tab-settings").click();
    await l!.main.getByTestId("data-repo").fill("me/saru-data");
    await l!.main.getByTestId("data-repo").press("Enter");
    await expect(l!.main.getByTestId("sync-foot")).toContainText("Synced to me/saru-data", { timeout: 15_000 });
  });
  await test.step("Change a rule: a commit for it reaches the repo", async () => {
    await l!.main.getByTestId("tab-people").click();
    await l!.main.getByTestId("person-hana-mori").click();
    await l!.main.getByTestId("rule-text").click();
    await l!.main.getByTestId("rule-edit").fill("Numbered lists, always.");
    await l!.main.getByTestId("rule-edit").press("Enter");
    await expect.poll(() => log(remote)[0], { timeout: 15_000 }).toBe("saru: update people/hana-mori.json");
  });
});

test("A public data repo is refused", async () => {
  criterion("R18 — sync refuses a public repo");
  l = await launch({ remote: bareRemote() });
  await l.main.getByTestId("tab-settings").click();
  await l.main.getByTestId("data-repo").fill("me/notes-public");
  await l.main.getByTestId("data-repo").press("Enter");
  await expect(l.main.getByTestId("sync-banner")).toContainText("me/notes-public is public: Saru only syncs to a private repo");
  await expect(l.main.getByTestId("sync-foot")).toContainText("Sync refused");
});
