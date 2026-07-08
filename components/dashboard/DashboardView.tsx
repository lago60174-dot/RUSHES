"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { C, FONT_DISPLAY, FONT_MONO, PLATFORMS } from "../ui/constants";
import { Video } from "../ui/types";
import { EmptyState } from "../ui/EmptyState";

function formatNum(n: number | string) {
  const num = Number(n);
  if (!num || isNaN(num)) return "0";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
  return num.toLocaleString("fr-FR");
}

function formatDuration(seconds: number) {
  const s = Math.round(Number(seconds) || 0);
  if (!s) return "0s";
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m > 0 ? `${m}m${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function StatCard({ label, value, sub, accent = C.violetLight }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: C.card, border: `1px solid ${C.border}` }}
    >
      <div className="text-xs uppercase tracking-widest mb-3" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
        {label}
      </div>
      <div className="text-3xl font-bold" style={{ fontFamily: FONT_MONO, color: accent }}>
        {value}
      </div>
      {sub && <div className="text-xs mt-1" style={{ color: C.textSecondary }}>{sub}</div>}
    </div>
  );
}

const COLS = ["platform","title","publishedDate","views","likes","comments","shares","saves","newFollowers","completionRate","sync"];
const COL_LABELS: Record<string, string> = {
  platform: "Plat.", title: "Titre", publishedDate: "Date",
  views: "Vues", likes: "Likes", comments: "Comm.", shares: "Partages",
  saves: "Favoris", newFollowers: "Abonnés", completionRate: "Complét.", sync: "",
};

export function DashboardView({
  videos, platformFilter, setPlatformFilter, sortKey, setSortKey, sortDir, setSortDir, onEdit, syncingId, onSync,
}: {
  videos: Video[];
  platformFilter: string;
  setPlatformFilter: (v: string) => void;
  sortKey: string;
  setSortKey: (v: string) => void;
  sortDir: "asc" | "desc";
  setSortDir: (v: "asc" | "desc") => void;
  onEdit: (v: Video) => void;
  syncingId: string | null;
  onSync: (id: string) => void;
}) {
  const published = videos.filter((v) => v.status === "published");
  if (published.length === 0) {
    return (
      <EmptyState
        icon="📊"
        title="Pas encore de vidéo publiée"
        text="Marque une vidéo comme publiée pour commencer à suivre tes performances."
      />
    );
  }

  const filtered = platformFilter === "all" ? published : published.filter((v) => v.platform === platformFilter);
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey as keyof Video] ?? "";
    const bv = b[sortKey as keyof Video] ?? "";
    if (typeof av === "string") return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
  });

  const totals = published.reduce((acc, v) => ({
    views: acc.views + (v.views || 0),
    followers: acc.followers + (v.newFollowers || 0),
    count: acc.count + 1,
    completionSum: acc.completionSum + (v.completionRate || 0),
    likesSum: acc.likesSum + (v.likes || 0),
    commentsSum: acc.commentsSum + (v.comments || 0),
    sharesSum: acc.sharesSum + (v.shares || 0),
    savesSum: acc.savesSum + (v.saves || 0),
    watchTimeSum: acc.watchTimeSum + (v.avgWatchTime || 0),
    watchTimeCount: acc.watchTimeCount + (v.avgWatchTime ? 1 : 0),
  }), {
    views: 0, followers: 0, count: 0, completionSum: 0, likesSum: 0,
    commentsSum: 0, sharesSum: 0, savesSum: 0, watchTimeSum: 0, watchTimeCount: 0,
  });

  const avgCompletion = totals.count ? (totals.completionSum / totals.count).toFixed(1) : "0";
  const engagementRate = totals.views > 0
    ? (((totals.likesSum + totals.commentsSum + totals.sharesSum + totals.savesSum) / totals.views) * 100).toFixed(2)
    : "0";
  const avgWatchTime = totals.watchTimeCount ? totals.watchTimeSum / totals.watchTimeCount : 0;
  const avgViewsPerVideo = totals.count ? Math.round(totals.views / totals.count) : 0;

  const topVideo = published.length
    ? [...published].sort((a, b) => (b.views || 0) - (a.views || 0))[0]
    : null;

  // Répartition par plateforme (compteur de vidéos, pas juste les vues)
  const platformCounts = Object.entries(PLATFORMS).map(([key, p]) => ({
    key, label: p.label, color: p.color,
    count: published.filter((v) => v.platform === key).length,
  })).filter((p) => p.count > 0);

  // Tendance des vues dans le temps (par date de publication)
  const trendMap = new Map<string, number>();
  [...published]
    .filter((v) => v.publishedDate)
    .sort((a, b) => String(a.publishedDate).localeCompare(String(b.publishedDate)))
    .forEach((v) => {
      const key = v.publishedDate as string;
      trendMap.set(key, (trendMap.get(key) || 0) + (v.views || 0));
    });
  const trendData = Array.from(trendMap.entries()).map(([date, vues]) => ({ date, vues }));

  const chartData = Object.entries(PLATFORMS).map(([key, p]) => {
    const vids = published.filter((v) => v.platform === key);
    return {
      name: p.short,
      color: p.color,
      vues: vids.reduce((s, v) => s + (v.views || 0), 0),
      likes: vids.reduce((s, v) => s + (v.likes || 0), 0),
      commentaires: vids.reduce((s, v) => s + (v.comments || 0), 0),
      partages: vids.reduce((s, v) => s + (v.shares || 0), 0),
    };
  });

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Vidéos publiées" value={String(totals.count)} accent={C.violetLight} />
        <StatCard label="Vues totales" value={formatNum(totals.views)} sub={`${formatNum(avgViewsPerVideo)} / vidéo en moy.`} accent={C.cyanLight} />
        <StatCard label="Nouveaux abonnés" value={formatNum(totals.followers)} accent={C.emerald} />
        <StatCard label="Taux d'engagement" value={`${engagementRate}%`} sub="(likes+comm.+partages+favoris) / vues" accent={C.amber} />
        <StatCard label="Likes totaux" value={formatNum(totals.likesSum)} accent={C.violetLight} />
        <StatCard label="Commentaires totaux" value={formatNum(totals.commentsSum)} accent={C.cyanLight} />
        <StatCard label="Partages totaux" value={formatNum(totals.sharesSum)} accent={C.emerald} />
        <StatCard label="Favoris totaux" value={formatNum(totals.savesSum)} accent={C.amber} />
        <StatCard label="Complétion moy." value={`${avgCompletion}%`} accent={C.violetLight} />
        <StatCard label="Temps de visionnage moy." value={formatDuration(avgWatchTime)} accent={C.cyanLight} />
        {topVideo && (
          <div
            className="rounded-2xl p-5 col-span-2"
            style={{ background: C.card, border: `1px solid ${C.border}` }}
          >
            <div className="text-xs uppercase tracking-widest mb-3" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
              Vidéo la plus performante
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ color: PLATFORMS[topVideo.platform]?.color, background: `${PLATFORMS[topVideo.platform]?.color}15`, fontFamily: FONT_MONO }}>
                {PLATFORMS[topVideo.platform]?.short}
              </span>
              <div className="truncate font-semibold" style={{ color: C.textPrimary }}>{topVideo.title}</div>
            </div>
            <div className="text-2xl font-bold" style={{ fontFamily: FONT_MONO, color: C.emerald }}>
              {formatNum(topVideo.views)} <span className="text-xs font-normal" style={{ color: C.textSecondary }}>vues</span>
            </div>
          </div>
        )}
      </div>

      {/* Chart multi-métriques par plateforme */}
      <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-5">
          <div className="text-sm font-semibold" style={{ color: C.textPrimary }}>Vues, likes, commentaires, partages par plateforme</div>
          <div className="text-xs" style={{ color: C.textMuted, fontFamily: FONT_MONO }}>
            {published.length} vidéos
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: C.textSecondary, fontSize: 12, fontFamily: FONT_MONO }} stroke="transparent" />
            <YAxis tick={{ fill: C.textSecondary, fontSize: 11 }} stroke="transparent" tickFormatter={formatNum} />
            <Tooltip
              contentStyle={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 12 }}
              labelStyle={{ color: C.textSecondary, fontFamily: FONT_MONO }}
              formatter={(v: number, name: string) => [formatNum(v), name]}
            />
            <Bar dataKey="vues" fill={C.violetLight} radius={[6, 6, 0, 0]} />
            <Bar dataKey="likes" fill={C.cyanLight} radius={[6, 6, 0, 0]} />
            <Bar dataKey="commentaires" fill={C.emerald} radius={[6, 6, 0, 0]} />
            <Bar dataKey="partages" fill={C.amber} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tendance des vues + répartition des publications par plateforme */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5 md:col-span-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Tendance des vues dans le temps</div>
          {trendData.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: C.textSecondary, fontSize: 10, fontFamily: FONT_MONO }} stroke="transparent" />
                <YAxis tick={{ fill: C.textSecondary, fontSize: 11 }} stroke="transparent" tickFormatter={formatNum} />
                <Tooltip
                  contentStyle={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 12 }}
                  labelStyle={{ color: C.textSecondary, fontFamily: FONT_MONO }}
                  formatter={(v: number) => [formatNum(v), "vues"]}
                />
                <Line type="monotone" dataKey="vues" stroke={C.violetLight} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-xs py-8 text-center" style={{ color: C.textMuted }}>
              Publie au moins 2 vidéos à des dates différentes pour voir une tendance.
            </div>
          )}
        </div>

        <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-semibold mb-5" style={{ color: C.textPrimary }}>Publications par plateforme</div>
          <div className="space-y-3">
            {platformCounts.map((p) => (
              <div key={p.key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-1.5" style={{ color: C.textSecondary }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color, display: "inline-block" }} />
                    {p.label}
                  </span>
                  <span style={{ fontFamily: FONT_MONO, color: C.textPrimary }}>{p.count}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: C.border }}>
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${(p.count / totals.count) * 100}%`, background: p.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Platform filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {[["all", "Toutes", C.violetLight], ...Object.entries(PLATFORMS).map(([k, p]) => [k, p.label, p.color])].map(([key, label, color]) => (
          <button
            key={key}
            onClick={() => setPlatformFilter(key)}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-all flex items-center gap-1.5"
            style={{
              background: platformFilter === key ? `${color}20` : "transparent",
              color: platformFilter === key ? color : C.textSecondary,
              border: `1px solid ${platformFilter === key ? color + "60" : C.border}`,
            }}
          >
            {key !== "all" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />}
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.surfaceAlt }}>
                {COLS.map((key) => (
                  <th
                    key={key}
                    onClick={() => key !== "sync" && toggleSort(key)}
                    className="px-4 py-3 text-left select-none whitespace-nowrap"
                    style={{
                      color: sortKey === key ? C.violetLight : C.textMuted,
                      fontSize: "0.7rem", fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.1em",
                      cursor: key !== "sync" ? "pointer" : "default",
                    }}
                  >
                    {COL_LABELS[key]}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((v, idx) => (
                <tr
                  key={v.id}
                  onClick={() => onEdit(v)}
                  className="cursor-pointer transition-all"
                  style={{ borderTop: `1px solid ${C.border}`, background: idx % 2 === 0 ? "transparent" : C.surface + "80" }}
                >
                  <td className="px-4 py-3">
                    <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ color: PLATFORMS[v.platform]?.color, background: `${PLATFORMS[v.platform]?.color}15`, fontFamily: FONT_MONO }}>
                      {PLATFORMS[v.platform]?.short}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ maxWidth: 200 }}>
                    <div className="truncate" style={{ color: C.textPrimary }}>{v.title}</div>
                    {v.zernioPostId && <span className="text-xs ml-1" style={{ color: C.cyan, fontFamily: FONT_MONO }}>Z</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ fontFamily: FONT_MONO, color: C.textSecondary, fontSize: "0.8rem" }}>{v.publishedDate}</td>
                  <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: FONT_MONO, color: C.textPrimary }}>{formatNum(v.views)}</td>
                  <td className="px-4 py-3 text-right" style={{ fontFamily: FONT_MONO, color: C.textSecondary }}>{formatNum(v.likes)}</td>
                  <td className="px-4 py-3 text-right" style={{ fontFamily: FONT_MONO, color: C.textSecondary }}>{formatNum(v.comments)}</td>
                  <td className="px-4 py-3 text-right" style={{ fontFamily: FONT_MONO, color: C.textSecondary }}>{formatNum(v.shares)}</td>
                  <td className="px-4 py-3 text-right" style={{ fontFamily: FONT_MONO, color: C.textSecondary }}>{formatNum(v.saves)}</td>
                  <td className="px-4 py-3 text-right" style={{ fontFamily: FONT_MONO, color: C.emerald }}>{formatNum(v.newFollowers)}</td>
                  <td className="px-4 py-3 text-right" style={{ fontFamily: FONT_MONO, color: v.completionRate >= 50 ? C.emerald : C.textSecondary }}>{v.completionRate}%</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {v.zernioPostId && (
                      <button
                        onClick={() => onSync(v.id)}
                        disabled={syncingId === v.id}
                        className="text-xs px-2 py-1 rounded-lg"
                        style={{ color: C.cyan, border: `1px solid ${C.cyan}30`, opacity: syncingId === v.id ? 0.5 : 1 }}
                      >
                        {syncingId === v.id ? "…" : "⟳"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
