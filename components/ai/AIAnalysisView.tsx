"use client";
import { C, FONT_DISPLAY, FONT_MONO, MIN_VIDEOS_FOR_ANALYSIS, PLATFORMS } from "../ui/constants";
import { Video, AIAnalysis, AIMeta } from "../ui/types";
import { EmptyState } from "../ui/EmptyState";

const SECTION_CONFIG = [
  { key: "patterns",        label: "Tendances observées", icon: "📈", accent: C.orange },
  { key: "recommendations", label: "Recommandations",     icon: "🎯", accent: C.greenLight },
  { key: "next_ideas",      label: "Idées à tester",      icon: "💡", accent: C.emerald },
];

function AnalysisSection({ icon, label, items, accent }: { icon: string; label: string; items: string[]; accent: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2 mb-4">
        <span>{icon}</span>
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: accent, fontFamily: FONT_MONO }}>
          {label}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex gap-3 text-sm">
            <div
              className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5"
              style={{ background: `${accent}20`, color: accent, fontFamily: FONT_MONO }}
            >
              {i + 1}
            </div>
            <span style={{ color: C.textPrimary, lineHeight: 1.6 }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AIAnalysisView({
  videos, analysis, meta, loading, error, onRun,
}: {
  videos: Video[];
  analysis: AIAnalysis | null;
  meta: AIMeta | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
}) {
  const published = videos.filter((v) => v.status === "published");

  if (published.length < MIN_VIDEOS_FOR_ANALYSIS) {
    return (
      <EmptyState
        icon="✦"
        title="Pas encore assez de données"
        text={`Il faut au moins ${MIN_VIDEOS_FOR_ANALYSIS} vidéos publiées. Tu en as ${published.length} pour l'instant.`}
      />
    );
  }

  const dataChanged = meta && meta.videoCount !== published.length;
  const formattedDate = meta ? new Date(meta.generatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : null;

  // Aperçu des données qui alimentent l'analyse
  const totalViews = published.reduce((s, v) => s + (v.views || 0), 0);
  const avgViews = published.length ? Math.round(totalViews / published.length) : 0;
  const dates = published.map((v) => v.publishedDate).filter(Boolean).sort() as string[];
  const dateRange = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : null;
  const platformBreakdown = Object.entries(PLATFORMS)
    .map(([key, p]) => ({ key, short: p.short, color: p.color, count: published.filter((v) => v.platform === key).length }))
    .filter((p) => p.count > 0);

  return (
    <div className="space-y-6">
      {/* Aperçu des données analysées */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Vidéos analysées</div>
          <div className="text-xl font-bold" style={{ fontFamily: FONT_MONO, color: C.greenLight }}>{published.length}</div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Vues moy. / vidéo</div>
          <div className="text-xl font-bold" style={{ fontFamily: FONT_MONO, color: C.orangeLight }}>{avgViews.toLocaleString("fr-FR")}</div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Période couverte</div>
          <div className="text-xs font-bold" style={{ fontFamily: FONT_MONO, color: C.emerald }}>{dateRange || "—"}</div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>Plateformes</div>
          <div className="flex flex-wrap gap-1.5">
            {platformBreakdown.map((p) => (
              <span key={p.key} className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ color: p.color, background: `${p.color}15`, fontFamily: FONT_MONO }}>
                {p.short} {p.count}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Header card */}
      <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: C.greenLight, fontFamily: FONT_MONO }}>
                ✦ Powered by Mistral AI
              </span>
            </div>
            <div className="text-sm" style={{ color: C.textSecondary }}>
              {published.length} vidéos analysées
              {formattedDate && (
                <span style={{ color: C.textMuted }}> · Dernière analyse le {formattedDate}</span>
              )}
            </div>
            {dataChanged && (
              <div className="text-xs mt-1" style={{ color: C.amber }}>
                ⚠ Nouvelles vidéos depuis la dernière analyse — relance pour mettre à jour
              </div>
            )}
          </div>
          <button
            onClick={onRun}
            disabled={loading}
            className="text-sm px-5 py-2.5 rounded-xl font-semibold transition-all"
            style={{
              background: loading ? C.greenBg : `linear-gradient(135deg, ${C.green}, #15803D)`,
              color: C.textPrimary,
              opacity: loading ? 0.7 : 1,
              border: `1px solid ${C.green}60`,
            }}
          >
            {loading ? "Analyse en cours…" : analysis ? "✦ Relancer" : "✦ Lancer l'analyse"}
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: C.greenLight,
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
              <span className="text-sm" style={{ color: C.textSecondary }}>
                Mistral analyse tes données…
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-2xl p-4 text-sm" style={{ background: C.coralBg, border: `1px solid ${C.coral}40`, color: C.coral }}>
          ⚠ {error}
        </div>
      )}

      {analysis && !loading && (
        <div className="grid gap-4">
          {SECTION_CONFIG.map(({ key, label, icon, accent }) => (
            <AnalysisSection
              key={key}
              icon={icon}
              label={label}
              items={analysis[key as keyof AIAnalysis] as string[]}
              accent={accent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
