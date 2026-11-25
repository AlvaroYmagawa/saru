import path from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { addChannelByPrompt, addRulesByPrompt, editPersonByPrompt, Polisher, updateRules, type AgentEnv, type RuleScope } from "../core/agents";
import { parseWindow } from "../core/channel";
import { ClaudeError, findInLoginShell } from "../core/claude";
import { DEFAULT_SHORTCUT, loadSettings, resolveDataDir, saveSettings, Settings } from "../core/config";
import { Channel, Person, Profile, Rule, formatZodError } from "../core/schema";
import { FileStore } from "../core/store";
import { DataSync } from "../core/sync";
import type { DataSnapshot, PanelState, Result, ShortcutResult } from "../shared/api";
import { fakeBridge, macBridge, type OsBridge } from "./macos";

const E2E = process.env.SARU_E2E === "1";
const os: OsBridge = E2E ? fakeBridge() : macBridge;

let settings: Settings;
let store: FileStore;
let sync: DataSync;
let loginEnv: { claude?: string; env: NodeJS.ProcessEnv } = { env: process.env };
let tray: Tray | undefined;
let panel: BrowserWindow | undefined;
let main: BrowserWindow | undefined;
let polisher: Polisher | undefined;
let target: { app: string } | undefined;
let panelState: PanelState | undefined;
let activeShortcut: string | undefined;

if (!app.requestSingleInstanceLock()) app.quit();

function resource(...p: string[]): string {
  // Packaged: Contents/Resources/…; from a clone: the repo root.
  return app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, "..", ...p);
}

function agentEnv(): AgentEnv {
  const claudePath = settings.claudePath || loginEnv.claude;
  if (!claudePath) throw new ClaudeError("not-found", "Couldn't find the claude command. Install Claude Code, or set its path in Settings.");
  return {
    claudePath,
    model: settings.model,
    timeoutSeconds: settings.timeoutSeconds,
    env: loginEnv.env,
    rulesFile: resource("plugin", "skills", "polish", "references", "rules.md"),
  };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

// ── Panel ────────────────────────────────────────────────────────────────────────────────────

function loadView(win: BrowserWindow, view: "panel" | "app"): void {
  void win.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { view } });
}

function ensurePanel(): BrowserWindow {
  if (panel && !panel.isDestroyed()) return panel;
  panel = new BrowserWindow({
    width: 560,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), additionalArguments: E2E ? ["--saru-e2e"] : [] },
  });
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadView(panel, "panel");
  panel.on("blur", () => {
    if (!E2E && panelState?.phase !== "loading" && panelState?.phase !== "changing") panel?.hide();
  });
  return panel;
}

function showPanel(): void {
  const win = ensurePanel();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  win.setPosition(Math.round(x + (width - 560) / 2), Math.round(y + 120));
  win.show();
  win.focus();
}

function setPanel(s: PanelState): void {
  panelState = s;
  ensurePanel().webContents.send("panel:state", s);
}

ipcMain.handle("panel:resize", (_e, height: number) => {
  if (!panel) return;
  const display = screen.getDisplayMatching(panel.getBounds());
  const max = Math.round(display.workArea.height * 0.8);
  panel.setSize(560, Math.min(max, Math.max(160, Math.round(height))));
});

async function startPolish(): Promise<void> {
  if (!E2E && !os.isTrusted(false)) {
    os.isTrusted(true);
    setPanel({ phase: "error", original: "", channel: "", error: "Saru needs Accessibility access to read and replace your message. Allow it in System Settings → Privacy & Security → Accessibility, then press the shortcut again." });
    showPanel();
    return;
  }
  let focused;
  try {
    focused = await os.captureFocused(settings.keystrokeDelayMs);
  } catch (e) {
    setPanel({ phase: "error", original: "", channel: "", error: `Couldn't read the message box: ${errorText(e)}` });
    showPanel();
    return;
  }
  target = { app: focused.app };
  const win = parseWindow(focused.app, focused.title);
  const channel = win.name ? `${labelFor(win.kind)} · ${win.name}` : labelFor(win.kind);
  setPanel({ phase: "loading", original: focused.text, channel });
  showPanel();
  try {
    polisher = new Polisher(store, agentEnv());
    const d = await polisher.draft(win, focused.text);
    setPanel({ phase: "ready", original: focused.text, channel: d.channel, message: d.message, recipient: d.recipient, note: d.note });
  } catch (e) {
    setPanel({ phase: "error", original: focused.text, channel, error: errorText(e) });
  }
}

function labelFor(kind: string): string {
  return ({ "slack-dm": "Slack DM", "slack-channel": "Slack channel", email: "Email", whatsapp: "WhatsApp", other: "Anywhere else" } as Record<string, string>)[kind] ?? kind;
}

ipcMain.handle("panel:accept", async () => {
  const s = panelState;
  if (!s?.message || !target) return;
  panel?.hide();
  if (!E2E) app.hide();
  await os.replaceFocused(target.app, s.message, settings.keystrokeDelayMs);
  if (E2E) setPanel({ ...s, note: `Pasted into ${target.app}.` });
});

