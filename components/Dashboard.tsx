"use client";
import React, { useState, useEffect, useRef } from "react";
import { C, FONT_DISPLAY, FONT_MONO, PLATFORMS, TABS, MIN_VIDEOS_FOR_ANALYSIS } from "./ui/constants";
import { Video, ZernioAccount, AIMeta, AIAnalysis } from "./ui/types";
import { CalendarView } from "./calendar/CalendarView";
import { DashboardView } from "./dashboard/DashboardView";
import { HistoryView } from "./history/HistoryView";
import { AIAnalysisView } from "./ai/AIAnalysisView";
import { LibraryView } from "./library/LibraryView";
import { VideoModal, ZernioPublishModal, ConnectedAccountsModal } from "./modals/Modals";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useToast } from "./ui/Toast";

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

// Synchro auto des stats Zernio : on ne retape pas une vidéo déjà
// synchronisée il y a moins de 5 min, et on vérifie toutes les 2 min.
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const AUTO_SYNC_STALE_MS = 5 * 60 * 1000;

const BOTTOM_NAV_LABELS: Record<string, string> = {
  calendar: "Calendrier", dashboard: "Stats", history: "Historique",
  ai: "IA", library: "Médias",
};
function emptyForm(): Record<string, string> {
  return {
    id: "", platform: "tiktok", platforms: "tiktok", title: "", hashtags: "", notes: "", entryType: "planned",
    scheduledDate: todayStr(), scheduledTime: "18:00", publishedDate: todayStr(), publishedTime: "",
    durationSeconds: "", views: "", likes: "", comments: "", shares: "", saves: "",
    newFollowers: "", avgWatchTime: "", completionRate: "",
  };
}

