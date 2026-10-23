// Appel LLM minimal et sans SDK. Priorité à Claude (ANTHROPIC_API_KEY), repli
// sur Mistral (MISTRAL_API_KEY, déjà utilisé par /api/analyse).
export function isLlmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.MISTRAL_API_KEY);
}

// Fournisseur utilisé par l'agent Telegram ET par llmComplete : une seule
// règle pour les deux. Par défaut Claude si ANTHROPIC_API_KEY existe, sinon
// Mistral ; AGENT_PROVIDER=mistral|anthropic permet de forcer le choix quand
// les deux clés sont présentes.
// Modèle Mistral unique pour tout le projet (agent, inbox, analyse IA).
// Par défaut « small » : disponible sur les forfaits gratuits ET compatible
// outils + images. Pour un modèle plus puissant (forfait payant) :
// MISTRAL_MODEL=mistral-large-latest. AGENT_MISTRAL_MODEL reste accepté.
export const MISTRAL_DEFAULT_MODEL = "mistral-small-latest";
export function mistralModel(env: Record<string, string | undefined> = process.env): string {
  return env.MISTRAL_MODEL?.trim() || env.AGENT_MISTRAL_MODEL?.trim() || MISTRAL_DEFAULT_MODEL;
}
export const isMistralTierError = (status: number, body: string) =>
  status === 403 && /tier_not_allowed|subscription tier/i.test(body);

// ── Cadence des appels Mistral ─────────────────────────────────────────
// Le forfait gratuit autorise ~1 requête/seconde PAR MODÈLE. Or l'agent
// enchaîne plusieurs appels (outil → réponse) : sans précaution, le 2e est
// refusé en 429. On espace donc les appels (MISTRAL_MIN_GAP_MS, défaut 1100 ms ;
// mets 0 sur un forfait payant) ET on réessaie quand même sur un 429.
export const mistralPacing = { minGapMs: -1, retries: 3, retryBaseMs: 1200 };
const gapMs = () => {
  if (mistralPacing.minGapMs >= 0) return mistralPacing.minGapMs;
  const v = Number(process.env.MISTRAL_MIN_GAP_MS);
  return Number.isFinite(v) && process.env.MISTRAL_MIN_GAP_MS?.trim() ? Math.max(0, v) : 1100;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let nextSlot = 0;
async function waitForSlot() {
  // Réservation atomique d'un créneau : des appels simultanés se font la queue.
  const slot = Math.max(Date.now(), nextSlot);
  nextSlot = slot + gapMs();
  const wait = slot - Date.now();
  if (wait > 0) await sleep(wait);
}

// POST /chat/completions avec cadence + nouvelle tentative sur 429. Si le
// modèle demandé n'est pas inclus dans le forfait (403 tier_not_allowed), on
// retente UNE fois avec le modèle par défaut (désactivable : opts.fallback=false).
export async function mistralPost(
  payload: Record<string, unknown>,
  model = mistralModel(),
  opts: { fallback?: boolean } = {},
): Promise<Response> {
  const send = async (m: string): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      await waitForSlot();
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
        body: JSON.stringify({ ...payload, model: m }),
      });
      if (res.status !== 429 || attempt >= mistralPacing.retries) return res;
      const retryAfter = Number(res.headers?.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : mistralPacing.retryBaseMs * (attempt + 1));
    }
  };

  const res = await send(model);
  if (opts.fallback !== false && res.status === 403 && model !== MISTRAL_DEFAULT_MODEL) {
    const body = await res.clone().text().catch(() => "");
    if (isMistralTierError(res.status, body)) {
      console.warn(`[mistral] ${model} absent du forfait, repli sur ${MISTRAL_DEFAULT_MODEL}`);
      return send(MISTRAL_DEFAULT_MODEL);
    }
  }
  return res;
}

// Message lisible pour l'utilisateur (Telegram) à partir d'une erreur LLM brute.
export function friendlyLlmError(message: string): string | null {
  if (/\b429\b|rate.?limit/i.test(message)) return "Mistral limite le nombre de requêtes (forfait gratuit : environ 1 par seconde). J'ai déjà réessayé plusieurs fois : attends une dizaine de secondes puis renvoie ton message.";
  if (/tier_not_allowed|subscription tier/i.test(message)) return "Ton forfait Mistral n'autorise pas ce modèle. Mets MISTRAL_MODEL=mistral-small-latest sur Vercel puis redéploie.";
  if (/(Mistral|Anthropic)( error)? 40[13]\b/.test(message)) return "La clé IA est refusée. Vérifie MISTRAL_API_KEY sur Vercel (clé valide, sans espace) puis redéploie.";
  if (/(Mistral|Anthropic)( error)? 5\d\d\b/.test(message)) return "Le service IA a un souci de son côté. Réessaie dans un instant.";
  return null;
}

export type AgentProvider = "anthropic" | "mistral";
export function agentProvider(env: Record<string, string | undefined> = process.env): AgentProvider | null {
  const forced = env.AGENT_PROVIDER?.trim().toLowerCase();
  if (forced === "mistral" && env.MISTRAL_API_KEY) return "mistral";
  if (forced === "anthropic" && env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.MISTRAL_API_KEY) return "mistral";
  return null;
}

export async function llmComplete(params: { system: string; user: string; maxTokens?: number }): Promise<string> {
  const maxTokens = params.maxTokens ?? 500;

  if (agentProvider() === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.AGENT_MODEL || "claude-haiku-5-5",
        max_tokens: maxTokens,
        system: params.system,
        messages: [{ role: "user", content: params.user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }

  if (agentProvider() === "mistral") {
    const res = await mistralPost({
      max_tokens: maxTokens,
      messages: [{ role: "system", content: params.system }, { role: "user", content: params.user }],
    });
    if (!res.ok) throw new Error(`Mistral error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  throw new Error("Aucune clé LLM configurée (ANTHROPIC_API_KEY ou MISTRAL_API_KEY).");
}

// Extrait le premier objet JSON d'une réponse (tolère les ```json … ```).
export function parseJsonObject<T>(raw: string): T | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)) as T; } catch { return null; }
}
