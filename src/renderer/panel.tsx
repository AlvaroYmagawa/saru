import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PanelState } from "../shared/api";

const saru = window.saru;

const MONKEYS = [
  { id: "see", kanji: "見", name: "See", doing: "Reading the window…" },
  { id: "hear", kanji: "聞", name: "Hear", doing: "Gathering the rules…" },
  { id: "speak", kanji: "言", name: "Speak", doing: "Writing it…" },
] as const;

/** 見 聞 言: which monkeys are done, which one is working, and where it stopped on an error. */
function Sanzaru({ s }: { s: PanelState }) {
  const reached = s.stage ? MONKEYS.findIndex((m) => m.id === s.stage) : -1;
  return (
    <div className="sanzaru" data-testid="sanzaru" aria-hidden>
      {MONKEYS.map((m, i) => {
        let cls = "";
        if (s.phase === "ready") cls = "done";
        else if (s.phase === "error") cls = i <= reached ? "done" : i === reached + 1 ? "failed" : "";
        else if (s.phase === "changing") cls = i < 2 ? "done" : "now";
        else cls = i <= reached ? "done" : i === reached + 1 ? "now" : "";
        return <span key={m.id} className={`monkey ${cls}`} title={m.name}>{m.kanji}</span>;
      })}
    </div>
  );
}

function stepText(s: PanelState): string {
  if (s.phase === "ready") return "Ready to paste";
  if (s.phase === "error") return "Stopped";
  if (s.phase === "changing") return "Rewriting…";
  const next = s.stage ? MONKEYS.findIndex((m) => m.id === s.stage) + 1 : 0;
  return MONKEYS[Math.min(next, 2)]!.doing;
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
        <Sanzaru s={s} />
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
        {s.note ? <p className="note" data-testid="panel-note">{s.note}</p> : null}
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
