import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, trigger } from "./helpers";

// Screenshots of every screen, light and dark, for the design review. Not a pass/fail check.
const out = process.env.SARU_SCREENS_DIR;
test.skip(!out, "set SARU_SCREENS_DIR to capture screenshots");

for (const scheme of ["light", "dark"] as const) {
  test(`Every screen in ${scheme} mode`, async () => {
    test.info().annotations.push({ type: "criterion", description: "R20 — Saru's brand and design on every screen" });
    mkdirSync(out!, { recursive: true });
    const l = await launch({ draft: "oi hana, da pra mover o release pra segunda? kindly let me know" });
    for (const p of [l.main, l.panel]) await p.emulateMedia({ colorScheme: scheme });
    await l.main.setViewportSize({ width: 1100, height: 720 });
    await l.main.getByTestId("person-hana-mori").click();
    await l.main.screenshot({ path: path.join(out!, `${scheme}-people.png`) });
    await l.main.getByTestId("rule-add").click();
    await l.main.getByTestId("rule-request").fill("never use kindly with her");
    await l.main.screenshot({ path: path.join(out!, `${scheme}-rule-add.png`) });
    await l.main.getByTestId("tab-channels").click();
    await l.main.getByTestId("channel-x-acme-dev").click();
    await l.main.screenshot({ path: path.join(out!, `${scheme}-channels.png`) });
    await l.main.getByTestId("tab-you").click();
    await l.main.screenshot({ path: path.join(out!, `${scheme}-you.png`) });
    await l.main.getByTestId("tab-settings").click();
    await l.main.screenshot({ path: path.join(out!, `${scheme}-settings.png`) });
    await trigger(l);
    await expect(l.panel.getByTestId("panel")).toHaveAttribute("data-phase", "ready");
    await l.panel.screenshot({ path: path.join(out!, `${scheme}-panel.png`), omitBackground: true });
    await l.app.close();
  });
}
