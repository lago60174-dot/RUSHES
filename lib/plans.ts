// ── Définition des plans ─────────────────────────────────────

export const PLAN_FREE = "free" as const;
export const PLAN_PRO = "pro" as const;
export type Plan = typeof PLAN_FREE | typeof PLAN_PRO;

export const BILLING_MONTHLY = "monthly" as const;
export const BILLING_ANNUAL = "annual" as const;
export type BillingPeriod = typeof BILLING_MONTHLY | typeof BILLING_ANNUAL;

export const PLANS = {
  free: {
    id: PLAN_FREE,
    name: "Freemium",
    price: 0,
    limits: {
      publications_per_month: 5,
      social_accounts: 1,
      ai_analysis: false,
      watermark: true,
    },
    features: [
      "5 publications / mois",
      "1 réseau social connecté",
      "Planification basique",
      "Filigrane RUSHES sur les publications",
    ],
    missing: [
      "Analyse IA",
      "Multi-réseaux simultanés",
      "Publications illimitées",
    ],
  },
  pro: {
    id: PLAN_PRO,
    name: "Pro",
    price_monthly: 5000,
    price_annual: 50000,
    annual_saving: 10000, // 5000 * 12 - 50000
    limits: {
      publications_per_month: Infinity,
      social_accounts: Infinity,
      ai_analysis: true,
      watermark: false,
    },
    features: [
      "Publications illimitées",
      "Tous les réseaux sociaux",
      "Analyse IA de tes performances",
      "Planification avancée",
      "Aucun filigrane",
      "Support prioritaire",
    ],
  },
} as const;

// ── Types abonnement ─────────────────────────────────────────

export interface Subscription {
  id: string;
  userId: string;
  plan: Plan;
  billingPeriod: BillingPeriod | null;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
}

export interface PaymentRequest {
  id: string;
  userId: string;
  plan: Plan;
  billingPeriod: BillingPeriod;
  amount: number;
  method: "mtn" | "orange";
  reference: string | null;
  proofUrl: string | null;
  status: "pending" | "approved" | "rejected";
  adminNotes: string | null;
  createdAt: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Montant en FCFA selon période */
export function getPlanAmount(period: BillingPeriod): number {
  return period === BILLING_ANNUAL
    ? PLANS.pro.price_annual
    : PLANS.pro.price_monthly;
}

/** Calcule la date de fin d'abonnement à partir d'aujourd'hui */
export function computeEndsAt(period: BillingPeriod, from?: Date): Date {
  const base = from ?? new Date();
  if (period === BILLING_ANNUAL) {
    return new Date(base.getFullYear() + 1, base.getMonth(), base.getDate());
  }
  return new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
}

/** Vérifie si un plan est actif (non expiré) */
export function isPlanActive(sub: Subscription | null): boolean {
  if (!sub || sub.plan === PLAN_FREE) return false;
  if (!sub.endsAt) return true; // pas d'expiration
  return new Date(sub.endsAt) > new Date();
}

/** Formate un montant en FCFA */
export function formatFCFA(amount: number): string {
  return new Intl.NumberFormat("fr-FR").format(amount) + " FCFA";
}

/** Numéros de paiement */
export const PAYMENT_NUMBERS = {
  mtn: { number: "6XX XXX XXX", label: "MTN Mobile Money" },
  orange: { number: "6XX XXX XXX", label: "Orange Money" },
} as const;
// ⚠️ Remplace les numéros ci-dessus par les tiens avant de déployer
