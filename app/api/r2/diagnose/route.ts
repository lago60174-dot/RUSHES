import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isOwner } from "@/lib/owner";
import { isR2Configured, r2PutObject, r2DeleteObject, r2PublicUrl } from "@/lib/r2";
import { summarize, type Check } from "@/lib/telegram-diagnose";
import { checkR2Env, interpretR2Put, interpretR2Public, interpretR2Cleanup, toFailure } from "@/lib/r2-diagnose";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ORDER = ["r2.env.R2_ACCOUNT_ID", "r2.env.R2_ACCESS_KEY_ID", "r2.env.R2_SECRET_ACCESS_KEY", "r2.env.R2_BUCKET", "r2.env.R2_PUBLIC_URL", "r2.put", "r2.public", "r2.delete"];

// GET /api/r2/diagnose : écrit un petit fichier de test dans ton bucket, le relit
// via l'URL publique, puis le supprime. Ne touche pas à tes vidéos.
export async function GET() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isOwner(user.email)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const checks: Check[] = checkR2Env(process.env as Record<string, string | undefined>);

  if (isR2Configured()) {
    const bucket = process.env.R2_BUCKET!;
    const key = `diagnostic/${randomUUID()}.txt`;
    const content = `diagnostic ${new Date().toISOString()}`;
    let written = false;

    try {
      await r2PutObject({ key, body: Buffer.from(content), contentType: "text/plain" });
      written = true;
      checks.push(interpretR2Put({ ok: true }, bucket));
    } catch (e) {
      checks.push(interpretR2Put({ ok: false, failure: toFailure(e) }, bucket));
    }

    if (written) {
      const url = r2PublicUrl(key);
      try {
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        checks.push(interpretR2Public({ status: res.status, matches: res.ok ? (await res.text()) === content : undefined }, url));
      } catch (e) {
        checks.push(interpretR2Public({ status: null, error: (e as Error).message }, url));
      }
      try {
        await r2DeleteObject(key);
        checks.push(interpretR2Cleanup({ ok: true }));
      } catch (e) {
        checks.push(interpretR2Cleanup({ ok: false, message: toFailure(e).message }));
      }
    }
  }

  checks.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return NextResponse.json({
    ...summarize(checks),
    checks,
    context: {
      webhookUrlExpected: process.env.R2_PUBLIC_URL ?? "",
      environment: process.env.VERCEL_ENV ?? "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
    },
  });
}
