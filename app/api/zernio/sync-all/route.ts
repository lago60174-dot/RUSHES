import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { syncEverything } from "@/lib/sync";

// Synchro complète à la demande, sans attendre le cron de 6h.
export const maxDuration = 60;

export async function POST() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await syncEverything(createSupabaseAdminClient(), user.id)) });
}
