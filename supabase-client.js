'use strict';
// Supabase client — carregado após config.js e o CDN do Supabase
const { createClient } = supabase;
const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
