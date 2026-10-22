import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioGetConnectUrl, zernioListAccounts, zernioPickProfileForNewAccount } from "@/lib/zernio";

// GET /api/zernio/connect?platform=tiktok
//   → AJOUTE un nouveau compte (profile libre ou nouveau profile : jamais
//     d'écrasement d'un compte existant).
// GET /api/zernio/connect?platform=tiktok&reconnectAccountId=XXX
//   → RECONNECTE ce compte (token expiré) dans son propre profile.
export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "Missing platform" }, { status: 400 });
  const reconnectAccountId = searchParams.get("reconnectAccountId");

  try {
    let profileId: string;
    if (reconnectAccountId) {
      const account = (await zernioListAccounts()).find((a) => a._id === reconnectAccountId);
      if (!account?.profileId) {
        return NextResponse.json({ error: "Compte à reconnecter introuvable." }, { status: 404 });
      }
      profileId = account.profileId;
    } else {
      profileId = await zernioPickProfileForNewAccount(platform);
    }

    const redirectUrl = new URL(request.url).origin + "/?zernio=connected";
    const authUrl = await zernioGetConnectUrl(platform, profileId, redirectUrl);
    return NextResponse.json({ authUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
