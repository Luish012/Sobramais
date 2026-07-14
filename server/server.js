'use strict';

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const axios     = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ─── CORS ──────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://sobramais.netlify.app',
  'http://localhost:8080',
  'http://localhost:3000',
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn('[CORS bloqueado]', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'access_token'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

// ─── Supabase (service role para escrita) ─────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Asaas client ─────────────────────────────────────────────────────────────
const ASAAS_BASE = process.env.ASAAS_SANDBOX === 'true'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

const asaas = axios.create({
  baseURL: ASAAS_BASE,
  headers: { 'access_token': process.env.ASAAS_API_KEY, 'Content-Type': 'application/json' },
});

// ─── CRIAR ASSINATURA ────────────────────────────────────────────────────────
app.post('/api/subscription/create', async (req, res) => {
  console.log('[subscription/create] recebido', req.body?.email, req.body?.userId);
  const { userId, email, name, cpfCnpj } = req.body;
  if (!userId || !email || !cpfCnpj) return res.status(400).json({ error: 'userId, email e cpfCnpj são obrigatórios.' });

  const cpfCnpjDigits = String(cpfCnpj).replace(/\D/g, '');
  if (cpfCnpjDigits.length !== 11 && cpfCnpjDigits.length !== 14) {
    return res.status(400).json({ error: 'Informe um CPF ou CNPJ válido.' });
  }

  try {
    const { data: existingSub } = await supabase
      .from('subscriptions').select('*').eq('user_id', userId).single();

    if (existingSub?.asaas_subscription_id) {
      try {
        const { data: payments } = await asaas.get(
          `/subscriptions/${existingSub.asaas_subscription_id}/payments`
        );
        const pending = payments.data?.find(p => p.status === 'PENDING')
                     || payments.data?.[0];
        if (pending?.invoiceUrl) {
          return res.json({
            paymentLink:    pending.invoiceUrl,
            subscriptionId: existingSub.asaas_subscription_id,
          });
        }
      } catch {
        return res.status(409).json({
          error: 'Você já possui uma assinatura em aberto. Verifique seu e-mail de cobrança.',
        });
      }
    }

    let customerId = existingSub?.asaas_customer_id;

    if (!customerId) {
      const { data: customer } = await asaas.post('/customers', {
        name: name || email.split('@')[0],
        email,
        cpfCnpj: cpfCnpjDigits,
        notificationDisabled: false,
      });
      customerId = customer.id;
    } else {
      try {
        await asaas.put(`/customers/${customerId}`, { cpfCnpj: cpfCnpjDigits });
      } catch (e) {
        console.warn('Não foi possível atualizar CPF/CNPJ do cliente existente:', e.response?.data || e.message);
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: subscription } = await asaas.post('/subscriptions', {
      customer:    customerId,
      billingType: 'UNDEFINED',
      value:       9.99,
      nextDueDate: today,
      cycle:       'MONTHLY',
      description: 'Plano Controle Financeiro — R$ 9,99/mês',
    });

    let paymentLink = subscription.invoiceUrl || null;
    try {
      const { data: payments } = await asaas.get(`/subscriptions/${subscription.id}/payments`);
      if (payments.data?.[0]?.invoiceUrl) paymentLink = payments.data[0].invoiceUrl;
    } catch (e) {
      console.warn('Não foi possível obter cobrança da assinatura:', e.response?.status || e.message);
    }

    const { data: upsertData, error: upsertError } = await supabase
      .from('subscriptions')
      .upsert({
        user_id:               userId,
        asaas_customer_id:     customerId,
        asaas_subscription_id: subscription.id,
        status:                'inactive',
        updated_at:            new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select();

    if (upsertError) {
      console.error('[supabase upsert error]', upsertError);
      throw upsertError;
    }

    console.log('[subscription saved]', upsertData);
    res.json({ paymentLink, subscriptionId: subscription.id });

  } catch (err) {
    console.error(
      'Erro ao criar assinatura completo:',
      JSON.stringify({
        status:  err.response?.status,
        data:    err.response?.data,
        url:     err.config?.url,
        baseURL: err.config?.baseURL,
        method:  err.config?.method,
      }, null, 2)
    );
    const detail =
      err.response?.data?.errors?.[0]?.description ||
      err.response?.data?.message ||
      err.message;
    res.status(500).json({ error: 'Erro ao criar assinatura', detail });
  }
});

// ─── STATUS DA ASSINATURA ─────────────────────────────────────────────────────
app.get('/api/subscription/status', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
  try {
    const { data, error } = await supabase
      .from('subscriptions').select('*').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || { status: 'inactive' });
  } catch (err) {
    console.error('[status]', err.message);
    res.status(500).json({ error: 'Erro ao consultar assinatura', detail: err.message });
  }
});

// ─── CANCELAR ASSINATURA ──────────────────────────────────────────────────────
app.post('/api/subscription/cancel', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  try {
    const { data: sub } = await supabase
      .from('subscriptions').select('*').eq('user_id', userId).single();
    if (!sub?.asaas_subscription_id)
      return res.status(404).json({ error: 'Assinatura não encontrada.' });

    await asaas.delete(`/subscriptions/${sub.asaas_subscription_id}`);

    await supabase.from('subscriptions').upsert({
      user_id:    userId,
      status:     'cancelled',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    res.json({ success: true });
  } catch (err) {
    const detail = err.response?.data?.errors?.[0]?.description || err.message;
    console.error('Erro ao cancelar:', detail);
    res.status(500).json({ error: 'Erro ao cancelar assinatura', detail });
  }
});

// ─── WEBHOOK ASAAS ───────────────────────────────────────────────────────────
app.post('/api/asaas/webhook', async (req, res) => {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (expectedToken) {
    const receivedToken =
      req.headers['asaas-access-token'] ||
      req.headers['access-token'] ||
      req.headers['access_token'] ||
      req.headers['authorization']?.replace('Bearer ', '') ||
      '';
    if (receivedToken !== expectedToken) {
      console.warn('[webhook] Rejeitado — token inválido');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else {
    console.warn('[webhook] ATENÇÃO: ASAAS_WEBHOOK_TOKEN não configurado — aceitando sem autenticação');
  }

  const event   = req.body;
  const evtName = event.event;
  console.log(`[webhook] ${evtName}`, event.payment?.id || event.subscription?.id || '');

  try {
    if (evtName === 'PAYMENT_RECEIVED' || evtName === 'PAYMENT_CONFIRMED') {
      const asaasSubId = event.payment?.subscription;
      if (asaasSubId) {
        const end = new Date();
        end.setMonth(end.getMonth() + 1);
        const { data: subRow } = await supabase.from('subscriptions').update({
          status:     'active',
          start_date: new Date().toISOString().split('T')[0],
          end_date:   end.toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId).select().single();

        // Notificação (não interfere no fluxo de ativação acima).
        if (subRow?.user_id) {
          await createNotification({
            userId: subRow.user_id, type: 'subscription_activated',
            title: 'Assinatura ativada', message: 'Seu pagamento foi confirmado e sua assinatura está ativa.',
            actionType: 'subscription',
            dedupeKey: `sub-active-${event.payment?.id || event.id || asaasSubId}`,
          });
        }
      }
    }

    if (evtName === 'PAYMENT_OVERDUE') {
      const asaasSubId = event.payment?.subscription;
      if (asaasSubId) {
        const { data: subRow } = await supabase.from('subscriptions').update({
          status:     'past_due',
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId).select().single();

        if (subRow?.user_id) {
          await createNotification({
            userId: subRow.user_id, type: 'payment_pending',
            title: 'Pagamento pendente', message: 'Identificamos um pagamento em atraso. Regularize para não perder o acesso.',
            actionType: 'subscription',
            dedupeKey: `sub-pastdue-${event.payment?.id || event.id || asaasSubId}`,
          });
        }
      }
    }

    if (evtName === 'SUBSCRIPTION_CANCELLED' || evtName === 'SUBSCRIPTION_DELETED') {
      const asaasSubId = event.subscription?.id;
      if (asaasSubId) {
        const { data: subRow } = await supabase.from('subscriptions').update({
          status:     'cancelled',
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId).select().single();

        if (subRow?.user_id) {
          await createNotification({
            userId: subRow.user_id, type: 'subscription_cancelled',
            title: 'Assinatura cancelada', message: 'Sua assinatura foi cancelada.',
            actionType: 'subscription',
            dedupeKey: `sub-cancelled-${event.id || asaasSubId}`,
          });
        }
      }
    }
  } catch (e) {
    console.error('[webhook-error]', e.message);
  }

  res.json({ received: true });
});

// ─── TRIAL — VERIFICAR E CRIAR ────────────────────────────────────────────────
// POST /api/trial/init
// Body: { userId: string, cpf: string }
//
// Fluxo:
//   1. Valida userId e CPF (somente 11 dígitos numéricos)
//   2. Consulta trial_registry pelo CPF
//   3. CPF inédito  → insere em trial_registry + upsert subscription como 'trial' (7 dias)
//   4. CPF já usado → upsert subscription como 'inactive' (sem datas)
//   5. Retorna a subscription atualizada
//
// Pré-requisito: rode trial-fix.sql no Supabase (cria trial_registry + cards + coluna cpf).
app.post('/api/trial/init', async (req, res) => {
  const { userId, cpf } = req.body;

  // ── Validação de entrada ─────────────────────────────────────────────────
  if (!userId || !cpf) {
    return res.status(400).json({ trial: false, error: 'userId e cpf são obrigatórios.' });
  }

  const cpfDigits = String(cpf).replace(/\D/g, '');
  if (cpfDigits.length !== 11) {
    return res.status(400).json({ trial: false, error: 'CPF inválido — informe os 11 dígitos.' });
  }

  try {
    // ── 1. Consultar trial_registry ─────────────────────────────────────────
    const { data: registry, error: regErr } = await supabase
      .from('trial_registry')
      .select('cpf')
      .eq('cpf', cpfDigits)
      .maybeSingle();

    if (regErr) {
      console.error('[trial/init] Erro ao consultar trial_registry:', regErr.message);
      console.error('[trial/init] Execute trial-fix.sql no Supabase antes de usar o trial.');
      return res.status(500).json({
        trial: false,
        error: 'Configuração pendente: execute o SQL de migração no Supabase.',
      });
    }

    let subData;
    const now = new Date();

    if (!registry) {
      // ── 2a. CPF inédito — conceder trial de 7 dias ─────────────────────────
      const endDate  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const startStr = now.toISOString().split('T')[0];
      const endStr   = endDate.toISOString().split('T')[0];

      // Registrar CPF para impedir reuso
      const { error: insertErr } = await supabase
        .from('trial_registry')
        .insert({ cpf: cpfDigits, first_user: userId });

      if (insertErr) {
        console.error('[trial/init] Erro ao inserir trial_registry:', insertErr.message);
        return res.status(500).json({ trial: false, error: 'Erro ao registrar trial.' });
      }

      // Criar/atualizar subscription com status 'trial'
      const { data: upserted, error: subErr } = await supabase
        .from('subscriptions')
        .upsert({
          user_id:    userId,
          cpf:        cpfDigits,
          status:     'trial',
          start_date: startStr,
          end_date:   endStr,
          updated_at: now.toISOString(),
        }, { onConflict: 'user_id' })
        .select()
        .single();

      if (subErr) {
        console.error('[trial/init] Erro ao criar subscription trial:', subErr.message);
        // Reverter trial_registry para não bloquear o CPF inutilmente
        await supabase.from('trial_registry').delete().eq('cpf', cpfDigits);
        return res.status(500).json({ trial: false, error: 'Erro ao criar período de teste.' });
      }

      subData = upserted;
      console.log('[trial/init] Trial criado — userId:', userId, '| CPF:', cpfDigits, '| até:', endStr);

    } else {
      // ── 2b. CPF já utilizado — marcar como inactive (sem datas) ───────────
      const { data: upserted, error: subErr } = await supabase
        .from('subscriptions')
        .upsert({
          user_id:    userId,
          cpf:        cpfDigits,
          status:     'inactive',
          start_date: null,
          end_date:   null,
          updated_at: now.toISOString(),
        }, { onConflict: 'user_id' })
        .select()
        .single();

      if (subErr) {
        console.error('[trial/init] Erro ao upsert subscription inactive:', subErr.message);
        return res.status(500).json({ trial: false, error: 'Erro ao atualizar assinatura.' });
      }

      subData = upserted;
      console.log('[trial/init] CPF já usado — subscription inactive. userId:', userId);
    }

    // ── 3. Retornar a subscription completa ──────────────────────────────────
    return res.json({ trial: subData.status === 'trial', subscription: subData });

  } catch (err) {
    console.error('[trial/init] Erro inesperado:', err.message);
    return res.status(500).json({ trial: false, error: 'Erro interno ao iniciar trial.' });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));


// ═════════════════════════════════════════════════════════════════════════════
// PAINEL ADMINISTRATIVO E NOTIFICAÇÕES (ETAPA 2)
// Módulo isolado: nenhuma rota abaixo participa de cálculos financeiros,
// trial, webhook de assinatura ou lançamentos. Qualquer falha aqui é isolada
// com try/catch e nunca deve derrubar as rotas acima.
// ═════════════════════════════════════════════════════════════════════════════

// ─── Helpers de notificação ───────────────────────────────────────────────────
// Cria uma notificação para um usuário. Idempotente via dedupe_key (índice
// único no banco) — se já existir, o erro de duplicidade é silenciosamente
// ignorado (nunca deve travar o fluxo que a chamou, ex: webhook do Asaas).
async function createNotification({ userId, type, title, message, actionType = null, actionId = null, dedupeKey = null, createdBy = null }) {
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id:     userId,
      type,
      title,
      message,
      action_type: actionType,
      action_id:   actionId,
      dedupe_key:  dedupeKey,
      created_by:  createdBy,
    });
    if (error) {
      // 23505 = violação de unique constraint → já existe, ignorar (dedupe)
      if (error.code !== '23505') console.error('[createNotification]', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[createNotification] erro inesperado:', e.message);
    return false;
  }
}

function maskCpf(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return null;
  return `***.***.***-${d.slice(-2)}`;
}

// ─── Autenticação: valida o JWT do usuário logado ────────────────────────────
async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { user: null, error: 'Não autenticado.' };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { user: null, error: 'Sessão inválida ou expirada.' };
  return { user: data.user, error: null };
}

// ─── Middleware: exige usuário logado (qualquer papel) ───────────────────────
async function requireUser(req, res, next) {
  const { user, error } = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error });
  req.authUser = user;
  next();
}

// ─── Middleware: exige papel admin — nunca confia em dados do frontend ──────
// Sempre revalida o JWT e consulta profiles.role no banco a cada chamada.
async function requireAdmin(req, res, next) {
  try {
    const { user, error } = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error });

    const { data: profile, error: profErr } = await supabase
      .from('profiles').select('role').eq('id', user.id).single();

    if (profErr || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    req.adminUser = user;
    next();
  } catch (e) {
    console.error('[requireAdmin]', e.message);
    res.status(500).json({ error: 'Erro ao validar permissão.' });
  }
}

// ─── Constantes de status de assinatura/trial (mesmas do restante do app) ───
const nowIso = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().split('T')[0];

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICAÇÕES — SINCRONIZAÇÃO NO LOGIN (trial acabando / encerrado)
// Chamado pelo frontend a cada login. Gera no máximo uma notificação por
// evento real (dedupe_key inclui userId+end_date+tipo), nunca duplica em
// refresh. Erros aqui nunca devem impedir login — sempre responde 200.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/notifications/sync', requireUser, async (req, res) => {
  try {
    const userId = req.authUser.id;
    const { data: sub } = await supabase
      .from('subscriptions').select('*').eq('user_id', userId).maybeSingle();

    if (sub?.status === 'trial' && sub.end_date) {
      const today = todayStr();
      const end   = sub.end_date;
      const daysLeft = Math.ceil((new Date(end + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);

      if (daysLeft === 2) {
        await createNotification({
          userId, type: 'trial_ending', title: 'Seu teste grátis está terminando',
          message: 'Faltam 2 dias para o fim do seu teste grátis. Assine para não perder o acesso.',
          actionType: 'subscription', dedupeKey: `trial-ending-2-${userId}-${end}`,
        });
      } else if (daysLeft === 1) {
        await createNotification({
          userId, type: 'trial_ending', title: 'Seu teste grátis está terminando',
          message: 'Falta 1 dia para o fim do seu teste grátis. Assine para não perder o acesso.',
          actionType: 'subscription', dedupeKey: `trial-ending-1-${userId}-${end}`,
        });
      } else if (daysLeft < 0) {
        await createNotification({
          userId, type: 'trial_ended', title: 'Seu teste grátis terminou',
          message: 'Seu período de teste terminou. Assine para continuar usando o SobraMais.',
          actionType: 'subscription', dedupeKey: `trial-ended-${userId}-${end}`,
        });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[notifications/sync]', e.message);
    res.json({ ok: false }); // nunca retorna erro que trave o login
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — VISÃO GERAL
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  const today = todayStr();
  const safe = async (fn, fallback = 0) => {
    try { return await fn(); } catch (e) { console.error('[admin/overview]', e.message); return fallback; }
  };

  const totalUsers      = await safe(async () => (await supabase.from('profiles').select('id', { count: 'exact', head: true })).count || 0);
  const activeTrials    = await safe(async () => (await supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trial').gte('end_date', today)).count || 0);
  const expiredTrials   = await safe(async () => (await supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trial').lt('end_date', today)).count || 0);
  const activeSubs      = await safe(async () => (await supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active')).count || 0);
  const inactiveSubs    = await safe(async () => (await supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'inactive')).count || 0);
  const pendingPayments = await safe(async () => (await supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'past_due')).count || 0);
  const cancelledSubs   = await safe(async () => (await supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'cancelled')).count || 0);
  const openTickets     = await safe(async () => (await supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'waiting', 'answered'])).count || 0);
  const waitingTickets  = await safe(async () => (await supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'waiting'])).count || 0);

  res.json({
    totalUsers, activeTrials, expiredTrials, activeSubs, inactiveSubs,
    pendingPayments, cancelledSubs, openTickets, waitingTickets,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — USUÁRIOS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { search = '', filter = 'todos' } = req.query;
    let query = supabase.from('admin_user_directory').select('*').order('signup_at', { ascending: false });

    const today = todayStr();
    if (filter === 'trial')      query = query.eq('subscription_status', 'trial');
    if (filter === 'ativos')     query = query.eq('subscription_status', 'active');
    if (filter === 'inativos')   query = query.eq('subscription_status', 'inactive');
    if (filter === 'pendentes')  query = query.eq('subscription_status', 'past_due');
    if (filter === 'cancelados') query = query.eq('subscription_status', 'cancelled');

    const { data, error } = await query;
    if (error) throw error;

    let rows = data || [];
    const term = String(search || '').trim().toLowerCase();
    if (term) {
      const termDigits = term.replace(/\D/g, '');
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(term) ||
        (r.email || '').toLowerCase().includes(term) ||
        (r.user_id || '').toLowerCase().includes(term) ||
        (termDigits.length >= 3 && String(r.cpf || '').includes(termDigits))
      );
    }

    res.json(rows.map(r => ({
      userId:               r.user_id,
      name:                 r.name,
      email:                r.email,
      cpfMasked:            maskCpf(r.cpf),
      signupAt:             r.signup_at,
      role:                 r.role,
      subscriptionStatus:   r.subscription_status,
      accessType:           r.access_type,
      manualAccess:         r.manual_access,
      startDate:            r.start_date,
      endDate:              r.end_date,
    })));
  } catch (e) {
    console.error('[admin/users]', e.message);
    res.status(500).json({ error: 'Erro ao carregar usuários.' });
  }
});

app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: userRow, error: userErr } = await supabase
      .from('admin_user_directory').select('*').eq('user_id', id).single();
    if (userErr || !userRow) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const { data: tickets } = await supabase
      .from('support_tickets').select('*').eq('user_id', id).order('updated_at', { ascending: false });

    res.json({
      userId:              userRow.user_id,
      name:                userRow.name,
      email:               userRow.email,
      cpfMasked:           maskCpf(userRow.cpf),
      signupAt:            userRow.signup_at,
      role:                userRow.role,
      subscriptionStatus:  userRow.subscription_status,
      accessType:          userRow.access_type,
      manualAccess:        userRow.manual_access,
      manualNote:          userRow.manual_note,
      plan:                userRow.plan,
      price:               userRow.price,
      startDate:           userRow.start_date,
      endDate:             userRow.end_date,
      asaasCustomerId:     userRow.asaas_customer_id,
      asaasSubscriptionId: userRow.asaas_subscription_id,
      updatedBy:           userRow.updated_by,
      subscriptionUpdatedAt: userRow.subscription_updated_at,
      tickets:             tickets || [],
    });
  } catch (e) {
    console.error('[admin/users/:id]', e.message);
    res.status(500).json({ error: 'Erro ao carregar usuário.' });
  }
});

// PATCH /api/admin/users/:id/access — ativar/desativar manualmente, conceder
// dias extras de trial, marcar vitalício/manual, cancelar acesso interno.
app.post('/api/admin/users/:id/access', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, accessType, manualAccess, manualNote, extraTrialDays } = req.body || {};

    const validStatuses  = ['trial', 'active', 'inactive', 'past_due', 'cancelled'];
    const validAccess    = ['trial', 'subscription', 'lifetime', 'manual'];

    const { data: current, error: curErr } = await supabase
      .from('subscriptions').select('*').eq('user_id', id).maybeSingle();
    if (curErr) throw curErr;

    const patch = { user_id: id, updated_at: nowIso(), updated_by: req.adminUser.id };

    if (status !== undefined) {
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
      patch.status = status;
    }
    if (accessType !== undefined) {
      if (accessType !== null && !validAccess.includes(accessType)) return res.status(400).json({ error: 'Tipo de acesso inválido.' });
      patch.access_type = accessType;
    }
    if (manualAccess !== undefined) patch.manual_access = !!manualAccess;
    if (manualNote !== undefined) patch.manual_note = manualNote;

    if (extraTrialDays !== undefined) {
      const days = parseInt(extraTrialDays, 10);
      if (!Number.isFinite(days) || days <= 0 || days > 365) return res.status(400).json({ error: 'Quantidade de dias inválida.' });
      const base = current?.end_date && current.end_date >= todayStr() ? new Date(current.end_date + 'T00:00:00Z') : new Date();
      base.setUTCDate(base.getUTCDate() + days);
      patch.end_date = base.toISOString().split('T')[0];
      if (!patch.status && !current?.status) patch.status = 'trial';
    }

    const { data: updated, error: upErr } = await supabase
      .from('subscriptions').upsert(patch, { onConflict: 'user_id' }).select().single();
    if (upErr) throw upErr;

    console.log(`[admin] ${req.adminUser.id} atualizou acesso de ${id}:`, JSON.stringify(patch));
    res.json({ success: true, subscription: updated });
  } catch (e) {
    console.error('[admin/users/:id/access]', e.message);
    res.status(500).json({ error: 'Erro ao atualizar acesso do usuário.' });
  }
});

