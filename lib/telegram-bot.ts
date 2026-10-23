import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getOwnerUserId } from "@/lib/sync";
import { runAgent } from "@/lib/agent";
import { friendlyLlmError } from "@/lib/llm";
import { sendReply, triageItem, notifyTelegramApproval } from "@/lib/inbox";
import { isR2Configured, buildObjectKey, r2PutObject, r2PublicUrl } from "@/lib/r2";
import { createUploadToken } from "@/lib/upload-token";
import { zernioDeleteAccount } from "@/lib/zernio";
import { isSttConfigured, transcribeAudio } from "@/lib/stt";
import {
  TG_DOWNLOAD_LIMIT, getOwnerChatId, isTelegramConfigured, sendMessage, editMessage,
  answerCallback, typing, downloadFile,
} from "@/lib/telegram";

type Db = ReturnType<typeof createSupabaseAdminClient>;
type TgUser = { id: number };
type TgFile = { file_id: string; file_size?: number; mime_type?: string; file_name?: string; duration?: number };
export type TgMessage = {
  message_id: number; from?: TgUser; chat: { id: number; type: string };
  text?: string; caption?: string;
  reply_to_message?: { message_id: number };
  video?: TgFile & { thumbnail?: { file_id: string }; thumb?: { file_id: string } };
  document?: TgFile;
  voice?: TgFile; audio?: TgFile; video_note?: TgFile;
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
};
export type TgUpdate = {
  update_id: number; message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: { id: number } } };
};

const HELP = `👋 Salut, je suis ton assistant FLARE Studio.

On peut simplement discuter, ou je m'occupe de ton contenu. Envoie-moi une vidéo, une photo ou un vocal, puis dis-moi ce que tu veux :
• « Tu en penses quoi de cette vidéo ? »
• « Publie-la sur mon TikTok avec des hashtags voyage »
• « Programme-la demain à 18h sur Instagram et Facebook »
• « Comment vont mes vidéos en ce moment ? »
• « Réponds oui à ce commentaire »

Commandes : /inbox (à valider), /sync (actualiser les stats), /aide`;

// Garde l'indicateur « en train d'écrire… » actif pendant les traitements longs.
async function withTyping<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
  await typing(chatId);
  const timer = setInterval(() => { typing(chatId); }, 4000);
  try { return await fn(); } finally { clearInterval(timer); }
}

// Point d'entrée : verrou propriétaire, dédoublonnage, aiguillage, et message
// d'erreur à l'utilisateur au lieu d'un silence en cas de souci.
export async function handleUpdate(update: TgUpdate, deps: { db?: Db } = {}) {
  const fromId = update.message?.from?.id ?? update.callback_query?.from.id;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!fromId || !chatId || !isTelegramConfigured()) return;

  // Tant que TELEGRAM_OWNER_ID n'est pas défini, le bot ne fait RIEN d'autre que donner l'ID de celui qui lui écrit.
  const owner = getOwnerChatId();
  if (!owner) {
    if (update.message) await sendMessage(chatId, `Ton ID Telegram est ${fromId}.\nAjoute TELEGRAM_OWNER_ID=${fromId} dans les variables Vercel, redéploie, puis écris-moi à nouveau.`);
    return;
  }
  if (fromId !== owner) return; // inconnu : silence total

  try {
    const db = deps.db ?? createSupabaseAdminClient();
    const { error: dup } = await db.from("telegram_updates").insert({ update_id: update.update_id });
    if (dup) {
      if (dup.code === "23505") return; // déjà traité (Telegram renvoie parfois le même update)
      console.error("[telegram] telegram_updates (script SQL exécuté ?) :", dup.message); // on continue quand même
    }
    const userId = await getOwnerUserId(db);
    if (!userId) { await sendMessage(chatId, "Compte propriétaire introuvable (vérifie OWNER_EMAIL)."); return; }

    if (update.callback_query) return await handleCallback(db, userId, chatId, update.callback_query);
    if (update.message) return await handleMessage(db, userId, chatId, update.message);
  } catch (e) {
    console.error("[telegram] erreur :", (e as Error).message);
    const raw = (e as Error).message;
    const friendly = friendlyLlmError(raw);
    await sendMessage(chatId, friendly ? `⚠️ ${friendly}` : `⚠️ Je n'ai pas réussi à traiter ça : ${raw.slice(0, 200)}`).catch(() => {});
  }
}

