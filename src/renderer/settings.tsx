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
    <div className="row">
      <button className={`btn field recorder${listening ? " listening" : ""}`} data-testid="shortcut" onClick={() => setListening((l) => !l)}>
        {listening ? "Press the new shortcut…" : prettyShortcut(value)}
      </button>
      <span className="hint">{listening ? "Esc to cancel" : "Click, then press the keys you want"}</span>
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
    <div className="page single">
      <section className="detail">
        <h1>Settings</h1>
        <p className="lede">How Saru starts, which Claude it runs, and where your notes live.</p>

        <div className="section">
          <div className="section-head"><span className="kicker">Shortcut</span><span className="rule-line" /></div>
          <ShortcutRecorder value={s.shortcut} onChange={(shortcut) => setS({ ...s, shortcut })} />
        </div>

        <div className="section">
          <div className="section-head"><span className="kicker">Claude</span><span className="rule-line" /></div>
          <div className="grid">
            <label>
              Model
              <select className="field" data-testid="model" value={s.model} onChange={(e) => void save({ model: e.target.value })}>
                {["sonnet", "opus", "haiku"].concat(["sonnet", "opus", "haiku"].includes(s.model) ? [] : [s.model]).map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <Field label="Path to claude" value={s.claudePath} placeholder="found automatically" onSave={(v) => void save({ claudePath: v.trim() })} />
            <Field label="Give up after (seconds)" value={String(s.timeoutSeconds)} onSave={(v) => Number(v) > 0 && void save({ timeoutSeconds: Number(v) })} />
          </div>
          <p className="hint">Saru runs your own Claude Code, signed in with your own account. It never sees your credentials.</p>
        </div>

        <div className="section">
          <div className="section-head"><span className="kicker">Your data</span><span className="rule-line" /></div>
          {sync?.state === "refused" || sync?.state === "error" ? <div className="banner" data-testid="sync-banner">{sync.message}</div> : null}
          {sync?.state === "idle" && sync.message ? <div className="banner">{sync.message}</div> : null}
          <div className="grid">
            <Field label="Private GitHub repo (owner/name)" value={s.dataRepo} testId="data-repo" placeholder="you/saru-data — empty: no sync" onSave={(v) => void save({ dataRepo: v.trim() })} />
            <Field label="Data folder" value={s.dataDir} placeholder="~/.local/share/saru" onSave={(v) => void save({ dataDir: v.trim() })} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" data-testid="sync-now" disabled={!s.dataRepo} onClick={async () => { const r = await saru.syncNow(); toast.show(r.state === "idle" ? "Synced." : r.message ?? r.state, { bad: r.state !== "idle" }); }}>Sync now</button>
            <span className="hint" data-testid="sync-state">{sync?.state === "idle" && sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}` : sync?.state ?? ""}</span>
          </div>
          <p className="hint">Each change is committed and pushed with your own git login. Saru refuses a public repo.</p>
        </div>

        <div className="section">
          <div className="section-head"><span className="kicker">Permissions</span><span className="rule-line" /></div>
          <div className="row">
            <span data-testid="ax">{ax ? "Accessibility: allowed" : "Accessibility: not allowed yet"}</span>
            {!ax ? <button className="btn" onClick={() => void saru.openAccessibility()}>Open System Settings</button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onSave, placeholder, testId }: { label: string; value: string; onSave(v: string): void; placeholder?: string; testId?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label>
      {label}
      <input className="field" data-testid={testId} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}
