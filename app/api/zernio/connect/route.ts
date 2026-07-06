import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { zernioGetConnectUrl } from "@/lib/zernio";

export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "Missing platform" }, { status: 400 });

  const db = createSupabaseAdminClient();
  const { data: settings } = await db
    .from("settings")
    .select("data")
    .eq("user_id", user.id)
    .single();

  const profileId = settings?.data?.zernioProfileId as string | undefined;
  if (!profileId) return NextResponse.json({ error: "No Zernio profile set up. Create a profile first via the Zernio dashboard." }, { status: 400 });

  try {
    const authUrl = await zernioGetConnectUrl(platform, profileId);
    return NextResponse.json({ authUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
