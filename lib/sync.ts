import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AccountHealth,
  zernioGetAccountsHealth,
  zernioGetFollowerStats,
  zernioGetPostTargetAnalytics,
  zernioListAccounts,
} from "@/lib/zernio";
import { getOwnerEmail } from "@/lib/owner";

// Logique de synchro Zernio → base, partagée par le cron, la route de synchro
// manuelle et (plus tard) l'agent Telegram. Toutes les écritures passent par
// le client admin (service_role).

type Db = SupabaseClient;
type Target = { platform: string; accountId: string };

export async function getOwnerUserId(db: Db): Promise<string | null> {
  const owner = getOwnerEmail();
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error || !data) return null;
  const users = (data.users ?? []) as Array<{ id: string; email?: string | null }>;
  if (owner) return users.find((u) => u.email?.toLowerCase() === owner)?.id ?? null;
  return users.length === 1 ? users[0].id : null; // app perso : un seul utilisateur
}

// ── Comptes : miroir de Zernio + santé ─────────────────────────────────
export async function syncAccounts(db: Db, userId: string) {
  const [accounts, health] = await Promise.all([
    zernioListAccounts(),
    zernioGetAccountsHealth().catch((e): AccountHealth[] => {
      console.error("[sync] accounts/health:", (e as Error).message);
      return [];
    }),
  ]);
  const healthById = new Map(health.map((h) => [h.accountId, h]));
  const now = new Date().toISOString();

  if (accounts.length > 0) {
    const rows = accounts.map((a) => {
      const h = healthById.get(a._id);
      return {
        account_id: a._id,
        user_id: userId,
        platform: a.platform,
        username: a.username ?? null,
        display_name: a.name ?? null,
        picture_url: a.profilePicture ?? null,
        profile_id: a.profileId ?? null,
        status: h?.status ?? "healthy",
        can_post: h?.canPost ?? null,
        can_fetch_analytics: h?.canFetchAnalytics ?? null,
        token_valid: h?.tokenValid ?? null,
        token_expires_at: h?.tokenExpiresAt ?? null,
        needs_reconnect: h?.needsReconnect ?? false,
        issues: h?.issues ?? [],
        is_connected: true,
        disconnected_at: null,
        last_synced_at: now,
        raw: a,
      };
    });
    const { error } = await db.from("zernio_accounts").upsert(rows, { onConflict: "account_id" });
    if (error) throw new Error(`zernio_accounts: ${error.message}`);
  }

  // Comptes qui n'existent plus chez Zernio → marqués déconnectés (on garde
  // la ligne et son historique plutôt que de la supprimer).
  const { data: known } = await db
    .from("zernio_accounts").select("account_id").eq("user_id", userId).eq("is_connected", true);
  const live = new Set(accounts.map((a) => a._id));
  const gone = (known ?? []).map((k) => k.account_id as string).filter((id) => !live.has(id));
  if (gone.length > 0) {
    await db.from("zernio_accounts")
      .update({ is_connected: false, status: "disconnected", disconnected_at: now })
      .in("account_id", gone);
  }
  return { count: accounts.length, disconnected: gone.length };
}

export async function markAccountDisconnected(db: Db, accountId: string) {
  await db.from("zernio_accounts")
    .update({ is_connected: false, status: "disconnected", disconnected_at: new Date().toISOString() })
    .eq("account_id", accountId);
}

// ── Compteurs d'un compte : 1 snapshot par jour ────────────────────────
export async function syncAccountSnapshot(db: Db, userId: string, account: { _id: string; platform: string }) {
  const stats = await zernioGetFollowerStats(account._id, account.platform);
  const now = new Date().toISOString();
  const { error } = await db.from("account_snapshots").upsert(
    {
      account_id: account._id,
      user_id: userId,
      snap_date: now.slice(0, 10),
      captured_at: now,
      followers: stats.followerCount,
      following: stats.followingCount,
      likes: stats.likesCount,
      videos: stats.videoCount,
      page_views: stats.pageViews ?? null,
      followers_gained: stats.followersGained,
      followers_lost: stats.followersLost,
      raw: stats,
    },
    { onConflict: "account_id,snap_date" }
  );
  if (error) console.error("[sync] account_snapshots:", error.message);
  await db.from("zernio_accounts").update({ followers: stats.followerCount }).eq("account_id", account._id);
  return stats;
}

// ── Vidéo : stats par compte + historique + totaux sur `videos` ────────
type VideoRow = {
  id: string;
  platform: string;
  zernio_post_id: string;
  zernio_account_id?: string | null;
  zernio_targets?: Target[] | null;
};

const METRICS = ["views", "impressions", "reach", "likes", "comments", "shares", "saves"] as const;

