import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function isAdmin(user: { user_metadata?: Record<string, unknown> } | null) {
  return user?.user_metadata?.role === "admin";
}

export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending"; // pending | approved | rejected | all

  const db = createSupabaseAdminClient();
  let query = db
    .from("payment_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data: requests, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Récupérer les emails des utilisateurs via l'API admin Supabase Auth
  const userIds = [...new Set((requests || []).map((r) => r.user_id))];
  const usersMap: Record<string, string> = {};
  for (const uid of userIds) {
    const { data } = await db.auth.admin.getUserById(uid);
    if (data?.user?.email) usersMap[uid] = data.user.email;
  }

  const enriched = (requests || []).map((r) => ({
    ...r,
    userEmail: usersMap[r.user_id] || r.user_id,
  }));

  return NextResponse.json(enriched);
}
