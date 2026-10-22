import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getOwnerUserId } from "@/lib/sync";
import { runAgent } from "@/lib/agent";
import { sendReply, triageItem, notifyTelegramApproval } from "@/lib/inbox";
import { isR2Configured, buildObjectKey, r2PutObject, r2PublicUrl } from "@/lib/r2";
import { createUploadToken } from "@/lib/upload-token";
import { zernioDeleteAccount } from "@/lib/zernio";
import {
  TG_DOWNLOAD_LIMIT, getOwnerChatId, isTelegramConfigured, sendMessage, editMessage,
  answerCallback, typing, downloadFile, escapeHtml,
} from "@/lib/telegram";

export const maxDuration = 60;

type TgUser = { id: number };
type TgMessage = {
  message_id: number; from?: TgUser; chat: { id: number; type: string };
  text?: string; caption?: string;
  reply_to_message?: { message_id: number };
  video?: { file_id: string; file_size?: number; mime_type?: string; file_name?: string };
  document?: { file_id: string; file_size?: number; mime_type?: string; file_name?: string };
  photo?: unknown[];
};
type TgUpdate = {
  update_id: number; message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: { id: number } } };
};

const HELP = `👋 Je suis ton agent FLARE Studio.

Envoie-moi une vidéo (avec une légende si tu veux), puis dis-moi quoi en faire :
• « Publie-la sur mon TikTok avec des hashtags voyage »
• « Programme-la demain à 18h sur Instagram et Facebook »
• « Mes dernières vidéos ont marché ? Que me conseilles-tu ? »
• « Réponds oui à ce commentaire » / « Montre-moi ce qui attend ma validation »

Commandes : /inbox (à valider), /sync (actualiser les stats), /aide`;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(request: Request) {
  // 1. Seul Telegram, muni du secret défini à l'installation, peut appeler cette route.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: true });

  // 2. On répond 200 tout de suite ; le traitement (téléchargement, LLM) continue après.
  after(() => handle(update).catch((e) => console.error("[telegram] erreur :", (e as Error).message)));
  return NextResponse.json({ ok: true });
}

async function handle(update: TgUpdate) {
  const fromId = update.message?.from?.id ?? update.callback_query?.from.id;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!fromId || !chatId || !isTelegramConfigured()) return;

  // 3. Verrou propriétaire. Tant que TELEGRAM_OWNER_ID n'est pas défini, le bot
  //    ne fait RIEN d'autre que donner l'ID Telegram de celui qui lui écrit.
  const owner = getOwnerChatId();
  if (!owner) {
    if (update.message) await sendMessage(chatId, `Ton ID Telegram est ${fromId}.\nAjoute TELEGRAM_OWNER_ID=${fromId} dans les variables Vercel, redéploie, puis écris-moi à nouveau.`);
    return;
  }
  if (fromId !== owner) return; // inconnu : silence total

  const db = createSupabaseAdminClient();
  const { error: dup } = await db.from("telegram_updates").insert({ update_id: update.update_id });
  if (dup) {
    if (dup.code === "23505") return; // déjà traité (Telegram renvoie parfois le même update)
    console.error("[telegram] telegram_updates (phase15.sql exécuté ?) :", dup.message); // on continue quand même
  }

  const userId = await getOwnerUserId(db);
  if (!userId) { await sendMessage(chatId, "Compte propriétaire introuvable (vérifie OWNER_EMAIL)."); return; }

  if (update.callback_query) return handleCallback(db, userId, chatId, update.callback_query);
  if (update.message) return handleMessage(db, userId, chatId, update.message);
}

// ── Boutons ────────────────────────────────────────────────────────────
async function handleCallback(db: ReturnType<typeof createSupabaseAdminClient>, userId: string, chatId: number, cb: NonNullable<TgUpdate["callback_query"]>) {
  const [kind, action, id] = (cb.data ?? "").split(":");
  const mid = cb.message?.message_id;
  const done = (text: string) => mid ? editMessage(chatId, mid, text) : Promise.resolve();

  if (kind === "ib" && id) {
    const { data: item } = await db.from("inbox_items").select("id, status, reply_draft, text, author_name").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!item) { await answerCallback(cb.id, "Introuvable"); return; }
    if (action === "ok") {
      if (!item.reply_draft) { await answerCallback(cb.id, "Pas de brouillon"); return; }
      await answerCallback(cb.id, "Envoi…");
      const r = await sendReply(db, id, item.reply_draft, "replied");
      await done(r.ok ? `✅ Réponse envoyée à ${item.author_name ?? "l'interlocuteur"} :\n« ${item.reply_draft} »` : `⚠️ Échec de l'envoi : ${r.error}`);
    } else if (action === "ig") {
      await db.from("inbox_items").update({ status: "ignored" }).eq("id", id).in("status", ["new", "pending_approval", "failed"]);
      await answerCallback(cb.id, "Ignoré"); await done("🚫 Ignoré.");
    } else if (action === "rg") {
      await answerCallback(cb.id, "Nouvelle version…");
      await db.from("inbox_items").update({ status: "new", reply_draft: null }).eq("id", id).in("status", ["pending_approval", "failed"]);
      await triageItem(db, userId, id, { forceApproval: true });
      await done("↻ Nouvelle version envoyée ci-dessous.");
      await notifyTelegramApproval(db, id);
    }
    return;
  }

  if (kind === "dc") {
    if (action === "n" || !id) { await answerCallback(cb.id, "Annulé"); await done("Annulé."); return; }
    try {
      await zernioDeleteAccount(id);
      await db.from("zernio_accounts").update({ is_connected: false, status: "disconnected", disconnected_at: new Date().toISOString() }).eq("account_id", id);
      await answerCallback(cb.id, "Déconnecté"); await done("✅ Compte déconnecté.");
    } catch (e) {
      await answerCallback(cb.id, "Échec"); await done(`⚠️ Déconnexion impossible : ${(e as Error).message}`);
    }
  }
}

