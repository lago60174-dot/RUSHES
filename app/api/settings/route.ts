import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("settings")
    .select("data")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json(data?.data || {});
}

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const db = createSupabaseAdminClient();

  await db.from("settings").upsert({
    user_id: user.id,
    data: body,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
