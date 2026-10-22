import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { PWARegister } from "@/components/pwa/PWARegister";
import { InstallBanner } from "@/components/pwa/InstallBanner";

export const metadata: Metadata = {
  title: "FLARE Studio",
  description: "Planifie, publie et analyse tes contenus sociaux depuis un studio unique.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default", // fond clair : texte sombre dans la barre d'état iOS
    title: "FLARE Studio",
  },
};

export const viewport: Viewport = {
  themeColor: "#EA580C",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* Capture beforeinstallprompt le plus tôt possible (avant même
            l'hydratation React) pour ne jamais rater l'évènement si Chrome
            le déclenche très vite après le chargement — le composant
            InstallBanner (monté plus tard) va simplement relire
            window.__deferredInstallPrompt au lieu de dépendre uniquement
            de son propre addEventListener, qui pourrait s'attacher trop tard. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__deferredInstallPrompt = null;
              window.addEventListener("beforeinstallprompt", function (e) {
                e.preventDefault();
                window.__deferredInstallPrompt = e;
                window.dispatchEvent(new Event("flare:bip-ready"));
              });
            `,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, background: "#F8F6F2" }}>
        <PWARegister />
        <InstallBanner />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
