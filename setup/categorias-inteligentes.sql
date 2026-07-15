-- ═══════════════════════════════════════════════════════════════════════════
-- SobraMais — Etapa 2 do roadmap: CATEGORIAS INTELIGENTES
-- SQL incremental — execute no Supabase SQL Editor.
-- Não apaga dados existentes. Cria apenas tabelas/colunas/índices/políticas novas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── CATEGORIAS (personalizadas por usuário) ─────────────────────────────────
create table if not exists public.categories (
  id          text primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  icon        text not null default '📦',
  color       text not null default '#78716c',
  keywords    text[] not null default '{}',
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.categories enable row level security;
drop policy if exists "Users manage own categories" on public.categories;
create policy "Users manage own categories" on public.categories
  for all using (auth.uid() = user_id);

create index if not exists categories_user_id_idx on public.categories(user_id);

-- ─── APRENDIZADO DE CATEGORIZAÇÃO (por usuário, não compartilhado) ───────────
create table if not exists public.category_learning (
  id           text primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  match_key    text not null,           -- descrição normalizada (minúsculo, sem acento)
  category_id  text references public.categories(id) on delete cascade not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (user_id, match_key)
);
alter table public.category_learning enable row level security;
drop policy if exists "Users manage own category learning" on public.category_learning;
create policy "Users manage own category learning" on public.category_learning
  for all using (auth.uid() = user_id);

create index if not exists category_learning_user_id_idx on public.category_learning(user_id);

-- ─── VÍNCULO DE CATEGORIA NOS LANÇAMENTOS ────────────────────────────────────
-- Mantém a coluna de texto "category" já existente (compatibilidade/histórico)
-- e adiciona o vínculo estruturado, exigido para o próximo passo do roadmap
-- (orçamento por categoria). on delete set null preserva o histórico mesmo se
-- a categoria for excluída depois.
alter table public.transactions
  add column if not exists category_id text references public.categories(id) on delete set null;

create index if not exists transactions_category_id_idx on public.transactions(category_id);

-- Gastos rápidos não possuíam categoria até agora — adicionamos ambas as
-- colunas (texto + vínculo) sem afetar os registros já existentes.
alter table public.quick_expenses
  add column if not exists category text;
alter table public.quick_expenses
  add column if not exists category_id text references public.categories(id) on delete set null;

create index if not exists quick_expenses_category_id_idx on public.quick_expenses(category_id);

-- ─── SEED DE CATEGORIAS PADRÃO PARA NOVAS CONTAS ─────────────────────────────
-- Dispara junto com a criação do perfil (mesmo gatilho que já existe hoje em
-- "on_auth_user_created" → public.handle_new_user). Usuários já cadastrados
-- recebem o conjunto padrão automaticamente pelo frontend no primeiro login
-- após esta atualização (Categories.ensureDefaults()), sem necessidade de
-- rodar nada manualmente aqui.
create or replace function public.seed_default_categories()
returns trigger language plpgsql security definer as $$
begin
  insert into public.categories (id, user_id, name, icon, color, keywords, position, active)
  values
    (gen_random_uuid()::text, new.id, 'Alimentação',   '🍔', '#f97316', array['lanche','hamburguer','pizza','salgado','esfiha','pastel','padaria','restaurante','mcdonalds','burger king','habibs','subway','acai','ifood'], 0,  true),
    (gen_random_uuid()::text, new.id, 'Mercado',       '🛒', '#22c55e', array['mercado','atacadao','assai','extra','carrefour','tenda','spani','supermercado'], 1,  true),
    (gen_random_uuid()::text, new.id, 'Combustível',   '⛽', '#eab308', array['shell','ipiranga','petrobras','etanol','gasolina','diesel','posto'], 2,  true),
    (gen_random_uuid()::text, new.id, 'Moradia',       '🏠', '#0ea5e9', array['aluguel','condominio','iptu','luz','energia','agua','gas','internet'], 3,  true),
    (gen_random_uuid()::text, new.id, 'Saúde',         '💊', '#ef4444', array['farmacia','remedio','medico','consulta','exame','dentista','hospital'], 4,  true),
    (gen_random_uuid()::text, new.id, 'Lazer',         '🎮', '#a855f7', array['cinema','show','viagem','passeio','jogo','streaming','netflix','bar','balada'], 5,  true),
    (gen_random_uuid()::text, new.id, 'Roupas',        '👕', '#ec4899', array['roupa','loja','calcado','tenis','sapato'], 6,  true),
    (gen_random_uuid()::text, new.id, 'Contas',        '🧾', '#64748b', array['boleto','fatura','conta','taxa','mensalidade'], 7,  true),
    (gen_random_uuid()::text, new.id, 'Transporte',    '🚗', '#3b82f6', array['uber','99','taxi','onibus','metro','pedagio','estacionamento','ipva'], 8,  true),
    (gen_random_uuid()::text, new.id, 'Pets',          '🐶', '#84cc16', array['cobasi','petz','racao','veterinario','banho','tosa'], 9,  true),
    (gen_random_uuid()::text, new.id, 'Educação',      '🎓', '#6366f1', array['curso','faculdade','escola','livro'], 10, true),
    (gen_random_uuid()::text, new.id, 'Trabalho',      '💼', '#0f766e', array['coworking','material de escritorio'], 11, true),
    (gen_random_uuid()::text, new.id, 'Presentes',     '🎁', '#f43f5e', array['presente','aniversario','lembranca'], 12, true),
    (gen_random_uuid()::text, new.id, 'Cartão',        '💳', '#7c3aed', array['anuidade','fatura do cartao'], 13, true),
    (gen_random_uuid()::text, new.id, 'Investimentos', '💰', '#059669', array['investimento','aporte','corretora','tesouro direto'], 14, true),
    (gen_random_uuid()::text, new.id, 'Outros',        '📦', '#78716c', array[]::text[], 15, true)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_seed_categories on public.profiles;
create trigger on_profile_created_seed_categories
  after insert on public.profiles
  for each row execute procedure public.seed_default_categories();