export default function Dashboard() {
  const toast = useToast();
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("calendar");
  const [modalMode, setModalMode] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sortKey, setSortKey] = useState("publishedDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiMeta, setAiMeta] = useState<AIMeta | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [zernioAccounts, setZernioAccounts] = useState<ZernioAccount[]>([]);
  const [publishModal, setPublishModal] = useState<Video | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);

  function refreshZernioAccounts() {
    fetch("/api/zernio/accounts").then(r => r.json())
      .then(data => Array.isArray(data) && setZernioAccounts(data)).catch(() => {});
  }

  // Centralise le chargement des vidéos : c'est la seule source de vérité,
  // utilisée à la fois par le Calendrier et la Médiathèque, pour qu'un
  // changement de statut (ex : publication confirmée par le webhook Zernio)
  // apparaisse automatiquement partout sans qu'il faille rafraîchir la page.
  function loadVideos(showSpinner = false) {
    if (showSpinner) setIsLoading(true);
    return fetch("/api/videos").then(r => r.json())
      .then(data => setVideos(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => { if (showSpinner) setIsLoading(false); });
  }

  useEffect(() => {
    loadVideos(true);
    // Sondage léger toutes les 15s : capte les changements de statut qui
    // arrivent en asynchrone côté serveur (webhook Zernio post.published,
    // post.failed, etc.) sans action de l'utilisateur.
    const interval = setInterval(() => loadVideos(false), 15000);
    return () => clearInterval(interval);
  }, []);

  // Synchro automatique et silencieuse des stats (vues, likes, etc.) pour
  // toutes les vidéos publiées, sans que l'utilisateur ait à cliquer sur ↻.
  // Complète le cron GitHub Actions (toutes les 6h, actif même app fermée) :
  // ici on rafraîchit dès que le dashboard est ouvert, toutes les 2 min,
  // en ignorant les vidéos déjà synchronisées il y a moins de 5 min.
  const videosRef = useRef<Video[]>([]);
  useEffect(() => { videosRef.current = videos; }, [videos]);

  useEffect(() => {
    let cancelled = false;

    async function autoSyncPublished() {
      const now = Date.now();
      const toSync = videosRef.current.filter(v =>
        v.status === "published" &&
        v.zernioPostId &&
        (!v.zernioSyncedAt || now - new Date(v.zernioSyncedAt).getTime() > AUTO_SYNC_STALE_MS)
      );
      for (const v of toSync) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/zernio/sync/${v.id}`);
          const data = await res.json().catch(() => null);
          if (res.ok && data?.stats && !cancelled) {
            setVideos(prev => prev.map(p => p.id === v.id ? { ...p, ...data.stats, zernioSyncedAt: new Date().toISOString() } : p));
          }
        } catch {
          // Échec silencieux : la prochaine passe (2 min après) réessaiera.
        }
        // Petite pause entre chaque vidéo pour ne pas saturer l'API Zernio.
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Filet de sécurité côté client : si une vidéo "planned" a dépassé son
    // heure programmée de plus de 3 min, on vérifie son vrai statut auprès
    // de Zernio via /check-status, au lieu d'attendre passivement le webhook
    // (qui peut ne jamais arriver si mal configuré côté Zernio) ou le
    // prochain passage du cron GitHub Actions (jusqu'à 30 min de retard).
    async function autoResolveOverdue() {
      const now = Date.now();
      const GRACE_MS = 3 * 60 * 1000;
      const overdue = videosRef.current.filter(v => {
        if (v.status !== "planned" || !v.zernioPostId || !v.scheduledDate) return false;
        const t = new Date(`${v.scheduledDate}T${v.scheduledTime || "00:00"}:00`).getTime();
        return !Number.isNaN(t) && now - t > GRACE_MS;
      });
      for (const v of overdue) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/zernio/check-status/${v.id}`);
          const data = await res.json().catch(() => null);
          if (res.ok && data?.status && !cancelled) {
            loadVideos(false);
          }
        } catch {
          // Échec silencieux : nouvelle tentative à la prochaine passe.
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    autoSyncPublished();
    autoResolveOverdue();
    const interval = setInterval(() => { autoSyncPublished(); autoResolveOverdue(); }, AUTO_SYNC_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    fetch("/api/analyse/cache").then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setAiAnalysis(data.result); setAiMeta({ generatedAt: data.generatedAt, videoCount: data.videoCount }); } })
      .catch(() => {});
    refreshZernioAccounts();
  }, []);

  // Après une connexion Zernio (retour d'OAuth via le paramètre
  // ?zernio=connected), on rafraîchit la liste des comptes et on nettoie l'URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("zernio") === "connected") {
      refreshZernioAccounts();
      toast.success("Compte connecté ✓", "Ton réseau social est prêt à être utilisé.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(next: Video[]) { setVideos(next); }

  async function handleSave() {
    if (!form.title?.trim()) return;
    setSaving(true);
    const isPublished = form.entryType === "published";
    let completion = form.completionRate;
    if (!completion && form.durationSeconds && form.avgWatchTime) {
      const c = (Number(form.avgWatchTime) / Number(form.durationSeconds)) * 100;
      completion = isFinite(c) ? c.toFixed(1) : "";
    }
    const base = {
      platform: form.platform, title: form.title.trim(),
      hashtags: form.hashtags.trim(), notes: form.notes.trim(),
      status: isPublished ? "published" as const : "planned" as const,
    };
    const record = isPublished ? {
      ...base, scheduledDate: form.scheduledDate, scheduledTime: form.scheduledTime,
      publishedDate: form.publishedDate || todayStr(), publishedTime: form.publishedTime || "",
      durationSeconds: Number(form.durationSeconds) || 0, views: Number(form.views) || 0,
      likes: Number(form.likes) || 0, comments: Number(form.comments) || 0,
      shares: Number(form.shares) || 0, saves: Number(form.saves) || 0,
      newFollowers: Number(form.newFollowers) || 0, avgWatchTime: Number(form.avgWatchTime) || 0,
      completionRate: Number(completion) || 0,
    } : {
      ...base, scheduledDate: form.scheduledDate || todayStr(), scheduledTime: form.scheduledTime || "00:00",
      durationSeconds: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
      newFollowers: 0, avgWatchTime: 0, completionRate: 0,
    };

    const isNew = modalMode === "add";
    try {
      if (isNew) {
        const platformList = (form.platforms || form.platform || "tiktok")
          .split(",").map(p => p.trim()).filter(Boolean);
        const newVideos = (platformList.length ? platformList : [form.platform]).map(platform => ({
          id: uid(), ...record, platform,
        })) as Video[];
        persist([...videos, ...newVideos]);
        const results = await Promise.all(newVideos.map(v =>
          fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) })
        ));
        const failed = results.filter(r => !r.ok);
        if (failed.length > 0) throw new Error(`${failed.length} vidéo(s) n'ont pas pu être enregistrées.`);
        toast.success(newVideos.length > 1 ? "Vidéos ajoutées ✓" : "Vidéo ajoutée ✓");
      } else {
        const next = videos.map(v => v.id === form.id ? { ...v, ...record } as Video : v);
        persist(next);
        const res = await fetch(`/api/videos/${form.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, ...record }) });
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "Échec de l'enregistrement."); }
        toast.success(modalMode === "publish" ? "Marquée comme publiée ✓" : "Modifications enregistrées ✓");
      }
    } catch (e) {
      toast.error("Erreur d'enregistrement", (e as Error).message);
    }
    setSaving(false);
    setModalMode(null);
    setForm(emptyForm());
  }

  async function handleDelete(id: string) {
    persist(videos.filter(v => v.id !== id));
    try {
      const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("La suppression a échoué côté serveur.");
      toast.success("Vidéo supprimée ✓");
    } catch (e) {
      toast.error("Erreur de suppression", (e as Error).message);
    }
    setModalMode(null);
    setForm(emptyForm());
  }

  async function syncStats(videoId: string) {
    setSyncingId(videoId);
    try {
      const res = await fetch(`/api/zernio/sync/${videoId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de la synchronisation des stats.");
      if (data.stats) setVideos(prev => prev.map(v => v.id === videoId ? { ...v, ...data.stats, zernioSyncedAt: new Date().toISOString() } : v));
      toast.success("Statistiques synchronisées ✓");
    } catch (e) {
      toast.error("Échec de la synchronisation", (e as Error).message);
    } finally { setSyncingId(null); }
  }

  // Interroge Zernio pour savoir si une publication programmée (ou forcée)
  // a réellement été publiée, a échoué, ou est toujours en attente — utile
  // en complément du webhook, ou si celui-ci n'est pas encore configuré.
  async function checkZernioStatus(videoId: string) {
    setSyncingId(videoId);
    try {
      const res = await fetch(`/api/zernio/check-status/${videoId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impossible de vérifier le statut.");
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, status: data.status, zernioError: data.error || null } : v));
      if (data.status === "published") toast.success("Publication confirmée ✓", "Le post est bien en ligne sur Zernio.");
      else if (data.status === "failed") toast.error("La publication a échoué", data.error);
      else toast.success("Toujours en attente", "La publication est programmée mais pas encore partie.");
    } catch (e) {
      toast.error("Vérification impossible", (e as Error).message);
    } finally { setSyncingId(null); }
  }

  async function runAnalysis() {
    const published = videos.filter(v => v.status === "published");
    if (published.length < MIN_VIDEOS_FOR_ANALYSIS) return;
    setAiLoading(true); setAiError(null);
    try {
      const res = await fetch("/api/analyse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos: published }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAiAnalysis(data.result);
      setAiMeta({ generatedAt: data.generatedAt, videoCount: data.videoCount });
    } catch { setAiError("L'analyse n'a pas pu être générée. Réessaie."); }
    finally { setAiLoading(false); }
  }

  function openEdit(v: Video) {
    setForm({
      ...emptyForm(), ...v as unknown as Record<string, string>, id: v.id, entryType: v.status,
      durationSeconds: String(v.durationSeconds || ""), views: String(v.views || ""),
      likes: String(v.likes || ""), comments: String(v.comments || ""),
      shares: String(v.shares || ""), saves: String(v.saves || ""),
      newFollowers: String(v.newFollowers || ""), avgWatchTime: String(v.avgWatchTime || ""),
      completionRate: String(v.completionRate || ""),
    });
    setModalMode("edit");
  }

  function openPublish(v: Video) {
    setForm({ ...emptyForm(), ...v as unknown as Record<string, string>, id: v.id, entryType: "published", publishedDate: todayStr(), publishedTime: v.scheduledTime || "" });
    setModalMode("publish");
  }

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (isLoading) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ fontFamily: FONT_MONO, color: C.textMuted, fontSize: "0.8rem" }}>Chargement…</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, color: C.textPrimary, minHeight: "100vh", fontFamily: FONT_DISPLAY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: ${C.textMuted}; }
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-calendar-picker-indicator { cursor: pointer; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        textarea, select, input { font-family: inherit; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
      `}</style>

      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden lg:flex flex-col w-60 shrink-0 sticky top-0 h-screen"
          style={{ background: C.bgAlt, borderRight: `1px solid ${C.border}` }}>
          <div className="p-6 pb-8">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)` }}>
                <span style={{ color: "#fff", fontSize: "1rem", fontWeight: 900, fontFamily: FONT_DISPLAY }}>R</span>
              </div>
              <div>
                <div className="font-bold tracking-wider text-sm" style={{ color: C.textPrimary, letterSpacing: "0.1em" }}>RUSHES</div>
                <div className="text-xs" style={{ color: C.textMuted }}>Studio contenu</div>
              </div>
            </div>
          </div>

          <nav className="flex-1 px-3 space-y-0.5">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: activeTab === t.key ? C.greenBg : "transparent",
                  color: activeTab === t.key ? C.greenLight : C.textSecondary,
                  border: `1px solid ${activeTab === t.key ? C.green + "40" : "transparent"}`,
                }}>
                <span style={{ fontSize: "1rem" }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>

          <div className="p-4 pb-6 space-y-2">
            <button onClick={() => setAccountsModalOpen(true)}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}>
              🔗 Réseaux sociaux
            </button>
            <button onClick={() => { setForm(emptyForm()); setModalMode("add"); }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)`, color: "#fff" }}>
              + Ajouter une vidéo
            </button>
            <button onClick={handleLogout}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}>
              ⏻ Déconnexion
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0">
          {/* Mobile header */}
          <div className="lg:hidden flex items-center justify-between p-4 sticky top-0 z-10"
            style={{ background: C.bg + "F0", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)` }}>
                <span style={{ color: "#fff", fontSize: "0.85rem", fontWeight: 900 }}>R</span>
              </div>
              <span className="font-bold text-sm tracking-wider" style={{ color: C.textPrimary }}>RUSHES</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setAccountsModalOpen(true)} aria-label="Réseaux sociaux"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sm"
                style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}>
                🔗
              </button>
              <button onClick={() => { setForm(emptyForm()); setModalMode("add"); }}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)`, color: "#fff" }}>
                + Ajouter
              </button>
              <button onClick={handleLogout} aria-label="Déconnexion"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sm"
                style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}>
                ⏻
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 pb-24 lg:pb-6">
            <div className="max-w-5xl">
              <div className="mb-7">
                <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>
                  {TABS.find(t => t.key === activeTab)?.icon}{" "}
                  {TABS.find(t => t.key === activeTab)?.label}
                </h1>
              </div>

              {activeTab === "calendar" && (
                <CalendarView videos={videos} onPublish={openPublish} onEdit={openEdit}
                  zernioAccounts={zernioAccounts} onZernioPublish={v => setPublishModal(v)}
                  onCheckStatus={checkZernioStatus} checkingId={syncingId} />
              )}
              {activeTab === "dashboard" && (
                <DashboardView videos={videos} platformFilter={platformFilter}
                  setPlatformFilter={setPlatformFilter} sortKey={sortKey} setSortKey={setSortKey}
                  sortDir={sortDir} setSortDir={setSortDir} onEdit={openEdit}
                  syncingId={syncingId} onSync={syncStats} />
              )}
              {activeTab === "history" && <HistoryView videos={videos} />}
              {activeTab === "ai" && (
                <AIAnalysisView videos={videos} analysis={aiAnalysis} meta={aiMeta}
                  loading={aiLoading} error={aiError} onRun={runAnalysis} />
              )}
              {activeTab === "library" && (
                <LibraryView
                  videos={videos}
                  onRefresh={() => loadVideos(false)}
                  onVideoAdded={vs => setVideos(prev => [...prev, ...vs])}
                  zernioAccounts={zernioAccounts}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Bottom navbar mobile (style application) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 flex"
        style={{
          background: C.bgAlt + "F8", backdropFilter: "blur(12px)",
          borderTop: `1px solid ${C.border}`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 px-0.5"
            style={{ color: activeTab === t.key ? C.greenLight : C.textMuted }}>
            <span style={{ fontSize: "1.15rem", lineHeight: 1 }}>{t.icon}</span>
            <span className="truncate w-full text-center" style={{ fontSize: "0.58rem", fontWeight: activeTab === t.key ? 700 : 500 }}>
              {BOTTOM_NAV_LABELS[t.key] || t.label}
            </span>
          </button>
        ))}
      </nav>

      {publishModal && (
        <ZernioPublishModal video={publishModal} accounts={zernioAccounts}
          onClose={() => setPublishModal(null)}
          onSuccess={(videoId, postId, isScheduled) => {
            setVideos(prev => prev.map(v => v.id === videoId
              ? { ...v, zernioPostId: postId, status: isScheduled ? "planned" : "published", zernioError: null }
              : v));
            setPublishModal(null);
          }} />
      )}

      {accountsModalOpen && (
        <ConnectedAccountsModal accounts={zernioAccounts}
          onClose={() => { setAccountsModalOpen(false); refreshZernioAccounts(); }} />
      )}

      {modalMode && (
        <VideoModal mode={modalMode} form={form} setForm={setForm}
          onSave={handleSave} onDelete={handleDelete}
          onClose={() => { setModalMode(null); setForm(emptyForm()); }}
          saving={saving} />
      )}
    </div>
  );
}
