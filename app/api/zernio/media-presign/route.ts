import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioGetMediaPresignUrl } from "@/lib/zernio";
import { isR2Configured, r2GetPresignedUpload } from "@/lib/r2";

// Même contrat qu'avant ({ uploadUrl, publicUrl, expires }) : les composants
// existants (Modals, LibraryView) n'ont pas à changer. Si Cloudflare R2 est
// configuré, le fichier va sur R2 ; sinon on retombe sur le presign Zernio
// (bascule progressive, rien ne casse tant que R2 n'est pas prêt).
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileName, fileType, fileSize } = await request.json().catch(() => ({}));
  if (!fileName || !fileType) {
    return NextResponse.json({ error: "fileName et fileType requis" }, { status: 400 });
  }
  if (!fileType.startsWith("video/")) {
    return NextResponse.json({ error: "Seuls les fichiers vidéo sont acceptés" }, { status: 400 });
  }

  try {
    if (!isR2Configured()) {
      const { uploadUrl, publicUrl, expires } = await zernioGetMediaPresignUrl(fileName, fileType);
      return NextResponse.json({ uploadUrl, publicUrl, expires });
    }

    const { key, uploadUrl, publicUrl, expires } = await r2GetPresignedUpload({
      userId: user.id,
      filename: fileName,
      contentType: fileType,
    });

    // Trace en base (RLS : l'utilisateur n'insère que pour lui-même).
    const { error } = await supabase.from("media_assets").insert({
      user_id: user.id,
      storage: "r2",
      object_key: key,
      public_url: publicUrl,
      filename: fileName,
      content_type: fileType,
      size_bytes: typeof fileSize === "number" ? fileSize : null,
      source: "web",
    });
    if (error) console.error("[r2] insert media_assets:", error.message);

    return NextResponse.json({ uploadUrl, publicUrl, expires });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
