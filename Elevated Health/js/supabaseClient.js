// supabaseClient.js
// Browser ESM version using esm.sh (recommended by Supabase docs).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ⬇️ REUSE the same URL + anon key that were working before
const supabaseUrl = "https://xjtriyybqsrumhkebobp.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqdHJpeXlicXNydW1oa2Vib2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1NDM3OTgsImV4cCI6MjA4MDExOTc5OH0.uT3jYu1MpFjuD-bJNiV17KK2jXKQbIEsXkSGvDgg_Rs";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
