"use client";
import { useCallback, useEffect, useState } from "react";
import { C, FONT_DISPLAY } from "@/components/ui/constants";

type Check = { id: string; label: string; status: "ok" | "warn" | "fail" | "skip"; detail: string; fix?: string };
type Report = {
  level: "ok" | "warn" | "fail";
  headline: string;
  checks: Check[];
  context: { webhookUrlExpected: string; environment: string; commit: string | null; checkedAt: string };
};

const ICON: Record<Check["status"], string> = { ok: "✅", warn: "⚠️", fail: "❌", skip: "➖" };
const TONE = {
  ok: { bg: C.emeraldBg, fg: C.emerald },
  warn: { bg: C.amberBg, fg: C.amber },
  fail: { bg: C.coralBg, fg: C.coral },
};

export default function DiagnosticPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [setupResult, setSetupResult] = useState("");
  const [copied, setCopied] = useState(false);

  const run = useCallback(async (send = false) => {
    setBusy(send ? "send" : "check");
    setError("");
    try {
      const res = await fetch(`/api/telegram/diagnose${send ? "?send=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setReport(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  async function installWebhook() {
    setBusy("setup");
    setSetupResult("");
    try {
      const res = await fetch("/api/telegram/setup", { cache: "no-store" });
      const data = await res.json();
      setSetupResult(res.ok
        ? `Webhook installé sur ${data.webhook}. ${data.etape_suivante ?? ""}`
        : `Échec : ${data.error ?? res.status}`);
    } catch (e) {
      setSetupResult(`Échec : ${(e as Error).message}`);
    }
    await run();
  }

  async function copyReport() {
    if (!report) return;
    const lines = [
      `Diagnostic bot Telegram — ${report.context.checkedAt} (${report.context.environment}${report.context.commit ? `, ${report.context.commit}` : ""})`,
      report.headline,
      "",
      ...report.checks.map((c) => `${ICON[c.status]} ${c.label} — ${c.detail}${c.fix ? ` → ${c.fix}` : ""}`),
    ];
    await navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const btn: React.CSSProperties = {
    border: `1px solid ${C.border}`, background: C.card, color: C.textPrimary, borderRadius: 10,
    padding: "9px 14px", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const primary: React.CSSProperties = { ...btn, background: C.orange, color: "#fff", border: `1px solid ${C.orange}` };
  const tone = report ? TONE[report.level] : null;

  return (
    <main style={{ background: C.bg, minHeight: "100vh", padding: "24px 16px", fontFamily: FONT_DISPLAY, color: C.textPrimary }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <a href="/" style={{ color: C.textSecondary, fontSize: "0.85rem", textDecoration: "none" }}>← Retour à l&apos;app</a>
        <h1 style={{ fontSize: "1.5rem", margin: "12px 0 4px" }}>Diagnostic du bot Telegram</h1>
        <p style={{ color: C.textSecondary, fontSize: "0.9rem", margin: "0 0 18px" }}>
          Vérifie les variables, la connexion avec Telegram et la base de données, et te dit pourquoi le bot ne répond pas.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <button style={primary} disabled={busy !== null} onClick={() => run()}>
            {busy === "check" ? "Vérification…" : "Relancer le diagnostic"}
          </button>
          <button style={btn} disabled={busy !== null} onClick={installWebhook}>
            {busy === "setup" ? "Installation…" : "Installer / réparer le webhook"}
          </button>
          <button style={btn} disabled={busy !== null} onClick={() => run(true)}>
            {busy === "send" ? "Envoi…" : "Envoyer un message test"}
          </button>
          <button style={btn} disabled={!report} onClick={copyReport}>
            {copied ? "Copié ✓" : "Copier le rapport"}
          </button>
        </div>

        {error && (
          <div style={{ background: C.coralBg, color: C.coral, borderRadius: 12, padding: 14, marginBottom: 14, fontSize: "0.9rem" }}>{error}</div>
        )}
        {setupResult && (
          <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14, fontSize: "0.85rem", wordBreak: "break-word" }}>{setupResult}</div>
        )}

        {report && tone && (
          <>
            <div style={{ background: tone.bg, color: tone.fg, borderRadius: 14, padding: "14px 16px", marginBottom: 14, fontWeight: 700 }}>
              {ICON[report.level]} {report.headline}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {report.checks.map((c) => (
                <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{ICON[c.status]} {c.label}</div>
                  <div style={{ color: C.textSecondary, fontSize: "0.85rem", marginTop: 4, wordBreak: "break-word" }}>{c.detail}</div>
                  {c.fix && c.status !== "ok" && (
                    <div style={{ marginTop: 6, fontSize: "0.85rem", color: C.textPrimary, background: C.surfaceAlt, borderRadius: 8, padding: "7px 10px" }}>
                      👉 {c.fix}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p style={{ color: C.textMuted, fontSize: "0.75rem", marginTop: 14, wordBreak: "break-all" }}>
              Webhook attendu : {report.context.webhookUrlExpected} · {report.context.environment}
              {report.context.commit ? ` · commit ${report.context.commit}` : ""}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
