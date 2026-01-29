import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

// Next.js automatically loads .env.local, no need for dotenv.config()
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  // In Next.js app, warn but don't throw (client-side might not have these)
  if (typeof window === 'undefined') {
    console.warn('Supabase env vars missing - check .env.local file')
  }
}

// Use Service Role key for backend scripts (bypasses RLS)
export const supabase = createClient<Database>(
  supabaseUrl || '', 
  supabaseServiceKey || ''
)