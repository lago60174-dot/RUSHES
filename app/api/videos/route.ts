import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function dbToVideo(row: Record<string, unknown>) {
  return {
    id: row.id,
    platform: row.platform,
    title: row.title,
    hashtags: row.hashtags,
    notes: row.notes,
    status: row.status,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    publishedDate: row.published_date,
    publishedTime: row.published_time,
    durationSeconds: row.duration_seconds,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    newFollowers: row.new_followers,
    avgWatchTime: row.avg_watch_time,
    completionRate: row.completion_rate,
    videoUrl: row.video_url,
    zernioPostId: row.zernio_post_id,
    zernioTargets: row.zernio_targets,
    zernioError: row.zernio_error,
    zernioErrorCategory: row.zernio_error_category,
    zernioSyncedAt: row.zernio_synced_at,
  };
}

export async function GET() {
  // 1. Identifier l'utilisateur via sa session (cookies)
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 2. Opération DB via le client admin (bypass RLS, user_id filtré manuellement)
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("videos")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data || []).map(dbToVideo));
}

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("videos")
    .insert({
      id: body.id,
      user_id: user.id,
      platform: body.platform,
      title: body.title,
      hashtags: body.hashtags || "",
      notes: body.notes || "",
      status: body.status,
      scheduled_date: body.scheduledDate || null,
      scheduled_time: body.scheduledTime || null,
      published_date: body.publishedDate || null,
      published_time: body.publishedTime || null,
      duration_seconds: body.durationSeconds || 0,
      views: body.views || 0,
      likes: body.likes || 0,
      comments: body.comments || 0,
      shares: body.shares || 0,
      saves: body.saves || 0,
      new_followers: body.newFollowers || 0,
      avg_watch_time: body.avgWatchTime || 0,
      completion_rate: body.completionRate || 0,
      video_url: body.videoUrl || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(dbToVideo(data));
}
