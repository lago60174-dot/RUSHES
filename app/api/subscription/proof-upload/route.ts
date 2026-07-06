import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filename } = await request.json().catch(() => ({ filename: "proof.jpg" }));
  const ext = (filename || "proof.jpg").split(".").pop() || "jpg";
  const path = `${user.id}/${Date.now()}.${ext}`;

  const db = createSupabaseAdminClient();
  const { data, error } = await db.storage
    .from("payment-proofs")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Échec" }, { status: 500 });
  }

  return NextResponse.json({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    path: data.path,
    token: data.token,
  });
}