// ── Boutons ────────────────────────────────────────────────────────────
async function handleCallback(db: Db, userId: string, chatId: number, cb: NonNullable<TgUpdate["callback_query"]>) {
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
async function inboxItemFromReply(db: Db, userId: string, m: TgMessage) {
  if (!m.reply_to_message) return null;
  const { data: item } = await db.from("inbox_items").select("id, status").eq("user_id", userId)
    .eq("tg_message_id", m.reply_to_message.message_id).maybeSingle();
  return item && ["pending_approval", "failed"].includes(item.status as string) ? (item.id as string) : null;
}

async function handleMessage(db: Db, userId: string, chatId: number, m: TgMessage) {
  const text = (m.text ?? "").trim();

  // Réponse (reply) à une carte de validation = envoi de TA version.
  if (text) {
    const itemId = await inboxItemFromReply(db, userId, m);
    if (itemId) {
      const r = await sendReply(db, itemId, text, "replied");
      await sendMessage(chatId, r.ok ? "✅ Ta réponse a été envoyée." : `⚠️ Échec de l'envoi : ${r.error}`);
      return;
    }
  }

  if (text === "/start" || text === "/aide" || text === "/help") { await sendMessage(chatId, HELP); return; }
  if (text === "/id") { await sendMessage(chatId, `Ton ID Telegram : ${m.from?.id}`); return; }
  if (text === "/sync") { await sendMessage(chatId, await withTyping(chatId, () => runAgent(db, userId, chatId, "Synchronise tout avec Zernio maintenant et résume ce qui a été mis à jour."))); return; }
  if (text === "/inbox") {
    const { data: pending } = await db.from("inbox_items").select("id").eq("user_id", userId).eq("status", "pending_approval").order("received_at", { ascending: false }).limit(5);
    if (!pending?.length) { await sendMessage(chatId, "Rien à valider 🎉"); return; }
    for (const p of pending) await notifyTelegramApproval(db, p.id as string);
    return;
  }

  // Vocal / fichier audio
  const voice = m.voice ?? m.audio;
  if (voice) { await handleVoice(db, userId, chatId, m, voice); return; }

  // Vidéo (envoyée comme vidéo ou comme fichier)
  const file = m.video ?? (m.document?.mime_type?.startsWith("video/") ? m.document : undefined);
  if (file) { await handleVideo(db, userId, chatId, m, file); return; }

  // Photo : le bot la regarde et en discute
  if (m.photo?.length) { await handlePhoto(db, userId, chatId, m); return; }

  if (m.video_note || m.document) { await sendMessage(chatId, "Ce type de fichier, je ne sais pas encore le lire. Envoie-moi plutôt une vidéo, une photo ou un vocal 🙂"); return; }

  if (text) await sendMessage(chatId, await withTyping(chatId, () => runAgent(db, userId, chatId, text)));
}

// ── Vocaux ─────────────────────────────────────────────────────────────
const MAX_VOICE_SECONDS = 10 * 60;

async function handleVoice(db: Db, userId: string, chatId: number, m: TgMessage, voice: TgFile) {
  if (!isSttConfigured()) { await sendMessage(chatId, "🎙️ Je ne peux pas encore écouter les vocaux : il manque MISTRAL_API_KEY (ou OPENAI_API_KEY) sur Vercel. En attendant, écris-moi 🙂"); return; }
  if ((voice.duration ?? 0) > MAX_VOICE_SECONDS) { await sendMessage(chatId, "🎙️ Ce vocal dépasse 10 minutes, c'est trop long pour moi. Peux-tu le raccourcir ou me l'écrire ?"); return; }
  if ((voice.file_size ?? 0) > TG_DOWNLOAD_LIMIT) { await sendMessage(chatId, "🎙️ Ce fichier audio est trop volumineux (20 Mo max)."); return; }

  const reply = await withTyping(chatId, async () => {
    const { buffer, path } = await downloadFile(voice.file_id);
    const { text } = await transcribeAudio(buffer, {
      filename: voice.file_name || path.split("/").pop() || "voice.ogg",
      mimeType: voice.mime_type || "audio/ogg",
    });
    // On montre ce qui a été compris : l'utilisateur voit tout de suite une erreur de transcription.
    await sendMessage(chatId, `🎙️ « ${text} »`);

    // Vocal en réponse à une carte de validation : on en fait un BROUILLON à confirmer
    // (jamais un envoi direct, une transcription peut être fausse et la réponse est publique).
    const itemId = await inboxItemFromReply(db, userId, m);
    if (itemId) {
      await db.from("inbox_items").update({ reply_draft: text }).eq("id", itemId);
      await notifyTelegramApproval(db, itemId);
      return null;
    }
    return runAgent(db, userId, chatId, `[Message vocal] ${text}`);
  }).catch(async (e) => {
    await sendMessage(chatId, `🎙️ Je n'ai pas pu comprendre ce vocal : ${(e as Error).message.slice(0, 180)}`);
    return null;
  });
  if (reply) await sendMessage(chatId, reply);
}

// ── Photos ─────────────────────────────────────────────────────────────
async function handlePhoto(db: Db, userId: string, chatId: number, m: TgMessage) {
  // La plus grande version qui reste sous la limite d'image de l'API (5 Mo).
  const best = [...(m.photo ?? [])].filter((p) => (p.file_size ?? 0) <= 5 * 1024 * 1024).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!best) { await sendMessage(chatId, "Cette photo est trop lourde pour que je la regarde 😅"); return; }
  const reply = await withTyping(chatId, async () => {
    const { buffer } = await downloadFile(best.file_id);
    return runAgent(db, userId, chatId, {
      text: (m.caption ?? "").trim() || "(il t'a envoyé cette image sans message)",
      images: [{ mediaType: "image/jpeg", data: buffer.toString("base64") }],
    });
  });
  await sendMessage(chatId, reply);
}

