'use strict';

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const axios     = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ─── CORS ──────────────────────────────────────────────────────────────────
// Lista de origens permitidas (Netlify + dev local). FRONTEND_URL pode ser
// usada para adicionar mais um domínio via variável de ambiente no Render.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://sobramais.netlify.app',
  'http://localhost:8080',
  'http://localhost:3000',
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Requisições sem origin (ex: curl, server-to-server) são permitidas
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
  : 'https://api.asaas.com/api/v3';

const asaas = axios.create({
  baseURL: ASAAS_BASE,
  headers: { 'access_token': process.env.ASAAS_API_KEY, 'Content-Type': 'application/json' },
});

// ─── CRIAR ASSINATURA ────────────────────────────────────────────────────────
app.post('/api/subscription/create', async (req, res) => {
  console.log('[subscription/create] recebido', req.body?.email, req.body?.userId);
  const { userId, email, name } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'userId e email são obrigatórios.' });

  try {
    const { data: existingSub } = await supabase
      .from('subscriptions').select('*').eq('user_id', userId).single();

    // ── BUG-03: Impedir criação duplicada de assinatura no Asaas ──────────────
    // Se já existe um asaas_subscription_id, NÃO criar nova assinatura.
    // Retornar o link de pagamento da cobrança pendente existente.
    if (existingSub?.asaas_subscription_id) {
      try {
        const { data: payments } = await asaas.get(
          `/subscriptions/${existingSub.asaas_subscription_id}/payments`
        );
        // Procura cobrança pendente; senão retorna a mais recente
        const pending = payments.data?.find(p => p.status === 'PENDING')
                     || payments.data?.[0];
        if (pending?.invoiceUrl) {
          return res.json({
            paymentLink:    pending.invoiceUrl,
            subscriptionId: existingSub.asaas_subscription_id,
          });
        }
      } catch {
        // Se não conseguir buscar o link, informa ao usuário
        return res.status(409).json({
          error: 'Você já possui uma assinatura em aberto. Verifique seu e-mail de cobrança.',
        });
      }
    }

    let customerId = existingSub?.asaas_customer_id;

    // Criar cliente no Asaas se ainda não existe
    if (!customerId) {
      const { data: customer } = await asaas.post('/customers', {
        name: name || email.split('@')[0],
        email,
        notificationDisabled: false,
      });
      customerId = customer.id;
    }

    // Criar assinatura
    const today = new Date().toISOString().split('T')[0];
    const { data: subscription } = await asaas.post('/subscriptions', {
      customer:    customerId,
      billingType: 'UNDEFINED',   // Aceita Pix e Cartão
      value:       9.90,
      nextDueDate: today,
      cycle:       'MONTHLY',
      description: 'Plano Controle Financeiro — R$ 9,90/mês',
    });

    // Obter link de pagamento da primeira cobrança
    let paymentLink = subscription.invoiceUrl || null;
    try {
      const { data: payments } = await asaas.get(`/subscriptions/${subscription.id}/payments`);
      if (payments.data?.[0]?.invoiceUrl) paymentLink = payments.data[0].invoiceUrl;
    } catch {}

    // ── RISCO-04: Usar upsert (não update) para cobrir o caso em que o
    // trigger do Supabase falhou e a linha em subscriptions não existe.
    await supabase.from('subscriptions').upsert({
      user_id:               userId,
      asaas_customer_id:     customerId,
      asaas_subscription_id: subscription.id,
      status:                'inactive',
      updated_at:            new Date().toISOString(),
    }, { onConflict: 'user_id' });

    res.json({ paymentLink, subscriptionId: subscription.id });
  } catch (err) {
    const detail = err.response?.data?.errors?.[0]?.description || err.message;
    console.error('Erro ao criar assinatura:', detail);
    res.status(500).json({ error: 'Erro ao criar assinatura', detail });
  }
});

// ─── STATUS DA ASSINATURA ─────────────────────────────────────────────────────
// BUG-05: Adicionado try/catch — sem ele uma falha do Supabase derrubava o
// processo Express com UnhandledPromiseRejection.
app.get('/api/subscription/status', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
  try {
    const { data, error } = await supabase
      .from('subscriptions').select('*').eq('user_id', userId).single();
    // PGRST116 = "Row not found" — não é um erro fatal, retorna inactive
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

    // RISCO-04: upsert para garantir que a linha exista antes de atualizar
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

  // ── RISCO-01: Autenticar o webhook com token configurável ──────────────────
  // Configure ASAAS_WEBHOOK_TOKEN no painel Asaas (Integrações → Webhooks)
  // e adicione o mesmo valor ao .env do servidor.
  // Sem isso, qualquer pessoa que descubra a URL pode ativar assinaturas.
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (expectedToken) {
    const receivedToken = req.headers['access_token'] || req.headers['Access_Token'] || '';
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
    // Pagamento confirmado → ativar assinatura
    if (evtName === 'PAYMENT_RECEIVED' || evtName === 'PAYMENT_CONFIRMED') {
      const asaasSubId = event.payment?.subscription;
      if (asaasSubId) {
        const end = new Date();
        end.setMonth(end.getMonth() + 1);
        // RISCO-04: upsert via asaas_subscription_id (update apenas — linha
        // já deve existir pois o /create a cria com upsert antes do pagamento)
        await supabase.from('subscriptions').update({
          status:     'active',
          start_date: new Date().toISOString().split('T')[0],
          end_date:   end.toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId);
      }
    }

    // Pagamento vencido → past_due
    if (evtName === 'PAYMENT_OVERDUE') {
      const asaasSubId = event.payment?.subscription;
      if (asaasSubId) {
        await supabase.from('subscriptions').update({
          status:     'past_due',
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId);
      }
    }

    // Assinatura cancelada
    if (evtName === 'SUBSCRIPTION_CANCELLED' || evtName === 'SUBSCRIPTION_DELETED') {
      const asaasSubId = event.subscription?.id;
      if (asaasSubId) {
        await supabase.from('subscriptions').update({
          status:     'cancelled',
          updated_at: new Date().toISOString(),
        }).eq('asaas_subscription_id', asaasSubId);
      }
    }

    // Renovação mensal — o Asaas envia PAYMENT_RECEIVED para cada cobrança
    // mensal com o mesmo subscription ID. O handler acima já estende end_date.
    // RISCO-06 (auditoria): evento SUBSCRIPTION_RENEWED não existe na API Asaas;
    // removido para evitar falsa sensação de cobertura.

  } catch (e) {
    console.error('[webhook-error]', e.message);
  }

  res.json({ received: true });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
