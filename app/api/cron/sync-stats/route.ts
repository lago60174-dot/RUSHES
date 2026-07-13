import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  zernioGetPostAnalytics,
  mapZernioAnalyticsMulti,
  zernioGetPost,
  zernioCreatePost,
  zernioListAccounts,
  zernioGetFollowerStats,
} from "@/lib/zernio";
import { sendPush } from "@/lib/push";

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

  // ── Étape 0 : publication automatique des vidéos jamais envoyées ───────
  // "Ajouter une vidéo" crée juste une fiche locale (status "planned" +
  // scheduled_date/time) SANS jamais appeler Zernio — l'envoi réel ne se
  // produisait auparavant que si l'utilisateur ouvrait manuellement la
  // modale de publication et cliquait sur "Publier". Résultat : une vidéo
  // planifiée dont l'heure passait ne se publiait jamais toute seule.
  // On répare ça ici : toute vidéo "planned" sans zernio_post_id dont
  // l'heure programmée est dépassée est envoyée à Zernio directement par
  // le cron, comme si l'utilisateur avait cliqué sur "Publier" lui-même.
  let autoPublished = 0;
  const autoPublishErrors: Array<{ id: string; error: string }> = [];
  {
    const { data: neverSent } = await supabase
      .from("videos")
      .select("id, platform, title, hashtags, video_url, scheduled_date, scheduled_time")
      .eq("status", "planned")
      .is("zernio_post_id", null);

    const now = Date.now();
    const overdueNeverSent = (neverSent || []).filter((v) => {
      if (!v.scheduled_date) return false;
      const iso = `${v.scheduled_date}T${v.scheduled_time || "00:00"}:00`;
      const t = new Date(iso).getTime();
      return !Number.isNaN(t) && now - t > 0;
    });

    if (overdueNeverSent.length > 0) {
      // Un seul appel pour récupérer les comptes connectés, réutilisé pour
      // toutes les vidéos de ce passage (au lieu d'un appel par vidéo).
      let accountsByPlatform: Record<string, string> = {};
      try {
        const accounts = await zernioListAccounts(process.env.ZERNIO_PROFILE_ID);
        for (const a of accounts) {
          if (!accountsByPlatform[a.platform]) accountsByPlatform[a.platform] = a._id;
        }
      } catch {
        // Si la liste des comptes échoue, chaque vidéo tombera dans l'erreur
        // "Aucun compte connecté" ci-dessous plutôt que de planter le cron.
        accountsByPlatform = {};
      }

      for (const video of overdueNeverSent) {
        try {
          const accountId = accountsByPlatform[video.platform as string];
          if (!accountId) {
            throw new Error(`Aucun compte ${video.platform} connecté sur Zernio.`);
          }
          if (!video.video_url) {
            throw new Error("Aucune vidéo liée (video_url manquant).");
          }

          const caption = [video.title, video.hashtags].filter(Boolean).join("\n\n");
          const post = await zernioCreatePost({
            content: caption,
            platforms: [{ platform: video.platform as string, accountId }],
            mediaUrl: video.video_url as string,
            // Pas de scheduledFor : l'heure est déjà dépassée, on publie
            // immédiatement plutôt que de reprogrammer dans le passé.
          });

          const { error: updateError } = await supabase
            .from("videos")
            .update({
              zernio_post_id: post._id,
              zernio_account_id: accountId,
              zernio_targets: [{ platform: video.platform, accountId }],
              status: "published",
              published_date: new Date().toISOString().slice(0, 10),
              published_time: new Date().toTimeString().slice(0, 5),
              zernio_error: null,
              zernio_error_category: null,
            })
            .eq("id", video.id);

          if (updateError) throw new Error(updateError.message);
          autoPublished += 1;
        } catch (e) {
          const message = (e as Error).message;
          autoPublishErrors.push({ id: video.id as string, error: message });
          // On marque la vidéo en échec plutôt que de la laisser silencieusement
          // "planned" pour toujours — elle apparaît dans le bucket "Échec de
          // publication" du calendrier, avec le motif exact, pour action manuelle.
          await supabase
            .from("videos")
            .update({ status: "failed", zernio_error: message })
            .eq("id", video.id);
          sendPush("video_never_sent", {
            title: "⏰ Vidéo jamais envoyée à Zernio",
            body: `« ${video.title || "Une vidéo"} » était programmée mais n'a pas pu être envoyée : ${message}`,
            url: "/",
          }).catch((err) => console.error("[push] video_never_sent:", err));
        }
      }
    }
  }

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
      .select("id, title, zernio_post_id, scheduled_date, scheduled_time")
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

        // Le webhook Zernio n'a manifestement pas fonctionné pour cette vidéo
        // (sinon elle ne serait plus "planned") — on notifie quand même via
        // ce filet de sécurité pour ne pas laisser passer l'évènement.
        const videoTitle = (video.title as string) || "Une vidéo";
        if (status === "published") {
          sendPush("publish_success", {
            title: "✅ Publication réussie",
            body: `« ${videoTitle} » est en ligne.`,
            url: "/",
          }).catch((e) => console.error("[push] publish_success (fallback):", e));
        } else if (status === "failed") {
          sendPush("publish_failed", {
            title: "❌ Échec de publication",
            body: `« ${videoTitle} » : ${(update.zernio_error as string) || "la publication a échoué."}`,
            url: "/",
          }).catch((e) => console.error("[push] publish_failed (fallback):", e));
        }
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
      if (Object.keys(analytics.platforms).length === 0) {
        // Pas encore de données exploitables (synchro en cours côté Zernio,
        // ou échec sur toutes les plateformes) — on retente au prochain
        // passage plutôt que d'écraser les stats avec des zéros.
        continue;
      }
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

  // ── Étape 3 : paliers de croissance (tous les 100 abonnés) ─────────────
  // Pour chaque compte connecté, compare le nombre d'abonnés actuel au
  // dernier palier de 100 déjà notifié (table account_milestones). Au
  // premier passage pour un compte donné, on enregistre le palier de départ
  // SANS notifier (sinon on spammerait immédiatement avec toute la
  // croissance déjà acquise avant l'activation des notifications).
  let milestonesSent = 0;
  const milestoneErrors: Array<{ accountId: string; error: string }> = [];
  {
    try {
      const accounts = await zernioListAccounts(process.env.ZERNIO_PROFILE_ID);
      for (const account of accounts) {
        try {
          const stats = await zernioGetFollowerStats(account._id, account.platform);
          const currentMilestone = Math.floor(stats.followerCount / 100) * 100;

          const { data: existing } = await supabase
            .from("account_milestones")
            .select("last_follower_milestone")
            .eq("account_id", account._id)
            .maybeSingle();

          if (!existing) {
            await supabase.from("account_milestones").insert({
              account_id: account._id,
              last_follower_milestone: currentMilestone,
            });
            continue;
          }

          if (currentMilestone > existing.last_follower_milestone) {
            await sendPush("follower_milestone", {
              title: "🎉 Nouveau palier d'abonnés",
              body: `${account.platform} (@${account.username || account.name}) vient de dépasser ${currentMilestone.toLocaleString("fr-FR")} abonnés !`,
              url: "/",
            });
            await supabase
              .from("account_milestones")
              .update({ last_follower_milestone: currentMilestone, updated_at: new Date().toISOString() })
              .eq("account_id", account._id);
            milestonesSent += 1;
          }
        } catch (e) {
          milestoneErrors.push({ accountId: account._id, error: (e as Error).message });
        }
      }
    } catch (e) {
      milestoneErrors.push({ accountId: "*", error: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    synced,
    total: videos?.length || 0,
    errors,
    resolvedScheduled: resolved,
    resolveErrors,
    autoPublished,
    autoPublishErrors,
    milestonesSent,
    milestoneErrors,
  });
}
