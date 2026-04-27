import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isValidUrl = (url: string) => {
  try { return url && (url.startsWith('http://') || url.startsWith('https://')) }
  catch { return false }
}

// Crée un client factice si les variables d'env sont manquantes ou invalides
const createSafeClient = () => {
  if (isValidUrl(supabaseUrl) && supabaseAnonKey) {
    try {
      return createClient(supabaseUrl, supabaseAnonKey)
    } catch {
      // fall through to mock
    }
  }
  // Client factice — toutes les méthodes retournent des valeurs neutres
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      signInWithPassword: () => Promise.resolve({ data: { user: null, session: null }, error: { message: 'Supabase non configuré' } }),
      signUp: () => Promise.resolve({ data: { user: null, session: null }, error: { message: 'Supabase non configuré' } }),
      signInWithOAuth: () => Promise.resolve({ data: null, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: (_cb: unknown) => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }), data: null, error: null }) }),
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  } as unknown as ReturnType<typeof createClient>
}

export const supabase = createSafeClient()

export interface User {
  id: string
  email: string
  stripe_customer_id?: string
  subscription_status?: 'active' | 'inactive' | 'cancelled'
  plan?: 'weekly' | 'monthly' | 'free'
  credits_remaining: number
  created_at: string
}

export interface Mytho {
  id: string
  user_id: string
  image_url: string
  prompt: string
  created_at: string
}
