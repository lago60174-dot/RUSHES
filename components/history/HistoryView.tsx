"use client";
import { C, FONT_DISPLAY, FONT_MONO, PLATFORMS } from "../ui/constants";
import { Video } from "../ui/types";
import { EmptyState } from "../ui/EmptyState";

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString("fr-FR");
}

function hourBucket(timeStr?: string) {
  if (!timeStr) return null;
  const h = parseInt(timeStr.split(":")[0], 10);
  if (isNaN(h)) return null;
  if (h >= 6 && h < 12)  return "Matin (6h–12h)";
  if (h >= 12 && h < 18) return "Après-midi (12h–18h)";
  if (h >= 18 && h < 22) return "Soir (18h–22h)";
  return "Nuit";
}

function weekdayBucket(dateStr?: string) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const days = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  return days[d.getDay()];
}

function extractHashtags(raw?: string) {
  if (!raw) return [];
  return Array.from(new Set(
    raw.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`))
  ));
}

const MEDALS = ["🥇", "🥈", "🥉"];

function InsightCard({ icon, label, value, detail, accent = C.greenLight }: {
  icon: string; label: string; value: string | null; detail: string; accent?: string;
}) {
  return (
    <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <div className="text-xs uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>{label}</div>
      </div>
      {value ? (
        <>
          <div className="text-xl font-bold mb-1" style={{ color: accent, fontFamily: FONT_DISPLAY }}>{value}</div>
          <div className="text-xs" style={{ color: C.textSecondary }}>{detail}</div>
        </>
      ) : (
        <div className="text-sm italic" style={{ color: C.textMuted }}>{detail}</div>
      )}
    </div>
  );
}

export function HistoryView({ videos }: { videos: Video[] }) {
  const published = videos.filter((v) => v.status === "published");
  if (published.length === 0) {
    return <EmptyState icon="🏆" title="Pas encore d'historique" text="Marque des vidéos comme publiées pour voir ton classement ici." />;
  }

  const top10 = [...published].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10);

  const byPlatform: Record<string, { sum: number; count: number }> = {};
  published.forEach((v) => {
    byPlatform[v.platform] = byPlatform[v.platform] || { sum: 0, count: 0 };
    byPlatform[v.platform].sum += v.views || 0;
    byPlatform[v.platform].count += 1;
  });
  const platformAvgs = Object.entries(byPlatform).map(([key, d]: [string, { sum: number; count: number }]) => ({ key, avg: d.sum / d.count }));
  const bestPlatform = platformAvgs.length >= 2 ? [...platformAvgs].sort((a, b) => b.avg - a.avg)[0] : null;

  const byHour: Record<string, { sum: number; count: number }> = {};
  published.forEach((v) => {
    const hb = hourBucket(v.publishedTime);
    if (!hb) return;
    byHour[hb] = byHour[hb] || { sum: 0, count: 0 };
    byHour[hb].sum += v.views || 0;
    byHour[hb].count += 1;
  });
  const hourAvgs = Object.entries(byHour).map(([key, d]: [string, { sum: number; count: number }]) => ({ key, avg: d.sum / d.count }));
  const bestHour = hourAvgs.length >= 2 ? [...hourAvgs].sort((a, b) => b.avg - a.avg)[0] : null;

  const withDuration = published.filter((v) => v.durationSeconds > 0);
  const top3dur = [...withDuration].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 3);
  const avgDurAll = withDuration.length ? withDuration.reduce((s, v) => s + v.durationSeconds, 0) / withDuration.length : 0;
  const avgDurTop3 = top3dur.length ? top3dur.reduce((s, v) => s + v.durationSeconds, 0) / top3dur.length : 0;

  // Meilleur jour de la semaine pour publier
  const byWeekday: Record<string, { sum: number; count: number }> = {};
  published.forEach((v) => {
    const wd = weekdayBucket(v.publishedDate);
    if (!wd) return;
    byWeekday[wd] = byWeekday[wd] || { sum: 0, count: 0 };
    byWeekday[wd].sum += v.views || 0;
    byWeekday[wd].count += 1;
  });
  const weekdayAvgs = Object.entries(byWeekday).map(([key, d]) => ({ key, avg: d.sum / d.count }));
  const bestWeekday = weekdayAvgs.length >= 2 ? [...weekdayAvgs].sort((a, b) => b.avg - a.avg)[0] : null;

  // Fréquence de publication (jours moyens entre deux publications)
  const sortedDates = [...new Set(published.map((v) => v.publishedDate).filter(Boolean))].sort() as string[];
  let avgGapDays: number | null = null;
  if (sortedDates.length >= 2) {
    const first = new Date(sortedDates[0] + "T00:00:00").getTime();
    const last = new Date(sortedDates[sortedDates.length - 1] + "T00:00:00").getTime();
    avgGapDays = (last - first) / 86400000 / (sortedDates.length - 1);
  }

  // Meilleurs hashtags (moyenne de vues des vidéos qui les utilisent, mini. 2 vidéos)
  const hashtagStats: Record<string, { sum: number; count: number }> = {};
  published.forEach((v) => {
    extractHashtags(v.hashtags).forEach((h) => {
      hashtagStats[h] = hashtagStats[h] || { sum: 0, count: 0 };
      hashtagStats[h].sum += v.views || 0;
      hashtagStats[h].count += 1;
    });
  });
  const topHashtags = Object.entries(hashtagStats)
    .filter(([, d]) => d.count >= 2)
    .map(([tag, d]) => ({ tag, avg: Math.round(d.sum / d.count), count: d.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);

  // Engagement rate per platform
  const platformEngagement = Object.entries(byPlatform).map(([key, _]) => {
    const pvids = published.filter((v) => v.platform === key);
    const totalViews = pvids.reduce((s, v) => s + (v.views || 0), 0);
    const totalEng = pvids.reduce((s, v) => s + (v.likes || 0) + (v.comments || 0) + (v.shares || 0), 0);
    return { key, rate: totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(2) : "0" };
  });

  return (
    <div className="space-y-8">
      {/* Top 10 */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <span className="text-sm font-bold uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
            Classement
          </span>
          <div className="flex-1 h-px" style={{ background: C.border }} />
        </div>
        <div className="space-y-2">
          {top10.map((v, i) => {
            const p = PLATFORMS[v.platform];
            const isTop3 = i < 3;
            return (
              <div
                key={v.id}
                className="flex items-center gap-4 rounded-xl px-4 py-3"
                style={{
                  background: isTop3 ? C.card : C.surface,
                  border: `1px solid ${isTop3 ? C.border : C.border + "80"}`,
                  borderLeft: isTop3 ? `3px solid ${p.color}` : `3px solid transparent`,
                }}
              >
                <div className="w-8 text-center text-xl shrink-0">
                  {i < 3 ? MEDALS[i] : (
                    <span style={{ fontFamily: FONT_MONO, color: C.textMuted, fontSize: "0.8rem" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  )}
                </div>
                <div className="shrink-0 text-xs px-1.5 py-0.5 rounded font-bold" style={{ color: p.color, background: `${p.color}15`, fontFamily: FONT_MONO }}>
                  {p.short}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium" style={{ color: C.textPrimary }}>{v.title}</div>
                  <div className="text-xs" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>{v.publishedDate}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold" style={{ fontFamily: FONT_MONO, color: i === 0 ? C.greenLight : C.textPrimary }}>
                    {formatNum(v.views || 0)}
                  </div>
                  <div className="text-xs" style={{ color: C.emerald, fontFamily: FONT_MONO }}>
                    +{formatNum(v.newFollowers || 0)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Engagement par plateforme */}
      {platformEngagement.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-bold uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
              Engagement par plateforme
            </span>
            <div className="flex-1 h-px" style={{ background: C.border }} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {platformEngagement.map(({ key, rate }) => {
              const p = PLATFORMS[key];
              return (
                <div key={key} className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                  <div className="text-xs mb-2 font-bold" style={{ color: p.color, fontFamily: FONT_MONO }}>{p.label}</div>
                  <div className="text-2xl font-bold" style={{ fontFamily: FONT_MONO, color: C.textPrimary }}>{rate}%</div>
                  <div className="text-xs" style={{ color: C.textMuted }}>taux d'engagement</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Insights */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-bold uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
            Aperçus
          </span>
          <div className="flex-1 h-px" style={{ background: C.border }} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <InsightCard
            icon="🏆"
            label="Meilleure plateforme"
            value={bestPlatform ? PLATFORMS[bestPlatform.key]?.label : null}
            detail={bestPlatform ? `${formatNum(Math.round(bestPlatform.avg))} vues / vidéo` : "Publie sur 2+ plateformes pour comparer"}
            accent={C.greenLight}
          />
          <InsightCard
            icon="⏰"
            label="Meilleur créneau"
            value={bestHour ? bestHour.key : null}
            detail={bestHour ? `${formatNum(Math.round(bestHour.avg))} vues / vidéo` : "Renseigne l'heure de publication"}
            accent={C.orange}
          />
          <InsightCard
            icon="⏱"
            label="Durée optimale"
            value={withDuration.length >= 5 ? `${Math.round(avgDurTop3)}s` : null}
            detail={withDuration.length >= 5 ? `vs ${Math.round(avgDurAll)}s en moyenne générale` : "Ajoute 5+ vidéos avec durée"}
            accent={C.emerald}
          />
          <InsightCard
            icon="📆"
            label="Meilleur jour"
            value={bestWeekday ? bestWeekday.key : null}
            detail={bestWeekday ? `${formatNum(Math.round(bestWeekday.avg))} vues / vidéo` : "Publie sur 2+ jours différents pour comparer"}
            accent={C.amber}
          />
          <InsightCard
            icon="🔁"
            label="Fréquence de publication"
            value={avgGapDays !== null ? `1 vidéo / ${avgGapDays.toFixed(1)}j` : null}
            detail={avgGapDays !== null ? "en moyenne entre deux publications" : "Publie à 2+ dates différentes"}
            accent={C.orangeLight}
          />
          <InsightCard
            icon="#️⃣"
            label="Meilleur hashtag"
            value={topHashtags.length ? topHashtags[0].tag : null}
            detail={topHashtags.length ? `${formatNum(topHashtags[0].avg)} vues / vidéo en moy. (${topHashtags[0].count} vidéos)` : "Ajoute des hashtags à 2+ vidéos pour comparer"}
            accent={C.greenLight}
          />
        </div>
      </div>

      {/* Top hashtags */}
      {topHashtags.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-bold uppercase tracking-widest" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
              Hashtags les plus performants
            </span>
            <div className="flex-1 h-px" style={{ background: C.border }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {topHashtags.map((h) => (
              <div key={h.tag} className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <span className="text-sm font-semibold" style={{ color: C.greenLight, fontFamily: FONT_MONO }}>{h.tag}</span>
                <span className="text-xs" style={{ color: C.textSecondary }}>{formatNum(h.avg)} vues moy.</span>
                <span className="text-xs" style={{ color: C.textMuted }}>({h.count}v)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
