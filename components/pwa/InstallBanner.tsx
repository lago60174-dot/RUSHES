"use client";

import { useEffect, useState } from "react";
import { C, FONT_DISPLAY } from "@/components/ui/constants";

const DISMISS_KEY = "rushes-install-dismissed-at";
const DISMISS_DAYS = 7;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

function recentlyDismissed() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const elapsedDays = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
  return elapsedDays < DISMISS_DAYS;
}

export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    if (isIOS()) {
      // Pas d'événement beforeinstallprompt sur iOS : on affiche direct les
      // instructions manuelles (Safari uniquement — Chrome/Firefox iOS ne
      // supportent pas l'installation, mais on ne peut pas le détecter
      // fiablement donc on affiche quand même, ça ne gêne pas).
      setShowIOSInstructions(true);
      setVisible(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    setVisible(false);
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed left-3 right-3 z-50 rounded-2xl p-3.5 flex items-center gap-3 shadow-lg"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        background: C.surface,
        border: `1px solid ${C.borderLight}`,
        fontFamily: FONT_DISPLAY,
        maxWidth: 420,
        margin: "0 auto",
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
      }}
    >
      <img src="/icon-192.png" alt="RUSHES" className="w-10 h-10 rounded-xl shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold" style={{ color: C.textPrimary }}>
          Installer RUSHES
        </div>
        {showIOSInstructions ? (
          <div className="text-xs mt-0.5" style={{ color: C.textSecondary }}>
            Appuie sur <strong>Partager</strong> ⬆️ puis <strong>« Sur l'écran d'accueil »</strong>
          </div>
        ) : (
          <div className="text-xs mt-0.5" style={{ color: C.textSecondary }}>
            Accès rapide depuis ton écran d'accueil, comme une vraie app.
          </div>
        )}
      </div>
      {!showIOSInstructions && (
        <button
          onClick={handleInstall}
          className="text-xs px-3.5 py-2 rounded-xl font-semibold whitespace-nowrap shrink-0"
          style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)`, color: "#fff" }}
        >
          Installer
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Fermer"
        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-sm"
        style={{ color: C.textMuted, background: C.card }}
      >
        ✕
      </button>
    </div>
  );
}
