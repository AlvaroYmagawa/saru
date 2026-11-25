import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ToastOpts {
  undo?: () => Promise<void> | void;
  bad?: boolean;
}
interface ToastApi {
  show(text: string, opts?: ToastOpts): void;
}

const Ctx = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(Ctx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; opts: ToastOpts; key: number } | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, opts: ToastOpts = {}) => {
    clearTimeout(timer.current);
    const key = Date.now();
    setToast({ text, opts, key });
    timer.current = setTimeout(() => setToast((t) => (t?.key === key ? undefined : t)), opts.undo ? 8000 : 5000);
  }, []);
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {toast ? (
        <div className={`toast${toast.opts.bad ? " bad" : ""}`} role="status" data-testid="toast">
          <span>{toast.text}</span>
          {toast.opts.undo ? (
            <button
              data-testid="toast-undo"
              onClick={async () => {
                const undo = toast.opts.undo!;
                setToast(undefined);
                await undo();
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
