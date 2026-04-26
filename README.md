# GoMytho - Web App d'IA pour Créer des Mythos Viraux 🚀

GoMytho est une web app complète d'IA qui permet de modifier des photos selon un prompt utilisateur. C'est un MVP fonctionnel avec landing page, funnel de paiement, dashboard, et génération réelle d'images via l'API Kie.ai.

## 🎯 Concept

Une app où l'utilisateur upload une photo + un prompt ("mets une Rolex sur mon poignet", "ajoute un poisson absurde") et l'IA génère le résultat. L'objectif : prank ses potes, créer du contenu TikTok viral.

**Public cible** : Gen Z français, 16-25 ans, mobile-first.

## 🎨 Stack Technique

- **Frontend** : React + Vite + TypeScript
- **Styling** : Tailwind CSS
- **Animations** : Framer Motion
- **Auth** : Supabase Auth (email + Google OAuth)
- **Database** : Supabase (PostgreSQL)
- **Storage** : Supabase Storage
- **Paiement** : Stripe Checkout + Webhooks
- **API IA** : Kie.ai (Nano Banana 2 / Gemini 3.1 Flash Image)
- **Déploiement** : Vercel

## 🚀 Installation

### 1. Cloner le repo

```bash
git clone https://github.com/Milo-adonos/GoMytho.git
cd GoMytho
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configuration des variables d'environnement

Créer un fichier `.env` à la racine :

```env
# Kie.ai API
VITE_KIE_API_KEY=your_kie_api_key_here

# Supabase
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Stripe (côté client)
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key_here

# Stripe (côté serveur - pour webhooks)
STRIPE_SECRET_KEY=your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret_here
```

### 4. Configuration Supabase

Exécuter le script SQL suivant dans l'éditeur SQL de Supabase :

```sql
-- Voir le fichier supabase-schema.sql
```

### 5. Lancer le serveur de développement

```bash
npm run dev
```

L'app sera accessible sur `http://localhost:3000`

## 📁 Structure du Projet