ipcMain.handle("panel:change", async (_e, text: string) => {
  const s = panelState;
  if (!s || !polisher) return;
  setPanel({ ...s, phase: "changing", error: undefined });
  try {
    const d = await polisher.change(text);
    setPanel({ ...s, phase: "ready", message: d.message, recipient: d.recipient, note: d.note, error: undefined });
  } catch (e) {
    setPanel({ ...s, phase: s.message ? "ready" : "error", error: errorText(e) });
  }
});

ipcMain.handle("panel:close", () => {
  panel?.hide();
});

ipcMain.handle("test:trigger", () => (E2E ? startPolish() : undefined));
ipcMain.handle("test:pasted", () => (E2E ? (os as ReturnType<typeof fakeBridge>).pasted : []));

// ── Data ─────────────────────────────────────────────────────────────────────────────────────

async function snapshot(): Promise<DataSnapshot> {
  const [profile, people, channels] = await Promise.all([store.getProfile(), store.listPeople(), store.listChannels()]);
  return { profile, people: people.items, channels: channels.items, invalid: [...people.invalid, ...channels.invalid], dataDir: store.dir };
}

let dataTimer: NodeJS.Timeout | undefined;
function dataChanged(): void {
  sync?.changed();
  clearTimeout(dataTimer);
  dataTimer = setTimeout(async () => {
    const snap = await snapshot();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("data:changed", snap);
  }, 50);
}

ipcMain.handle("data:get", () => snapshot());
ipcMain.handle("rules:add", (_e, scope: RuleScope, request: string) => attempt(() => addRulesByPrompt(store, scope, request, agentEnv())));
ipcMain.handle("rules:edit", (_e, scope: RuleScope, rule: Rule) =>
  attempt(() => {
    const parsed = Rule.safeParse(rule);
    if (!parsed.success) throw new Error(formatZodError(parsed.error));
    return updateRules(store, scope, (rs) => {
      if (!rs.some((r) => r.id === rule.id)) throw new Error("That rule no longer exists.");
      return rs.map((r) => (r.id === rule.id ? parsed.data : r));
    });
  }),
);
ipcMain.handle("rules:delete", (_e, scope: RuleScope, id: string) =>
  attempt(async () => {
    let removed: { rule: Rule; index: number } | undefined;
    await updateRules(store, scope, (rs) => {
      const index = rs.findIndex((r) => r.id === id);
      if (index < 0) throw new Error("That rule no longer exists.");
      removed = { rule: rs[index]!, index };
      return rs.filter((r) => r.id !== id);
    });
    return removed!;
  }),
);
ipcMain.handle("rules:restore", (_e, scope: RuleScope, rule: Rule, index: number) =>
  attempt(() => updateRules(store, scope, (rs) => (rs.some((r) => r.id === rule.id) ? rs : [...rs.slice(0, index), rule, ...rs.slice(index)]))),
);
ipcMain.handle("person:tell", (_e, request: string, selected?: string) => attempt(() => editPersonByPrompt(store, request, selected, agentEnv())));
ipcMain.handle("person:restore", (_e, before: Person | undefined, after: Person) =>
  attempt(async () => {
    if (before) await store.savePerson(before);
    else await store.deletePerson(after.slug);
  }),
);
ipcMain.handle("person:delete", (_e, slug: string) =>
  attempt(async () => {
    const p = await store.getPerson(slug);
    if (!p) throw new Error("That person no longer exists.");
    await store.deletePerson(slug);
    return p;
  }),
);
ipcMain.handle("person:save", (_e, p: Person) => attempt(() => store.savePerson(Person.parse(p))));
ipcMain.handle("channel:add", (_e, request: string) => attempt(() => addChannelByPrompt(store, request, agentEnv())));
ipcMain.handle("channel:delete", (_e, id: string) =>
  attempt(async () => {
    const c = await store.getChannel(id);
    if (!c) throw new Error("That channel no longer exists.");
    await store.deleteChannel(id);
    return c;
  }),
);
ipcMain.handle("channel:save", (_e, c: Channel) => attempt(() => store.saveChannel(Channel.parse(c))));
ipcMain.handle("profile:save", (_e, p: Profile) => attempt(() => store.saveProfile(Profile.parse(p))));

// ── Settings, shortcut, sync ─────────────────────────────────────────────────────────────────

function registerShortcut(accelerator: string): ShortcutResult {
  const previous = activeShortcut;
  if (previous) globalShortcut.unregister(previous);
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => void startPolish());
  } catch {
    if (previous) globalShortcut.register(previous, () => void startPolish());
    return { shortcut: previous ?? "", refused: `${accelerator} isn't a shortcut Saru can use.` };
  }
  if (!ok) {
    if (previous) globalShortcut.register(previous, () => void startPolish());
    return { shortcut: previous ?? "", refused: `${pretty(accelerator)} is already used by another app. Pick another.` };
  }
  activeShortcut = accelerator;
  refreshTray();
  return { shortcut: accelerator };
}

