"use client";
import { C, FONT_DISPLAY, FONT_MONO, PLATFORMS } from "../ui/constants";
import { Video, ZernioAccount } from "../ui/types";
import { VideoCard } from "./VideoCard";
import { EmptyState } from "../ui/EmptyState";

function dayDiff(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function getBucket(video: Video) {
  const diff = dayDiff(video.scheduledDate || "");
  if (diff < 0)  return "retard";
  if (diff === 0) return "aujourdhui";
  if (diff === 1) return "demain";
  if (diff <= 7)  return "semaine";
  return "plus_tard";
}

const BUCKET_CONFIG = {
  retard:     { label: "En retard",    color: "#F43F5E" },
  aujourdhui: { label: "Aujourd'hui",  color: "#22C55E" },
  demain:     { label: "Demain",       color: "#F97316" },
  semaine:    { label: "Cette semaine", color: "#10B981" },
  plus_tard:  { label: "Plus tard",    color: "#475569" },
};

export function CalendarView({
  videos, onPublish, onEdit, zernioAccounts, onZernioPublish, onCheckStatus, checkingId,
}: {
  videos: Video[];
  onPublish: (v: Video) => void;
  onEdit: (v: Video) => void;
  zernioAccounts: ZernioAccount[];
  onZernioPublish: (v: Video) => void;
  onCheckStatus?: (id: string) => void;
  checkingId?: string | null;
}) {
  const planned = videos.filter((v) => v.status === "planned" || v.status === "failed");
  if (planned.length === 0) {
    return (
      <EmptyState
        icon="📅"
        title="Rien de planifié"
        text="Ajoute ta prochaine vidéo pour commencer à organiser ton calendrier de publication."
      />
    );
  }

  const buckets: Record<string, Video[]> = { echec: [], retard: [], aujourdhui: [], demain: [], semaine: [], plus_tard: [] };
  planned.forEach((v) => buckets[v.status === "failed" ? "echec" : getBucket(v)].push(v));
  Object.values(buckets).forEach((arr) =>
    arr.sort((a, b) => ((a.scheduledDate || "") + (a.scheduledTime || "")).localeCompare((b.scheduledDate || "") + (b.scheduledTime || "")))
  );

  // Résumé : total, échéances urgentes, répartition par plateforme
  const urgentCount = buckets.echec.length + buckets.retard.length + buckets.aujourdhui.length + buckets.demain.length;
  const platformCounts = Object.entries(PLATFORMS)
    .map(([key, p]) => ({ key, label: p.label, short: p.short, color: p.color, count: planned.filter((v) => v.platform === key).length }))
    .filter((p) => p.count > 0);

  return (
    <div className="space-y-8">
      {/* Résumé */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Total planifié</div>
          <div className="text-2xl font-bold" style={{ fontFamily: FONT_MONO, color: C.greenLight }}>{planned.length}</div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>À traiter sous 48h</div>
          <div className="text-2xl font-bold" style={{ fontFamily: FONT_MONO, color: urgentCount > 0 ? C.coral : C.emerald }}>{urgentCount}</div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Échecs de publication</div>
          <div className="text-2xl font-bold" style={{ fontFamily: FONT_MONO, color: buckets.echec.length > 0 ? C.coral : C.emerald }}>{buckets.echec.length}</div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Par plateforme</div>
          <div className="flex flex-wrap gap-2">
            {platformCounts.map((p) => (
              <span key={p.key} className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ color: p.color, background: `${p.color}15`, fontFamily: FONT_MONO }}>
                {p.short} {p.count}
              </span>
            ))}
          </div>
        </div>
      </div>

      {Object.entries({ echec: { label: "Échec de publication", color: "#F43F5E" }, ...BUCKET_CONFIG }).map(([key, cfg]) =>
        buckets[key].length > 0 ? (
          <div key={key}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.color }} />
              <span
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: cfg.color, fontFamily: FONT_MONO }}
              >
                {cfg.label}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: `${cfg.color}15`, color: cfg.color, fontFamily: FONT_MONO }}
              >
                {buckets[key].length}
              </span>
              <div className="flex-1 h-px" style={{ background: `${cfg.color}20` }} />
            </div>
            <div className="space-y-2">
              {buckets[key].map((v) => (
                <VideoCard
                  key={v.id}
                  video={v}
                  onPublish={onPublish}
                  onEdit={onEdit}
                  hasZernio={zernioAccounts.some((a) => a.platform === v.platform)}
                  onZernioPublish={onZernioPublish}
                  onCheckStatus={onCheckStatus}
                  checking={checkingId === v.id}
                />
              ))}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}
