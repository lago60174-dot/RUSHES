// RUSHES est une app personnelle : un seul utilisateur autorisé, identifié par
// son email (variable OWNER_EMAIL). Toute autre session est refusée.
export function getOwnerEmail(): string | null {
  const e = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return e || null;
}

export function isOwner(email: string | null | undefined): boolean {
  const owner = getOwnerEmail();
  if (!owner || !email) return false; // fail closed : sans OWNER_EMAIL, personne n'entre
  return email.trim().toLowerCase() === owner;
}
