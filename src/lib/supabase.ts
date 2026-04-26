import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

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
