import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getOwnerUserId } from "@/lib/sync";
import { isOwner } from "@/lib/owner";
import { getInboxSettings, retryStuckItems } from "@/lib/inbox";
import { agentProvider, isLlmConfigured } from "@/lib/llm";
import { isTelegramConfigured, getOwnerChatId } from "@/lib/telegram";
import { zernioListAccounts, zernioListWebhooks } from "@/lib/zernio";
import { summarize, type Check } from "@/lib/telegram-diagnose";
import { zernioWebhookUrlFor } from "@/lib/zernio-diagnose";
import {
  aggregateInbox, interpretInboxSettings, interpretInboxLlm, interpretInboxAccounts, interpretInboxEvents,
  interpretInboxTelegram, interpretInboxActivity, interpretInboxStuck, interpretInboxFailed, interpretInboxTables, interpretInboxRetry,
} from "@/lib/inbox-diagnose";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ORDER = ["i.tables", "i.settings", "i.llm", "i.accounts", "i.events", "i.telegram", "i.activity", "i.stuck", "i.failed", "i.retry"];

// GET /api/inbox/diagnose            → l'app répond-elle aux commentaires et messages ? (lecture seule)
// GET /api/inbox/diagnose?retry=1    → relance en plus le tri des éléments bloqués
export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isOwner(user.email)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const wantRetry = url.searchParams.get("retry") === "1";
  const base = (process.env.NEXT_PUBLIC_SITE_URL || url.origin).replace(/\/+$/, "");
  const expected = zernioWebhookUrlFor(base);
  const norm = (u: string) => u.trim().replace(/\/+$/, "");
  const checks: Check[] = [];

  const db = createSupabaseAdminClient();
  const ownerId = await getOwnerUserId(db);
  if (!ownerId) {
    return NextResponse.json({ error: "Compte propriétaire introuvable (OWNER_EMAIL)." }, { status: 400 });
  }

  checks.push(interpretInboxSettings(await getInboxSettings(db, ownerId)));
  checks.push(interpretInboxLlm(isLlmConfigured(), agentProvider()));

  let accounts: number | null = null;
  try { accounts = (await zernioListAccounts()).length; } catch { /* clé absente ou refusée */ }
  checks.push(interpretInboxAccounts(accounts));

  let webhook: { found: boolean; events: string[] } | null = null;
  try {
    const hooks = await zernioListWebhooks();
    const mine = hooks.find((w) => norm(w.url) === norm(expected));
    webhook = { found: Boolean(mine), events: mine?.events ?? [] };
  } catch { /* liste indisponible */ }
  checks.push(interpretInboxEvents(webhook));
  checks.push(interpretInboxTelegram(isTelegramConfigured(), Boolean(getOwnerChatId())));

  // Reprise des éléments bloqués (à la demande), AVANT de compter, pour que le résultat se voie.
  let retry: { retried: number; escalated: number; stuck: number } | null = null;
  if (wantRetry) {
    try { retry = await retryStuckItems(db, ownerId); }
    catch (e) { checks.push({ id: "i.retry", label: "Relance du tri", status: "fail", detail: (e as Error).message }); }
  }

  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data, error } = await db.from("inbox_items").select("kind, status, error, received_at")
    .eq("user_id", ownerId).eq("direction", "incoming").gte("received_at", since)
    .order("received_at", { ascending: false }).limit(1000);
  const missing = Boolean(error && (error.code === "42P01" || /does not exist|schema cache|could not find/i.test(error.message)));
  const tableCheck = interpretInboxTables(missing || Boolean(error), error?.message);
  if (tableCheck) {
    checks.push(tableCheck);
  } else {
    const stats = aggregateInbox((data ?? []) as Array<{ kind: string; status: string; error: string | null; received_at: string }>);
    checks.push(interpretInboxActivity(stats), interpretInboxStuck(stats), interpretInboxFailed(stats));
  }
  if (wantRetry && retry) checks.push(interpretInboxRetry(retry));

  checks.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return NextResponse.json({
    ...summarize(checks),
    checks,
    context: { webhookUrlExpected: expected, environment: process.env.VERCEL_ENV ?? "local", commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null, checkedAt: new Date().toISOString() },
  });
}
