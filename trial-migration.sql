-- ============================================================
-- MIGRAÇÃO INCREMENTAL — SobraMais Free Trial
-- Execute no Supabase SQL Editor.
-- NÃO apaga dados existentes. NÃO altera usuários existentes.
-- ============================================================

-- 1. Criar tabela de controle de trial (impede múltiplos trials por CPF)
CREATE TABLE IF NOT EXISTS trial_registry (
  cpf        text        PRIMARY KEY,
  first_user uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Habilitar RLS (apenas service role acessa — o backend usa service key)
ALTER TABLE trial_registry ENABLE ROW LEVEL SECURITY;

-- 3. (Opcional) Coluna cpf nas subscriptions para referência futura
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cpf text;
