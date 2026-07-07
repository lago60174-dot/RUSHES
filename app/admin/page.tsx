"use client";
import { useState, useEffect, useCallback } from "react";
import { formatFCFA } from "@/lib/plans";

// ── Types ────────────────────────────────────────────────────
interface Stats {
  activeSubscribers: number;
  pendingRequests: number;
  totalRevenue: number;
  revenueThisMonth: number;
  monthlySubscribers: number;
  annualSubscribers: number;
  expiringSoon: number;
  totalUsers: number;
}

interface PaymentRequest {
  id: string;
  user_id: string;
  userEmail: string;
  plan: string;
  billing_period: string;
  amount: number;
  method: string;
  reference: string | null;
  proof_url: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

interface Subscription {
  id: string;
  user_id: string;
  userEmail: string;
  plan: string;
  billing_period: string | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

type Tab = "requests" | "subscribers" | "stats";

// ── Helpers UI ───────────────────────────────────────────────
const badge = (status: string) => {
  const map: Record<string, string> = {
    pending: "bg-yellow-400/20 text-yellow-300",
    approved: "bg-green-400/20 text-green-300",
    rejected: "bg-red-400/20 text-red-300",
    pro: "bg-violet-400/20 text-violet-300",
    business: "bg-cyan-400/20 text-cyan-300",
    free: "bg-gray-400/20 text-gray-400",
    monthly: "bg-blue-400/20 text-blue-300",
    annual: "bg-cyan-400/20 text-cyan-300",
  };
  return `text-xs px-2 py-0.5 rounded-full font-semibold ${map[status] || "bg-white/10 text-white"}`;
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

function isExpired(endsAt: string | null) {
  if (!endsAt) return false;
  return new Date(endsAt) < new Date();
}

// ── Composant principal ──────────────────────────────────────
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("requests");
  const [stats, setStats] = useState<Stats | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [reqFilter, setReqFilter] = useState("pending");
  const [subFilter, setSubFilter] = useState("active");
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [newSubUserId, setNewSubUserId] = useState("");
  const [newSubEndsAt, setNewSubEndsAt] = useState("");
  const [newSubPlan, setNewSubPlan] = useState<"pro" | "business">("pro");

  const fetchStats = useCallback(async () => {
    const r = await fetch("/api/admin/stats");
    if (r.ok) setStats(await r.json());
  }, []);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/payment-requests?status=${reqFilter}`);
    if (r.ok) setRequests(await r.json());
    setLoading(false);
  }, [reqFilter]);

  const fetchSubs = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/subscriptions?filter=${subFilter}`);
    if (r.ok) setSubs(await r.json());
    setLoading(false);
  }, [subFilter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (tab === "requests") fetchRequests(); }, [tab, fetchRequests]);
  useEffect(() => { if (tab === "subscribers") fetchSubs(); }, [tab, fetchSubs]);

  async function handleRequestAction(id: string, action: "approve" | "reject") {
    if (!confirm(`${action === "approve" ? "Approuver" : "Rejeter"} cette demande ?`)) return;
    setActionId(id);
    await fetch(`/api/admin/payment-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, adminNotes }),
    });
    setAdminNotes("");
    setActionId(null);
    fetchRequests();
    fetchStats();
  }

  async function handleRenew(id: string, billingPeriod: string | null) {
    if (!confirm("Renouveler cet abonnement ?")) return;
    await fetch(`/api/admin/subscriptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "renew", billingPeriod }),
    });
    fetchSubs();
    fetchStats();
  }

  async function handleDeleteSub(id: string) {
    if (!confirm("Supprimer cet abonnement ? L'utilisateur repassera en Freemium immédiatement.")) return;
    await fetch(`/api/admin/subscriptions/${id}`, { method: "DELETE" });
    fetchSubs();
    fetchStats();
  }

  async function handleCreateSub() {
    if (!newSubUserId.trim()) return alert("UUID utilisateur requis");
    await fetch("/api/admin/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: newSubUserId.trim(),
        plan: newSubPlan,
        billingPeriod: null,
        endsAt: newSubEndsAt || null,
      }),
    });
    setNewSubUserId("");
    setNewSubEndsAt("");
    fetchSubs();
    fetchStats();
  }

  return (
    <main className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold mb-8">Dashboard Admin — RUSHES</h1>

        {/* ── Stats cards ── */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Abonnés actifs", value: stats.activeSubscribers, color: "text-violet-400" },
              { label: "Demandes en attente", value: stats.pendingRequests, color: "text-yellow-400" },
              { label: "Revenu total", value: formatFCFA(stats.totalRevenue), color: "text-green-400" },
              { label: "Revenu (30 jours)", value: formatFCFA(stats.revenueThisMonth), color: "text-green-300" },
              { label: "Plans mensuels", value: stats.monthlySubscribers, color: "text-blue-400" },
              { label: "Plans annuels", value: stats.annualSubscribers, color: "text-cyan-400" },
              { label: "Expirent bientôt", value: stats.expiringSoon, color: "text-orange-400" },
              { label: "Total entrées", value: stats.totalUsers, color: "text-gray-400" },
            ].map((s) => (
              <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-2 mb-6 border-b border-white/10 pb-2">
          {([
            { key: "requests", label: `Demandes ${stats?.pendingRequests ? `(${stats.pendingRequests})` : ""}` },
            { key: "subscribers", label: "Abonnés" },
            { key: "stats", label: "Ajouter manuellement" },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                tab === t.key
                  ? "bg-violet-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab : Demandes ── */}
        {tab === "requests" && (
          <div>
            <div className="flex gap-2 mb-4">
              {["pending", "approved", "rejected", "all"].map((f) => (
                <button
                  key={f}
                  onClick={() => setReqFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition capitalize ${
                    reqFilter === f ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {f === "pending" ? "En attente" : f === "approved" ? "Approuvées" : f === "rejected" ? "Rejetées" : "Toutes"}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="text-gray-400 text-sm">Chargement...</p>
            ) : requests.length === 0 ? (
              <p className="text-gray-400 text-sm">Aucune demande.</p>
            ) : (
              <div className="space-y-4">
                {requests.map((r) => (
                  <div key={r.id} className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-sm">{r.userEmail}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtDate(r.created_at)}</p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <span className={badge(r.status)}>{r.status}</span>
                        <span className={badge(r.billing_period)}>{r.billing_period === "monthly" ? "Mensuel" : "Annuel"}</span>
                        <span className={badge(r.method)}>{r.method.toUpperCase()}</span>
                      </div>
                    </div>

                    <div className="mt-3 text-sm space-y-1">
                      <p className="text-gray-300">Montant : <span className="font-bold text-white">{formatFCFA(r.amount)}</span></p>
                      {r.reference && <p className="text-gray-300">Référence : <span className="font-mono text-white">{r.reference}</span></p>}
                      {r.proof_url && (
                        <a href={r.proof_url} target="_blank" rel="noopener noreferrer" className="text-violet-400 underline text-xs">
                          Voir le screenshot →
                        </a>
                      )}
                      {r.admin_notes && <p className="text-gray-400 text-xs">Note : {r.admin_notes}</p>}
                    </div>

                    {r.status === "pending" && (
                      <div className="mt-4 space-y-2">
                        <input
                          type="text"
                          placeholder="Note admin (optionnel)"
                          value={actionId === r.id ? adminNotes : ""}
                          onChange={(e) => { setActionId(r.id); setAdminNotes(e.target.value); }}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRequestAction(r.id, "approve")}
                            className="flex-1 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-semibold transition"
                          >
                            ✓ Approuver
                          </button>
                          <button
                            onClick={() => handleRequestAction(r.id, "reject")}
                            className="flex-1 py-2 bg-red-600/80 hover:bg-red-600 rounded-lg text-sm font-semibold transition"
                          >
                            ✗ Rejeter
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab : Abonnés ── */}
        {tab === "subscribers" && (
          <div>
            <div className="flex gap-2 mb-4">
              {["active", "expired", "all"].map((f) => (
                <button
                  key={f}
                  onClick={() => setSubFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    subFilter === f ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {f === "active" ? "Actifs" : f === "expired" ? "Expirés" : "Tous"}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="text-gray-400 text-sm">Chargement...</p>
            ) : subs.length === 0 ? (
              <p className="text-gray-400 text-sm">Aucun abonnement.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-white/10">
                      <th className="text-left py-2 pr-4">Utilisateur</th>
                      <th className="text-left py-2 pr-4">Plan</th>
                      <th className="text-left py-2 pr-4">Début</th>
                      <th className="text-left py-2 pr-4">Fin</th>
                      <th className="text-left py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-3 pr-4">
                          <p className="font-medium">{s.userEmail}</p>
                          <p className="text-xs text-gray-500 font-mono">{s.user_id.slice(0, 8)}...</p>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={badge(s.billing_period || "—")}>
                            {s.billing_period === "monthly" ? "Mensuel" : s.billing_period === "annual" ? "Annuel" : "Offert"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-gray-300">{fmtDate(s.starts_at)}</td>
                        <td className="py-3 pr-4">
                          <span className={isExpired(s.ends_at) ? "text-red-400" : "text-gray-300"}>
                            {s.ends_at ? fmtDate(s.ends_at) : "Illimité"}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRenew(s.id, s.billing_period)}
                              className="px-3 py-1 bg-violet-600/50 hover:bg-violet-600 rounded-lg text-xs transition"
                            >
                              Renouveler
                            </button>
                            <button
                              onClick={() => handleDeleteSub(s.id)}
                              className="px-3 py-1 bg-red-600/30 hover:bg-red-600/60 rounded-lg text-xs transition"
                            >
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Tab : Ajouter manuellement ── */}
        {tab === "stats" && (
          <div className="max-w-md">
            <h2 className="text-lg font-semibold mb-4">Donner un abonnement manuellement</h2>
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Plan</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["pro", "business"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setNewSubPlan(p)}
                      className={`py-2 rounded-lg text-sm font-semibold border transition capitalize ${
                        newSubPlan === p
                          ? "border-violet-500 bg-violet-600/20 text-white"
                          : "border-white/10 text-gray-400 hover:border-white/30"
                      }`}
                    >
                      {p === "business" ? "Business" : "Pro"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">UUID de l'utilisateur *</label>
                <input
                  type="text"
                  value={newSubUserId}
                  onChange={(e) => setNewSubUserId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
                />
                <p className="text-xs text-gray-500 mt-1">Visible dans Supabase → Authentication → Users</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Date de fin (vide = illimité)</label>
                <input
                  type="date"
                  value={newSubEndsAt}
                  onChange={(e) => setNewSubEndsAt(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                />
              </div>
              <button
                onClick={handleCreateSub}
                className="w-full py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-semibold transition"
              >
                Activer l'abonnement {newSubPlan === "business" ? "Business" : "Pro"}
              </button>
            </div>

            <div className="mt-8 bg-yellow-400/10 border border-yellow-400/20 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-yellow-300 mb-2">⚙️ Promouvoir un compte admin</h3>
              <p className="text-xs text-gray-400">
                Dans Supabase SQL Editor, exécute :
              </p>
              <pre className="mt-2 text-xs bg-black/30 rounded-lg p-3 overflow-x-auto text-green-300">
{`update auth.users
  set raw_user_meta_data =
    raw_user_meta_data || '{"role":"admin"}'
  where id = '<UUID>';`}
              </pre>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