export async function syncVideoTargets(db: Db, userId: string, video: VideoRow) {
  const { pending, targets } = await zernioGetPostTargetAnalytics(video.zernio_post_id);
  // Pas encore de données : on n'écrase rien avec des zéros, le prochain passage réessaie.
  if (pending) return { synced: false as const };

  const configured: Target[] =
    Array.isArray(video.zernio_targets) && video.zernio_targets.length > 0
      ? video.zernio_targets
      : video.zernio_account_id
        ? [{ platform: video.platform, accountId: video.zernio_account_id }]
        : [];

  // Rattache chaque ligne à un compte ; si Zernio ne donne pas d'accountId,
  // on ne devine que lorsque c'est sans ambiguïté (une seule cible de cette plateforme).
  const resolved = targets
    .map((t) => {
      if (t.accountId) return { ...t, accountId: t.accountId };
      const same = configured.filter((c) => c.platform === t.platform);
      return same.length === 1 ? { ...t, accountId: same[0].accountId } : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  if (resolved.length === 0) return { synced: false as const };

  const { data: prevRows } = await db
    .from("post_targets").select("*").eq("video_id", video.id);
  const prev = new Map((prevRows ?? []).map((r) => [r.account_id as string, r]));
  const now = new Date().toISOString();

  const rows = resolved.map((t) => ({
    video_id: video.id,
    account_id: t.accountId,
    user_id: userId,
    zernio_post_id: video.zernio_post_id,
    platform: t.platform,
    platform_post_url: t.platformPostUrl,
    thumbnail_url: t.thumbnailUrl,
    views: t.views, impressions: t.impressions, reach: t.reach,
    likes: t.likes, comments: t.comments, shares: t.shares,
    saves: t.saves, clicks: t.clicks,
    avg_watch_time: t.avgWatchTime,
    raw: t.raw,
    last_synced_at: now,
  }));
  const { error: upErr } = await db.from("post_targets").upsert(rows, { onConflict: "video_id,account_id" });
  if (upErr) throw new Error(`post_targets: ${upErr.message}`);

  const history = rows
    .filter((r) => {
      const p = prev.get(r.account_id);
      return !p || METRICS.some((m) => Number(p[m]) !== r[m]);
    })
    .map((r) => ({
      video_id: r.video_id, account_id: r.account_id, user_id: userId, captured_at: now,
      views: r.views, impressions: r.impressions, reach: r.reach,
      likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves,
    }));
  if (history.length > 0) {
    const { error } = await db.from("post_target_history").insert(history);
    if (error) console.error("[sync] post_target_history:", error.message);
  }

  // Totaux de la vidéo = somme des comptes réellement ciblés.
  const wanted = new Set(configured.map((c) => c.accountId));
  const counted = wanted.size > 0 ? rows.filter((r) => wanted.has(r.account_id)) : rows;
  const used = counted.length > 0 ? counted : rows;
  const sum = (k: "views" | "likes" | "comments" | "shares" | "saves") => used.reduce((s, r) => s + r[k], 0);
  const watch = used.filter((r) => r.avg_watch_time > 0);
  const totals = {
    views: sum("views"),
    likes: sum("likes"),
    comments: sum("comments"),
    shares: sum("shares"),
    saves: sum("saves"),
    newFollowers: 0, // Zernio n'expose pas les abonnés gagnés par post
    avgWatchTime: watch.length ? watch.reduce((s, r) => s + r.avg_watch_time, 0) / watch.length : 0,
    completionRate: 0,
  };

  const { error: vErr } = await db.from("videos").update({
    views: totals.views, likes: totals.likes, comments: totals.comments,
    shares: totals.shares, saves: totals.saves,
    new_followers: totals.newFollowers,
    avg_watch_time: totals.avgWatchTime,
    completion_rate: totals.completionRate,
    zernio_synced_at: now,
  }).eq("id", video.id);
  if (vErr) throw new Error(vErr.message);

  return { synced: true as const, totals };
}

// Synchro complète (comptes + santé + compteurs + stats de toutes les vidéos publiées).
export async function syncEverything(db: Db, userId: string) {
  const errors: Array<{ scope: string; error: string }> = [];
  let accountsSynced = 0, snapshots = 0, videosSynced = 0;
  try {
    accountsSynced = (await syncAccounts(db, userId)).count;
    for (const a of await zernioListAccounts()) {
      try { await syncAccountSnapshot(db, userId, a); snapshots += 1; }
      catch (e) { errors.push({ scope: `account:${a._id}`, error: (e as Error).message }); }
    }
  } catch (e) {
    errors.push({ scope: "accounts", error: (e as Error).message });
  }
  const { data: videos } = await db.from("videos")
    .select("id, platform, zernio_post_id, zernio_account_id, zernio_targets")
    .eq("user_id", userId).eq("status", "published").not("zernio_post_id", "is", null);
  for (const v of videos ?? []) {
    try {
      const r = await syncVideoTargets(db, userId, {
        id: v.id as string, platform: v.platform as string, zernio_post_id: v.zernio_post_id as string,
        zernio_account_id: v.zernio_account_id as string | null, zernio_targets: v.zernio_targets,
      });
      if (r.synced) videosSynced += 1;
    } catch (e) { errors.push({ scope: `video:${v.id}`, error: (e as Error).message }); }
  }
  return { accountsSynced, snapshots, videosSynced, totalVideos: videos?.length ?? 0, errors };
}
