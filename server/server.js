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

  // Aceita apenas dígitos; valida tamanho de CPF (11) ou CNPJ (14)
  const cpfCnpjDigits = String(cpfCnpj).replace(/\D/g, '');
  if (cpfCnpjDigits.length !== 11 && cpfCnpjDigits.length !== 14) {
    return res.status(400).json({ error: 'Informe um CPF ou CNPJ válido.' });
  }

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
        cpfCnpj: cpfCnpjDigits,
        notificationDisabled: false,
      });
      customerId = customer.id;
    } else {
      // Cliente já existe no Asaas — garante que o CPF/CNPJ esteja preenchido
      // (clientes criados antes desta correção podem não ter o campo, o que
      // bloqueia a geração de cobrança com o erro "CPF ou CNPJ do cliente").
      try {
        await asaas.put(`/customers/${customerId}`, { cpfCnpj: cpfCnpjDigits });
      } catch (e) {
        console.warn('Não foi possível atualizar CPF/CNPJ do cliente existente:', e.response?.data || e.message);
      }
    }

    // Criar assinatura
    const today = new Date().toISOString().split('T')[0];
    const { data: subscription } = await asaas.post('/subscriptions', {
      customer:    customerId,
      billingType: 'UNDEFINED',   // Aceita Pix e Cartão
      value:       9.99,
      nextDueDate: today,
      cycle:       'MONTHLY',
      description: 'Plano Controle Financeiro — R$ 9,99/mês',
    });

  // Obter link de pagamento da primeira cobrança
let paymentLink = subscription.invoiceUrl || null;
try {
  const { data: payments } = await asaas.get(`/subscriptions/${subscription.id}/payments`);
  if (payments.data?.[0]?.invoiceUrl) paymentLink = payments.data[0].invoiceUrl;
} catch (e) {
  console.warn('Não foi possível obter cobrança da assinatura:', e.response?.status || e.message);
}

   // ── RISCO-04: Usar upsert (não update) para cobrir o caso em que o
// trigger do Supabase falhou e a linha em subscriptions não existe.
const { data: upsertData, error: upsertError } = await supabase
  .from('subscriptions')
  .upsert({
    user_id: userId,
    asaas_customer_id: customerId,
    asaas_subscription_id: subscription.id,
    status: 'inactive',
    updated_at: new Date().toISOString(),
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
    status: err.response?.status,
    data: err.response?.data,
    url: err.config?.url,
    baseURL: err.config?.baseURL,
    method: err.config?.method,
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

// ─── TRIAL — VERIFICAR E CRIAR ────────────────────────────────────────────────
// Chamado pelo frontend após o primeiro login de um usuário sem assinatura.
// Verifica se o CPF já foi utilizado em outro trial; se não, cria o trial.
// ATENÇÃO: requer migração SQL (trial_registry + coluna cpf em subscriptions).
app.post('/api/trial/init', async (req, res) => {
  const { userId, cpf } = req.body;
  if (!userId || !cpf) return res.status(400).json({ trial: false, error: 'userId e cpf são obrigatórios.' });

  const cpfDigits = String(cpf).replace(/\D/g, '');
  if (cpfDigits.length !== 11) return res.status(400).json({ trial: false, error: 'CPF inválido (deve ter 11 dígitos).' });

  try {
    // 1. Verificar se o CPF já utilizou algum trial
    const { data: registry, error: regErr } = await supabase
      .from('trial_registry')
      .select('cpf')
      .eq('cpf', cpfDigits)
      .maybeSingle();

    if (regErr) {
      // Tabela não existe (migração não rodou) ou outro erro de infra
      console.error('[trial/init] Erro ao consultar trial_registry:', regErr.message);
      console.error('[trial/init] Execute a migração SQL no Supabase antes de usar o trial.');
      return res.status(500).json({ trial: false, error: 'Configuração pendente: execute a migração SQL no Supabase.' });
    }

    if (registry) {
      // CPF já foi utilizado — não conceder novo trial
      console.log('[trial/init] CPF já utilizado em outro trial:', cpfDigits);
      return res.json({ trial: false, reason: 'cpf_already_used' });
    }

    // 2. CPF novo — criar trial de 7 dias
    const start    = new Date();
    const end      = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startStr = start.toISOString().split('T')[0];
    const endStr   = end.toISOString().split('T')[0];

    // 3. Registrar CPF em trial_registry (impede reuso do CPF em novos trials)
    const { error: insertErr } = await supabase
      .from('trial_registry')
      .insert({ cpf: cpfDigits, first_user: userId });

    if (insertErr) {
      console.error('[trial/init] Erro ao inserir trial_registry:', insertErr.message);
      return res.status(500).json({ trial: false, error: 'Erro ao registrar trial.' });
    }

    // 4. Criar/atualizar subscription com status trial (inclui coluna cpf)
    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert({
        user_id:    userId,
        status:     'trial',
        start_date: startStr,
        end_date:   endStr,
        cpf:        cpfDigits,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (subErr) {
      console.error('[trial/init] Erro ao criar subscription trial:', subErr.message);
      // Reverter registro no trial_registry para não bloquear o CPF inutilmente
      await supabase.from('trial_registry').delete().eq('cpf', cpfDigits);
      return res.status(500).json({ trial: false, error: 'Erro ao criar período de teste.' });
    }

    console.log('[trial/init] Trial criado — userId:', userId, '| CPF:', cpfDigits, '| até:', endStr);
    return res.json({ trial: true, endDate: endStr });

  } catch (err) {
    console.error('[trial/init] Erro inesperado:', err.message);
    return res.status(500).json({ trial: false, error: 'Erro interno ao iniciar trial.' });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
