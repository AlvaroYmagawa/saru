import { useEffect, useState } from "react";
import type { Settings, SyncStatus } from "../shared/api";
import { useToast } from "./toast";

const saru = window.saru;

/** `KeyboardEvent` → Electron accelerator; undefined until a non-modifier key is pressed. */
export function acceleratorFrom(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "code">): string | undefined {
  const code = e.code;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else key = ({ Space: "Space", Period: ".", Comma: ",", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`" } as Record<string, string>)[code];
  if (!key) return undefined;
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Command"].filter(Boolean) as string[];
  if (!mods.some((m) => m !== "Shift") && !/^F\d/.test(key)) return undefined;
  return [...mods, key].join("+");
}

export function prettyShortcut(acc: string): string {
  const map: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘", CommandOrControl: "⌘" };
  return acc.split("+").map((p) => map[p] ?? p).join("");
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange(v: string): void }) {
  const toast = useToast();
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    void saru.suspendShortcut(true);
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") return setListening(false);
      const acc = acceleratorFrom(e);
      if (!acc) return;
      setListening(false);
      const r = await saru.setShortcut(acc);
      if (r.refused) toast.show(r.refused, { bad: true });
      else {
        onChange(r.shortcut);
        toast.show(`Shortcut set to ${prettyShortcut(r.shortcut)}.`);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      void saru.suspendShortcut(false);
    };
  }, [listening]);
  return (
    <div className="actions">
      <button className={`btn recorder${listening ? " listening" : ""}`} data-testid="shortcut" onClick={() => setListening((l) => !l)}>
        {listening ? "Press the new shortcut…" : prettyShortcut(value)}
      </button>
      <span className="label">{listening ? "Esc cancels" : "Click, then press the keys you want"}</span>
    </div>
  );
}

export function SettingsPage({ sync }: { sync?: SyncStatus }) {
  const toast = useToast();
  const [s, setS] = useState<Settings>();
  const [ax, setAx] = useState<boolean>();
  useEffect(() => {
    void saru.getSettings().then(setS);
    void saru.accessibility().then((a) => setAx(a.trusted));
  }, []);
  if (!s) return <div />;

  const save = async (patch: Partial<Settings>) => {
    const r = await saru.saveSettings({ ...s, ...patch });
    if (!r.ok) return toast.show(r.error, { bad: true });
    setS(r.value);
    toast.show("Saved.");
  };

  return (
    <main className="sheet">
      <div className="sheet-inner">
        <div className="title">
          <h1>Settings</h1>
          <p>How Saru starts, which Claude it runs, and where your notes live.</p>
        </div>

        <section className="block">
          <div className="block-head"><h3>Appearance</h3></div>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(["system", "light", "dark"] as const).map((t) => (
              <button key={t} role="radio" aria-checked={s.theme === t} className={s.theme === t ? "on" : ""} data-testid={`theme-${t}`} onClick={() => void save({ theme: t })}>
                {t === "system" ? "Match macOS" : t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </section>

        <section className="block">
          <div className="block-head"><h3>Shortcut</h3><span className="hint">Starts a polish in any app</span></div>
          <ShortcutRecorder value={s.shortcut} onChange={(shortcut) => setS({ ...s, shortcut })} />
          <p className="label">In the panel, <kbd>⌘↵</kbd> or the Paste button pastes Saru's version. Enter alone never pastes, so it can't send your draft by accident.</p>
        </section>

        <section className="block">
          <div className="block-head"><h3>Claude</h3><span className="hint">Your own Claude Code, on your account</span></div>
          <div className="grid">
            <label>
              <span className="label">Model</span>
              <select className="field" data-testid="model" value={s.model} onChange={(e) => void save({ model: e.target.value })}>
                {["sonnet", "opus", "haiku"].concat(["sonnet", "opus", "haiku"].includes(s.model) ? [] : [s.model]).map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <Field label="Path to claude" value={s.claudePath} placeholder="Found automatically" onSave={(v) => void save({ claudePath: v.trim() })} />
            <Field label="Give up after (seconds)" value={String(s.timeoutSeconds)} onSave={(v) => Number(v) > 0 && void save({ timeoutSeconds: Number(v) })} />
          </div>
        </section>

        <section className="block">
          <div className="block-head"><h3>Your notes</h3><span className="hint">Kept in a private GitHub repo</span></div>
          {sync?.state === "refused" || sync?.state === "error" ? <div className="banner" data-testid="sync-banner">{sync.message}</div> : null}
          {sync?.state === "idle" && sync.message ? <div className="banner info">{sync.message}</div> : null}
          <div className="grid">
            <Field label="Private repo (owner/name)" value={s.dataRepo} testId="data-repo" placeholder="you/saru-data" onSave={(v) => void save({ dataRepo: v.trim() })} />
            <Field label="Folder on this Mac" value={s.dataDir} placeholder="~/.local/share/saru" onSave={(v) => void save({ dataDir: v.trim() })} />
          </div>
          <div className="actions">
            <button className="btn" data-testid="sync-now" disabled={!s.dataRepo} onClick={async () => { const r = await saru.syncNow(); toast.show(r.state === "idle" ? "Synced." : r.message ?? r.state, { bad: r.state !== "idle" }); }}>Sync now</button>
            <span className="label" data-testid="sync-state">{sync?.state === "idle" && sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}` : sync?.state === "off" ? "Sync is off" : ""}</span>
          </div>
          <p className="label">Each change is committed and pushed with your own git login. Saru refuses a public repo.</p>
        </section>

        <section className="block">
          <div className="block-head"><h3>Permissions</h3></div>
          <div className="actions">
            <span data-testid="ax">{ax ? "Accessibility is allowed." : "Accessibility isn't allowed yet: Saru can't read or paste your message."}</span>
            {!ax ? <button className="btn" onClick={() => void saru.openAccessibility()}>Open System Settings</button> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ label, value, onSave, placeholder, testId }: { label: string; value: string; onSave(v: string): void; placeholder?: string; testId?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label>
      <span className="label">{label}</span>
      <input className="field" data-testid={testId} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}
