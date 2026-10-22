import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getOwnerUserId } from "@/lib/sync";
import { verifyUploadToken } from "@/lib/upload-token";
import { getOwnerChatId, isTelegramConfigured, sendMessage } from "@/lib/telegram";

// Appelée par la page /u/<jeton> une fois l'upload terminé : prévient le chat Telegram.
export async function POST(request: Request) {
  const { token, mediaId } = await request.json().catch(() => ({}));
  if (!verifyUploadToken(token)) return NextResponse.json({ error: "Lien expiré ou invalide." }, { status: 401 });

  const db = createSupabaseAdminClient();
  const userId = await getOwnerUserId(db);
  const { data: media } = await db.from("media_assets").select("filename, size_bytes")
    .eq("id", mediaId).eq("user_id", userId ?? "").maybeSingle();
  if (!media) return NextResponse.json({ error: "Média introuvable." }, { status: 404 });

  const chatId = getOwnerChatId();
  if (isTelegramConfigured() && chatId) {
    const mb = media.size_bytes ? ` (${(Number(media.size_bytes) / 1048576).toFixed(0)} Mo)` : "";
    await sendMessage(chatId, `✅ Vidéo reçue : ${media.filename}${mb}.\nDis-moi où et quand la publier, avec quelle légende et quels hashtags.`).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