// ── Vidéos ─────────────────────────────────────────────────────────────
async function handleVideo(db: Db, userId: string, chatId: number, m: TgMessage, file: NonNullable<TgMessage["video"]>) {
  if (!isR2Configured()) { await sendMessage(chatId, "⚠️ Le stockage Cloudflare R2 n'est pas configuré (variables R2_* sur Vercel)."); return; }

  // Telegram ne laisse pas un bot télécharger plus de 20 Mo : lien d'upload direct vers R2.
  if (!file.file_size || file.file_size > TG_DOWNLOAD_LIMIT) {
    const base = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
    if (!base) { await sendMessage(chatId, "⚠️ NEXT_PUBLIC_SITE_URL manquant : impossible de générer le lien d'upload."); return; }
    const mb = file.file_size ? `${Math.round(file.file_size / 1048576)} Mo` : "volumineuse";
    await sendMessage(chatId, `Cette vidéo est ${mb} : Telegram ne me laisse pas la télécharger au-delà de 20 Mo.\n\n📤 Envoie-la directement avec ce lien (valable 30 min) :\n${base}/u/${createUploadToken(30)}\n\nJe te préviens ici dès qu'elle est reçue.`);
    return;
  }

  const caption = (m.caption ?? "").trim();
  const reply = await withTyping(chatId, async () => {
    const { buffer, path } = await downloadFile(file.file_id);
    const filename = file.file_name || path.split("/").pop() || "video.mp4";
    const contentType = file.mime_type || "video/mp4";
    const key = buildObjectKey(userId, filename);
    const publicUrl = await r2PutObject({ key, body: buffer, contentType });

    // Miniature fournie par Telegram, rangée à côté (<clé>.thumb.jpg) : sert de
    // repli quand l'extraction d'images de la vidéo n'est pas possible.
    const thumbId = file.thumbnail?.file_id ?? file.thumb?.file_id;
    if (thumbId) {
      try { await r2PutObject({ key: `${key}.thumb.jpg`, body: (await downloadFile(thumbId)).buffer, contentType: "image/jpeg" }); }
      catch (e) { console.error("[telegram] miniature :", (e as Error).message); }
    }

    const { data: media, error } = await db.from("media_assets").insert({
      user_id: userId, storage: "r2", object_key: key, public_url: publicUrl ?? r2PublicUrl(key),
      filename, content_type: contentType, size_bytes: buffer.length, source: "telegram",
    }).select("id").single();
    if (error || !media) return `⚠️ Vidéo stockée mais non enregistrée : ${error?.message}`;

    const mo = (buffer.length / 1048576).toFixed(1);
    if (!caption) return `✅ Vidéo reçue (${mo} Mo). Tu veux mon avis dessus, ou on la publie ? Dis-moi où, quand, avec quelle légende.`;
    // Une légende jointe vaut message : on la transmet à l'agent (qui peut regarder la vidéo).
    return runAgent(db, userId, chatId, `[Vidéo reçue : ${filename}, ${mo} Mo, media_id=${media.id}]\n${caption}`);
  });
  await sendMessage(chatId, reply);
}
