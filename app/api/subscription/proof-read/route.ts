import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { path } = await request.json().catch(() => ({}));
  if (!path || !path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "Chemin invalide" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.storage
    .from("payment-proofs")
    .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 jours

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Échec" }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
