-- ═══════════════════════════════════════════════════════════════════════════
-- SOBRAMAIS — MIGRAÇÃO INCREMENTAL: SUPORTE (ETAPA 1)
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor).
--
-- Este script é seguro para rodar mais de uma vez (idempotente).
-- NÃO apaga dados existentes. NÃO altera transactions, quick_expenses, goals,
-- cards, subscriptions, trial_registry ou qualquer cálculo financeiro.
-- NÃO transforma nenhum usuário existente em admin.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. CHAMADOS DE SUPORTE (support_tickets) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject      text        NOT NULL,
  category     text        NOT NULL,
  status       text        NOT NULL DEFAULT 'open',
  app_version  text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);

-- Valores permitidos de categoria e status (defesa em profundidade —
-- além da validação já feita no frontend).
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_category_check
  CHECK (category IN ('duvida','tecnico','pagamento','conta','sugestao','outro'));

ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open','waiting','answered','closed'));

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON public.support_tickets(status);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own tickets" ON public.support_tickets;
CREATE POLICY "Users view own tickets" ON public.support_tickets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create own tickets" ON public.support_tickets;
CREATE POLICY "Users create own tickets" ON public.support_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'open');

-- Usuário só pode atualizar o próprio chamado para encerrá-lo (status = 'closed').
-- Qualquer outra transição de status (respondido, aguardando resposta) só ocorre
-- pelo trigger de mensagens (abaixo) ou futuramente pelo painel admin (service_role,
-- que ignora RLS). Isso impede que o usuário "reabra" ou marque como respondido.
DROP POLICY IF EXISTS "Users close own tickets" ON public.support_tickets;
CREATE POLICY "Users close own tickets" ON public.support_tickets
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status = 'closed');


-- ─── 2. MENSAGENS DO CHAMADO (support_messages) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid        REFERENCES public.support_tickets(id) ON DELETE CASCADE NOT NULL,
  sender_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_type     text        NOT NULL,
  message         text        NOT NULL,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_messages DROP CONSTRAINT IF EXISTS support_messages_sender_type_check;
ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_sender_type_check
  CHECK (sender_type IN ('user','admin','system'));

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id   ON public.support_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at  ON public.support_messages(created_at);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view messages of own tickets" ON public.support_messages;
CREATE POLICY "Users view messages of own tickets" ON public.support_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
  );

-- Usuário só cria mensagens nos próprios chamados, e só como sender_type='user'
-- (nunca 'admin' ou 'system') — impede se passar por suporte pelo frontend.
DROP POLICY IF EXISTS "Users create messages on own tickets" ON public.support_messages;
CREATE POLICY "Users create messages on own tickets" ON public.support_messages
  FOR INSERT WITH CHECK (
    sender_type = 'user'
    AND sender_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
  );


-- ─── 3. TRIGGER: atualizar status/updated_at do chamado ao chegar mensagem ───
-- Regra: mensagem de admin -> status 'answered'.
--        mensagem de usuário -> se já estava 'answered', volta para 'waiting'
--        (usuário respondeu, aguardando o suporte novamente); caso contrário
--        mantém o status atual. Roda como SECURITY DEFINER apenas para poder
--        atualizar support_tickets além do que a policy de UPDATE do usuário
--        permite — a lógica em si é fixa e não aceita entrada arbitrária.
CREATE OR REPLACE FUNCTION public.touch_ticket_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.support_tickets
     SET updated_at = now(),
         status = CASE
           WHEN new.sender_type = 'admin' THEN 'answered'
           WHEN new.sender_type = 'user' AND status = 'answered' THEN 'waiting'
           ELSE status
         END
   WHERE id = new.ticket_id;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ticket_on_message ON public.support_messages;
CREATE TRIGGER trg_touch_ticket_on_message
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE PROCEDURE public.touch_ticket_on_message();


-- ─── 4. PAPEL DE ADMINISTRADOR (preparação segura, sem promover ninguém) ─────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user','admin'));

-- Garantia extra: mesmo que a policy "Users manage own profile" (já existente,
-- for all using auth.uid() = id) permita ao usuário atualizar sua própria linha,
-- este trigger impede que ele altere o próprio "role" — só o backend com a
-- service_role key (que ignora triggers de RLS mas passa por este trigger normal
-- de tabela) pode alterar esse campo.
CREATE OR REPLACE FUNCTION public.prevent_role_self_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF new.role IS DISTINCT FROM old.role AND auth.role() <> 'service_role' THEN
    new.role := old.role;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_self_change ON public.profiles;
CREATE TRIGGER trg_prevent_role_self_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.prevent_role_self_change();

-- Nenhum usuário existente é alterado — todos permanecem com role = 'user'.
-- Para promover um administrador, use o SQL separado: set-admin-role.sql

-- FIM DA MIGRAÇÃO
-- ═══════════════════════════════════════════════════════════════════════════
-- RESUMO DAS ALTERAÇÕES:
--   support_tickets            — nova tabela (chamados de suporte) + RLS
--   support_messages           — nova tabela (mensagens do chamado) + RLS
--   touch_ticket_on_message    — trigger que atualiza status/updated_at
--   profiles.role              — nova coluna ('user' | 'admin'), default 'user'
--   prevent_role_self_change   — trigger que impede o próprio usuário de se
--                                 promover a admin, mesmo via API pública
-- ═══════════════════════════════════════════════════════════════════════════
