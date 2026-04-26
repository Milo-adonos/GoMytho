# Configuration Stripe Webhooks pour GoMytho

## Prérequis

- Compte Stripe configuré
- Plans de prix créés dans Stripe Dashboard
- Endpoint de webhook déployé

## Webhooks à configurer

### 1. `checkout.session.completed`

Déclenché quand un paiement est complété avec succès.

**Actions à effectuer** :
- Récupérer le `customer_id` et `customer_email` depuis la session
- Mettre à jour la table `users` :
  - `stripe_customer_id` = customer_id
  - `subscription_status` = 'active'
  - `credits_remaining` = 610 (pour plan mensuel) ou 70 (pour plan hebdo)

### 2. `customer.subscription.updated`

Déclenché quand un abonnement est modifié.

**Actions à effectuer** :
- Vérifier le nouveau statut de l'abonnement
- Mettre à jour `subscription_status` dans la table `users`
- Si renouvellement : ajouter des crédits

### 3. `customer.subscription.deleted`

Déclenché quand un abonnement est annulé.

**Actions à effectuer** :
- Mettre `subscription_status` = 'cancelled'
- Ne PAS supprimer les crédits restants (laisser l'utilisateur les utiliser)

## Exemple de code Node.js/Express

```javascript
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Utiliser la service key côté serveur
)

export async function POST(req) {
  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event

  try {
    event = stripe.webhooks.constructEvent(
      await req.text(),
      sig,
      webhookSecret
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response('Webhook Error', { status: 400 })
  }

  // Gérer les événements
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object

      // Récupérer le user_id depuis les metadata (à configurer lors de la création de session)
      const userId = session.metadata?.user_id
      const customerId = session.customer
      const subscriptionId = session.subscription

      if (userId) {
        // Déterminer les crédits selon le plan
        const priceId = session.line_items?.data[0]?.price?.id
        let credits = 610 // Par défaut mensuel
        
        if (priceId === process.env.STRIPE_PRICE_WEEKLY) {
          credits = 70
        }

        // Mettre à jour l'utilisateur
        await supabase
          .from('users')
          .update({
            stripe_customer_id: customerId,
            subscription_status: 'active',
            credits_remaining: credits,
          })
          .eq('id', userId)
      }
      break

    case 'customer.subscription.updated':
      const subscription = event.data.object

      // Trouver l'utilisateur par customer_id
      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('stripe_customer_id', subscription.customer)
        .single()

      if (user) {
        const status = subscription.status === 'active' ? 'active' : 'inactive'
        
        await supabase
          .from('users')
          .update({ subscription_status: status })
          .eq('id', user.id)

        // Si renouvellement, ajouter des crédits
        if (subscription.status === 'active' && user.credits_remaining < 10) {
          const priceId = subscription.items.data[0].price.id
          let credits = 610
          
          if (priceId === process.env.STRIPE_PRICE_WEEKLY) {
            credits = 70
          }

          await supabase
            .from('users')
            .update({ credits_remaining: credits })
            .eq('id', user.id)
        }
      }
      break

    case 'customer.subscription.deleted':
      const deletedSub = event.data.object

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('stripe_customer_id', deletedSub.customer)
        .single()

      if (userData) {
        await supabase
          .from('users')
          .update({ subscription_status: 'cancelled' })
          .eq('id', userData.id)
      }
      break

    default:
      console.log(`Unhandled event type ${event.type}`)
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
}
```

## Configuration dans Stripe Dashboard

1. Aller dans **Developers** > **Webhooks**
2. Cliquer sur **Add endpoint**
3. Entrer l'URL : `https://votre-domaine.com/api/webhooks/stripe`
4. Sélectionner les événements :
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copier le **Signing secret** et l'ajouter dans `.env` comme `STRIPE_WEBHOOK_SECRET`

## Test en local avec Stripe CLI

```bash
# Installer Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forwarder les webhooks vers votre localhost
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Tester un webhook
stripe trigger checkout.session.completed
```

## Sécurité

- ✅ Toujours vérifier la signature du webhook
- ✅ Utiliser la `service_key` Supabase côté serveur (pas l'anon key)
- ✅ Logger tous les événements webhook pour debugging
- ✅ Implémenter une logique de retry en cas d'échec
- ✅ Tester en mode test Stripe avant la prod

## Rate Limiting

Stripe peut envoyer plusieurs fois le même webhook. Implémenter une logique d'idempotence :

```javascript
// Vérifier si l'événement a déjà été traité
const { data: existing } = await supabase
  .from('webhook_events')
  .select('*')
  .eq('stripe_event_id', event.id)
  .single()

if (existing) {
  return new Response('Already processed', { status: 200 })
}

// Traiter l'événement...

// Sauvegarder l'événement comme traité
await supabase
  .from('webhook_events')
  .insert({ stripe_event_id: event.id, processed_at: new Date() })
```
