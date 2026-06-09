// Cliente Supabase compartilhado pelo app (lado do navegador).
// As credenciais vêm de variáveis PUBLIC_ do .env (expostas ao front pelo Astro).
import { createClient } from '@supabase/supabase-js';

const url     = import.meta.env.PUBLIC_SUPABASE_URL as string;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey);
