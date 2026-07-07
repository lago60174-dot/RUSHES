// ── Définition des plans ─────────────────────────────────────

export const PLAN_FREE = "free" as const;
export const PLAN_PRO = "pro" as const;
export const PLAN_BUSINESS = "business" as const;
export type Plan = typeof PLAN_FREE | typeof PLAN_PRO | typeof PLAN_BUSINESS;

// Plans payants (déblocables via demande d'abonnement) — utilisé partout où
// on doit savoir si un utilisateur a un accès "illimité" quel que soit
// le palier payant exact (Pro ou Business).
export const PAID_PLANS: Plan[] = [PLAN_PRO, PLAN_BUSINESS];

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
      team_seats: 1,
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
      team_seats: 1,
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
  business: {
    id: PLAN_BUSINESS,
    name: "Business",
    price_monthly: 15000,
    price_annual: 150000,
    annual_saving: 30000, // 15000 * 12 - 150000
    limits: {
      publications_per_month: Infinity,
      social_accounts: Infinity,
      ai_analysis: true,
      watermark: false,
      team_seats: 5,
    },
    features: [
      "Tout ce qui est inclus dans Pro",
      "Jusqu'à 5 membres d'équipe",
      "Comptes sociaux illimités par membre",
      "Support prioritaire dédié",
      "Accès API et export de données",
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

/** Un plan payant (Pro ou Business), par opposition à Freemium */
export function isPaidPlan(plan: Plan | null | undefined): boolean {
  return !!plan && (PAID_PLANS as string[]).includes(plan);
}

/** Montant en FCFA selon période et plan (Pro par défaut, pour compatibilité) */
export function getPlanAmount(period: BillingPeriod, plan: typeof PLAN_PRO | typeof PLAN_BUSINESS = PLAN_PRO): number {
  const p = PLANS[plan];
  return period === BILLING_ANNUAL ? p.price_annual : p.price_monthly;
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
  mtn: { number: "+237 652 954 134", label: "MTN Mobile Money", name: "MIDRENE" },
  orange: { number: "+237 656 106 225", label: "Orange Money", name: "NDJANAN VITAL AKANGE" },
} as const;
