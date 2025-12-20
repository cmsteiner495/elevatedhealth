// supabaseClient.js
// Browser ESM version using esm.sh (recommended by Supabase docs).
// NEVER put the Supabase service_role or any sb_secret key in frontend code—privileged
// access belongs only inside secured Edge Functions. The browser must use the
// publishable (anon) key provided via environment variables.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = import.meta.env.xjtriyybqsrumhkebobp.supabase.co;
const supabaseAnonKey = import.meta.env.sb_publishable_qw6LJ5v0IG8UXJasDFI8CQ_rVdY65pb;

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