```
GoMytho/
├── src/
│   ├── pages/
│   │   ├── Landing.tsx        # Page d'accueil avec hero, carousel, FAQ
│   │   ├── Create.tsx         # Upload de photo et prompt
│   │   ├── Analyzing.tsx      # Fausse analyse (15s)
│   │   ├── Unlock.tsx         # Paywall avec Stripe
│   │   ├── Signup.tsx         # Création de compte
│   │   ├── App.tsx            # Dashboard principal
│   │   └── Creations.tsx      # Historique des mythos
│   ├── components/
│   │   ├── Header.tsx         # Header sticky
│   │   ├── Footer.tsx         # Footer
│   │   ├── Button.tsx         # Bouton réutilisable
│   │   └── LoadingAnimation.tsx
│   ├── lib/
│   │   ├── supabase.ts        # Configuration Supabase
│   │   ├── stripe.ts          # Configuration Stripe
│   │   └── kie-api.ts         # Intégration Kie.ai
│   ├── styles/
│   │   └── globals.css        # Styles globaux
│   ├── App.tsx                # Router principal
│   └── main.tsx               # Point d'entrée
├── public/
├── index.html
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## 🎨 Palette de Couleurs

```css
--primary-bg: #0A0E1A      /* Noir profond bleuté */
--secondary-bg: #141826     /* Gris très foncé bleuté */
--lime: #C6FF3C             /* Vert lime électrique (accent principal) */
--lime-hover: #9FE831       /* Vert acide saturé (hover) */
--text-primary: #F5F5F0     /* Blanc cassé */
--text-secondary: #8A8FA0   /* Gris clair */
```

## 🔄 Funnel de Conversion

1. **Landing (/)** → Utilisateur arrive, voit les exemples before/after
2. **Create (/create)** → Upload photo + prompt
3. **Analyzing (/analyzing)** → Fausse analyse 15s avec loading progressif
4. **Unlock (/unlock)** → Paywall avec prix hebdo/mensuel
5. **Signup (/signup)** → Création de compte email ou Google
6. **Dashboard (/app)** → Interface principale avec génération réelle
7. **Creations (/app/creations)** → Historique des mythos

## 💳 Tarification

- **Gratuit** : 3 mythos pour tester (non implémenté dans MVP)
- **Hebdo** : 2,99€/semaine - 70 mythos (8 crédits = 1 mytho)
- **Mensuel** : 9,90€/mois - 610 mythos ⭐ LE PLUS CHOISI

## 🔐 Sécurité

- Variables d'environnement pour toutes les clés API
- Validation côté serveur du paiement Stripe
- Webhooks Stripe pour activer les abonnements
- Rate limiting recommandé (max 10 req/min par utilisateur)
- Images supprimées de Supabase Storage après X jours (à configurer)

## 🚀 Déploiement sur Vercel

1. Push le code sur GitHub
2. Connecter le repo à Vercel
3. Ajouter les variables d'environnement dans Vercel
4. Déployer

```bash
vercel
```

## 📊 Base de Données Supabase

### Table `users`

| Colonne | Type | Description |
|---------|------|-------------|
| id | uuid | ID utilisateur (PK) |
| email | text | Email de l'utilisateur |
| stripe_customer_id | text | ID client Stripe |
| subscription_status | text | 'active', 'inactive', 'cancelled' |
| credits_remaining | integer | Crédits restants |
| created_at | timestamp | Date de création |

### Table `mythos`

| Colonne | Type | Description |
|---------|------|-------------|
| id | uuid | ID du mytho (PK) |
| user_id | uuid | ID utilisateur (FK) |
| image_url | text | URL de l'image stockée |
| prompt | text | Prompt utilisé |
| created_at | timestamp | Date de création |

### Bucket Storage `mythos`

Stocke toutes les images uploadées et générées.

## 🔧 To-Do Avant Production

- [ ] Configurer les vrais Price IDs Stripe
- [ ] Implémenter les webhooks Stripe (backend)
- [ ] Ajouter rate limiting sur l'API
- [ ] Tester l'intégration Kie.ai avec une vraie clé API
- [ ] Configurer le nettoyage automatique des images anciennes
- [ ] Ajouter les pages légales (CGU, Mentions légales, etc.)
- [ ] Tester sur tous les navigateurs et devices
- [ ] Optimiser les performances (Lighthouse > 90)
- [ ] Configurer les analytics (Google Analytics, etc.)
- [ ] Mettre en place un système de monitoring des erreurs (Sentry)

## 🎯 Fonctionnalités Futures

- [ ] Mode vidéo (actuellement "Bientôt")
- [ ] Templates viraux prédéfinis
- [ ] Partage direct sur TikTok/Instagram
- [ ] Mode collaboratif (mytho entre amis)
- [ ] Historique de prompts sauvegardés
- [ ] API publique pour les développeurs

## 📝 Notes Techniques

### Kie.ai API

- **Endpoint** : `https://api.kie.ai/v1/image-to-image`
- **Coût** : 8 crédits = 1 image en 1K = 0,04$
- **Modèle** : Nano Banana 2 / Gemini 3.1 Flash Image

### Stripe Webhooks

À configurer dans Stripe Dashboard :
- `checkout.session.completed` → Activer l'abonnement
- `customer.subscription.updated` → Mettre à jour le statut
- `customer.subscription.deleted` → Désactiver l'abonnement

## 🐛 Debugging

### L'app ne se lance pas
```bash
# Vérifier les dépendances
npm install

# Vérifier les variables d'env
cat .env
```

### Erreur Supabase
- Vérifier que les tables existent
- Vérifier que RLS (Row Level Security) est configuré
- Vérifier les clés API dans `.env`

### Erreur Stripe
- Vérifier que les Price IDs correspondent
- Vérifier la clé publishable dans `.env`
- Tester en mode test Stripe d'abord

## 📄 Licence

Propriétaire - GoMytho © 2026

---

Créé avec ❤️ pour la Gen Z française qui veut mytho sa vie en 10 secondes.