function pretty(acc: string): string {
  return acc.replace(/Command|Cmd|CommandOrControl/g, "⌘").replace(/Alt|Option/g, "⌥").replace(/Shift/g, "⇧").replace(/Control|Ctrl/g, "⌃").replace(/\+/g, "");
}

ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:save", (_e, next: Settings) =>
  attempt(async () => {
    const before = settings;
    const parsed = Settings.safeParse(next);
    if (!parsed.success) throw new Error(formatZodError(parsed.error));
    settings = await saveSettings({ ...parsed.data, shortcut: activeShortcut ?? parsed.data.shortcut });
    if (before.dataRepo !== settings.dataRepo || before.dataDir !== settings.dataDir) await startSync();
    return settings;
  }),
);
ipcMain.handle("shortcut:set", async (_e, accelerator: string) => {
  const r = registerShortcut(accelerator);
  if (!r.refused) settings = await saveSettings({ ...settings, shortcut: accelerator });
  return r;
});
ipcMain.handle("shortcut:suspend", (_e, on: boolean) => {
  if (on && activeShortcut) globalShortcut.unregister(activeShortcut);
  else if (!on && activeShortcut && !globalShortcut.isRegistered(activeShortcut)) globalShortcut.register(activeShortcut, () => void startPolish());
});
ipcMain.handle("sync:get", () => sync.current);
ipcMain.handle("sync:now", () => sync.syncNow());
ipcMain.handle("os:accessibility", () => ({ trusted: os.isTrusted(false) }));
ipcMain.handle("os:open-accessibility", () => os.openAccessibilitySettings());

async function startSync(): Promise<void> {
  sync?.stop();
  store = new FileStore(resolveDataDir(settings));
  await store.ensureSeed();
  store.onChange(() => dataChanged());
  sync = new DataSync(store.dir, settings.dataRepo, settings.syncDelaySeconds * 1000, {
    git: "/usr/bin/git",
    env: loginEnv.env,
    remoteUrl: process.env.SARU_E2E_REMOTE ? () => process.env.SARU_E2E_REMOTE! : undefined,
    visibility: E2E ? async (repo) => (repo.endsWith("-public") ? "public" : "private-or-missing") : undefined,
  });
  sync.onStatus((s) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("sync:status", s);
    refreshTray();
  });
  if (settings.dataRepo) await sync.connect();
  dataChanged();
}

// ── Windows and tray ─────────────────────────────────────────────────────────────────────────

function openMain(tab?: string): void {
  if (main && !main.isDestroyed()) {
    main.show();
    main.focus();
    if (tab) main.webContents.send("app:tab", tab);
    return;
  }
  main = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 720,
    minHeight: 480,
    title: "Saru",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#00000000",
    vibrancy: "sidebar",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), additionalArguments: E2E ? ["--saru-e2e"] : [] },
  });
  void main.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { view: "app", ...(tab ? { tab } : {}) } });
  main.once("ready-to-show", () => {
    main?.show();
    if (!E2E) app.dock?.show();
  });
  main.on("closed", () => {
    main = undefined;
    if (!E2E) app.dock?.hide();
  });
}

function refreshTray(): void {
  if (!tray) return;
  const s = sync?.current;
  const syncLine = !s || s.state === "off" ? "Sync off" : s.state === "error" || s.state === "refused" ? "Sync: needs attention" : s.state === "idle" ? "Synced" : "Syncing…";
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Polish message  ${activeShortcut ? pretty(activeShortcut) : ""}`, click: () => void startPolish() },
      { type: "separator" },
      { label: "People…", click: () => openMain("people") },
      { label: "Channels…", click: () => openMain("channels") },
      { label: "You…", click: () => openMain("you") },
      { label: "Settings…", click: () => openMain("settings") },
      { type: "separator" },
      { label: syncLine, enabled: false },
      { label: "Sync now", enabled: !!settings?.dataRepo, click: () => void sync.syncNow() },
      { type: "separator" },
      { label: "Quit Saru", role: "quit" },
    ]),
  );
}

app.whenReady().then(async () => {
  if (!E2E) app.dock?.hide();
  settings = await loadSettings().catch(() => Settings.parse({}));
  const found = E2E ? undefined : await findInLoginShell("claude");
  loginEnv = { claude: found?.path, env: found ? { ...process.env, PATH: found.envPath } : process.env };
  await startSync();

  const icon = nativeImage.createFromPath(resource("resources", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Saru");
  const r = registerShortcut(settings.shortcut || DEFAULT_SHORTCUT);
  refreshTray();
  ensurePanel();
  if (E2E || r.refused || process.argv.includes("--open")) openMain(r.refused ? "settings" : undefined);
});

app.on("window-all-closed", () => {
  // A menu-bar app keeps running with no windows.
});

app.on("will-quit", () => globalShortcut.unregisterAll());
