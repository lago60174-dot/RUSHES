import webpush from "web-push";
import { createSupabaseAdminClient } from "./supabase-admin";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:contact@example.com";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY as string, VAPID_PRIVATE_KEY as string);
  configured = true;
}

// Les 5 catégories d'évènements choisies pour RUSHES. Chaque appelant passe
// l'une de ces valeurs — ça permet de désactiver une catégorie plus tard
// (préférence par utilisateur, table `settings` → clé `pushPreferences`)
// sans toucher au code d'envoi lui-même.
export type PushEvent =
  | "publish_failed"
  | "publish_success"
  | "account_disconnected"
  | "video_never_sent"
  | "follower_milestone";

const DEFAULT_PREFERENCES: Record<PushEvent, boolean> = {
  publish_failed: true,
  publish_success: true,
  account_disconnected: true,
  video_never_sent: true,
  follower_milestone: true,
};

// Envoie une notification push à tous les utilisateurs abonnés (RUSHES est
// une app mono-utilisateur en pratique, mais on reste correct si jamais un
// second compte est créé un jour : chacun ne reçoit que selon ses propres
// préférences, stockées dans `settings.data.pushPreferences`).
export async function sendPush(
  event: PushEvent,
  payload: { title: string; body: string; url?: string }
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error(`[push] VAPID keys non configurées sur Vercel — notification "${payload.title}" ignorée.`);
    return;
  }
  ensureConfigured();

  const db = createSupabaseAdminClient();
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth");
  if (!subs || subs.length === 0) return;

  const { data: settingsRows } = await db.from("settings").select("user_id, data");
  const prefsByUser = new Map<string, Record<string, boolean>>();
  for (const row of settingsRows || []) {
    const data = row.data as Record<string, unknown> | null;
    prefsByUser.set(row.user_id as string, (data?.pushPreferences as Record<string, boolean>) || {});
  }

  await Promise.all(
    subs.map(async (sub) => {
      const prefs = prefsByUser.get(sub.user_id as string);
      const enabled = prefs && event in prefs ? prefs[event] : DEFAULT_PREFERENCES[event];
      if (!enabled) return;

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint as string, keys: { p256dh: sub.p256dh as string, auth: sub.auth as string } },
          JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || "/" })
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Abonnement expiré ou révoqué côté navigateur (app désinstallée,
          // permission retirée, etc.) — on le supprime plutôt que de
          // continuer à échouer dessus à chaque évènement.
          await db.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error(`[push] échec d'envoi (${sub.endpoint.slice(0, 40)}…) :`, (e as Error).message);
        }
      }
    })
  );
}
