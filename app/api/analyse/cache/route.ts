import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("ai_analyses")
    .select("result, video_count, generated_at")
    .eq("user_id", user.id)
    .single();

  if (!data) return NextResponse.json(null, { status: 404 });
  return NextResponse.json({
    result: data.result,
    videoCount: data.video_count,
    generatedAt: data.generated_at,
  });
}
