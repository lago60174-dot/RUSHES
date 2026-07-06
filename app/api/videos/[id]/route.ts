import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("videos")
    .update({
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
      video_url: body.videoUrl ?? undefined,
    })
    .eq("id", id)
    .eq("user_id", user.id); // isolation manuelle obligatoire avec admin client

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("videos")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id); // isolation manuelle obligatoire avec admin client

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
