import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures");

export interface Launched {
  app: ElectronApplication;
  main: Page;
  panel: Page;
  dataDir: string;
  claudeLog: string;
  configFile: string;
  /** Set once the panel was shown, so its video is worth attaching. */
  panelUsed?: boolean;
}

export interface LaunchOpts {
  draft?: string;
  title?: string;
  appName?: string;
  claudeMode?: "ok" | "fail" | "invalid" | "slow";
  settings?: Record<string, unknown>;
  remote?: string;
  recordVideoDir?: string;
}

/** A fictional person and channel: the e2e data never holds real people. */
function seed(dataDir: string): void {
  mkdirSync(path.join(dataDir, "people"), { recursive: true });
  mkdirSync(path.join(dataDir, "channels"), { recursive: true });
  writeFileSync(path.join(dataDir, "people", "hana-mori.json"), JSON.stringify({
    slug: "hana-mori", fullName: "Hana Mori", aliases: ["Hana", "HM"], role: "Head of Product", org: "Acme (client)", intimacy: 2,
    nativeLanguage: "en", timezone: "Europe/London", about: "Product lead on the Acme side.",
    rules: [{ id: "hana000001", category: "format", text: "Numbered lists for decisions." }],
  }, null, 2));
  writeFileSync(path.join(dataDir, "channels", "x-acme-dev.json"), JSON.stringify({
    id: "x-acme-dev", kind: "slack-channel", name: "#x-acme-dev", match: "#x-acme-dev", intimacy: 4, members: ["hana-mori"],
    about: "Internal dev channel for Acme.", rules: [{ id: "acme000001", category: "format", text: "First name only." }],
  }, null, 2));
}

export async function launch(o: LaunchOpts = {}): Promise<Launched> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "saru-e2e-"));
  const dataDir = path.join(tmp, "data");
  seed(dataDir);
  const configFile = path.join(tmp, "config.json");
  const claudeLog = path.join(tmp, "claude.log");
  writeFileSync(configFile, JSON.stringify({ claudePath: path.join(fixtures, "fake-claude.mjs"), dataDir, syncDelaySeconds: 1, ...o.settings }));
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      SARU_E2E: "1",
      SARU_CONFIG: configFile,
      SARU_E2E_DRAFT: o.draft ?? "oi hana, da pra mover o release pra segunda? kindly let me know",
      SARU_E2E_TITLE: o.title ?? "Hana Mori (DM) - Acme - Slack",
      SARU_E2E_APP: o.appName ?? "Slack",
      FAKE_CLAUDE_MODE: o.claudeMode ?? "ok",
      FAKE_CLAUDE_LOG: claudeLog,
      SARU_E2E_PASTE_FILE: path.join(tmp, "pasted.json"),
      ...(o.remote ? { SARU_E2E_REMOTE: o.remote } : {}),
    },
    // SARU_RECORD=1 records every window (for the review page), one video each.
    ...(o.recordVideoDir || process.env.SARU_RECORD === "1"
      ? { recordVideo: { dir: o.recordVideoDir ?? test.info().outputPath("videos"), size: { width: 1100, height: 720 } } }
      : {}),
  });
  const pages = async () => app.windows();
  let main: Page | undefined;
  let panel: Page | undefined;
  await expect.poll(async () => {
    for (const w of await pages()) {
      const url = w.url();
      if (url.includes("view=panel")) panel = w;
      else if (url.includes("view=app")) main = w;
    }
    return !!main && !!panel;
  }, { timeout: 20_000 }).toBe(true);
  await main!.waitForSelector(".shell");
  return { app, main: main!, panel: panel!, dataDir, claudeLog, configFile };
}

export function pasted(l: Launched): { app: string; text: string }[] {
  const f = path.join(path.dirname(l.dataDir), "pasted.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
}

export function claudeCalls(l: Launched): { args: string[] }[] {
  if (!existsSync(l.claudeLog)) return [];
  return readFileSync(l.claudeLog, "utf8").trim().split("\n").filter(Boolean).map((x) => JSON.parse(x));
}

export function readJson(l: Launched, rel: string): any {
  return JSON.parse(readFileSync(path.join(l.dataDir, rel), "utf8"));
}

export async function trigger(l: Launched): Promise<void> {
  l.panelUsed = true;
  await l.main.evaluate(() => (window as any).saru.testTrigger());
}

/** Closes the app and, when recording, attaches the app window's video then the panel's. */
export async function close(l: Launched | undefined): Promise<void> {
  if (!l) return;
  const videos = [l.main.video(), l.panelUsed ? l.panel.video() : null];
  await l.app.close();
  if (process.env.SARU_RECORD !== "1") return;
  const roles = ["App window", "Panel"];
  for (const [i, v] of videos.entries()) {
    if (!v) continue;
    test.info().annotations.push({ type: "role", description: roles[i]! });
    await test.info().attach("video", { path: await v.path(), contentType: "video/webm" });
  }
}
