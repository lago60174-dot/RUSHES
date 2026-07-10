import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { zernioGetPostAnalytics, mapZernioAnalyticsMulti, zernioGetPost } from "@/lib/zernio";

// Synchronise automatiquement les statistiques de toutes les vidéos publiées
// (tous utilisateurs) ayant un post Zernio lié. Déclenché soit par :
//  - Vercel Cron (voir vercel.json) — header `Authorization: Bearer ${CRON_SECRET}`
//  - un webhook externe (Render, GitHub Actions, etc.) — header `x-cron-secret`
function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();

  // ── Étape 1 : filet de sécurité pour les publications programmées ──────
  // Le webhook Zernio (/api/zernio/webhook) est censé faire passer une vidéo
  // de "planned" à "published"/"failed" dès que Zernio publie réellement.
  // Mais si le webhook n'est pas configuré côté Zernio (ou mal configuré,
  // ex. sur le mauvais profile), une vidéo reste bloquée indéfiniment sur
  // "planned" même après l'heure prévue, sans que personne ne s'en rende
  // compte. On vérifie donc ici, à chaque passage du cron, toute vidéo
  // "planned" dont l'heure programmée est dépassée depuis au moins 3 minutes
  // (marge pour laisser Zernio publier réellement) directement auprès de
  // l'API Zernio.
  let resolved = 0;
  const resolveErrors: Array<{ id: string; error: string }> = [];
  {
    const { data: planned } = await supabase
      .from("videos")
      .select("id, zernio_post_id, scheduled_date, scheduled_time")
      .eq("status", "planned")
      .not("zernio_post_id", "is", null);

    const now = Date.now();
    const GRACE_MS = 3 * 60 * 1000;
    const overdue = (planned || []).filter((v) => {
      if (!v.scheduled_date) return false;
      const iso = `${v.scheduled_date}T${v.scheduled_time || "00:00"}:00`;
      const t = new Date(iso).getTime();
      return !Number.isNaN(t) && now - t > GRACE_MS;
    });

    for (const video of overdue) {
      try {
        const post = await zernioGetPost(video.zernio_post_id as string);
        const failed = (post.platforms || []).filter((p) => p.status === "failed");
        const message = failed.length
          ? failed.map((p) => `${p.platform} : ${p.errorMessage || "échec inconnu"}`).join(" · ")
          : null;

        let status: "planned" | "published" | "failed" | null = null;
        if (post.status === "published" || post.status === "partial") status = "published";
        else if (post.status === "failed" || post.status === "cancelled") status = "failed";

        if (!status) continue; // toujours en attente côté Zernio, on ne touche à rien

        const update: Record<string, unknown> = {
          status,
          zernio_error: status === "failed" ? (message || "La publication a échoué sur Zernio.") : (message || null),
          zernio_error_category: failed[0]?.errorCategory || null,
          zernio_platform_status: post.platforms || [],
        };
        if (status === "published") {
          update.published_date = (post.publishedAt || new Date().toISOString()).slice(0, 10);
          update.published_time = (post.publishedAt ? new Date(post.publishedAt) : new Date()).toTimeString().slice(0, 5);
        }

        const { error: updateError } = await supabase.from("videos").update(update).eq("id", video.id);
        if (updateError) throw new Error(updateError.message);
        resolved += 1;
      } catch (e) {
        resolveErrors.push({ id: video.id as string, error: (e as Error).message });
      }
    }
  }

  // ── Étape 2 : synchro des stats des vidéos déjà publiées ───────────────
  const { data: videos, error } = await supabase
    .from("videos")
    .select("id, platform, zernio_post_id, zernio_targets")
    .eq("status", "published")
    .not("zernio_post_id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let synced = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const video of videos || []) {
    try {
      const analytics = await zernioGetPostAnalytics(video.zernio_post_id as string);
      const targetPlatforms: string[] =
        Array.isArray(video.zernio_targets) && video.zernio_targets.length > 0
          ? video.zernio_targets.map((t: { platform: string }) => t.platform)
          : [video.platform as string];
      const mapped = mapZernioAnalyticsMulti(analytics.platforms, targetPlatforms);

      const { error: updateError } = await supabase
        .from("videos")
        .update({
          views: mapped.views,
          likes: mapped.likes,
          comments: mapped.comments,
          shares: mapped.shares,
          saves: mapped.saves,
          new_followers: mapped.newFollowers,
          avg_watch_time: mapped.avgWatchTime,
          completion_rate: mapped.completionRate,
          zernio_synced_at: new Date().toISOString(),
        })
        .eq("id", video.id);

      if (updateError) throw new Error(updateError.message);
      synced += 1;
    } catch (e) {
      errors.push({ id: video.id as string, error: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    synced,
    total: videos?.length || 0,
    errors,
    resolvedScheduled: resolved,
    resolveErrors,
  });
}
