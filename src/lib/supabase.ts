import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

// Load environment variables if not already loaded (for scripts outside Next.js)
if (typeof window === 'undefined' && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const dotenv = require('dotenv')
    const path = require('path')
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  } catch (e) {
    // dotenv might not be available in all contexts, that's okay
  }
}

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