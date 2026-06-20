-- ═══════════════════════════════════════════════════════════════════════════
-- FINANÇAS SAAS — Setup Supabase
-- Execute este SQL no Supabase SQL Editor (supabase.com → seu projeto → SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── PERFIS ───────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id   uuid references auth.users(id) on delete cascade primary key,
  name text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Users manage own profile" on public.profiles;
create policy "Users manage own profile" on public.profiles
  for all using (auth.uid() = id);

-- ─── ASSINATURAS ─────────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references auth.users(id) on delete cascade not null unique,
  asaas_customer_id      text,
  asaas_subscription_id  text,
  status                 text not null default 'inactive',  -- inactive|active|cancelled|past_due
  plan                   text not null default 'Plano Controle Financeiro',
  price                  numeric(10,2) not null default 9.90,
  start_date             date,
  end_date               date,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);
alter table public.subscriptions enable row level security;
-- Usuário pode ler sua própria assinatura
drop policy if exists "Users read own subscription" on public.subscriptions;
create policy "Users read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);
-- Escrita somente via service_role (webhooks do servidor Node.js)

-- ─── TRANSAÇÕES ───────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id                   text primary key,
  user_id              uuid references auth.users(id) on delete cascade not null,
  group_id             text,
  type                 text not null,
  subtype              text not null default 'once',
  description          text not null,
  category             text,
  amount               numeric(12,2) not null,
  payment_method       text,
  card_id              text,
  due_date             date,
  purchase_date        date,
  invoice_cycle_key    text,
  paid                 boolean not null default false,
  paid_date            date,
  installment_current  integer default 1,
  installment_total    integer default 1,
  is_generated         boolean default false,
  created_at           timestamptz default now()
);
alter table public.transactions enable row level security;
drop policy if exists "Users manage own transactions" on public.transactions;
create policy "Users manage own transactions" on public.transactions
  for all using (auth.uid() = user_id);

-- ─── GASTOS RÁPIDOS ──────────────────────────────────────────────────────────
create table if not exists public.quick_expenses (
  id              text primary key,
  user_id         uuid references auth.users(id) on delete cascade not null,
  description     text not null,
  amount          numeric(12,2) not null,
  payment_method  text,
  date            date,
  created_at      timestamptz default now()
);
alter table public.quick_expenses enable row level security;
drop policy if exists "Users manage own quick expenses" on public.quick_expenses;
create policy "Users manage own quick expenses" on public.quick_expenses
  for all using (auth.uid() = user_id);

-- ─── METAS ───────────────────────────────────────────────────────────────────
create table if not exists public.goals (
  id          text primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  emoji       text default '🎯',
  target      numeric(12,2) not null,
  saved       numeric(12,2) default 0,
  deadline    date,
  created_at  timestamptz default now()
);
alter table public.goals enable row level security;
drop policy if exists "Users manage own goals" on public.goals;
create policy "Users manage own goals" on public.goals
  for all using (auth.uid() = user_id);

-- ─── TRIGGER: auto-criar perfil e assinatura ao cadastrar ─────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name)
  values (new.id, new.raw_user_meta_data->>'name')
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, status)
  values (new.id, 'inactive')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
