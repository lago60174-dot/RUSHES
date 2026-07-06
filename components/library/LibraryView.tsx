"use client";
import React from "react";
import { C, FONT_MONO, PLATFORMS } from "../ui/constants";
import { Video } from "../ui/types";

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function isLikelyValidVideoUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ── AddVideoModal : ajoute une vidéo à partir d'un lien externe ────────────
function AddVideoModal({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: (videoRecords: Video[]) => void;
}) {
  const [videoUrl, setVideoUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [platforms, setPlatforms] = React.useState<string[]>(["tiktok"]);
  const [scheduledDate, setScheduledDate] = React.useState(todayStr());
  const [scheduledTime, setScheduledTime] = React.useState("18:00");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const inputStyle: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, color: C.textPrimary,
    outline: "none", borderRadius: 12, padding: "10px 14px", width: "100%", fontSize: "0.875rem",
  };

  function togglePlatform(key: string) {
    setPlatforms((prev) => {
      if (prev.includes(key)) return prev.length > 1 ? prev.filter((p) => p !== key) : prev;
      return [...prev, key];
    });
  }

  async function handleConfirm() {
    if (!title.trim() || !videoUrl.trim()) return;
    if (!isLikelyValidVideoUrl(videoUrl.trim())) {
      setError("Ce lien ne semble pas valide. Utilise un lien http(s) public.");
      return;
    }
    setSaving(true); setError("");
    try {
      // Crée une fiche vidéo par plateforme sélectionnée
      const videoRecords: Video[] = platforms.map((platform) => ({
        id: uid(), platform, title: title.trim(), hashtags: "", notes: "",
        status: "planned", scheduledDate, scheduledTime,
        durationSeconds: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
        newFollowers: 0, avgWatchTime: 0, completionRate: 0, videoUrl: videoUrl.trim(),
      }));
      await Promise.all(videoRecords.map(async (videoRecord) => {
        const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(videoRecord) });
        if (!res.ok) throw new Error((await res.json()).error);
      }));
      onDone(videoRecords);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: "rgba(4,6,11,0.92)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl" style={{ background: C.surfaceAlt, border: `1px solid ${C.borderLight}` }}>
        <div className="flex items-center justify-between p-6 pb-4">
          <div className="font-semibold" style={{ color: C.textPrimary }}>Ajouter une vidéo</div>
          <button onClick={onClose} className="text-xl w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: C.textSecondary, background: C.surface }}>✕</button>
        </div>
        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Lien de la vidéo</label>
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} style={inputStyle}
              placeholder="https://drive.google.com/... ou tout lien .mp4 public" />
            <div className="text-xs mt-1.5" style={{ color: C.textMuted }}>
              Héberge ta vidéo où tu veux (Google Drive, Dropbox, OneDrive…) en accès public, puis colle le lien ici. Aucune limite de taille ni de qualité.
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Titre</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Plateformes (sélection multiple)</label>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(PLATFORMS).map(([key, p]) => {
                const active = platforms.includes(key);
                return (
                  <button key={key} onClick={() => togglePlatform(key)} className="text-xs px-3 py-2 rounded-xl font-semibold transition-all flex items-center gap-1.5"
                    style={{
                      background: active ? `${p.color}20` : C.surface,
                      color: active ? p.color : C.textSecondary,
                      border: `1px solid ${active ? p.color + "60" : C.border}`,
                    }}>
                    <span style={{ opacity: active ? 1 : 0.4 }}>{active ? "☑" : "☐"}</span>
                    {p.label}
                  </button>
                );
              })}
            </div>
            {platforms.length > 1 && (
              <div className="text-xs mt-2" style={{ color: C.textMuted }}>
                Une fiche distincte sera créée pour chaque plateforme sélectionnée.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Date planifiée</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={{ ...inputStyle, colorScheme: "dark" }} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Heure</label>
              <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} style={{ ...inputStyle, colorScheme: "dark", fontFamily: FONT_MONO }} />
            </div>
          </div>

          {error && <div className="text-xs rounded-xl p-3" style={{ color: C.coral, background: C.coralBg }}>{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: `1px solid ${C.border}` }}>
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl" style={{ color: C.textSecondary, border: `1px solid ${C.border}`, background: C.surface }}>Annuler</button>
          <button onClick={handleConfirm} disabled={saving || !title.trim() || !videoUrl.trim()}
            className="text-sm px-5 py-2 rounded-xl font-semibold"
            style={{ background: `linear-gradient(135deg, ${C.violet}, #5B21B6)`, color: "#fff", opacity: saving || !title.trim() || !videoUrl.trim() ? 0.6 : 1 }}>
            {saving ? "Enregistrement…" : platforms.length > 1 ? `Ajouter à ${platforms.length} réseaux` : "Ajouter au calendrier"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LibraryView : liste les vidéos (via /api/videos) ayant un lien renseigné ─
export function LibraryView({ onVideoAdded }: { onVideoAdded: (videos: Video[]) => void }) {
  const [videos, setVideos] = React.useState<Video[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const [showAddModal, setShowAddModal] = React.useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/videos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVideos(Array.isArray(data) ? data.filter((v: Video) => v.videoUrl) : []);
    } catch (e) {
      setError((e as Error).message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  function copyLink(url: string) {
    navigator.clipboard?.writeText(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div className="text-xs" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
          {loading ? "Chargement…" : `${videos.length} vidéo${videos.length > 1 ? "s" : ""}`}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddModal(true)}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ background: `linear-gradient(135deg, ${C.violet}, #4F1D96)`, color: "#fff" }}>
            + Ajouter une vidéo
          </button>
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}>
            ↻ Rafraîchir
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-4 text-sm mb-4" style={{ background: C.coralBg, color: C.coral }}>
          {error}
        </div>
      )}

      {!loading && videos.length === 0 && !error ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-2xl mb-2">🎞</div>
          <div className="text-sm" style={{ color: C.textSecondary }}>
            Aucune vidéo pour le moment. Clique sur « + Ajouter une vidéo » et colle le lien de ta vidéo (Google Drive, Dropbox, etc.).
          </div>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {videos.map((v) => (
            <div key={v.id} className="rounded-2xl overflow-hidden flex flex-col" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="relative" style={{ background: C.bg, aspectRatio: "9/16" }}>
                {v.videoUrl && playingId === v.id ? (
                  <video src={v.videoUrl} controls autoPlay style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <button onClick={() => setPlayingId(v.id)} disabled={!v.videoUrl}
                    className="absolute inset-0 flex items-center justify-center w-full h-full"
                    style={{ color: C.violetLight, fontSize: "2rem", background: "rgba(124,58,237,0.08)" }}>
                    ▶
                  </button>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col gap-1">
                <div className="text-xs font-medium truncate" style={{ color: C.textPrimary }} title={v.title}>{v.title}</div>
                <div className="text-xs" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>{PLATFORMS[v.platform]?.label || v.platform}</div>
              </div>
              <div className="flex gap-1.5 p-3 pt-0">
                <button onClick={() => v.videoUrl && copyLink(v.videoUrl)} disabled={!v.videoUrl}
                  className="flex-1 text-xs py-1.5 rounded-lg font-medium"
                  style={{ background: C.violetBg, color: C.violetLight, border: `1px solid ${C.violet}40` }}>
                  Copier le lien
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddVideoModal onClose={() => setShowAddModal(false)}
          onDone={(videoRecords) => {
            setShowAddModal(false);
            load();
            onVideoAdded(videoRecords);
          }} />
      )}
    </div>
  );
}
