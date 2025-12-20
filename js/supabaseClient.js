// supabaseClient.js
// Browser ESM version using esm.sh (recommended by Supabase docs).
// NEVER put the Supabase service_role or any sb_secret key in frontend code—privileged
// access belongs only inside secured Edge Functions. The browser must use the
// publishable (anon) key provided via environment variables.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment configuration. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
