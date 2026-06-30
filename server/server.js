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
        await supabase.from('subscriptions').update({
          status:     'active',
          start_date: new Date().toISOString().split('T')[0],
          end_date:   end.toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId);
      }
    }

    if (evtName === 'PAYMENT_OVERDUE') {
      const asaasSubId = event.payment?.subscription;
      if (asaasSubId) {
        await supabase.from('subscriptions').update({
          status:     'past_due',
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId);
      }
    }

    if (evtName === 'SUBSCRIPTION_CANCELLED' || evtName === 'SUBSCRIPTION_DELETED') {
      const asaasSubId = event.subscription?.id;
      if (asaasSubId) {
        await supabase.from('subscriptions').update({
          status:     'cancelled',
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId);
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