// ── Messages ───────────────────────────────────────────────────────────
async function handleMessage(db: ReturnType<typeof createSupabaseAdminClient>, userId: string, chatId: number, m: TgMessage) {
  const text = (m.text ?? "").trim();

  // Réponse (reply) à une carte de validation = envoi de TA version.
  if (text && m.reply_to_message) {
    const { data: item } = await db.from("inbox_items").select("id, status").eq("user_id", userId)
      .eq("tg_message_id", m.reply_to_message.message_id).maybeSingle();
    if (item && ["pending_approval", "failed"].includes(item.status as string)) {
      const r = await sendReply(db, item.id as string, text, "replied");
      await sendMessage(chatId, r.ok ? "✅ Ta réponse a été envoyée." : `⚠️ Échec de l'envoi : ${r.error}`);
      return;
    }
  }

  if (text === "/start" || text === "/aide" || text === "/help") { await sendMessage(chatId, HELP); return; }
  if (text === "/id") { await sendMessage(chatId, `Ton ID Telegram : ${m.from?.id}`); return; }
  if (text === "/sync") { await typing(chatId); await sendMessage(chatId, await runAgent(db, userId, chatId, "Synchronise tout avec Zernio maintenant et résume ce qui a été mis à jour.")); return; }
  if (text === "/inbox") {
    const { data: pending } = await db.from("inbox_items").select("id").eq("user_id", userId).eq("status", "pending_approval").order("received_at", { ascending: false }).limit(5);
    if (!pending?.length) { await sendMessage(chatId, "Rien à valider 🎉"); return; }
    for (const p of pending) await notifyTelegramApproval(db, p.id as string);
    return;
  }

  // Vidéo (envoyée comme vidéo ou comme fichier)
  const file = m.video ?? (m.document?.mime_type?.startsWith("video/") ? m.document : undefined);
  if (file) { await handleVideo(db, userId, chatId, m, file); return; }
  if (m.photo || (m.document && !file)) { await sendMessage(chatId, "Je ne gère que les vidéos pour l'instant 🎬"); return; }

  if (text) {
    await typing(chatId);
    await sendMessage(chatId, await runAgent(db, userId, chatId, text));
  }
}

async function handleVideo(db: ReturnType<typeof createSupabaseAdminClient>, userId: string, chatId: number, m: TgMessage, file: NonNullable<TgMessage["video"]>) {
  if (!isR2Configured()) { await sendMessage(chatId, "⚠️ Le stockage Cloudflare R2 n'est pas configuré (variables R2_* sur Vercel)."); return; }

  // Telegram ne laisse pas un bot télécharger plus de 20 Mo : lien d'upload direct vers R2.
  if (!file.file_size || file.file_size > TG_DOWNLOAD_LIMIT) {
    const base = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
    if (!base) { await sendMessage(chatId, "⚠️ NEXT_PUBLIC_SITE_URL manquant : impossible de générer le lien d'upload."); return; }
    const mb = file.file_size ? `${Math.round(file.file_size / 1048576)} Mo` : "volumineuse";
    await sendMessage(chatId, `Cette vidéo est ${mb} : Telegram ne me laisse pas la télécharger au-delà de 20 Mo.\n\n📤 Envoie-la directement avec ce lien (valable 30 min) :\n${base}/u/${createUploadToken(30)}\n\nJe te préviens ici dès qu'elle est reçue.`);
    return;
  }

  await typing(chatId);
  const { buffer, path } = await downloadFile(file.file_id);
  const filename = file.file_name || path.split("/").pop() || "video.mp4";
  const contentType = file.mime_type || "video/mp4";
  const key = buildObjectKey(userId, filename);
  const publicUrl = await r2PutObject({ key, body: buffer, contentType });

  const { data: media, error } = await db.from("media_assets").insert({
    user_id: userId, storage: "r2", object_key: key, public_url: publicUrl ?? r2PublicUrl(key),
    filename, content_type: contentType, size_bytes: buffer.length, source: "telegram",
  }).select("id").single();
  if (error || !media) { await sendMessage(chatId, `⚠️ Vidéo stockée mais non enregistrée : ${error?.message}`); return; }

  const caption = (m.caption ?? "").trim();
  if (!caption) {
    await sendMessage(chatId, `✅ Vidéo reçue (${(buffer.length / 1048576).toFixed(1)} Mo).\nDis-moi où et quand la publier, avec quelle légende et quels hashtags.`);
    return;
  }
  // Une légende jointe vaut instruction : on la transmet à l'agent.
  await typing(chatId);
  await sendMessage(chatId, await runAgent(db, userId, chatId,
    `[Vidéo reçue : ${filename}, ${(buffer.length / 1048576).toFixed(1)} Mo, media_id=${media.id}]\n${caption}`));
}
