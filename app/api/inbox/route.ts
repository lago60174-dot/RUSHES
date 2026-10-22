import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// GET /api/inbox?view=pending|recent   (+ pendingCount toujours renvoyé)
export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = new URL(request.url).searchParams.get("view") || "pending";
  const db = createSupabaseAdminClient();

  const { count } = await db.from("inbox_items").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("status", "pending_approval");

  let q = db.from("inbox_items")
    .select("id, kind, direction, platform, account_id, author_name, author_username, text, received_at, status, category, confidence, reply_draft, reply_text, reason, replied_at, error, video_id")
    .eq("user_id", user.id).eq("direction", "incoming");
  q = view === "pending"
    ? q.in("status", ["pending_approval", "failed"]).order("received_at", { ascending: false })
    : q.in("status", ["auto_replied", "replied", "ignored"]).order("received_at", { ascending: false });
  const { data, error } = await q.limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], pendingCount: count ?? 0 });
}
