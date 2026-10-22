import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { syncVideoTargets } from "@/lib/sync";

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
    .select("zernio_post_id, platform, zernio_account_id, zernio_targets")
    .eq("id", videoId)
    .eq("user_id", user.id) // isolation manuelle obligatoire
    .single();

  if (fetchError || !video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  if (!video.zernio_post_id) {
    return NextResponse.json({ error: "No Zernio post linked to this video" }, { status: 400 });
  }

  try {
    const result = await syncVideoTargets(db, user.id, {
      id: videoId,
      platform: video.platform,
      zernio_post_id: video.zernio_post_id,
      zernio_account_id: video.zernio_account_id,
      zernio_targets: video.zernio_targets,
    });
    // Pas encore de stats côté Zernio : on ne renvoie pas de `stats` (le
    // client ne touche alors à rien) plutôt que d'écraser avec des zéros.
    if (!result.synced) return NextResponse.json({ ok: true, pending: true });
    return NextResponse.json({ ok: true, stats: result.totals });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
