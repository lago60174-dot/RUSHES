"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PLANS, PAYMENT_NUMBERS, formatFCFA, getPlanAmount, PLAN_BUSINESS, PLAN_PRO } from "@/lib/plans";

type Period = "monthly" | "annual";
type Method = "mtn" | "orange";
type InputMode = "reference" | "screenshot";
type PlanId = typeof PLAN_PRO | typeof PLAN_BUSINESS;

function SubscribeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan: PlanId = searchParams.get("plan") === PLAN_BUSINESS ? PLAN_BUSINESS : PLAN_PRO;
  const planDef = PLANS[plan];

  const [period, setPeriod] = useState<Period>("monthly");
  const [method, setMethod] = useState<Method>("mtn");
  const [inputMode, setInputMode] = useState<InputMode>("reference");
  const [reference, setReference] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = getPlanAmount(period, plan);
  const paymentInfo = PAYMENT_NUMBERS[method];

  async function uploadProof(file: File): Promise<string> {
    const signRes = await fetch("/api/subscription/proof-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name }),
    });
    const signData = await signRes.json();
    if (!signRes.ok) throw new Error(signData.error);

    const { createClient: cc } = await import("@supabase/supabase-js");
    const sb = cc(signData.url, signData.key);

    const buf = await file.arrayBuffer();
    const { error: upErr } = await sb.storage
      .from("payment-proofs")
      .uploadToSignedUrl(signData.path, signData.token, buf, {
        contentType: file.type || "image/jpeg",
      });
    if (upErr) throw new Error(upErr.message);

    // URL signée de lecture (7 jours — assez pour que l'admin valide)
    const readRes = await fetch("/api/subscription/proof-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: signData.path }),
    });
    const readData = await readRes.json();
    if (!readRes.ok) throw new Error(readData.error);
    return readData.signedUrl;
  }

  async function handleSubmit() {
    setError(null);
    if (inputMode === "reference" && !reference.trim()) {
      setError("Entre ta référence de transaction.");
      return;
    }
    if (inputMode === "screenshot" && !proofFile) {
      setError("Sélectionne un screenshot de preuve.");
      return;
    }

    try {
      setSubmitting(true);
      let proofUrl: string | null = null;

      if (inputMode === "screenshot" && proofFile) {
        setUploading(true);
        proofUrl = await uploadProof(proofFile);
        setUploading(false);
      }

      const res = await fetch("/api/subscription/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          billingPeriod: period,
          method,
          reference: inputMode === "reference" ? reference.trim() : null,
          proofUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  }

  if (success) {
    return (
      <main className="min-h-screen bg-[#0f1117] text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">✅</div>
          <h1 className="text-2xl font-bold mb-3">Demande envoyée !</h1>
          <p className="text-gray-400 mb-6">
            Ta demande d'abonnement {planDef.name} a bien été reçue. Elle sera traitée sous 24h.
            Tu recevras une confirmation une fois ton compte activé.
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl font-semibold transition"
          >
            Retour à l'accueil
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1117] text-white px-4 py-16">
      <div className="max-w-lg mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Passer au {planDef.name}</h1>
          <p className="text-gray-400">Paiement via Mobile Money — activation sous 24h.</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
          {/* Choix du plan */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              Plan choisi
            </label>
            <div className="grid grid-cols-2 gap-3">
              {([PLAN_PRO, PLAN_BUSINESS] as PlanId[]).map((p) => (
                <button
                  key={p}
                  onClick={() => router.replace(`/subscribe?plan=${p}`)}
                  className={`py-3 px-4 rounded-xl border text-sm font-semibold transition text-left ${
                    plan === p
                      ? p === PLAN_BUSINESS
                        ? "border-cyan-500 bg-cyan-600/20 text-white"
                        : "border-violet-500 bg-violet-600/20 text-white"
                      : "border-white/10 text-gray-400 hover:border-white/30"
                  }`}
                >
                  <div>{PLANS[p].name}</div>
                  <div className={p === PLAN_BUSINESS ? "text-cyan-300" : "text-violet-300"}>
                    {formatFCFA(PLANS[p].price_monthly)}/mois
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Période */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              Période de facturation
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(["monthly", "annual"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`py-3 px-4 rounded-xl border text-sm font-semibold transition text-left ${
                    period === p
                      ? "border-violet-500 bg-violet-600/20 text-white"
                      : "border-white/10 text-gray-400 hover:border-white/30"
                  }`}
                >
                  {p === "monthly" ? (
                    <>
                      <div>Mensuel</div>
                      <div className="text-violet-300 font-bold">
                        {formatFCFA(planDef.price_monthly)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>Annuel</div>
                      <div className="text-violet-300 font-bold">
                        {formatFCFA(planDef.price_annual)}
                      </div>
                      <div className="text-xs text-green-400">
                        Économise {formatFCFA(planDef.annual_saving)}
                      </div>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Méthode de paiement */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              Méthode de paiement
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(["mtn", "orange"] as Method[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`py-3 px-4 rounded-xl border text-sm font-semibold transition ${
                    method === m
                      ? "border-yellow-400 bg-yellow-400/10 text-white"
                      : "border-white/10 text-gray-400 hover:border-white/30"
                  }`}
                >
                  {PAYMENT_NUMBERS[m].label}
                </button>
              ))}
            </div>
          </div>

          {/* Instructions de paiement */}
          <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4">
            <p className="text-sm text-yellow-300 font-semibold mb-1">
              Envoie {formatFCFA(amount)} au numéro suivant :
            </p>
            <p className="text-2xl font-bold text-white tracking-widest">
              {paymentInfo.number}
            </p>
            <p className="text-xs text-gray-400 mt-1">{paymentInfo.label}</p>
          </div>

          {/* Mode de confirmation */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              Confirme ton paiement
            </label>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setInputMode("reference")}
                className={`flex-1 py-2 rounded-lg border text-sm transition ${
                  inputMode === "reference"
                    ? "border-violet-500 bg-violet-600/20 text-white"
                    : "border-white/10 text-gray-400"
                }`}
              >
                Référence transaction
              </button>
              <button
                onClick={() => setInputMode("screenshot")}
                className={`flex-1 py-2 rounded-lg border text-sm transition ${
                  inputMode === "screenshot"
                    ? "border-violet-500 bg-violet-600/20 text-white"
                    : "border-white/10 text-gray-400"
                }`}
              >
                Screenshot
              </button>
            </div>

            {inputMode === "reference" ? (
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ex: TXN1234567890"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500"
              />
            ) : (
              <label className="block w-full">
                <div className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                  proofFile ? "border-green-400/40 bg-green-400/5" : "border-white/10 hover:border-white/30"
                }`}>
                  {proofFile ? (
                    <p className="text-sm text-green-300">{proofFile.name}</p>
                  ) : (
                    <p className="text-sm text-gray-400">
                      Clique pour sélectionner un screenshot (JPG, PNG)
                    </p>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                />
              </label>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold transition"
          >
            {uploading
              ? "Upload en cours..."
              : submitting
              ? "Envoi en cours..."
              : "Envoyer ma demande"}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Activation manuelle sous 24h après vérification de ton paiement.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeForm />
    </Suspense>
  );
}
