import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { zernioGetPostAnalytics, mapZernioAnalyticsMulti } from "@/lib/zernio";

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
    .select("zernio_post_id, platform, zernio_targets")
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
    const analytics = await zernioGetPostAnalytics(video.zernio_post_id);
    const targetPlatforms: string[] =
      Array.isArray(video.zernio_targets) && video.zernio_targets.length > 0
        ? video.zernio_targets.map((t: { platform: string }) => t.platform)
        : [video.platform];
    const mapped = mapZernioAnalyticsMulti(analytics.platforms, targetPlatforms);

    const { error: updateError } = await db
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
      .eq("id", videoId)
      .eq("user_id", user.id); // isolation manuelle obligatoire

    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({ ok: true, stats: mapped });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
