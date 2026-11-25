import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PanelState } from "../shared/api";

const saru = window.saru;

export function Panel() {
  const [s, setS] = useState<PanelState>({ phase: "loading", original: "", channel: "" });
  const [change, setChange] = useState("");
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => saru.onPanel((next) => {
    setS(next);
    if (next.phase === "loading") setChange("");
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void saru.closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    if (s.phase !== "ready") return;
    const text = change.trim();
    if (!text) void saru.accept();
    else {
      setChange("");
      void saru.change(text);
    }
  };

  const busy = s.phase === "loading" || s.phase === "changing";
  return (
    <div className="panel-card washi" ref={card} data-testid="panel" data-phase={s.phase}>
      <div className="panel-head">
        <span className="seal" aria-hidden>猿</span>
        <div>
          <div className="where" data-testid="panel-channel">{s.channel || "Saru"}</div>
          {s.recipient ? <div className="who" data-testid="panel-recipient">for {s.recipient}</div> : null}
        </div>
        <span className="spacer" />
        <span className="kicker">{busy ? "writing" : s.phase === "error" ? "stopped" : "ready"}</span>
      </div>
      <div className="panel-body">
        {s.original ? (
          <>
            <div className="kicker">Yours</div>
            <div className="original" data-testid="panel-original">{s.original}</div>
            <div className="brushline" />
          </>
        ) : null}
        {s.message ? (
          <>
            <div className="kicker">Saru</div>
            <div className="draft" data-testid="panel-draft" style={{ opacity: s.phase === "changing" ? 0.45 : 1 }}>{s.message}</div>
          </>
        ) : null}
        {busy ? (
          <div className="ink-loader" data-testid="panel-loading"><i /><i /><i /> {s.phase === "changing" ? "Rewriting…" : "Reading the room…"}</div>
        ) : null}
        {s.note ? <p className="note" data-testid="panel-note">{s.note}</p> : null}
        {s.error ? <p className="error" data-testid="panel-error">{s.error}</p> : null}
      </div>
      <div className="panel-foot">
        <input
          ref={input}
          className="field"
          data-testid="panel-change"
          placeholder={s.phase === "ready" ? "Enter to paste · or type a change (shorter, warmer…)" : ""}
          value={change}
          disabled={s.phase !== "ready"}
          onChange={(e) => setChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="keys">
          <span><kbd>⏎</kbd>{change.trim() ? "rewrite" : "paste"}</span>
          <span><kbd>esc</kbd>close, draft untouched</span>
        </div>
      </div>
    </div>
  );
}
