import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray } from "electron";
import { addChannelByPrompt, addRulesByPrompt, editPersonByPrompt, Polisher, updateRules, type AgentEnv, type RuleScope } from "../core/agents";
import { channelsFor, findPeople, parseWindow, type WindowContext } from "../core/channel";
import { editProfileByPrompt, isBlankProfile, learnStyleFromSlack } from "../core/profile";
import { readNotionCopy, writeNotionCopy, type NotionCopy } from "../core/notion";
import { ClaudeError, findInLoginShell } from "../core/claude";
import { DEFAULT_SHORTCUT, loadSettings, resolveDataDir, saveSettings, Settings } from "../core/config";
import { Channel, Person, Profile, Rule, formatZodError, slugify } from "../core/schema";
import { FileStore } from "../core/store";
import { DataSync } from "../core/sync";
import type { DataSnapshot, PanelState, Result, ShortcutResult } from "../shared/api";
import { fakeBridge, macBridge, type OsBridge } from "./macos";

const E2E = process.env.SARU_E2E === "1";
/** The panel window: the card plus its 10px margin on each side. */
const PANEL_WIDTH = 640;
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
let askedForTrust = false;
let watcher: FSWatcher | undefined;

// e2e runs get their own profile, so they start even while the installed Saru is open.
if (E2E) app.setPath("userData", path.join(app.getPath("temp"), `saru-e2e-${process.pid}`));
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
    width: PANEL_WIDTH,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    // Only the card is drawn: no window material or window shadow behind it (that showed as a
    // second, grey frame around the card).
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
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
  win.setPosition(Math.round(x + (width - PANEL_WIDTH) / 2), Math.round(y + 120));
  win.show();
  // Take focus from the app you're writing in, so no key you press next reaches it.
  if (!E2E) app.focus({ steal: true });
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
  panel.setSize(PANEL_WIDTH, Math.min(max, Math.max(160, Math.round(height))));
});

async function startPolish(): Promise<void> {
  if (!E2E && !os.isTrusted(false)) {
    // macOS's own prompt, once per launch; after that the panel explains.
    if (!askedForTrust) {
      askedForTrust = true;
      os.isTrusted(true);
    }
    setPanel({
      phase: "error",
      original: "",
      channel: "",
      action: "open-accessibility",
      error:
        "Saru needs Accessibility access to read and replace your message. Turn Saru on in System Settings → Privacy & Security → Accessibility, then press the shortcut again.\n\n" +
        "Already on? macOS is holding the permission of another copy of Saru (an older or a different build). Select Saru there, remove it with −, then press the shortcut again and allow it.",
    });
    showPanel();
    return;
  }
  let focused;
  try {
    focused = await os.captureFocused(settings.keystrokeDelayMs);
  } catch (e) {
    setPanel({ phase: "error", original: "", channel: "", stage: undefined, error: `Couldn't read the message box: ${errorText(e)}` });
    showPanel();
    return;
  }
  target = { app: focused.app };
  // Notion puts "@Anonymous" in the plain text; its own data says who each mention is.
  const notion = focused.custom ? readNotionCopy(focused.custom, (await store.listPeople()).items) : undefined;
  lastCapture = { win: parseWindow(focused.app, focused.title), text: notion?.text ?? focused.text, app: focused.app, notion };
  showPanel();
  await draftLast();
}

let lastCapture: { win: WindowContext; text: string; app: string; notion?: NotionCopy } | undefined;

/** A named place (#channel, group…) the window names that Channels doesn't have yet. */
async function unknownChannel(win: WindowContext): Promise<string | null> {
  if (!win.name || win.kind === "slack-dm") return null;
  const channels = (await store.listChannels()).items;
  return channelsFor(win, channels).some((c) => c.match) ? null : win.name;
}

/** Writes Saru's version of the last captured draft (again, after notes were added). */
async function draftLast(added?: string): Promise<void> {
  if (!lastCapture) return;
  const { win, text, app: appName } = lastCapture;
  const channel = win.name ? `${labelFor(win.kind)} · ${win.name}` : labelFor(win.kind);
  const base = { original: text, channel, app: appName, added };
  setPanel({ ...base, phase: "loading", stage: "see" });
  let stage: PanelState["stage"] = "see";
  try {
    polisher = new Polisher(store, agentEnv());
    const d = await polisher.draft(win, text, (s) => {
      stage = s;
      setPanel({ ...base, phase: "loading", stage: s });
    });
    const people = (await store.listPeople()).items;
    const newPerson = d.newPerson && findPeople(d.newPerson, people).length === 0 ? d.newPerson : null;
    setPanel({ ...base, phase: "ready", stage: "speak", channel: d.channel, message: d.message, recipient: d.recipient, note: d.note, newPerson, newChannel: await unknownChannel(win) });
  } catch (e) {
    setPanel({ ...base, phase: "error", stage, error: errorText(e) });
  }
}

