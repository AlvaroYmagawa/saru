import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

interface ConfirmOpts {
  title: string;
  body?: string;
  action: string;
}

interface OverlayApi {
  /** Opens a small menu where the right-click happened. */
  openMenu(e: MouseEvent, items: MenuItem[]): void;
  /** Asks before a destructive action; resolves true only when the user confirms. */
  confirm(opts: ConfirmOpts): Promise<boolean>;
}

const Ctx = createContext<OverlayApi>({ openMenu: () => undefined, confirm: async () => false });
export const useOverlay = () => useContext(Ctx);

export function OverlayHost({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();
  const [dialog, setDialog] = useState<ConfirmOpts & { resolve(ok: boolean): void }>();

  const openMenu = useCallback((e: MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })), []);

  return (
    <Ctx.Provider value={{ openMenu, confirm }}>
      {children}
      {menu ? <ContextMenu {...menu} onClose={() => setMenu(undefined)} /> : null}
      {dialog ? (
        <ConfirmDialog
          {...dialog}
          onDone={(ok) => {
            dialog.resolve(ok);
            setDialog(undefined);
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" role="menu" data-testid="context-menu" style={pos}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={it.danger ? "danger" : ""}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onSelect?.();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function ConfirmDialog({ title, body, action, onDone }: ConfirmOpts & { onDone(ok: boolean): void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDone(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onDone(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" data-testid="confirm">
        <h3 id="confirm-title">{title}</h3>
        {body ? <p>{body}</p> : null}
        <div className="dialog-actions">
          <button ref={cancel} className="btn quiet" data-testid="confirm-cancel" onClick={() => onDone(false)}>Cancel</button>
          <button className="btn destructive" data-testid="confirm-ok" onClick={() => onDone(true)}>{action}</button>
        </div>
      </div>
    </div>
  );
}
