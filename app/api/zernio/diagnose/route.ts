import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isOwner } from "@/lib/owner";
import { zernioListAccounts, zernioListProfiles, zernioListWebhooks, zernioTestWebhook, type ZernioWebhook } from "@/lib/zernio";
import { summarize, type Check } from "@/lib/telegram-diagnose";
import {
  checkZernioEnv, interpretZernioAccounts, interpretZernioProfile, interpretZernioWebhooks,
  interpretSignedProbe, interpretZernioTest, zernioWebhookUrlFor, type SignedProbe,
} from "@/lib/zernio-diagnose";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ORDER = ["z.env.key", "z.env.secret", "z.api", "z.profile", "z.webhook", "z.probe", "z.test"];

// GET /api/zernio/diagnose            → contrôle complet (lecture seule)
// GET /api/zernio/diagnose?test=1     → idem + demande à Zernio d'envoyer un webhook.test
export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isOwner(user.email)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const wantTest = url.searchParams.get("test") === "1";
  const base = (process.env.NEXT_PUBLIC_SITE_URL || url.origin).replace(/\/+$/, "");
  const expected = zernioWebhookUrlFor(base);
  const secret = process.env.ZERNIO_WEBHOOK_SECRET ?? "";

  const checks: Check[] = checkZernioEnv(process.env as Record<string, string | undefined>);

  // Clé API + comptes connectés
  if (process.env.ZERNIO_API_KEY) {
    try {
      const accounts = await zernioListAccounts();
      checks.push(interpretZernioAccounts({ ok: true, count: accounts.length }));
    } catch (e) {
      checks.push(interpretZernioAccounts({ ok: false, error: (e as Error).message }));
    }

    // Profil de l'ancien compte encore configuré ?
    let profiles: Array<{ id: string; name?: string }> | null = null;
    try { profiles = await zernioListProfiles(); } catch { /* indisponible */ }
    checks.push(interpretZernioProfile(process.env.ZERNIO_PROFILE_ID, profiles));

    // Webhook(s) déclaré(s) chez Zernio
    let hooks: ZernioWebhook[] | null = null;
    try {
      hooks = await zernioListWebhooks();
      checks.push(interpretZernioWebhooks(hooks, expected));
    } catch (e) {
      checks.push({ id: "z.webhook", label: "Webhook déclaré dans Zernio", status: "warn", detail: `Impossible de lire la liste des webhooks : ${(e as Error).message}`, fix: "La clé API a peut-être un accès restreint (groupe « webhooks » désactivé)." });
    }

    // Test à la demande, envoyé par Zernio lui-même
    if (wantTest) {
      const norm = (u: string) => u.trim().replace(/\/+$/, "");
      const mine = hooks?.find((w) => norm(w.url) === norm(expected)) ?? hooks?.[0];
      if (!mine?.id) {
        checks.push({ id: "z.test", label: "Test envoyé par Zernio à ton webhook", status: "fail", detail: "Aucun webhook à tester dans ce compte Zernio.", fix: "Crée d'abord le webhook (voir la ligne précédente)." });
      } else {
        try { checks.push(interpretZernioTest(await zernioTestWebhook(mine.id))); }
        catch (e) { checks.push({ id: "z.test", label: "Test envoyé par Zernio à ton webhook", status: "fail", detail: (e as Error).message }); }
      }
    } else {
      checks.push(interpretZernioTest(null));
    }
  }

  // Test interne : faux webhook.test signé avec TON secret, envoyé à ta propre URL publique
  if (secret) {
    const body = JSON.stringify({ id: `diag-${Date.now()}`, event: "webhook.test", message: "Test interne du diagnostic", timestamp: new Date().toISOString() });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    let probe: SignedProbe;
    try {
      const res = await fetch(expected, {
        method: "POST", redirect: "manual",
        headers: { "content-type": "application/json", "x-zernio-signature": signature },
        body, signal: AbortSignal.timeout(8000),
      });
      probe = { status: res.status, contentType: res.headers.get("content-type"), location: res.headers.get("location"), body: (await res.text().catch(() => "")).slice(0, 200) };
    } catch (e) {
      probe = { status: null, error: (e as Error).message };
    }
    checks.push(interpretSignedProbe(probe, expected));
  }

  checks.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

  return NextResponse.json({
    ...summarize(checks),
    checks,
    context: {
      webhookUrlExpected: expected,
      environment: process.env.VERCEL_ENV ?? "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
    },
  });
}
