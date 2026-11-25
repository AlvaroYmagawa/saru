import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { clipboard, ClipboardItem, systemPreferences, shell } from "electron";

/**
 * Talking to the app you're writing in, without native code: AppleScript through System Events
 * reads the focused window and presses ⌘A ⌘C / ⌘A ⌘V. macOS asks once for Accessibility (and for
 * permission to control System Events) for Saru.
 */
export interface Focused {
  app: string;
  title: string;
  text: string;
}

export interface OsBridge {
  isTrusted(prompt: boolean): boolean;
  openAccessibilitySettings(): void;
  captureFocused(delayMs: number): Promise<Focused>;
  replaceFocused(app: string, text: string, delayMs: number): Promise<void>;
}

function osascript(script: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", script], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.replace(/\n$/, ""));
    });
  });
}

const asString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Every format on the clipboard, read in full so it can be put back exactly. */
type ClipSnapshot = ClipboardItem[];

async function snapshot(): Promise<ClipSnapshot> {
  try {
    const items = await clipboard.read();
    return await Promise.all(
      items.map(async (item) => {
        const entries = await Promise.all(item.types.map(async (t) => [t, await item.getType(t)] as const));
        return new ClipboardItem(Object.fromEntries(entries) as ConstructorParameters<typeof ClipboardItem>[0]);
      }),
    );
  } catch {
    return [];
  }
}

async function restore(s: ClipSnapshot): Promise<void> {
  if (s.length) await clipboard.write(s).catch(() => clipboard.clear());
  else clipboard.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const macBridge: OsBridge = {
  isTrusted: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),

  openAccessibilitySettings: () => {
    void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
  },

  async captureFocused(delayMs) {
    const saved = await snapshot();
    const sentinel = `saru-${Date.now()}-${Math.random()}`;
    await clipboard.writeText(sentinel);
    // One call: name the front app and window, then ⌘A ⌘C (key codes, so any keyboard layout works).
    const out = await osascript(`
      tell application "System Events"
        set p to first application process whose frontmost is true
        set appName to name of p
        set t to ""
        try
          set t to name of front window of p
        end try
        key code 0 using command down
        key code 8 using command down
      end tell
      return appName & linefeed & t`);
    const [app = "", ...rest] = out.split("\n");
    let text = "";
    for (let i = 0; i < 10; i++) {
      await sleep(Math.max(20, Math.round(delayMs / 3)));
      const now = await clipboard.readText();
      if (now !== sentinel) {
        text = now;
        break;
      }
    }
    await restore(saved);
    // → collapses the selection, so a stray key doesn't wipe the draft.
    await osascript(`tell application "System Events" to key code 124`).catch(() => undefined);
    return { app, title: rest.join("\n"), text };
  },

  async replaceFocused(app, text, delayMs) {
    const saved = await snapshot();
    await clipboard.writeText(text);
    await osascript(`
      tell application "System Events"
        try
          set frontmost of application process ${asString(app)} to true
        end try
        delay 0.15
        key code 0 using command down
        key code 9 using command down
      end tell`);
    await sleep(delayMs * 2);
    await restore(saved);
  },
};

/** Used by the e2e tests: a pretend focused app whose box holds `SARU_E2E_DRAFT`. */
export function fakeBridge(): OsBridge & { pasted: { app: string; text: string }[] } {
  const pasted: { app: string; text: string }[] = [];
  return {
    pasted,
    isTrusted: () => true,
    openAccessibilitySettings: () => undefined,
    async captureFocused() {
      return {
        app: process.env.SARU_E2E_APP ?? "Slack",
        title: process.env.SARU_E2E_TITLE ?? "Hana Mori (DM) - Acme - Slack",
        text: process.env.SARU_E2E_DRAFT ?? "",
      };
    },
    async replaceFocused(app, text) {
      pasted.push({ app, text });
      if (process.env.SARU_E2E_PASTE_FILE) writeFileSync(process.env.SARU_E2E_PASTE_FILE, JSON.stringify(pasted));
    },
  };
}

