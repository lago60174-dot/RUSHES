import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getInboxSettings, saveInboxSettings, type InboxSettings } from "@/lib/inbox";

export async function GET() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getInboxSettings(createSupabaseAdminClient(), user.id));
}

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await request.json().catch(() => ({}));
  const patch: Partial<InboxSettings> = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (typeof b.autoReply === "boolean") patch.autoReply = b.autoReply;
  if (typeof b.tone === "string") patch.tone = b.tone.slice(0, 300);
  if (typeof b.maxAutoPerHour === "number") patch.maxAutoPerHour = Math.max(0, Math.min(200, Math.floor(b.maxAutoPerHour)));
  if (Array.isArray(b.extraSensitiveWords)) patch.extraSensitiveWords = b.extraSensitiveWords.map(String).slice(0, 50);
  return NextResponse.json(await saveInboxSettings(createSupabaseAdminClient(), user.id, patch));
}
