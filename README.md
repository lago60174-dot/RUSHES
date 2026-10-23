# FLARE Studio — Guide de déploiement

Studio personnel de planification, publication et analyse de contenu social (TikTok, Instagram, YouTube Shorts, Facebook).  
Stack : Next.js 16 · Supabase · Vercel (déploiement gratuit)

---

## Prérequis

- Un compte [Supabase](https://supabase.com) (gratuit)
- Un compte [Vercel](https://vercel.com) (gratuit)
- Node.js 18+ installé localement
- Un compte [Anthropic](https://console.anthropic.com) pour la clé API (analyse IA)

---

## Étape 1 — Créer le projet Supabase

1. Connecte-toi sur [supabase.com](https://supabase.com) et crée un nouveau projet.
2. Dans le menu de gauche, va dans **SQL Editor**.
3. Copie-colle le contenu de `supabase/schema.sql` et clique **Run**.  
   Cela crée les tables `videos` et `ai_analyses` avec les règles de sécurité.
4. Dans **Settings > API**, note :
   - `Project URL` → c'est ton `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → c'est ton `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → c'est ton `SUPABASE_SERVICE_ROLE_KEY` (garde-le secret)

---

## Étape 2 — Configurer l'authentification Supabase

1. Dans Supabase, va dans **Authentication > Providers**.
2. Vérifie que **Email** est activé (il l'est par défaut).
3. Dans **Authentication > URL Configuration**, ajoute :
   - Site URL : `https://ton-projet.vercel.app` (tu la connaîtras après le déploiement Vercel)
   - Redirect URLs : `https://ton-projet.vercel.app/auth/callback`
4. Pour tester en local, ajoute aussi : `http://localhost:3000/auth/callback`

---

## Étape 3 — Configurer les variables d'environnement

Copie `.env.example` en `.env.local` et remplis les valeurs :

```bash
cp .env.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://XXXXXXXXXXXX.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Étape 4 — Lancer en local

```bash
npm install
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).  
Entrez ton email → reçois le lien magique → connecte-toi.

---

## Étape 5 — Déployer sur Vercel

```bash
npm install -g vercel
vercel
```

Suis les instructions, puis ajoute les variables d'environnement dans le tableau de bord Vercel :  
**Project Settings > Environment Variables**

Ajoute les mêmes 5 variables, mais avec `NEXT_PUBLIC_SITE_URL` égal à ton URL Vercel finale (ex: `https://rushes-xyz.vercel.app`).

Ensuite retourne dans Supabase **Authentication > URL Configuration** et mets à jour avec ton URL Vercel définitive.

---

## Structure du projet

```
rushes/
├── app/
│   ├── api/
│   │   ├── videos/          # GET liste, POST création
│   │   │   └── [id]/        # PATCH mise à jour, DELETE suppression
│   │   └── analyse/         # POST génération IA, GET cache
│   ├── auth/callback/       # Callback magic link
│   ├── login/               # Page de connexion
│   └── page.tsx             # Dashboard principal
├── components/
│   └── Dashboard.tsx        # Composant principal (toutes les vues)
├── lib/
│   └── supabase.ts          # Clients Supabase (browser + server)
├── supabase/
│   └── schema.sql           # Schéma à exécuter une fois dans Supabase
├── middleware.ts             # Protection des routes (auth)
└── .env.example             # Template des variables d'environnement
```

---

## Données et vie privée

- Toutes les données sont dans **ton propre projet Supabase** (pas de serveur partagé).
- Les Row Level Security policies garantissent que seul ton compte peut lire/écrire tes vidéos.
- La clé API Anthropic est utilisée **côté serveur uniquement** (jamais exposée au navigateur).

---

## Phase 5 — Sync automatique des stats (GitHub Actions)

La route `app/api/cron/sync-stats` resynchronise les stats Zernio de toutes les
vidéos publiées sans action manuelle. Elle est déclenchée par un workflow
GitHub Actions (`.github/workflows/sync-stats.yml`), toutes les 6h.

### Étape A — Variable d'environnement sur Vercel
Ajoute `CRON_SECRET` dans **Project Settings > Environment Variables** : une
chaîne aléatoire de ton choix, par exemple générée avec :
```bash
openssl rand -hex 32
```

### Étape B — Secrets GitHub
Dans ton repo GitHub, va dans **Settings > Secrets and variables > Actions**
et ajoute :
- `FLARE_APP_URL` = l'URL de ton app déployée (ex: `https://rushes-xyz.vercel.app`)
- `CRON_SECRET` = la même valeur que sur Vercel

Le workflow s'exécute automatiquement toutes les 6h, et tu peux aussi le
lancer manuellement depuis l'onglet **Actions** du repo (bouton "Run workflow").

---

## Phase 11 — Stockage Cloudflare R2

Les vidéos uploadées depuis l'app vont maintenant sur Cloudflare R2 (si les variables `R2_*` sont renseignées). Sans ces variables, l'app continue d'utiliser le presign Zernio : rien ne casse pendant la migration.

1. **Cloudflare > R2 > Create bucket** (ex: `rushes-media`).
2. **Rendre le bucket lisible publiquement** : *Settings > Public access* — soit un *Custom domain* (recommandé), soit l'URL `r2.dev`. Zernio doit pouvoir télécharger la vidéo via cette URL pour publier.
3. **CORS** : *Settings > CORS policy* → colle le contenu de `cloudflare-r2-cors.json` (remplace l'URL Vercel par la tienne). Sans ça, l'upload depuis le navigateur échoue.
4. **API token** : *R2 > Manage API tokens > Create* avec le droit *Object Read & Write* sur ce bucket. Note `Access Key ID` et `Secret Access Key`. L'`Account ID` est affiché sur la page R2.
5. Ajoute dans Vercel (et `.env.local`) : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.
6. Exécute `supabase/phase11.sql` dans le SQL Editor (table `media_assets`).
7. `npm install` puis redéploie.

---

## Phase 12 — App privée (toi seul)

Trois verrous empilés, pour qu'il n'existe aucune porte d'entrée pour quelqu'un d'autre :

1. **Supabase** : *Authentication > Sign In / Providers > Email* → désactive **« Allow new users to sign up »**. Crée ton compte à la main dans *Authentication > Users > Add user* (coche *Auto Confirm*).
2. **Base** : remplace `ton@email.com` dans `supabase/phase12.sql` par ton email, puis exécute-le. Un trigger refuse alors toute création de compte autre que le tien, même en appelant l'API directement.
3. **App** : ajoute `OWNER_EMAIL=ton@email.com` dans Vercel. Le proxy coupe toute session dont l'email diffère. ⚠️ Sans cette variable, **personne** ne peut entrer (fail-closed) : ajoute-la avant de déployer. L'onglet « Inscription » a été retiré de la page de login.

## Plusieurs comptes par réseau (Zernio)

Zernio n'autorise **qu'un compte par plateforme et par profile** : reconnecter TikTok sur un profile qui a déjà un TikTok **remplace** ce TikTok. FLARE crée donc automatiquement un profile Zernio par compte supplémentaire (les profiles sont gratuits ; chaque compte connecté est facturé par Zernio selon ton plan).

- **+ Ajouter** : connecte un nouveau compte sans jamais écraser les existants.
- **Reconnecter** : renouvelle le token d'un compte précis, dans son propre profile.
- **Déconnecter** : supprime le compte côté Zernio ; si des publications planifiées le ciblent, une confirmation indique combien ne partiront pas.
- Ta clé API Zernio doit avoir accès à **tous** les profiles (pas de clé restreinte à un seul profile), sinon la création de profile échoue.
- Le modal de publication permet de cocher **plusieurs comptes d'une même plateforme** en une seule publication.

---

## Phase 13 — Données Zernio stockées en base

Exécute `supabase/phase13.sql` dans le SQL Editor. Quatre tables (lecture seule côté navigateur, écriture côté serveur) :

| Table | Contenu |
|---|---|
| `zernio_accounts` | Chaque compte connecté : plateforme, @, profil, abonnés, **santé** (token valide, expiration, `needs_reconnect`, problèmes), connecté/déconnecté |
| `account_snapshots` | Historique quotidien par compte : abonnés, abonnements, likes, vidéos, vues de page, abonnés gagnés/perdus |
| `post_targets` | Stats de chaque vidéo **par compte** (vues, impressions, portée, likes, commentaires, partages, enregistrements, clics, lien du post, miniature, réponse Zernio brute) |
| `post_target_history` | Évolution dans le temps de ces stats (une ligne seulement quand un chiffre change) |

**Quand ça se remplit** : le cron (toutes les 6h) ; le bouton **↻ Tout synchroniser** (modal « Réseaux sociaux ») ; et les webhooks `account.connected` / `account.disconnected`. Pense à **ajouter l'évènement `account.connected`** au webhook dans le dashboard Zernio.

- Les totaux affichés sur chaque vidéo restent dans `videos` ; ils sont maintenant la **somme des comptes réellement ciblés** (corrige l'écrasement quand 2 comptes d'une même plateforme publient la même vidéo).
- Zernio ne remonte pas les abonnés gagnés par post, ni le taux de complétion (sauf temps de visionnage moyen sur Instagram Reels) : ces champs restent à 0, ce n'est pas un bug.
- L'add-on **Analytics** de Zernio doit être actif, sinon les stats de posts renvoient une erreur 402.

---

## Phase 14 — Inbox : commentaires, DMs et agent de réponse

Exécute `supabase/phase14.sql`, puis dans le dashboard Zernio (*Settings → Webhooks*) **ajoute les évènements** `comment.received`, `message.received` et `message.sent` au webhook existant. Définis `ANTHROPIC_API_KEY` (ou `MISTRAL_API_KEY`) sur Vercel pour que l'agent puisse rédiger.

**Comment ça marche** : chaque commentaire/DM reçu est enregistré (`inbox_items`), puis l'agent le classe :
- **simple** (compliment, merci, emojis) → l'agent **répond seul** ;
- **sensible** (prix, collab, plainte, santé, légal…) → **brouillon à valider** (💬 Inbox, avec pastille + notification push) ;
- **spam** → ignoré.

**Garde-fous appliqués par le code, pas seulement par le LLM** : mots sensibles (prix, collab, argent, santé, légal, coordonnées…) forcent la validation même si le LLM dit « simple » ; une réponse contenant un lien, une @mention ou un numéro n'est jamais envoyée seule ; confiance < 0,8 → validation ; plafond de 20 réponses auto par heure (réglable) ; verrou anti double-envoi + clé d'idempotence ; l'agent ne répond jamais à ses propres réponses ni à ton propre compte ; le texte reçu est traité comme une donnée (anti prompt-injection). Les réglages (agent actif, réponse auto) sont dans le modal Inbox.

### Plateformes — ce qui est réellement supporté
- **Commentaires** : Instagram, Facebook, YouTube, Threads, LinkedIn, Bluesky, Reddit, **TikTok**.
- **DMs** : Instagram, Facebook, Telegram, WhatsApp, X, **TikTok**. Pas de DMs sur YouTube ni Threads.
- **TikTok** : depuis septembre 2026, Zernio passe par l'**API Business de TikTok**. Les commentaires et DMs ne marchent que pour les comptes connectés **après le 10 septembre** : **reconnecte** tes comptes TikTok plus anciens (bouton « Reconnecter »). Règles TikTok pour les DMs : compte Business hors EEE/UK/Suisse, on ne peut répondre qu'à quelqu'un qui a écrit en premier, 10 messages max dans les 48 h suivant son dernier message. (La page `docs.zernio.com/platforms/tiktok` est restée sur l'ancien « non supporté » : l'annonce de septembre fait foi.)
- Les **DMs n'arrivent que par webhook** ; pour les commentaires, le cron (6 h) relève en plus les 14 derniers jours si un webhook a été manqué.

---

## Phase 15 — Bot Telegram + agent

Tu écris au bot, il agit sur tout le projet : publier ou programmer des vidéos, légendes et hashtags, réponses aux commentaires et DMs, stats et recommandations, déconnexion d'un compte.

### Installation (une seule fois)
1. **Révoque le token si tu l'as partagé quelque part** : @BotFather → `/revoke` → ton bot → utilise le nouveau token.
2. Exécute `supabase/phase15.sql`.
3. Variables Vercel : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (long, aléatoire, lettres/chiffres/`_`/`-` uniquement), `NEXT_PUBLIC_SITE_URL` (ex. `https://ton-projet.vercel.app`), `ANTHROPIC_API_KEY`, `R2_BUCKET=mymedia` (+ les autres `R2_*`). **Pas** encore `TELEGRAM_OWNER_ID`. Redéploie.
4. Connecté à l'app dans ton navigateur, ouvre `https://ton-projet.vercel.app/api/telegram/setup` : il enregistre le webhook chez Telegram.
5. Écris n'importe quoi à ton bot : il répond avec **ton ID Telegram**. Ajoute-le dans `TELEGRAM_OWNER_ID`, redéploie. À partir de là, le bot ne répond **qu'à toi** ; tout autre utilisateur est ignoré en silence.

### Utilisation
- **Envoie une vidéo** au bot (une légende jointe vaut instruction), puis : « publie-la sur mon TikTok avec des hashtags voyage » → **publication immédiate**. « Programme-la demain à 18h sur Instagram et Facebook » → programmée (heure de `APP_TIMEZONE`, par défaut Africa/Douala).
- **Plusieurs comptes** : « publie sur mes deux TikTok » ; en cas d'ambiguïté l'agent pose une seule question.
- **Vidéo > 20 Mo** : Telegram interdit aux bots de la télécharger. Le bot te renvoie alors un lien d'envoi (valable 30 min) qui uploade directement vers R2 ; il te prévient dans le chat dès que c'est reçu. Le CORS du bucket doit autoriser l'origine de ton site (voir `cloudflare-r2-cors.json`).
- **Inbox** : chaque réponse à valider arrive dans le chat avec ✅ Envoyer / ↻ Autre / 🚫 Ignorer. **Réponds (reply) au message** avec ton texte pour envoyer ta propre version. `/inbox` ressort les éléments en attente.
- **Analyse** : « mes vidéos ont marché ? » → l'agent lit les chiffres stockés (vidéos, comptes, évolution) et recommande. Il n'analyse pas le contenu visuel de la vidéo, seulement ses performances, légende, hashtags et horaire.
- **Déconnecter un compte** : l'agent demande toujours une confirmation par bouton.
- Commandes : `/aide`, `/inbox`, `/sync`, `/id`.

### Sécurité
Secret de webhook comparé en temps constant ; verrou sur ton ID ; dédoublonnage des updates ; le token n'est lu que dans l'environnement et n'est jamais loggé ; lien d'upload signé (HMAC) et limité à 30 min ; le texte reçu des abonnés est traité comme une donnée par l'agent.

### Correctifs inclus
- Les publications **programmées depuis le web** étaient envoyées à Zernio sans fuseau, donc lues comme de l'UTC (une heure d'écart à Yaoundé). Elles utilisent maintenant `APP_TIMEZONE`.
- Le cron comparait l'heure programmée à l'heure du serveur (UTC) : les vidéos « jamais envoyées » partaient avec une heure de retard. Corrigé aussi.

---

## Installer FLARE Studio sur l'écran d'accueil (PWA)

**Android (Chrome)** : ouvre l'app → bannière « Installer FLARE Studio » → *Installer*. Sinon menu ⋮ → *Installer l'application*.
**iPhone/iPad (Safari uniquement)** : bouton *Partager* ⬆️ → *Sur l'écran d'accueil*.
**Ordinateur (Chrome/Edge)** : icône d'installation à droite de la barre d'adresse.

Conditions : l'app doit être servie en **HTTPS** (Vercel le fait). Si tu avais déjà installé l'ancienne version « RUSHES », **désinstalle-la puis réinstalle** : Android et iOS gardent l'ancienne icône tant que l'app n'est pas réinstallée.

Fichiers concernés : `app/manifest.ts`, `public/sw.js`, `public/offline.html`, `public/icon-*.png`, `public/apple-touch-icon.png`. Le `proxy.ts` laisse volontairement publics `manifest.webmanifest`, `sw.js` et `offline.html` (sinon le navigateur, qui les demande sans session, recevrait la page de connexion et l'app ne serait pas installable).

Pour changer l'icône : modifie `public/icon.svg`, puis régénère les 5 PNG (les versions « maskable » et iOS sont en plein cadre, sans coins ni transparence).

> Le workflow GitHub `sync-stats.yml` lit toujours le secret `RUSHES_APP_URL` : ne le renomme pas côté GitHub sans modifier le fichier.

---

## Discuter avec le bot, lui envoyer des vocaux, lui faire regarder tes vidéos

Le bot n'est plus qu'un exécutant de commandes : tu peux **simplement lui parler** (« comment tu vas ? », « j'ai la flemme aujourd'hui », « t'en penses quoi de mon idée ? ») et il répond comme à une vraie conversation. Il garde les 30 derniers échanges en mémoire.

- **Avis sur une vidéo** : « tu penses quoi de ma dernière vidéo ? ». Le bot en extrait jusqu'à 8 images réparties sur sa durée (outil `watch_video`) et juge l'accroche, le cadrage, le texte à l'écran, le rythme et l'appel à l'action, puis propose légende et hashtags. Il peut aussi regarder une vidéo déjà publiée (si son fichier est sur R2). **Il n'entend pas le son** : il ne commentera ni la musique ni la voix.
- **Photos** : envoie une miniature ou une capture, il la regarde et en discute.
- **Vocaux** : parle-lui, il transcrit (Mistral Voxtral, même clé `MISTRAL_API_KEY` que l'analyse ; repli OpenAI si `OPENAI_API_KEY` est définie) et **te montre ce qu'il a compris** (🎙️ « … ») avant d'agir. Un vocal envoyé *en réponse à une carte de validation* de l'inbox devient un **brouillon à confirmer**, jamais un envoi direct (une transcription peut être fausse et la réponse est publique). Limite : 10 minutes / 20 Mo.
- **Questions sur tes stats** : « comment vont mes vidéos ? » → il lit tes vrais chiffres et répond en langage naturel (2-3 constats + 1 conseil).

### À savoir côté technique
- **Aucune migration SQL** : rien à relancer dans Supabase pour cette fonctionnalité.
- L'extraction d'images utilise `ffmpeg-static` (binaire de 76 Mo, embarqué dans la fonction `/api/telegram/webhook` via `next.config.mjs`). Pourquoi on télécharge la vidéo au lieu de donner l'URL à ffmpeg : ce binaire **plante dès qu'il résout un nom de domaine**, donc Node télécharge (150 Mo max) dans `/tmp` et ffmpeg lit le fichier local, supprimé ensuite.
- **Repli** : si ffmpeg n'est pas disponible ou la vidéo est trop lourde, le bot se rabat sur la miniature (celle que Telegram fournit à la réception, rangée dans R2 en `<fichier>.thumb.jpg`, ou celle de Zernio pour une vidéo publiée) et **dit clairement qu'il ne juge que la couverture**.
- Sécurité : ffmpeg ne reçoit que des URL du domaine `R2_PUBLIC_URL` ; le texte des commentaires reste traité comme une donnée.
- Les erreurs (API en panne, vocal illisible…) sont maintenant **annoncées dans le chat** au lieu d'un silence.
- Le webhook dispose de 60 s ; un long téléchargement + analyse d'images + réponse peut s'en approcher.
