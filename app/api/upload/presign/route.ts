import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getOwnerUserId } from "@/lib/sync";
import { isR2Configured, r2GetPresignedUpload } from "@/lib/r2";
import { verifyUploadToken } from "@/lib/upload-token";

// Public mais protégé par le jeton HMAC (30 min) généré par le bot Telegram.
export async function POST(request: Request) {
  const { token, fileName, fileType, fileSize } = await request.json().catch(() => ({}));
  if (!verifyUploadToken(token)) return NextResponse.json({ error: "Lien expiré ou invalide." }, { status: 401 });
  if (!isR2Configured()) return NextResponse.json({ error: "Stockage non configuré." }, { status: 500 });
  if (!fileName || typeof fileType !== "string" || !fileType.startsWith("video/")) {
    return NextResponse.json({ error: "Seules les vidéos sont acceptées." }, { status: 400 });
  }
  if (typeof fileSize === "number" && fileSize > 5 * 1024 ** 3) {
    return NextResponse.json({ error: "Fichier trop volumineux (5 Go max)." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const userId = await getOwnerUserId(db);
  if (!userId) return NextResponse.json({ error: "Compte propriétaire introuvable." }, { status: 500 });

  const { key, uploadUrl, publicUrl } = await r2GetPresignedUpload({ userId, filename: fileName, contentType: fileType });
  const { data, error } = await db.from("media_assets").insert({
    user_id: userId, storage: "r2", object_key: key, public_url: publicUrl, filename: fileName,
    content_type: fileType, size_bytes: typeof fileSize === "number" ? fileSize : null, source: "telegram",
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Erreur base." }, { status: 500 });
  return NextResponse.json({ uploadUrl, mediaId: data.id });
}
