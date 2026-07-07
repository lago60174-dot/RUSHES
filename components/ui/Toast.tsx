"use client";
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { C, FONT_DISPLAY } from "./constants";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; title: string; description?: string };

type ToastContextValue = {
  showToast: (kind: ToastKind, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLES: Record<ToastKind, { icon: string; color: string; bg: string }> = {
  success: { icon: "✓", color: C.emerald, bg: C.emeraldBg },
  error: { icon: "✕", color: C.coral, bg: C.coralBg },
  info: { icon: "ℹ", color: C.cyan, bg: C.cyanBg },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((kind: ToastKind, title: string, description?: string) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, kind, title, description }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);

  const value: ToastContextValue = {
    showToast,
    success: (title, description) => showToast("success", title, description),
    error: (title, description) => showToast("error", title, description),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed z-[100] flex flex-col gap-2 p-4"
        style={{ top: 0, right: 0, maxWidth: 380, width: "100%" }}
      >
        {toasts.map((t) => {
          const s = KIND_STYLES[t.kind];
          return (
            <div
              key={t.id}
              className="rounded-xl p-3.5 flex items-start gap-3 shadow-lg animate-[toast-in_0.2s_ease-out]"
              style={{ background: C.surfaceAlt, border: `1px solid ${s.color}40` }}
              role="status"
            >
              <div
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: s.bg, color: s.color }}
              >
                {s.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold" style={{ color: C.textPrimary, fontFamily: FONT_DISPLAY }}>
                  {t.title}
                </div>
                {t.description && (
                  <div className="text-xs mt-0.5" style={{ color: C.textSecondary }}>
                    {t.description}
                  </div>
                )}
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="ml-auto shrink-0 text-xs"
                style={{ color: C.textMuted }}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé à l'intérieur de <ToastProvider>");
  return ctx;
}
