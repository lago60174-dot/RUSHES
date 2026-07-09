"use client";
import { C, FONT_DISPLAY, FONT_MONO, PLATFORMS } from "../ui/constants";
import { Video, ZernioAccount } from "../ui/types";

export function VideoCard({
  video, onPublish, onEdit, hasZernio, onZernioPublish, onCheckStatus, checking,
}: {
  video: Video;
  onPublish: (v: Video) => void;
  onEdit: (v: Video) => void;
  hasZernio: boolean;
  onZernioPublish: (v: Video) => void;
  onCheckStatus?: (id: string) => void;
  checking?: boolean;
}) {
  const p = PLATFORMS[video.platform];
  const isFailed = video.status === "failed";
  return (
    <div
      className="flex items-center gap-4 rounded-xl p-4 group transition-all flex-wrap"
      style={{
        background: C.card,
        border: `1px solid ${isFailed ? C.coral + "60" : C.border}`,
        borderLeft: `3px solid ${isFailed ? C.coral : p.color}`,
      }}
    >
      {/* Time */}
      <div className="shrink-0 text-center" style={{ minWidth: 48 }}>
        <div style={{ fontFamily: FONT_MONO, color: p.color, fontSize: "0.8rem", fontWeight: 600 }}>
          {video.scheduledTime?.slice(0, 5) || "--:--"}
        </div>
      </div>

      {/* Platform badge */}
      <div
        className="shrink-0 px-2 py-1 rounded-lg text-xs font-semibold"
        style={{ background: `${p.color}18`, color: p.color, fontFamily: FONT_MONO }}
      >
        {p.short}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate flex items-center gap-2" style={{ fontFamily: FONT_DISPLAY, color: C.textPrimary }}>
          {isFailed && <span style={{ color: C.coral }}>⚠</span>}
          {video.title}
        </div>
        {video.hashtags && (
          <div className="text-xs mt-0.5 truncate" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
            {video.hashtags}
          </div>
        )}
        {isFailed && video.zernioError && (
          <div className="text-xs mt-1" style={{ color: C.coral }}>
            {video.zernioError}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onEdit(video)}
          className="text-xs px-3 py-1.5 rounded-lg transition-all"
          style={{ color: C.textSecondary, border: `1px solid ${C.border}`, background: "transparent" }}
        >
          Modifier
        </button>
        {hasZernio && video.zernioPostId && onCheckStatus && (
          <button
            onClick={() => onCheckStatus(video.id)}
            disabled={checking}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
            style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`, opacity: checking ? 0.6 : 1 }}
            title="Vérifier si la publication est réellement partie sur Zernio"
          >
            {checking ? "Vérification…" : "⟳ Vérifier statut"}
          </button>
        )}
        {hasZernio && (
          <button
            onClick={() => onZernioPublish(video)}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
            style={{
              background: isFailed ? C.coralBg : C.orangeBg,
              color: isFailed ? C.coral : C.orange,
              border: `1px solid ${isFailed ? C.coral : C.orange}40`,
            }}
          >
            {isFailed ? "↻ Réessayer" : "↑ Zernio"}
          </button>
        )}
        <button
          onClick={() => onPublish(video)}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
          style={{ background: C.greenBg, color: C.greenLight, border: `1px solid ${C.green}40` }}
        >
          ✓ Publier
        </button>
      </div>
    </div>
  );
}