/** From the panel: add the new person or channel (with an optional hint), then rewrite. */
ipcMain.handle("panel:add", (_e, kind: "person" | "channel", name: string, hint: string) =>
  attempt(async () => {
    const env = agentEnv();
    const clean = name.trim();
    if (!clean) throw new Error("No name to add.");
    const how = hint.trim();
    if (kind === "person") {
      const slug = slugify(clean);
      if (!slug) throw new Error("That name can't be used.");
      if (!(await store.getPerson(slug))) {
        await store.savePerson(Person.parse({ slug, fullName: clean, aliases: [clean.split(/\s+/)[0]], intimacy: 2 }));
      }
      if (how) {
        await editPersonByPrompt(store, `${clean}: ${how}`, slug, env).catch(() => undefined);
        await addRulesByPrompt(store, { type: "person", slug }, how, env).catch(() => undefined);
      }
    } else {
      const win = lastCapture?.win;
      const ch = Channel.parse({ id: slugify(clean) || "channel", kind: win && win.kind !== "other" ? win.kind : "slack-channel", name: clean, match: clean });
      if (!(await store.getChannel(ch.id))) await store.saveChannel(ch);
      if (how) await addRulesByPrompt(store, { type: "channel", id: ch.id }, how, env).catch(() => undefined);
    }
    void draftLast(`Added ${clean}. Rewritten with ${kind === "person" ? "their" : "its"} notes.`);
  }),
);

// ── You: by prompt, and learned from Slack ───────────────────────────────────────────────────

ipcMain.handle("profile:tell", (_e, request: string) => attempt(() => editProfileByPrompt(store, request, agentEnv())));

let learning: Promise<unknown> | undefined;
function learnStyle(): Promise<Result<unknown>> {
  const broadcast = (s: { running: boolean; result?: string; error?: string }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("profile:learning", s);
  };
  if (learning) return learning as Promise<Result<unknown>>;
  broadcast({ running: true });
  const run = attempt(async () => {
    const r = await learnStyleFromSlack(store, agentEnv());
    broadcast({ running: false, result: `Learned your style from ${r.read} of your Slack messages.` });
    return r;
  }).then((r) => {
    if (!r.ok) broadcast({ running: false, error: r.error });
    learning = undefined;
    return r;
  });
  learning = run;
  return run;
}
ipcMain.handle("profile:learn", () => learnStyle());

function labelFor(kind: string): string {
  return ({ "slack-dm": "Slack DM", "slack-channel": "Slack channel", email: "Email", notion: "Notion comment", whatsapp: "WhatsApp", other: "Anywhere else" } as Record<string, string>)[kind] ?? kind;
}

ipcMain.handle("panel:accept", async () => {
  const s = panelState;
  if (!s?.message || !target) return;
  panel?.hide();
  if (!E2E) app.hide();
  // Back into Notion with its own data, so the mentions are real mentions again.
  const notion = lastCapture?.notion;
  await os.replaceFocused(target.app, s.message, settings.keystrokeDelayMs, notion ? writeNotionCopy(s.message, notion) : undefined);
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
    nativeTheme.themeSource = settings.theme;
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
  // Changes from elsewhere (the CLI, the Claude Code plugin, a pull) show up and sync too.
  watcher?.close();
  try {
    watcher = watch(store.dir, { recursive: true }, (_event, file) => {
      if (file && !String(file).startsWith(".git") && String(file).endsWith(".json")) dataChanged();
    });
  } catch {
    watcher = undefined;
  }
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
  nativeTheme.themeSource = settings.theme;
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
  // First run: no profile yet → learn the user's voice from their own Slack messages (read-only).
  const blank = isBlankProfile(await store.getProfile());
  if (blank && (!E2E || process.env.SARU_E2E_LEARN === "1")) {
    openMain("you");
    void learnStyle();
  } else if (E2E || r.refused || process.argv.includes("--open")) openMain(r.refused ? "settings" : undefined);
});

app.on("window-all-closed", () => {
  // A menu-bar app keeps running with no windows.
});

app.on("will-quit", () => globalShortcut.unregisterAll());
