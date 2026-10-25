import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isOwner } from "@/lib/owner";
import { agentProvider, mistralListModels, mistralModel, probeMistralModel, type MistralModelInfo } from "@/lib/llm";
import { classifyProbe, pickCandidateModels, summarizeScan, type ScanResult } from "@/lib/telegram-diagnose";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// GET /api/telegram/diagnose/models
// Teste, un par un (requête d'1 jeton chacun), les modèles Mistral compatibles
// « outils » pour trouver lesquels répondent avec ta clé et ton forfait.
export async function GET() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isOwner(user.email)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (agentProvider() !== "mistral") {
    return NextResponse.json({ error: "Mistral n'est pas le fournisseur actif (MISTRAL_API_KEY absente, ou ANTHROPIC_API_KEY prioritaire)." }, { status: 400 });
  }

  const current = mistralModel();
  let list: MistralModelInfo[] | null = null;
  let listError: string | null = null;
  try { list = await mistralListModels(); } catch (e) { listError = (e as Error).message; }

  const candidates = pickCandidateModels(list, current);
  const results: ScanResult[] = [];
  for (const model of candidates) {
    // 0 nouvelle tentative : on veut l'état brut de chaque modèle, vite.
    results.push(classifyProbe(model, await probeMistralModel(model, { retries: 0 })));
  }

  return NextResponse.json({
    current,
    listError,
    results,
    ...summarizeScan(results, current),
  });
}
