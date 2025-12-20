// supabaseClient.js
// Publishable (anon) keys are safe to load in the browser when Row Level Security
// is enforced on all tables. The service_role or any secret key must never be
// exposed in frontend code—keep those only in secured backend functions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = window?.EH_ENV?.SUPABASE_URL;
const supabaseAnonKey = window?.EH_ENV?.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase configuration missing. Create js/env.local.js with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
