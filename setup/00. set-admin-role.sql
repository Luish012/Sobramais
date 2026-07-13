-- ═══════════════════════════════════════════════════════════════════════════
-- SOBRAMAIS — DEFINIR ADMINISTRADOR (EXECUÇÃO MANUAL E EXPLÍCITA)
--
-- Este script NÃO é executado automaticamente e NÃO faz parte da migração
-- incremental (support-phase-1.sql). Rode-o manualmente, apenas quando você
-- quiser promover uma conta específica a administrador.
--
-- Pré-requisito: já ter executado support-phase-1.sql (cria a coluna
-- public.profiles.role).
--
-- IMPORTANTE:
--   - Não existe e-mail nem UUID de administrador fixo no código do app.
--   - Esta é a única forma prevista nesta etapa de conceder o papel 'admin'.
--   - Um trigger (prevent_role_self_change) impede que o próprio usuário
--     altere seu papel pela API pública — só é possível pelo SQL Editor do
--     Supabase (que roda como owner/service role) ou pela service_role key.
-- ═══════════════════════════════════════════════════════════════════════════

-- OPÇÃO A — Definir admin pelo UUID do usuário (auth.users.id):
-- update public.profiles
-- set role = 'admin'
-- where id = 'UUID_DO_ADMIN';

-- OPÇÃO B — Definir admin pelo e-mail (mais prático no dia a dia):
-- update public.profiles
-- set role = 'admin'
-- where id = (select id from auth.users where email = 'admin@exemplo.com');

-- Para revogar o papel de admin (voltar para usuário comum):
-- update public.profiles
-- set role = 'user'
-- where id = 'UUID_DO_ADMIN';

-- Para conferir quem é admin atualmente:
-- select p.id, u.email, p.role from public.profiles p
-- join auth.users u on u.id = p.id
-- where p.role = 'admin';
