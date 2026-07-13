"use client";

import { useEffect } from "react";

export function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // ✅ Corrigé : enregistrement immédiat au lieu d'attendre l'évènement
    // "load" de la page. `register()` est déjà asynchrone et non-bloquant
    // pour le rendu — attendre "load" n'apportait donc aucun gain de
    // performance, mais retardait réellement le moment où Chrome considère
    // le service worker comme actif. Or Chrome exige un service worker actif
    // pour déclencher `beforeinstallprompt` (le bouton "Installer") : avec
    // l'ancien code, sur une visite fraîche ou une connexion lente, Chrome
    // pouvait terminer son évaluation d'installabilité AVANT que le service
    // worker n'ait fini de s'installer/activer — d'où l'installation qui
    // marchait "parfois" et pas d'autres, selon la vitesse de connexion et
    // si le SW était déjà actif depuis une visite précédente.
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[PWA] Échec d'enregistrement du service worker:", err);
    });
  }, []);

  return null;
}
