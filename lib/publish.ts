import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zernioCreatePost, zernioListAccounts } from "@/lib/zernio";

type Db = SupabaseClient;

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Africa/Douala";

// Décalage (ms) entre UTC et le fuseau `tz` à l'instant `utcMs`.
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs;
}
// "2026-10-23T18:00" (heure locale dans tz) → timestamp UTC.
export function localToUtcMs(local: string, tz = APP_TIMEZONE): number {
  // Format strict : Date.parse est très permissif (« demain » donnerait l'an 2000).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return NaN;
  const naive = Date.parse(`${local}:00Z`); // "2026-10-23T18:00" lu comme de l'UTC, puis corrigé du décalage
  if (Number.isNaN(naive)) return NaN;
  return naive - tzOffsetMs(naive, tz);
}
export function nowLocalString(tz = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz, dateStyle: "full", timeStyle: "short",
  }).format(new Date());
}

export type PublishInput = {
  mediaId: string;                 // media_assets.id
  accountIds: string[];
  caption: string;
  hashtags?: string;
  title?: string;
  scheduledAtLocal?: string;       // "YYYY-MM-DDTHH:mm" (heure locale APP_TIMEZONE) ; absent = publier maintenant
};

// Crée la fiche vidéo + l'envoie à Zernio (immédiat ou programmé).
// La fiche est créée AVANT l'appel Zernio : en cas d'échec elle passe en
// "failed" avec le motif, visible dans l'app (rien ne se perd silencieusement).
export async function createAndPublishVideo(db: Db, userId: string, input: PublishInput) {
  const { data: media } = await db.from("media_assets")
    .select("id, public_url, filename").eq("id", input.mediaId).eq("user_id", userId).maybeSingle();
  if (!media) throw new Error("Média introuvable.");

  const accounts = await zernioListAccounts();
  const targets = input.accountIds.map((id) => {
    const a = accounts.find((x) => x._id === id);
    if (!a) throw new Error(`Compte inconnu ou déconnecté : ${id}`);
    return { platform: a.platform, accountId: a._id, username: a.username };
  });
  if (targets.length === 0) throw new Error("Aucun compte cible.");

  let scheduledFor: string | undefined;
  if (input.scheduledAtLocal) {
    const utc = localToUtcMs(input.scheduledAtLocal);
    if (Number.isNaN(utc)) throw new Error("Date de programmation invalide (format attendu AAAA-MM-JJTHH:mm).");
    if (utc < Date.now() + 60_000) throw new Error("La date de programmation est dans le passé.");
    scheduledFor = input.scheduledAtLocal;
  }

  const hashtags = (input.hashtags ?? "").trim();
  const content = [input.caption.trim(), hashtags].filter(Boolean).join("\n\n");
  const videoId = randomUUID();
  const [sd, st] = scheduledFor ? scheduledFor.split("T") : [null, null];

  const { error: insErr } = await db.from("videos").insert({
    id: videoId, user_id: userId, platform: targets[0].platform,
    title: (input.title || input.caption).trim().slice(0, 100) || "Vidéo",
    hashtags, notes: "Créée via Telegram",
    status: "planned", scheduled_date: sd, scheduled_time: st, video_url: media.public_url,
    zernio_targets: targets.map(({ platform, accountId }) => ({ platform, accountId })),
  });
  if (insErr) throw new Error(`Base de données : ${insErr.message}`);

  try {
    const post = await zernioCreatePost({
      content, platforms: targets.map(({ platform, accountId }) => ({ platform, accountId })),
      mediaUrl: media.public_url as string, scheduledFor, timezone: APP_TIMEZONE,
    });
    const now = new Date();
    await db.from("videos").update({
      zernio_post_id: post._id, zernio_account_id: targets[0].accountId,
      status: scheduledFor ? "planned" : "published",
      published_date: scheduledFor ? null : now.toISOString().slice(0, 10),
      published_time: scheduledFor ? null : now.toISOString().slice(11, 16),
      zernio_error: null, zernio_error_category: null,
    }).eq("id", videoId);
    await db.from("media_assets").update({ video_id: videoId }).eq("id", input.mediaId);
    return { videoId, postId: post._id, scheduled: Boolean(scheduledFor), scheduledAtLocal: scheduledFor ?? null, targets };
  } catch (e) {
    await db.from("videos").update({ status: "failed", zernio_error: (e as Error).message }).eq("id", videoId);
    throw e;
  }
}
