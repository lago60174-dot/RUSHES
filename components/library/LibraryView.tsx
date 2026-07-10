"use client";
import React from "react";
import { C, FONT_MONO, PLATFORMS } from "../ui/constants";
import { Video, ZernioAccount } from "../ui/types";
import { useToast } from "../ui/Toast";

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── AddVideoModal : ajoute une vidéo à partir d'un lien externe ────────────
function AddVideoModal({
  onClose, onDone, accounts,
}: {
  onClose: () => void;
  onDone: (videoRecords: Video[]) => void;
  accounts: ZernioAccount[];
}) {
  const toast = useToast();
  const [videoUrl, setVideoUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [platforms, setPlatforms] = React.useState<string[]>(["tiktok"]);
  const [scheduledDate, setScheduledDate] = React.useState(todayStr());
  const [scheduledTime, setScheduledTime] = React.useState("18:00");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const inputStyle: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, color: C.textPrimary,
    outline: "none", borderRadius: 12, padding: "10px 14px", width: "100%", fontSize: "0.875rem",
  };

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("video/")) { setError("Sélectionne un fichier vidéo."); return; }
    setUploading(true); setUploadProgress(0); setError("");
    try {
      const signRes = await fetch("/api/zernio/media-presign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) throw new Error(signData.error);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signData.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Échec de l'upload (${xhr.status})`));
        xhr.onerror = () => reject(new Error("Échec de l'upload — vérifie ta connexion"));
        xhr.send(file);
      });

      setVideoUrl(signData.publicUrl);
      if (!title.trim()) setTitle(file.name.replace(/\.[^/.]+$/, ""));
    } catch (e) {
      setError("Échec de l'upload : " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function togglePlatform(key: string) {
    setPlatforms((prev) => {
      if (prev.includes(key)) return prev.length > 1 ? prev.filter((p) => p !== key) : prev;
      return [...prev, key];
    });
  }

  async function handleConfirm() {
    if (!title.trim() || !videoUrl.trim()) return;
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

      // Envoie chaque fiche à Zernio tout de suite (planifiée à la date/heure
      // choisie) au lieu de la laisser en attente locale jusqu'à une action
      // manuelle plus tard — c'est ce qui manquait pour que la planification
      // fonctionne vraiment de bout en bout.
      const scheduledFor = `${scheduledDate}T${scheduledTime}`;
      const notSent: string[] = [];
      await Promise.all(videoRecords.map(async (videoRecord) => {
        const account = accounts.find((a) => a.platform === videoRecord.platform);
        if (!account) {
          notSent.push(`${PLATFORMS[videoRecord.platform]?.label || videoRecord.platform} : aucun compte connecté.`);
          return;
        }
        try {
          const pubRes = await fetch("/api/zernio/publish", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              videoId: videoRecord.id,
              caption: videoRecord.title,
              videoUrl: videoRecord.videoUrl,
              scheduledFor,
              targets: [{ platform: videoRecord.platform, accountId: account._id }],
            }),
          });
          const pubData = await pubRes.json().catch(() => null);
          if (!pubRes.ok) throw new Error(pubData?.error || "Échec de l'envoi à Zernio.");
        } catch (e) {
          notSent.push(`${PLATFORMS[videoRecord.platform]?.label || videoRecord.platform} : ${(e as Error).message}`);
        }
      }));

      if (notSent.length > 0) {
        toast.error(
          "Vidéo enregistrée mais pas planifiée sur Zernio",
          notSent.join(" · ")
        );
      } else {
        toast.success(
          "Planifiée sur Zernio ✓",
          `Publication programmée le ${new Date(scheduledFor).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}.`
        );
      }

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
            <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Vidéo</label>
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="w-full text-sm px-4 py-3 rounded-xl font-semibold text-left"
              style={{ ...inputStyle, opacity: uploading ? 0.6 : 1, color: videoUrl ? C.textPrimary : C.textMuted }}>
              {uploading ? `Upload en cours… ${uploadProgress}%` : videoUrl ? "✓ Vidéo prête — cliquer pour remplacer" : "📤 Choisir une vidéo"}
            </button>
            {uploading && (
              <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: C.border }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${uploadProgress}%`, background: C.green }} />
              </div>
            )}
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
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={{ ...inputStyle, colorScheme: "light" }} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Heure</label>
              <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} style={{ ...inputStyle, colorScheme: "light", fontFamily: FONT_MONO }} />
            </div>
          </div>

          {error && <div className="text-xs rounded-xl p-3" style={{ color: C.coral, background: C.coralBg }}>{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: `1px solid ${C.border}` }}>
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl" style={{ color: C.textSecondary, border: `1px solid ${C.border}`, background: C.surface }}>Annuler</button>
          <button onClick={handleConfirm} disabled={saving || uploading || !title.trim() || !videoUrl.trim()}
            className="text-sm px-5 py-2 rounded-xl font-semibold"
            style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)`, color: "#fff", opacity: saving || !title.trim() || !videoUrl.trim() ? 0.6 : 1 }}>
            {saving ? "Enregistrement…" : platforms.length > 1 ? `Ajouter à ${platforms.length} réseaux` : "Ajouter au calendrier"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Badge de statut ──────────────────────────────────────────────────────
// Reflète automatiquement l'état réel de la publication : "published" est
// posé par le webhook Zernio (ou immédiatement après une publication non
// planifiée), donc dès que la vidéo est publiée, ce badge se met à jour
// tout seul au prochain rafraîchissement (automatique ou manuel).
function StatusBadge({ status }: { status: Video["status"] }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    published: { label: "✓ Publié", color: C.emerald, bg: C.emerald + "18" },
    planned: { label: "◷ Planifié", color: C.amber, bg: C.amber + "18" },
    failed: { label: "⚠ Échec", color: C.coral, bg: C.coralBg },
  };
  const s = map[status] || map.planned;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

// ── LibraryView : liste les vidéos (via /api/videos) ayant un lien renseigné ─
// Les vidéos viennent du Dashboard parent (source de vérité unique, partagée
// avec le Calendrier), donc une publication faite ailleurs dans l'app —
// ou confirmée en asynchrone par le webhook Zernio — apparaît ici
// automatiquement, sans qu'il faille cliquer sur Rafraîchir.
export function LibraryView({
  videos, onRefresh, onVideoAdded, zernioAccounts,
}: {
  videos: Video[];
  onRefresh: () => void;
  onVideoAdded: (videos: Video[]) => void;
  zernioAccounts: ZernioAccount[];
}) {
  const [refreshing, setRefreshing] = React.useState(false);
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const [showAddModal, setShowAddModal] = React.useState(false);

  const libraryVideos = React.useMemo(() => videos.filter((v) => v.videoUrl), [videos]);

  const statusCounts = React.useMemo(() => ({
    published: libraryVideos.filter((v) => v.status === "published").length,
    planned: libraryVideos.filter((v) => v.status === "planned").length,
    failed: libraryVideos.filter((v) => v.status === "failed").length,
    totalViews: libraryVideos.reduce((s, v) => s + (v.views || 0), 0),
  }), [libraryVideos]);

  async function handleRefresh() {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }

  function copyLink(url: string) {
    navigator.clipboard?.writeText(url);
  }

  return (
    <div>
      {libraryVideos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-[0.65rem] uppercase tracking-widest mb-1" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Publiées</div>
            <div className="text-lg font-bold" style={{ fontFamily: FONT_MONO, color: C.emerald }}>{statusCounts.published}</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-[0.65rem] uppercase tracking-widest mb-1" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Planifiées</div>
            <div className="text-lg font-bold" style={{ fontFamily: FONT_MONO, color: C.amber }}>{statusCounts.planned}</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-[0.65rem] uppercase tracking-widest mb-1" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Échecs</div>
            <div className="text-lg font-bold" style={{ fontFamily: FONT_MONO, color: statusCounts.failed > 0 ? C.coral : C.textSecondary }}>{statusCounts.failed}</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-[0.65rem] uppercase tracking-widest mb-1" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Vues cumulées</div>
            <div className="text-lg font-bold" style={{ fontFamily: FONT_MONO, color: C.greenLight }}>{statusCounts.totalViews.toLocaleString("fr-FR")}</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div className="text-xs" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
          {`${libraryVideos.length} vidéo${libraryVideos.length > 1 ? "s" : ""}`}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddModal(true)}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)`, color: "#fff" }}>
            + Ajouter une vidéo
          </button>
          <button onClick={handleRefresh} disabled={refreshing} className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`, opacity: refreshing ? 0.6 : 1 }}>
            {refreshing ? "Actualisation…" : "↻ Rafraîchir"}
          </button>
        </div>
      </div>

      {libraryVideos.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-2xl mb-2">🎞</div>
          <div className="text-sm" style={{ color: C.textSecondary }}>
            Aucune vidéo pour le moment. Clique sur « + Ajouter une vidéo » et colle le lien de ta vidéo (Google Drive, Dropbox, etc.).
          </div>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {libraryVideos.map((v) => (
            <div key={v.id} className="rounded-2xl overflow-hidden flex flex-col" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="relative" style={{ background: C.bg, aspectRatio: "9/16" }}>
                {v.videoUrl && playingId === v.id ? (
                  <video src={v.videoUrl} controls autoPlay style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <button onClick={() => setPlayingId(v.id)} disabled={!v.videoUrl}
                    className="absolute inset-0 flex items-center justify-center w-full h-full"
                    style={{ color: C.greenLight, fontSize: "2rem", background: "rgba(124,58,237,0.08)" }}>
                    ▶
                  </button>
                )}
                <div className="absolute top-2 left-2">
                  <StatusBadge status={v.status} />
                </div>
                {v.status === "published" && (
                  <div className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(0,0,0,0.55)", color: C.greenLight, fontFamily: FONT_MONO }}>
                    👁 {(v.views || 0).toLocaleString("fr-FR")}
                  </div>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col gap-1">
                <div className="text-xs font-medium truncate" style={{ color: C.textPrimary }} title={v.title}>{v.title}</div>
                <div className="text-xs" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>{PLATFORMS[v.platform]?.label || v.platform}</div>
              </div>
              <div className="flex gap-1.5 p-3 pt-0">
                <button onClick={() => v.videoUrl && copyLink(v.videoUrl)} disabled={!v.videoUrl}
                  className="flex-1 text-xs py-1.5 rounded-lg font-medium"
                  style={{ background: C.greenBg, color: C.greenLight, border: `1px solid ${C.green}40` }}>
                  Copier le lien
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddVideoModal onClose={() => setShowAddModal(false)}
          accounts={zernioAccounts}
          onDone={(videoRecords) => {
            setShowAddModal(false);
            onVideoAdded(videoRecords);
          }} />
      )}
    </div>
  );
}
