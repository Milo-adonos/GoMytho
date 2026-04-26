import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface User {
  id: string
  email: string
  stripe_customer_id?: string
  subscription_status?: 'active' | 'inactive' | 'cancelled'
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