// PATCH /api/admin/users/:id/role — só o backend (service_role) pode alterar
// role; o trigger prevent_role_self_change bloqueia qualquer outra via.
app.post('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Papel inválido.' });

    const { data, error } = await supabase
      .from('profiles').update({ role }).eq('id', id).select().single();
    if (error) throw error;

    console.log(`[admin] ${req.adminUser.id} definiu role='${role}' para ${id}`);
    res.json({ success: true, profile: data });
  } catch (e) {
    console.error('[admin/users/:id/role]', e.message);
    res.status(500).json({ error: 'Erro ao atualizar papel do usuário.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — ASSINATURAS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    const { filter = 'todas' } = req.query;
    const today = todayStr();
    let query = supabase.from('admin_user_directory').select('*').order('subscription_updated_at', { ascending: false });

    if (filter === 'ativa')     query = query.eq('subscription_status', 'active');
    if (filter === 'trial')     query = query.eq('subscription_status', 'trial').gte('end_date', today);
    if (filter === 'inativa')   query = query.eq('subscription_status', 'inactive');
    if (filter === 'vencida')   query = query.eq('subscription_status', 'trial').lt('end_date', today);
    if (filter === 'cancelada') query = query.eq('subscription_status', 'cancelled');
    if (filter === 'vitalicia') query = query.eq('access_type', 'lifetime');
    if (filter === 'manual')    query = query.eq('manual_access', true);

    const { data, error } = await query;
    if (error) throw error;

    res.json((data || []).map(r => ({
      userId: r.user_id, name: r.name, email: r.email,
      status: r.subscription_status, accessType: r.access_type, manualAccess: r.manual_access,
      plan: r.plan, price: r.price, startDate: r.start_date, endDate: r.end_date,
      asaasCustomerId: r.asaas_customer_id, asaasSubscriptionId: r.asaas_subscription_id,
    })));
  } catch (e) {
    console.error('[admin/subscriptions]', e.message);
    res.status(500).json({ error: 'Erro ao carregar assinaturas.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — TRIALS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/admin/trials', requireAdmin, async (req, res) => {
  try {
    const { filter = 'todos' } = req.query;
    const today = todayStr();
    const { data, error } = await supabase
      .from('admin_user_directory').select('*').eq('subscription_status', 'trial').order('end_date', { ascending: true });
    if (error) throw error;

    let rows = data || [];
    rows = rows.map(r => {
      const daysLeft = r.end_date ? Math.ceil((new Date(r.end_date + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000) : null;
      return { ...r, _daysLeft: daysLeft };
    });

    if (filter === 'ativos')          rows = rows.filter(r => r._daysLeft !== null && r._daysLeft >= 0);
    if (filter === 'vencendo_hoje')   rows = rows.filter(r => r._daysLeft === 0);
    if (filter === 'vencendo_2dias')  rows = rows.filter(r => r._daysLeft !== null && r._daysLeft >= 0 && r._daysLeft <= 2);
    if (filter === 'vencidos')        rows = rows.filter(r => r._daysLeft !== null && r._daysLeft < 0);

    res.json(rows.map(r => ({
      userId: r.user_id, name: r.name, email: r.email, cpfMasked: maskCpf(r.cpf),
      startDate: r.start_date, endDate: r.end_date, daysLeft: r._daysLeft,
    })));
  } catch (e) {
    console.error('[admin/trials]', e.message);
    res.status(500).json({ error: 'Erro ao carregar trials.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — CENTRAL DE SUPORTE
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/admin/support/tickets', requireAdmin, async (req, res) => {
  try {
    const { filter = 'todos' } = req.query;
    let query = supabase.from('support_tickets').select('*').order('updated_at', { ascending: false });

    if (filter === 'abertos')    query = query.eq('status', 'open');
    if (filter === 'aguardando') query = query.in('status', ['open', 'waiting']);
    if (filter === 'respondidos') query = query.eq('status', 'answered');
    if (filter === 'encerrados') query = query.eq('status', 'closed');

    const { data: tickets, error } = await query;
    if (error) throw error;

    const userIds = [...new Set((tickets || []).map(t => t.user_id))];
    let usersMap = {};
    if (userIds.length) {
      const { data: users } = await supabase
        .from('admin_user_directory').select('user_id,name,email').in('user_id', userIds);
      usersMap = Object.fromEntries((users || []).map(u => [u.user_id, u]));
    }

    // Última mensagem de cada ticket (para prévia na lista)
    const ticketIds = (tickets || []).map(t => t.id);
    let lastMsgMap = {};
    if (ticketIds.length) {
      const { data: msgs } = await supabase
        .from('support_messages').select('ticket_id,message,created_at,sender_type')
        .in('ticket_id', ticketIds).order('created_at', { ascending: false });
      for (const m of msgs || []) {
        if (!lastMsgMap[m.ticket_id]) lastMsgMap[m.ticket_id] = m;
      }
    }

    res.json((tickets || []).map(t => ({
      id: t.id, subject: t.subject, category: t.category, status: t.status,
      createdAt: t.created_at, updatedAt: t.updated_at,
      userId: t.user_id, userName: usersMap[t.user_id]?.name, userEmail: usersMap[t.user_id]?.email,
      lastMessage: lastMsgMap[t.id]?.message || null,
      lastMessageSender: lastMsgMap[t.id]?.sender_type || null,
    })));
  } catch (e) {
    console.error('[admin/support/tickets]', e.message);
    res.status(500).json({ error: 'Erro ao carregar chamados.' });
  }
});

app.get('/api/admin/support/tickets/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: ticket, error: tErr } = await supabase.from('support_tickets').select('*').eq('id', id).single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const { data: messages, error: mErr } = await supabase
      .from('support_messages').select('*').eq('ticket_id', id).order('created_at', { ascending: true });
    if (mErr) throw mErr;

    const { data: userRow } = await supabase
      .from('admin_user_directory').select('name,email').eq('user_id', ticket.user_id).single();

    res.json({ ticket, userName: userRow?.name, userEmail: userRow?.email, messages: messages || [] });
  } catch (e) {
    console.error('[admin/support/tickets/:id]', e.message);
    res.status(500).json({ error: 'Erro ao carregar chamado.' });
  }
});

app.post('/api/admin/support/tickets/:id/reply', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Mensagem obrigatória.' });

    const { data: ticket, error: tErr } = await supabase.from('support_tickets').select('*').eq('id', id).single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const { data: msg, error: msgErr } = await supabase.from('support_messages').insert({
      ticket_id: id,
      sender_user_id: req.adminUser.id,
      sender_type: 'admin',
      message: String(message).trim(),
    }).select().single();
    if (msgErr) throw msgErr;
    // O trigger touch_ticket_on_message já move o status para 'answered'.

    await createNotification({
      userId: ticket.user_id,
      type: 'support_reply',
      title: 'Resposta do suporte',
      message: `Você recebeu uma resposta no chamado "${ticket.subject}".`,
      actionType: 'ticket',
      actionId: id,
      dedupeKey: `support-reply-${msg.id}`,
      createdBy: req.adminUser.id,
    });

    res.json({ success: true, message: msg });
  } catch (e) {
    console.error('[admin/support/tickets/:id/reply]', e.message);
    res.status(500).json({ error: 'Erro ao enviar resposta.' });
  }
});

app.post('/api/admin/support/tickets/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['open', 'waiting', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });

    const patch = { status, updated_at: nowIso() };
    patch.closed_at = status === 'closed' ? nowIso() : null;

    const { data, error } = await supabase.from('support_tickets').update(patch).eq('id', id).select().single();
    if (error) throw error;

    res.json({ success: true, ticket: data });
  } catch (e) {
    console.error('[admin/support/tickets/:id/status]', e.message);
    res.status(500).json({ error: 'Erro ao atualizar status do chamado.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — NOTIFICAÇÕES (envio manual / broadcast)
// ─────────────────────────────────────────────────────────────────────────────
async function resolveAudience(audience, userId) {
  const today = todayStr();
  if (audience === 'user') return userId ? [userId] : [];

  let query = supabase.from('subscriptions').select('user_id,status,end_date');
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];

  if (audience === 'all')      return rows.map(r => r.user_id);
  if (audience === 'trial')    return rows.filter(r => r.status === 'trial' && r.end_date >= today).map(r => r.user_id);
  if (audience === 'active')   return rows.filter(r => r.status === 'active').map(r => r.user_id);
  if (audience === 'inactive') return rows.filter(r => r.status === 'inactive').map(r => r.user_id);
  return [];
}

// GET — pré-visualização: quantos usuários receberiam o envio.
app.get('/api/admin/notifications/audience-count', requireAdmin, async (req, res) => {
  try {
    const { audience, userId } = req.query;
    const targets = await resolveAudience(audience, userId);
    res.json({ count: targets.length });
  } catch (e) {
    console.error('[admin/notifications/audience-count]', e.message);
    res.status(500).json({ error: 'Erro ao calcular audiência.' });
  }
});

app.post('/api/admin/notifications/send', requireAdmin, async (req, res) => {
  try {
    const { audience, userId, title, message, actionType, actionId, type } = req.body || {};
    if (!title || !message) return res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });
    if (!['user', 'all', 'trial', 'active', 'inactive'].includes(audience)) return res.status(400).json({ error: 'Audiência inválida.' });

    const targets = await resolveAudience(audience, userId);
    if (targets.length === 0) return res.status(400).json({ error: 'Nenhum usuário encontrado para essa audiência.' });

    const broadcastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let sent = 0;
    for (const uid of targets) {
      const ok = await createNotification({
        userId: uid,
        type: type || 'admin_message',
        title: String(title).trim(),
        message: String(message).trim(),
        actionType: actionType || null,
        actionId: actionId || null,
        dedupeKey: `admin-broadcast-${broadcastId}-${uid}`,
        createdBy: req.adminUser.id,
      });
      if (ok) sent++;
    }

    console.log(`[admin] ${req.adminUser.id} enviou notificação para ${sent}/${targets.length} usuário(s) (audiência: ${audience})`);
    res.json({ success: true, sentCount: sent, totalTargets: targets.length });
  } catch (e) {
    console.error('[admin/notifications/send]', e.message);
    res.status(500).json({ error: 'Erro ao enviar notificação.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
