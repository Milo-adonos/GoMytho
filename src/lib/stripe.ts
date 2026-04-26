import { loadStripe } from '@stripe/stripe-js'

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

export const stripePromise = stripePublishableKey && stripePublishableKey !== 'your_stripe_publishable_key' 
  ? loadStripe(stripePublishableKey) 
  : null

export const PRICE_IDS = {
  weekly: 'price_weekly_299', // À remplacer par les vrais IDs Stripe
  monthly: 'price_monthly_990',
}

export const createCheckoutSession = async (priceId: string, userId: string) => {
  try {
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        priceId,
        userId,
      }),
    })

    const session = await response.json()
    return session
  } catch (error) {
    console.error('Error creating checkout session:', error)
    throw error
  }
}
