"use client";

import React from "react";
import { C } from "../ui/constants";
import { useToast } from "../ui/Toast";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function PushToggle() {
  const toast = useToast();
  const [supported, setSupported] = React.useState(true);
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [denied, setDenied] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    setDenied(Notification.permission === "denied");
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  async function handleEnable() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      toast.error("Notifications non configurées", "Clé VAPID manquante côté serveur — contacte l'administrateur du site.");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDenied(permission === "denied");
        toast.error("Permission refusée", "Autorise les notifications dans les réglages de ton navigateur pour les activer.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Échec de l'enregistrement.");
      setSubscribed(true);
      toast.success("Notifications activées ✓", "Tu seras prévenu des échecs de publication, publications réussies, déconnexions de compte et paliers d'abonnés.");
    } catch (e) {
      toast.error("Échec de l'activation", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notifications désactivées");
    } catch (e) {
      toast.error("Échec de la désactivation", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <button
      onClick={subscribed ? handleDisable : handleEnable}
      disabled={busy || denied}
      title={denied ? "Notifications bloquées dans les réglages du navigateur — autorise-les puis recharge la page." : undefined}
      className="w-full py-2.5 rounded-xl text-sm font-medium transition-all"
      style={{
        background: subscribed ? C.greenBg : C.card,
        color: subscribed ? C.greenLight : C.textSecondary,
        border: `1px solid ${subscribed ? C.green + "40" : C.border}`,
        opacity: busy || denied ? 0.6 : 1,
      }}
    >
      {busy ? "…" : denied ? "🔕 Notifications bloquées" : subscribed ? "🔔 Notifications activées" : "🔔 Activer les notifications"}
    </button>
  );
}
