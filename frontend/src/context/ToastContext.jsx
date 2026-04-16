import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

const VARIANT_STYLES = {
  success:
    'border-emerald-800/80 bg-emerald-950/95 text-emerald-100 shadow-[0_8px_32px_rgba(6,78,59,0.35)]',
  error: 'border-red-900/80 bg-red-950/95 text-red-100 shadow-[0_8px_32px_rgba(127,29,29,0.3)]',
  info: 'border-slate-700/90 bg-slate-900/95 text-slate-100 shadow-[0_8px_32px_rgba(15,23,42,0.5)]',
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, variant = 'info', durationMs = 4500) => {
      const id = makeId();
      setToasts((prev) => [...prev, { id, message, variant }]);
      if (durationMs > 0) {
        window.setTimeout(() => dismiss(id), durationMs);
      }
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      show: push,
      success: (message, duration) => push(message, 'success', duration),
      error: (message, duration) => push(message, 'error', duration ?? 6000),
      info: (message, duration) => push(message, 'info', duration),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-0 right-0 z-[100] flex max-h-[min(50vh,320px)] w-full max-w-sm flex-col-reverse gap-2 overflow-hidden p-4 sm:max-w-md"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm leading-snug ${VARIANT_STYLES[t.variant] ?? VARIANT_STYLES.info}`}
            role="status"
          >
            <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-current opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-violet-400/50"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
