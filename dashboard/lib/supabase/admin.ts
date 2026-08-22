import { createClient } from '@supabase/supabase-js'
import { supabaseSecretKey, supabaseUrl } from './config'

export function createAdminClient() {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
