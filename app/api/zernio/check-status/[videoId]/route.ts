import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { zernioGetPost } from "@/lib/zernio";

// Vérifie manuellement, à la demande de l'utilisateur, si une publication
// (programmée ou forcée) est réellement passée côté Zernio. Sert de filet
// de sécurité tant que le webhook (/api/zernio/webhook) n'est pas configuré,
// et permet aussi une vérification immédiate à tout moment.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();
  const { data: video, error: fetchError } = await db
    .from("videos")
    .select("zernio_post_id")
    .eq("id", videoId)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !video) return NextResponse.json({ error: "Vidéo introuvable" }, { status: 404 });
  if (!video.zernio_post_id) {
    return NextResponse.json({ error: "Aucune publication Zernio liée à cette vidéo" }, { status: 400 });
  }

  try {
    const post = await zernioGetPost(video.zernio_post_id);
    const failed = (post.platforms || []).filter((p) => p.status === "failed");
    const message = failed.length
      ? failed.map((p) => `${p.platform} : ${p.errorMessage || "échec inconnu"}`).join(" · ")
      : null;

    let status: "planned" | "published" | "failed" = "planned";
    if (post.status === "published" || post.status === "partial") status = "published";
    else if (post.status === "failed" || post.status === "cancelled") status = "failed";

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

    const { error: updateError } = await db.from("videos").update(update).eq("id", videoId).eq("user_id", user.id);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, status, error: update.zernio_error });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
