"use client";
import React from "react";
import { C, FONT_DISPLAY, FONT_MONO, PLATFORMS } from "../ui/constants";
import { Video, ZernioAccount } from "../ui/types";
import { useToast } from "../ui/Toast";

const inputStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  color: C.textPrimary,
  outline: "none",
  borderRadius: 12,
  padding: "10px 14px",
  width: "100%",
  fontSize: "0.875rem",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function StatInput({ label, value, onChange, placeholder = "0" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: C.textSecondary }}>{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...inputStyle, fontFamily: FONT_MONO }} />
    </div>
  );
}

// ── VideoModal ────────────────────────────────────────────────────────────────
export function VideoModal({
  mode, form, setForm, onSave, onDelete, onClose, saving,
}: {
  mode: string;
  form: Record<string, string>;
  setForm: (f: Record<string, string>) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const isPublish = mode === "publish";
  const isAdd = mode === "add";
  const isPublished = form.entryType === "published";
  function set(key: string, val: string) { setForm({ ...form, [key]: val }); }

  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("video/")) return;
    setUploading(true); setUploadProgress(0);
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

      set("videoUrl", signData.publicUrl);
    } catch {
      // Échec silencieux ici : le champ reste vide, l'utilisateur peut réessayer.
    } finally {
      setUploading(false);
    }
  }

  const selectedPlatforms = (form.platforms || form.platform || "").split(",").map(p => p.trim()).filter(Boolean);
  function togglePlatform(key: string) {
    const next = selectedPlatforms.includes(key)
      ? selectedPlatforms.filter(p => p !== key)
      : [...selectedPlatforms, key];
    if (next.length === 0) return; // au moins une plateforme
    setForm({ ...form, platforms: next.join(","), platform: next[0] });
  }

  const titles: Record<string, string> = { add: "Ajouter une vidéo", edit: "Modifier", publish: "Marquer publiée" };
  const saveLabels: Record<string, string> = {
    publish: "Marquer publiée",
    add: isPublished ? "Ajouter" : selectedPlatforms.length > 1 ? `Ajouter à ${selectedPlatforms.length} réseaux` : "Ajouter au calendrier",
    edit: "Enregistrer",
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: "rgba(4,6,11,0.92)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl"
        style={{ background: C.surfaceAlt, border: `1px solid ${C.borderLight}`, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <div className="font-semibold text-lg" style={{ color: C.textPrimary, fontFamily: FONT_DISPLAY }}>{titles[mode]}</div>
          <button onClick={onClose} className="text-xl w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: C.textSecondary, background: C.card }}>✕</button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Platform */}
          <Field label={isAdd ? "Plateformes (sélection multiple)" : "Plateforme"}>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(PLATFORMS).map(([key, p]) => {
                const active = isAdd ? selectedPlatforms.includes(key) : form.platform === key;
                return (
                  <button key={key} onClick={() => isAdd ? togglePlatform(key) : set("platform", key)}
                    className="text-xs px-3 py-2 rounded-xl font-semibold transition-all flex items-center gap-1.5"
                    style={{
                      background: active ? `${p.color}20` : C.card,
                      color: active ? p.color : C.textSecondary,
                      border: `1px solid ${active ? p.color + "60" : C.border}`,
                    }}>
                    {isAdd && <span style={{ opacity: active ? 1 : 0.4 }}>{active ? "☑" : "☐"}</span>}
                    {p.label}
                  </button>
                );
              })}
            </div>
            {isAdd && selectedPlatforms.length > 1 && (
              <div className="text-xs mt-2" style={{ color: C.textMuted }}>
                Une fiche distincte sera créée pour chaque plateforme sélectionnée.
              </div>
            )}
          </Field>

          <Field label="Titre">
            <input value={form.title} onChange={(e) => set("title", e.target.value)}
              placeholder="Ex : 3 erreurs qui ruinent ta croissance" style={inputStyle} />
          </Field>

          <Field label="Hashtags">
            <input value={form.hashtags} onChange={(e) => set("hashtags", e.target.value)}
              placeholder="#growth #entrepreneur" style={{ ...inputStyle, fontFamily: FONT_MONO }} />
          </Field>

          {/* Toggle planifié / publié */}
          {!isPublish && (
            <div className="flex gap-2">
              {[["planned", "📅 Planifiée"], ["published", "✓ Déjà publiée"]].map(([val, label]) => (
                <button key={val} onClick={() => set("entryType", val)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: form.entryType === val ? C.greenBg : C.card,
                    color: form.entryType === val ? C.greenLight : C.textSecondary,
                    border: `1px solid ${form.entryType === val ? C.green + "60" : C.border}`,
                  }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {!isPublished && (
            <Field label="Vidéo (optionnel)">
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="w-full text-sm px-4 py-3 rounded-xl font-semibold text-left"
                style={{ ...inputStyle, opacity: uploading ? 0.6 : 1, color: form.videoUrl ? C.textPrimary : C.textMuted }}>
                {uploading ? `Upload en cours… ${uploadProgress}%` : form.videoUrl ? "✓ Vidéo prête — cliquer pour remplacer" : "📤 Choisir une vidéo"}
              </button>
              {uploading && (
                <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: C.border }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${uploadProgress}%`, background: C.green }} />
                </div>
              )}
              <div className="text-xs mt-2" style={{ color: C.textMuted }}>
                {form.videoUrl
                  ? "Sera envoyée automatiquement à Zernio à l'heure programmée."
                  : "Sans vidéo, cette entrée reste un simple pense-bête — utilise le bouton « ↑ Zernio » plus tard pour l'envoyer manuellement."}
              </div>
            </Field>
          )}

          {!isPublished ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input type="date" value={form.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} style={{ ...inputStyle, colorScheme: "light" }} />
              </Field>
              <Field label="Heure">
                <input type="time" value={form.scheduledTime} onChange={(e) => set("scheduledTime", e.target.value)} style={{ ...inputStyle, colorScheme: "light", fontFamily: FONT_MONO }} />
              </Field>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date de publication">
                  <input type="date" value={form.publishedDate} onChange={(e) => set("publishedDate", e.target.value)} style={{ ...inputStyle, colorScheme: "light" }} />
                </Field>
                <Field label="Heure (optionnel)">
                  <input type="time" value={form.publishedTime} onChange={(e) => set("publishedTime", e.target.value)} style={{ ...inputStyle, colorScheme: "light", fontFamily: FONT_MONO }} />
                </Field>
              </div>
              <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Statistiques</div>
                <div className="grid grid-cols-2 gap-3">
                  <StatInput label="Durée (s)" value={form.durationSeconds} onChange={(v) => set("durationSeconds", v)} />
                  <StatInput label="Vues" value={form.views} onChange={(v) => set("views", v)} />
                  <StatInput label="Likes" value={form.likes} onChange={(v) => set("likes", v)} />
                  <StatInput label="Commentaires" value={form.comments} onChange={(v) => set("comments", v)} />
                  <StatInput label="Partages" value={form.shares} onChange={(v) => set("shares", v)} />
                  <StatInput label="Favoris" value={form.saves} onChange={(v) => set("saves", v)} />
                  <StatInput label="Nouveaux abonnés" value={form.newFollowers} onChange={(v) => set("newFollowers", v)} />
                  <StatInput label="Temps moyen (s)" value={form.avgWatchTime} onChange={(v) => set("avgWatchTime", v)} />
                  <StatInput label="Complétion (%)" value={form.completionRate} onChange={(v) => set("completionRate", v)} placeholder="auto" />
                </div>
              </div>
            </>
          )}

          <Field label="Notes">
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
              placeholder="Hook utilisé, idée à retester…"
              style={{ ...inputStyle, resize: "vertical" }} />
          </Field>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: `1px solid ${C.border}` }}>
          {mode === "edit" ? (
            <button onClick={() => onDelete(form.id)} className="text-xs font-medium" style={{ color: C.coral }}>Supprimer</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl" style={{ color: C.textSecondary, border: `1px solid ${C.border}`, background: C.card }}>Annuler</button>
            <button onClick={onSave} disabled={saving || !form.title?.trim()}
              className="text-sm px-5 py-2 rounded-xl font-semibold"
              style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)`, color: "#fff", opacity: saving || !form.title?.trim() ? 0.6 : 1 }}>
              {saveLabels[mode] || "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ConnectedAccountsModal ──────────────────────────────────────────────────
// Permet de lier des comptes sociaux via Zernio, directement depuis l'app
// (plus besoin d'aller sur zernio.com). Une seule clé API Zernio pour toute
// l'app — les comptes connectés sont partagés au niveau de l'app, pas isolés
// par utilisateur.
export function ConnectedAccountsModal({
  accounts, onClose,
}: {
  accounts: ZernioAccount[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [connecting, setConnecting] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const accountsByPlatform = React.useMemo(() => {
    const map: Record<string, ZernioAccount[]> = {};
    for (const a of accounts) (map[a.platform] ||= []).push(a);
    return map;
  }, [accounts]);

  // Stats (abonnés / likes cumulés / vidéos) par compte connecté, chargées
  // dès l'ouverture de la modale — c'est l'endroit le plus visible/logique
  // pour les voir, plutôt qu'enfoui dans la modale de publication.
  const [statsByAccount, setStatsByAccount] = React.useState<Record<string, {
    followerCount: number; likesCount: number; videoCount: number;
  } | "error" | "loading">>({});

  React.useEffect(() => {
    accounts.forEach((a) => {
      setStatsByAccount((prev) => ({ ...prev, [a._id]: "loading" }));
      fetch(`/api/zernio/follower-stats/${a._id}?platform=${a.platform}`)
        .then(async (r) => {
          const data = await r.json().catch(() => null);
          if (!r.ok || !data) throw new Error();
          setStatsByAccount((prev) => ({ ...prev, [a._id]: data }));
        })
        .catch(() => setStatsByAccount((prev) => ({ ...prev, [a._id]: "error" })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  async function handleConnect(platformKey: string) {
    setConnecting(platformKey);
    setError("");
    try {
      const res = await fetch(`/api/zernio/connect?platform=${platformKey}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impossible de démarrer la connexion.");
      window.location.href = data.authUrl;
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("Échec de la connexion", msg);
      setConnecting(null);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: "rgba(4,6,11,0.92)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl"
        style={{ background: C.surfaceAlt, border: `1px solid ${C.borderLight}`, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <div className="font-semibold" style={{ color: C.textPrimary }}>Réseaux sociaux</div>
            <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>Comptes connectés à l'app via Zernio.</div>
          </div>
          <button onClick={onClose} className="text-xl w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: C.textSecondary, background: C.card }}>✕</button>
        </div>

        <div className="px-6 pb-6 space-y-2">
          {Object.entries(PLATFORMS).map(([key, p]) => {
            const platformAccounts = accountsByPlatform[key] || [];
            return (
              <div key={key} className="rounded-xl p-3 flex items-center justify-between"
                style={{ background: C.card, border: `1px solid ${platformAccounts.length ? p.color + "60" : C.border}` }}>
                <div>
                  <div className="text-sm font-semibold" style={{ color: p.color }}>{p.label}</div>
                  {platformAccounts.length > 0 ? (
                    <>
                      <div className="text-xs mt-0.5" style={{ color: C.textSecondary }}>
                        {platformAccounts.map(a => `@${a.username}`).join(", ")}
                      </div>
                      {platformAccounts.map((a) => {
                        const s = statsByAccount[a._id];
                        if (!s || s === "loading") {
                          return <div key={a._id} className="text-xs mt-1" style={{ color: C.textMuted }}>Chargement des stats…</div>;
                        }
                        if (s === "error") {
                          return <div key={a._id} className="text-xs mt-1" style={{ color: C.coral }}>Stats indisponibles</div>;
                        }
                        return (
                          <div key={a._id} className="text-xs mt-1 flex gap-3" style={{ color: C.textPrimary }}>
                            <span><b>{s.followerCount.toLocaleString("fr-FR")}</b> <span style={{ color: C.textMuted }}>abonnés</span></span>
                            <span><b>{s.likesCount.toLocaleString("fr-FR")}</b> <span style={{ color: C.textMuted }}>likes</span></span>
                            <span><b>{s.videoCount.toLocaleString("fr-FR")}</b> <span style={{ color: C.textMuted }}>vidéos</span></span>
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>Non connecté</div>
                  )}
                </div>
                <button onClick={() => handleConnect(key)} disabled={connecting === key}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap"
                  style={{
                    background: platformAccounts.length ? C.card : `linear-gradient(135deg, ${C.green}, #15803D)`,
                    color: platformAccounts.length ? C.textSecondary : "#fff",
                    border: platformAccounts.length ? `1px solid ${C.border}` : "none",
                    opacity: connecting === key ? 0.6 : 1,
                  }}>
                  {connecting === key ? "Redirection…" : platformAccounts.length ? "+ Ajouter" : "Connecter"}
                </button>
              </div>
            );
          })}
          {error && (
            <div className="text-xs rounded-xl p-3 mt-2" style={{ color: C.coral, background: C.coralBg }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ZernioPublishModal({
  video, accounts, onClose, onSuccess,
}: {
  video: Video;
  accounts: ZernioAccount[];
  onClose: () => void;
  onSuccess: (videoId: string, postId: string, isScheduled: boolean) => void;
}) {
  const toast = useToast();
  // Comptes disponibles groupés par plateforme
  const accountsByPlatform = React.useMemo(() => {
    const map: Record<string, ZernioAccount[]> = {};
    for (const a of accounts) (map[a.platform] ||= []).push(a);
    return map;
  }, [accounts]);

  // Sélection multi-plateforme : platform -> accountId (vide = décoché)
  const [selected, setSelected] = React.useState<Record<string, string>>(() => {
    const firstForVideoPlatform = accountsByPlatform[video.platform]?.[0]?._id;
    return firstForVideoPlatform ? { [video.platform]: firstForVideoPlatform } : {};
  });

  const [caption, setCaption] = React.useState([video.title, video.hashtags].filter(Boolean).join("\n\n"));
  const [videoUrl, setVideoUrl] = React.useState(video.videoUrl || "");
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [uploadError, setUploadError] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [scheduleMode, setScheduleMode] = React.useState(false);
  const [scheduledFor, setScheduledFor] = React.useState(video.scheduledDate && video.scheduledTime ? `${video.scheduledDate}T${video.scheduledTime}` : "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  // Stats du compte TikTok sélectionné (abonnés, likes, vidéos) + estimation
  // d'éligibilité Creator Rewards — affichées uniquement pour TikTok, seule
  // plateforme demandée pour l'instant. Voir note dans lib/zernio.ts : le
  // vrai statut de monétisation n'est jamais accessible via API, ceci n'est
  // qu'une estimation basée sur le seuil public de 10 000 abonnés.
  const [tiktokStats, setTiktokStats] = React.useState<{
    followerCount: number; followingCount: number; likesCount: number; videoCount: number;
  } | null>(null);
  const [tiktokStatsLoading, setTiktokStatsLoading] = React.useState(false);
  const [tiktokStatsError, setTiktokStatsError] = React.useState("");

  const tiktokAccountId = selected.tiktok;
  React.useEffect(() => {
    if (!tiktokAccountId) { setTiktokStats(null); setTiktokStatsError(""); return; }
    setTiktokStatsLoading(true);
    setTiktokStatsError("");
    fetch(`/api/zernio/follower-stats/${tiktokAccountId}?platform=tiktok`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !data) throw new Error(data?.error || "Impossible de récupérer les stats.");
        setTiktokStats(data);
      })
      .catch((e) => { setTiktokStats(null); setTiktokStatsError((e as Error).message); })
      .finally(() => setTiktokStatsLoading(false));
  }, [tiktokAccountId]);

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("video/")) { setUploadError("Sélectionne un fichier vidéo."); return; }
    setUploading(true); setUploadProgress(0); setUploadError("");
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
    } catch (e) {
      setUploadError("Échec de l'upload : " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function togglePlatform(platformKey: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[platformKey]) delete next[platformKey];
      else next[platformKey] = accountsByPlatform[platformKey]?.[0]?._id || "";
      return next;
    });
  }

  function setAccountForPlatform(platformKey: string, accountId: string) {
    setSelected((prev) => ({ ...prev, [platformKey]: accountId }));
  }

  const targets = Object.entries(selected)
    .filter(([, accountId]) => accountId)
    .map(([platform, accountId]) => ({ platform, accountId }));

  async function handleSubmit() {
    if (targets.length === 0 || !caption.trim()) return;
    const isScheduled = scheduleMode && !!scheduledFor;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/zernio/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id, caption: caption.trim(), targets, videoUrl: videoUrl.trim() || undefined, scheduledFor: isScheduled ? scheduledFor : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "La publication a échoué.");
      }
      const platformNames = targets.map((t) => PLATFORMS[t.platform]?.label || t.platform).join(", ");
      if (isScheduled) {
        toast.success(
          "Publication programmée ✓",
          `Sera publiée sur ${platformNames} le ${new Date(scheduledFor).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}.`
        );
      } else {
        toast.success("Publié avec succès ✓", `Envoyé sur ${platformNames} via Zernio.`);
      }
      onSuccess(video.id, data.postId, isScheduled);
    } catch (e: unknown) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("Échec de la publication", msg);
    }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: "rgba(4,6,11,0.92)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl"
        style={{ background: C.surfaceAlt, border: `1px solid ${C.borderLight}`, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <div className="font-semibold" style={{ color: C.textPrimary }}>Publier sur plusieurs réseaux</div>
            <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>{video.title}</div>
          </div>
          <button onClick={onClose} className="text-xl w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: C.textSecondary, background: C.card }}>✕</button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {accounts.length === 0 ? (
            <div className="rounded-xl p-4 text-sm" style={{ background: C.card, color: C.textSecondary }}>
              Tu n'as encore aucun compte social connecté. Ferme cette fenêtre et clique sur{" "}
              <span style={{ color: C.greenLight, fontWeight: 600 }}>🔗 Réseaux sociaux</span> dans le menu pour connecter les tiens.
            </div>
          ) : (
            <>
              {/* Cases à cocher multi-plateforme */}
              <Field label="Plateformes">
                <div className="space-y-2">
                  {Object.entries(PLATFORMS).map(([key, p]) => {
                    const platformAccounts = accountsByPlatform[key] || [];
                    const checked = !!selected[key];
                    return (
                      <div key={key} className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${checked ? p.color + "60" : C.border}` }}>
                        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: platformAccounts.length ? C.textPrimary : C.textMuted }}>
                          <input type="checkbox" checked={checked} disabled={platformAccounts.length === 0}
                            onChange={() => togglePlatform(key)} style={{ accentColor: p.color }} />
                          <span style={{ color: p.color, fontWeight: 600 }}>{p.label}</span>
                          {platformAccounts.length === 0 && <span className="text-xs" style={{ color: C.textMuted }}>(non connecté)</span>}
                        </label>
                        {checked && platformAccounts.length > 1 && (
                          <select value={selected[key]} onChange={(e) => setAccountForPlatform(key, e.target.value)}
                            className="mt-2" style={{ ...inputStyle, padding: "6px 10px", fontSize: "0.8rem" }}>
                            {platformAccounts.map((a) => <option key={a._id} value={a._id}>@{a.username} · {a.name}</option>)}
                          </select>
                        )}
                        {checked && key === "tiktok" && (
                          <div className="mt-2 rounded-lg p-2.5" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                            {tiktokStatsLoading ? (
                              <div className="text-xs" style={{ color: C.textMuted }}>Chargement des stats du compte…</div>
                            ) : tiktokStatsError ? (
                              <div className="text-xs" style={{ color: C.coral }}>Stats indisponibles : {tiktokStatsError}</div>
                            ) : tiktokStats ? (
                              <>
                                <div className="flex gap-4 text-xs">
                                  <div><span style={{ color: C.textPrimary, fontWeight: 700 }}>{tiktokStats.followerCount.toLocaleString("fr-FR")}</span> <span style={{ color: C.textMuted }}>abonnés</span></div>
                                  <div><span style={{ color: C.textPrimary, fontWeight: 700 }}>{tiktokStats.likesCount.toLocaleString("fr-FR")}</span> <span style={{ color: C.textMuted }}>likes cumulés</span></div>
                                  <div><span style={{ color: C.textPrimary, fontWeight: 700 }}>{tiktokStats.videoCount.toLocaleString("fr-FR")}</span> <span style={{ color: C.textMuted }}>vidéos</span></div>
                                </div>
                                <div className="mt-1.5 text-xs font-semibold" style={{ color: tiktokStats.followerCount >= 10000 ? C.green : C.textMuted }}>
                                  {tiktokStats.followerCount >= 10000
                                    ? "✓ Seuil d'abonnés du Creator Rewards Program atteint (estimation)"
                                    : `${(10000 - tiktokStats.followerCount).toLocaleString("fr-FR")} abonnés avant le seuil du Creator Rewards Program (estimation)`}
                                </div>
                                <div className="mt-1 text-xs" style={{ color: C.textMuted }}>
                                  Estimation basée sur le seuil public (10 000 abonnés) — TikTok ne communique le statut de monétisation réel qu'en interne, dans l'app.
                                </div>
                              </>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Field>

              <Field label="Légende">
                <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4}
                  style={{ ...inputStyle, resize: "vertical" }} />
              </Field>

              {/* Upload vidéo (hébergé via Zernio, jusqu'à 5 Go) */}
              <Field label="Vidéo">
                <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="w-full text-sm px-4 py-3 rounded-xl font-semibold text-left flex items-center justify-between"
                  style={{ background: C.card, border: `1px solid ${C.border}`, color: videoUrl ? C.textPrimary : C.textMuted, opacity: uploading ? 0.6 : 1 }}>
                  <span>{uploading ? `Upload en cours… ${uploadProgress}%` : videoUrl ? "✓ Vidéo prête — cliquer pour remplacer" : "📤 Choisir une vidéo"}</span>
                </button>
                {uploading && (
                  <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: C.border }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${uploadProgress}%`, background: C.green }} />
                  </div>
                )}
                {uploadError && <div className="text-xs mt-1.5" style={{ color: C.coral }}>{uploadError}</div>}
              </Field>

              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.textSecondary }}>
                <input type="checkbox" checked={scheduleMode} onChange={(e) => setScheduleMode(e.target.checked)} style={{ accentColor: C.green }} />
                Programmer plutôt que publier maintenant
              </label>
              {scheduleMode && (
                <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)}
                  style={{ ...inputStyle, colorScheme: "light", fontFamily: FONT_MONO }} />
              )}
              {error && (
                <div className="text-xs rounded-xl p-3" style={{ color: C.coral, background: C.coralBg }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: `1px solid ${C.border}` }}>
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl" style={{ color: C.textSecondary, border: `1px solid ${C.border}`, background: C.card }}>Annuler</button>
          {accounts.length > 0 && (
            <button onClick={handleSubmit} disabled={loading || uploading || !caption.trim() || !videoUrl.trim() || targets.length === 0}
              className="text-sm px-5 py-2 rounded-xl font-semibold"
              style={{ background: `linear-gradient(135deg, ${C.green}, #15803D)`, color: "#fff", opacity: loading || uploading || !caption.trim() || !videoUrl.trim() || targets.length === 0 ? 0.6 : 1 }}>
              {loading ? "Envoi…" : scheduleMode ? "Programmer" : `Publier sur ${targets.length || ""} réseau${targets.length > 1 ? "x" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
