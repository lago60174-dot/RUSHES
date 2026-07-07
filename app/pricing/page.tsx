import Link from "next/link";
import { PLANS, formatFCFA } from "@/lib/plans";

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#0f1117] text-white px-4 py-16">
      <div className="max-w-6xl mx-auto">
        {/* En-tête */}
        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold mb-3">Tarifs simples et transparents</h1>
          <p className="text-gray-400 text-lg">
            Commence gratuitement, passe Pro ou Business quand tu es prêt.
          </p>
        </div>

        {/* Cartes plans */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Plan Freemium */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col">
            <div className="mb-6">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                {PLANS.free.name}
              </span>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-5xl font-bold">0</span>
                <span className="text-gray-400 mb-2">FCFA</span>
              </div>
              <p className="text-gray-400 text-sm mt-2">Pour commencer à publier.</p>
            </div>

            <ul className="flex-1 space-y-3 mb-8">
              {PLANS.free.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                  <span className="text-green-400">✓</span> {f}
                </li>
              ))}
              {PLANS.free.missing.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-500 line-through">
                  <span>✗</span> {f}
                </li>
              ))}
            </ul>

            <Link
              href="/login"
              className="text-center py-3 rounded-xl border border-white/20 text-sm font-semibold hover:bg-white/10 transition"
            >
              Commencer gratuitement
            </Link>
          </div>

          {/* Plan Pro */}
          <div className="rounded-2xl border border-violet-500/60 bg-violet-600/10 p-8 flex flex-col relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-violet-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              POPULAIRE
            </div>

            <div className="mb-6">
              <span className="text-xs font-semibold uppercase tracking-widest text-violet-400">
                {PLANS.pro.name}
              </span>
              <div className="mt-3">
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-bold">
                    {new Intl.NumberFormat("fr-FR").format(PLANS.pro.price_monthly)}
                  </span>
                  <span className="text-gray-400 mb-2">FCFA / mois</span>
                </div>
                <p className="text-sm text-violet-300 mt-1">
                  ou {formatFCFA(PLANS.pro.price_annual)} / an{" "}
                  <span className="bg-violet-600/30 text-violet-300 text-xs px-2 py-0.5 rounded-full ml-1">
                    économise {formatFCFA(PLANS.pro.annual_saving)}
                  </span>
                </p>
              </div>
              <p className="text-gray-400 text-sm mt-2">Pour scaler ta présence sur les réseaux.</p>
            </div>

            <ul className="flex-1 space-y-3 mb-8">
              {PLANS.pro.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-200">
                  <span className="text-violet-400">✓</span> {f}
                </li>
              ))}
            </ul>

            <Link
              href="/subscribe?plan=pro"
              className="text-center py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition"
            >
              Passer au Pro
            </Link>
          </div>

          {/* Plan Business */}
          <div className="rounded-2xl border border-cyan-500/60 bg-cyan-600/10 p-8 flex flex-col relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-cyan-500 text-white text-xs font-bold px-3 py-1 rounded-full">
              ÉQUIPES
            </div>

            <div className="mb-6">
              <span className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
                {PLANS.business.name}
              </span>
              <div className="mt-3">
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-bold">
                    {new Intl.NumberFormat("fr-FR").format(PLANS.business.price_monthly)}
                  </span>
                  <span className="text-gray-400 mb-2">FCFA / mois</span>
                </div>
                <p className="text-sm text-cyan-300 mt-1">
                  ou {formatFCFA(PLANS.business.price_annual)} / an{" "}
                  <span className="bg-cyan-500/30 text-cyan-300 text-xs px-2 py-0.5 rounded-full ml-1">
                    économise {formatFCFA(PLANS.business.annual_saving)}
                  </span>
                </p>
              </div>
              <p className="text-gray-400 text-sm mt-2">Pour les équipes qui gèrent plusieurs comptes.</p>
            </div>

            <ul className="flex-1 space-y-3 mb-8">
              {PLANS.business.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-200">
                  <span className="text-cyan-400">✓</span> {f}
                </li>
              ))}
            </ul>

            <Link
              href="/subscribe?plan=business"
              className="text-center py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition"
            >
              Passer au Business
            </Link>
          </div>
        </div>

        {/* FAQ paiement */}
        <div className="mt-16 text-center">
          <h2 className="text-xl font-semibold mb-6 text-gray-300">Comment ça marche ?</h2>
          <div className="grid md:grid-cols-3 gap-4 text-left">
            {[
              {
                step: "1",
                title: "Choisis ton plan",
                desc: "Mensuel ou annuel, paye via MTN Mobile Money ou Orange Money.",
              },
              {
                step: "2",
                title: "Envoie la preuve",
                desc: "Entre ta référence de transaction ou uploade un screenshot du paiement.",
              },
              {
                step: "3",
                title: "Activation rapide",
                desc: "Ton compte est activé manuellement sous 24h après vérification.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-xl border border-white/10 bg-white/5 p-5"
              >
                <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-sm font-bold mb-3">
                  {item.step}
                </div>
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
