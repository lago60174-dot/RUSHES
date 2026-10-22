"use client";

import React from "react";
import { C, PLATFORMS } from "../ui/constants";
import { useToast } from "../ui/Toast";

type Item = {
  id: string; kind: "comment" | "dm"; platform: string;
  author_name: string | null; author_username: string | null;
  text: string; received_at: string; status: string;
  category: string | null; reply_draft: string | null; reply_text: string | null;
  reason: string | null; error: string | null;
};
type Settings = { enabled: boolean; autoReply: boolean };

export function InboxModal({ onClose, onChanged }: { onClose: () => void; onChanged?: (pending: number) => void }) {
  const toast = useToast();
  const [view, setView] = React.useState<"pending" | "recent">("pending");
  const [items, setItems] = React.useState<Item[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);

  const load = React.useCallback(async (v: "pending" | "recent") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox?view=${v}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setItems(data.items);
      setDrafts(Object.fromEntries((data.items as Item[]).map((i) => [i.id, i.reply_draft ?? ""])));
      onChanged?.(data.pendingCount);
    } catch (e) {
      toast.error("Inbox indisponible", (e as Error).message);
    } finally { setLoading(false); }
  }, [onChanged, toast]);

  React.useEffect(() => { load(view); }, [view, load]);
  React.useEffect(() => {
    fetch("/api/inbox/settings").then((r) => r.json()).then(setSettings).catch(() => {});
  }, []);

  async function act(id: string, action: "approve" | "ignore" | "regenerate") {
    setBusy(id);
    try {
      const res = await fetch(`/api/inbox/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text: drafts[id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Échec.");
      if (action === "approve") toast.success("Réponse envoyée ✓");
      await load(view);
    } catch (e) {
      toast.error("Échec", (e as Error).message);
      await load(view);
    } finally { setBusy(null); }
  }

  async function toggle(key: keyof Settings) {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    await fetch("/api/inbox/settings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: next[key] }),
    }).catch(() => setSettings(settings));
  }

  const tab = (v: "pending" | "recent", label: string) => (
    <button onClick={() => setView(v)} className="text-xs px-3 py-1.5 rounded-lg font-semibold"
      style={{ background: view === v ? C.green : C.card, color: view === v ? "#fff" : C.textSecondary, border: `1px solid ${C.border}` }}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ background: C.bg, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="p-6 pb-3 flex items-center justify-between">
          <div className="font-semibold" style={{ color: C.textPrimary }}>💬 Inbox</div>
          <button onClick={onClose} className="text-xl w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: C.textSecondary, background: C.card }}>✕</button>
        </div>

        {settings && (
          <div className="px-6 pb-3 flex gap-4 text-xs" style={{ color: C.textSecondary }}>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={settings.enabled} onChange={() => toggle("enabled")} /> Agent actif
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={settings.autoReply} onChange={() => toggle("autoReply")} /> Réponse auto (cas simples)
            </label>
          </div>
        )}

        <div className="px-6 pb-3 flex gap-2">{tab("pending", "À valider")}{tab("recent", "Récents")}</div>

        <div className="px-6 pb-6 space-y-3">
          {loading && <div className="text-xs" style={{ color: C.textMuted }}>Chargement…</div>}
          {!loading && items.length === 0 && (
            <div className="text-sm text-center py-8" style={{ color: C.textMuted }}>
              {view === "pending" ? "Rien à valider 🎉" : "Aucun message récent."}
            </div>
          )}
          {items.map((i) => {
            const p = PLATFORMS[i.platform];
            const pending = view === "pending";
            return (
              <div key={i.id} className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: p?.color || C.textSecondary, fontWeight: 600 }}>
                    {p?.label || i.platform} · {i.kind === "dm" ? "DM" : "Commentaire"}
                  </span>
                  <span style={{ color: C.textMuted }}>{new Date(i.received_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                <div className="text-xs mb-1" style={{ color: C.textSecondary }}>{i.author_name || i.author_username || "Inconnu"}</div>
                <div className="text-sm mb-2" style={{ color: C.textPrimary }}>{i.text}</div>

                {pending ? (
                  <>
                    {i.reason && <div className="text-[11px] mb-1" style={{ color: C.textMuted }}>🤖 {i.reason}</div>}
                    {i.error && <div className="text-[11px] mb-1" style={{ color: C.coral }}>⚠️ {i.error}</div>}
                    <textarea value={drafts[i.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))}
                      rows={2} placeholder="Ta réponse…"
                      className="w-full rounded-lg p-2 text-sm" style={{ background: C.bg, color: C.textPrimary, border: `1px solid ${C.border}` }} />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => act(i.id, "approve")} disabled={busy === i.id || !(drafts[i.id] ?? "").trim()}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: C.green, color: "#fff", opacity: busy === i.id ? 0.6 : 1 }}>
                        {busy === i.id ? "…" : "Envoyer"}
                      </button>
                      <button onClick={() => act(i.id, "regenerate")} disabled={busy === i.id}
                        className="text-xs px-3 py-1.5 rounded-lg" style={{ background: C.bg, color: C.textSecondary, border: `1px solid ${C.border}` }}>↻ Autre version</button>
                      <button onClick={() => act(i.id, "ignore")} disabled={busy === i.id}
                        className="text-xs px-3 py-1.5 rounded-lg" style={{ background: C.coralBg, color: C.coral }}>Ignorer</button>
                    </div>
                  </>
                ) : (
                  <div className="text-xs" style={{ color: C.textMuted }}>
                    {i.status === "auto_replied" && <>🤖 Répondu automatiquement : « {i.reply_text} »</>}
                    {i.status === "replied" && <>✅ Réponse envoyée : « {i.reply_text} »</>}
                    {i.status === "ignored" && <>— Ignoré{i.reason ? ` (${i.reason})` : ""}</>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
