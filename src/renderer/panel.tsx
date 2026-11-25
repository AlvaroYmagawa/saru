import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PanelState } from "../shared/api";
import { Mark } from "./mark";

const saru = window.saru;

const STEPS = { see: "Gathering the rules…", hear: "Writing it…", speak: "Ready to paste" } as const;

function stepText(s: PanelState): string {
  if (s.phase === "ready") return "Ready to paste";
  if (s.phase === "error") return "Stopped";
  if (s.phase === "changing") return "Rewriting…";
  return s.stage ? STEPS[s.stage] : "Reading the window…";
}

/** Someone or somewhere Saru doesn't know yet: add it in one line, and the draft is rewritten. */
function NewHere({ kind, name }: { kind: "person" | "channel"; name: string }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const add = async () => {
    setBusy(true);
    setError(undefined);
    const r = await saru.addFromPanel(kind, name, hint);
    setBusy(false);
    if (!r.ok) setError(r.error);
  };
  return (
    <div className="new-here" data-testid={`new-${kind}`}>
      <div className="new-row">
        <span><b>{name}</b> {kind === "person" ? "isn't in People yet." : "isn't in Channels yet."}</span>
        {!open ? <button className="btn" data-testid={`new-${kind}-open`} onClick={() => setOpen(true)}>Add {kind === "person" ? "them" : "it"}</button> : null}
      </div>
      {open ? (
        <div className="new-row">
          <input
            className="field"
            autoFocus
            data-testid={`new-${kind}-hint`}
            disabled={busy}
            placeholder={kind === "person" ? "Optional: who they are, how you write to them (client, keep it formal)" : "Optional: who reads it, how to write there"}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                void add();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <button className="btn primary" data-testid={`new-${kind}-add`} disabled={busy} onClick={() => void add()}>{busy ? "Adding…" : "Add and rewrite"}</button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

export function Panel() {
  const [s, setS] = useState<PanelState>({ phase: "loading", original: "", channel: "" });
  const [change, setChange] = useState("");
  const [nudge, setNudge] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ready = s.phase === "ready" && !!s.message;

  useEffect(() => saru.onPanel((next) => {
    setS(next);
    if (next.phase === "loading") {
      setChange("");
      setNudge(false);
    }
  }), []);

  useLayoutEffect(() => {
    if (!card.current) return;
    const ro = new ResizeObserver(() => void saru.resizePanel(card.current!.offsetHeight + 20));
    ro.observe(card.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (s.phase === "ready") input.current?.focus();
  }, [s.phase]);

  // ⌘↵ pastes; Esc closes. A plain Enter never pastes: it can't send anything by accident.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void saru.closePanel();
      if (e.key === "Enter" && e.metaKey && ready) {
        e.preventDefault();
        void saru.accept();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  const rewrite = () => {
    const text = change.trim();
    if (!text) {
      setNudge(true);
      return;
    }
    setChange("");
    setNudge(false);
    void saru.change(text);
  };

  const target = s.app || "the app";
  return (
    <div className="panel-card" ref={card} data-testid="panel" data-phase={s.phase}>
      <div className="panel-head">
        <span className={`panel-mark${s.phase === "loading" || s.phase === "changing" ? " busy" : ""}`}><Mark /></span>
        <div>
          <div className="where" data-testid="panel-channel">{s.channel || "Saru"}</div>
          {s.recipient ? <div className="who" data-testid="panel-recipient">for {s.recipient}</div> : null}
        </div>
        <span className="step" data-testid="panel-step">{stepText(s)}</span>
      </div>
      <div className="panel-body">
        {s.original ? (
          <div className="yours">
            <div className="label">Your draft</div>
            <div className="text" data-testid="panel-original">{s.original}</div>
          </div>
        ) : null}
        {s.message ? (
          <div className="saru-version">
            <div className="label">Saru's version</div>
            <div className="text" data-testid="panel-draft" style={{ opacity: s.phase === "changing" ? 0.4 : 1 }}>{s.message}</div>
          </div>
        ) : null}
        {s.added ? <p className="added" data-testid="panel-added">{s.added}</p> : null}
        {s.note ? <p className="note" data-testid="panel-note">{s.note}</p> : null}
        {s.phase === "ready" && s.newPerson ? <NewHere kind="person" name={s.newPerson} /> : null}
        {s.phase === "ready" && s.newChannel ? <NewHere kind="channel" name={s.newChannel} /> : null}
        {s.error ? <p className="error" data-testid="panel-error">{s.error}</p> : null}
      </div>
      <div className="panel-foot">
        <input
          ref={input}
          className="field"
          data-testid="panel-change"
          placeholder={ready ? "Ask for a change: shorter, warmer, add a thank-you…" : ""}
          value={change}
          disabled={s.phase !== "ready"}
          onChange={(e) => {
            setChange(e.target.value);
            setNudge(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.shiftKey) {
              e.preventDefault();
              rewrite();
            }
          }}
        />
        <div className="actions">
          <button className="btn quiet" data-testid="panel-discard" onClick={() => void saru.closePanel()}>
            Discard <kbd>esc</kbd>
          </button>
          <span className="hint" data-testid="panel-hint">
            {nudge ? "Enter rewrites with your change. To paste, press ⌘↵." : change.trim() ? "Enter rewrites it" : ""}
          </span>
          <span className="spacer" />
          <button className="btn primary" data-testid="panel-paste" disabled={!ready} onClick={() => void saru.accept()}>
            Paste into {target} <kbd>⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
