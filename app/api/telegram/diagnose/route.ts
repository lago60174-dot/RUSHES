import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getOwnerUserId } from "@/lib/sync";
import { isOwner } from "@/lib/owner";
import { tg, sendMessage, getOwnerChatId } from "@/lib/telegram";
import { agentProvider, mistralModel, probeMistralModel, MISTRAL_FALLBACK_CHAIN } from "@/lib/llm";
import {
  type Check, type ProbeResult, type WebhookInfo,
  checkEnv, interpretGetMe, interpretWebhookInfo, interpretProbe,
  interpretTables, interpretOwnerUser, interpretSend, interpretLlmKey, interpretLlmModel, summarize, webhookUrlFor,
} from "@/lib/telegram-diagnose";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Ordre d'affichage = ordre des causes les plus probables d'un bot muet.
const ORDER = [
  "env.token", "env.secret", "env.site",
  "tg.getme", "tg.webhook", "probe",
  "env.owner", "db.tables", "db.owner", "env.email",
  "env.llm", "llm.key", "llm.model", "env.stt", "env.r2", "send",
];

async function probe(url: string, secret: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      // Update vide : le webhook répond 200 sans rien traiter ni envoyer.
      body: JSON.stringify({ update_id: 0 }),
      signal: AbortSignal.timeout(8000),
    });
    return { status: res.status, contentType: res.headers.get("content-type"), location: res.headers.get("location") };
  } catch (e) {
    return { status: null, error: (e as Error).message };
  }
}

// GET /api/telegram/diagnose            → contrôle complet (lecture seule)
// GET /api/telegram/diagnose?send=1     → idem + envoie un message test à ton Telegram
export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isOwner(user.email)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const wantSend = url.searchParams.get("send") === "1";
  const origin = url.origin;
  const base = (process.env.NEXT_PUBLIC_SITE_URL || origin).replace(/\/+$/, "");
  const expected = webhookUrlFor(base);
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

  const checks: Check[] = checkEnv(process.env as Record<string, string | undefined>, origin);

  // Telegram : token valide + état du webhook
  if (token) {
    try {
      const me = await tg<{ username?: string }>("getMe");
      checks.push(interpretGetMe({ ok: true, username: me.username }));
    } catch (e) {
      checks.push(interpretGetMe({ ok: false, error: (e as Error).message }));
    }
    try {
      const info = await tg<WebhookInfo>("getWebhookInfo");
      checks.push(interpretWebhookInfo(info, expected));
    } catch (e) {
      checks.push({ id: "tg.webhook", label: "Webhook enregistré chez Telegram", status: "fail", detail: (e as Error).message });
    }
  }

  // Test réel de l'adresse publique (mauvais secret → 403, bon secret → 200)
  if (secret) {
    const [wrong, right] = await Promise.all([probe(expected, "diagnostic-invalid-secret"), probe(expected, secret)]);
    checks.push(interpretProbe(wrong, right, expected));
  }

  // Base de données + compte propriétaire
  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db.from("telegram_updates").select("created_at").order("created_at", { ascending: false }).limit(1);
    const agent = await db.from("agent_messages").select("id").limit(1);
    checks.push(interpretTables({ error: error ?? agent.error ?? undefined, lastUpdateAt: data?.[0]?.created_at ?? null }));
    checks.push(interpretOwnerUser(Boolean(await getOwnerUserId(db))));
  } catch (e) {
    checks.push({ id: "db.tables", label: "Tables du bot (phase15.sql)", status: "fail", detail: (e as Error).message, fix: "Vérifie NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY." });
  }

  // Clé IA + modèle. Mistral : UNE seule requête (le forfait gratuit n'accepte
  // qu'~1 requête/s, et le bot peut répondre en même temps) qui valide à la fois
  // la clé et le modèle. Anthropic : liste des modèles (gratuit).
  const provider = agentProvider();
  if (provider === "mistral") {
    const model = mistralModel();
    const main = await probeMistralModel(model);
    const isTier = main.status === 403 && /tier_not_allowed|subscription tier/i.test(main.body ?? "");
    const zero = main.status === 429 && main.headers?.["x-ratelimit-limit-req-minute"] === "0";
    // 401 (ou 403 hors forfait) = clé en cause ; tout autre statut prouve que la clé est acceptée.
    const keyStatus = main.status === null ? null : (main.status === 401 || (main.status === 403 && !isTier)) ? main.status : 200;
    checks.push(interpretLlmKey("mistral", keyStatus, main.error));
    // Modèle indisponible : on cherche, dans la chaîne de repli de l'app, le premier qui répond.
    let fallback: Awaited<ReturnType<typeof probeMistralModel>> | undefined;
    let fallbackModel: string | undefined;
    if (isTier || zero) {
      for (const m of MISTRAL_FALLBACK_CHAIN.filter((x) => x !== model)) {
        const pr = await probeMistralModel(m, { retries: 0 });
        if (pr.status !== null && pr.status >= 200 && pr.status < 300) { fallback = pr; fallbackModel = m; break; }
      }
    }
    checks.push(interpretLlmModel(model, main, fallback, fallbackModel));
  } else if (provider === "anthropic") {
    try {
      const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(8000) });
      checks.push(interpretLlmKey("anthropic", r.status));
    } catch (e) {
      checks.push(interpretLlmKey("anthropic", null, (e as Error).message));
    }
  }

  // Message test (uniquement à la demande)
  if (wantSend) {
    const owner = getOwnerChatId();
    if (!token || !owner) {
      checks.push({ id: "send", label: "Message test envoyé sur ton Telegram", status: "fail", detail: "Impossible : TELEGRAM_BOT_TOKEN ou TELEGRAM_OWNER_ID manquant." });
    } else {
      try {
        await sendMessage(owner, "🔧 Test de diagnostic FLARE Studio : si tu lis ceci, le bot peut t'écrire.");
        checks.push(interpretSend({ ok: true }));
      } catch (e) {
        checks.push(interpretSend({ ok: false, error: (e as Error).message }));
      }
    }
  } else {
    checks.push(interpretSend(null));
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
