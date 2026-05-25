import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cliente público (browser + server). NUNCA referenciar aquí la service role key:
// este módulo se bundlea al cliente y expondría el secreto + rompería la build.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
