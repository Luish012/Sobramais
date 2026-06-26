-- ============================================================
-- MIGRAÇÃO INCREMENTAL — SobraMais Free Trial
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor).
-- NÃO apaga dados existentes. Seguro para rodar mais de uma vez.
--
-- ORDEM DE DEPLOY OBRIGATÓRIA:
--   1. Execute este SQL no Supabase PRIMEIRO
--   2. Depois faça deploy do server.js atualizado
--   3. Depois faça deploy dos arquivos frontend
-- ============================================================

-- 1. Coluna cpf na tabela subscriptions (guarda o CPF usado no trial/assinatura)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cpf text;

-- 2. Tabela de controle de trial (impede múltiplos trials pelo mesmo CPF)
CREATE TABLE IF NOT EXISTS trial_registry (
  cpf        text        PRIMARY KEY,           -- 11 dígitos sem formatação
  first_user uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Habilitar RLS na trial_registry
--    O backend usa SUPABASE_SERVICE_KEY que ignora RLS automaticamente.
--    Nenhuma política pública é necessária — a tabela fica protegida por padrão.
ALTER TABLE trial_registry ENABLE ROW LEVEL SECURITY;

-- 4. (Opcional) Index para buscas por CPF — já coberto pela PRIMARY KEY,
--    mas explicitado aqui para clareza.
-- CREATE UNIQUE INDEX IF NOT EXISTS trial_registry_cpf_idx ON trial_registry(cpf);

-- FIM DA MIGRAÇÃO
