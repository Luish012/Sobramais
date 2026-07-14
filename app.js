'use strict';

// ─── UTILITY ─────────────────────────────────────────────────────────────────
function fmtCurrency(val) {
  return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}
function fmtDateTimeSimple(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
function fmtPayment(method) {
  const map = { pix:'Pix', credito:'Crédito', debito:'Débito', dinheiro:'Dinheiro', transferencia:'Transferência', boleto:'Boleto' };
  return map[method] || method;
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function todayIso() { return new Date().toISOString().split('T')[0]; }

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type ? `show ${type}` : 'show';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 2600);
}

// ─── CONFIRM ─────────────────────────────────────────────────────────────────
let _confirmCb = null;
function confirmDialog(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-overlay').classList.add('open');
  _confirmCb = cb;
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const _today = new Date();
const State = {
  view: 'loading',
  tab: 'overview',
  year: _today.getFullYear(),
  month: _today.getMonth(),
  expFilter: 'all',
  expSubFilter: 'once',
  incFilter: 'all',
  cardSubFilter: 'once',
  editTxId: null,
  editGoalId: null,
  selectedCardId: null,
  editCardId: null,
};

// ─── VIEW MANAGEMENT ─────────────────────────────────────────────────────────
function showView(v) {
  State.view = v;
  const allViews = [
    'view-loading','view-login','view-signup','view-forgot-pw',
    'view-confirm-email','view-reset-pw','view-subscription',
    'view-home','view-dashboard','view-admin',
  ];
  allViews.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('view-' + v);
  if (target) target.style.display = 'flex';

  if (v === 'dashboard') {
    showTab(State.tab || 'overview');
    refreshAll();
  }
  if (v === 'home') {
    renderHomeGreeting();
    renderHomeTrial();
    renderHomeBalance();
    renderHomeAlerts();
  }
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function showTab(t) {
  State.tab = t;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.tab === t));
  refreshTab(t);
}

function refreshAll() {
  updateMonthLabel();
  refreshTab(State.tab);
}
function refreshTab(t) {
  if (t === 'overview')  renderOverview();
  else if (t === 'expenses') renderExpenses();
  else if (t === 'income')   renderIncome();
  else if (t === 'cards')    renderCardTab();
  else if (t === 'goals')    renderGoals();
  else if (t === 'reports')  refreshReports();
}

// ─── MONTH NAVIGATION ────────────────────────────────────────────────────────
function updateMonthLabel() {
  document.getElementById('month-label').textContent = MONTHS_PT[State.month] + '/' + State.year;
}
function prevMonth() {
  if (State.month === 0) { State.month = 11; State.year--; } else State.month--;
  refreshAll();
}
function nextMonth() {
  if (State.month === 11) { State.month = 0; State.year++; } else State.month++;
  refreshAll();
}

// ─── HOME GREETING ───────────────────────────────────────────────────────────
const _FRASES = [
  'Hoje é um ótimo dia para economizar.',
  'Cada real bem cuidado vale muito.',
  'Seu futuro financeiro começa hoje.',
  'Controle hoje. Tranquilidade amanhã.',
  'Pequenos hábitos geram grandes resultados.',
  'Quem controla o dinheiro controla o futuro.',
  'Organização gera liberdade.',
  'Planejar hoje é conquistar amanhã.',
  'Economizar é investir em você.',
  'Grandes resultados começam com pequenas decisões.',
  'Dinheiro controlado é dinheiro multiplicado.',
  'A disciplina financeira é o caminho para a liberdade.',
  'Cuide bem do que você tem e conquiste o que quer.',
  'Um orçamento bem feito é seu maior aliado.',
  'Cada despesa registrada é um passo para o controle.',
  'O segredo das finanças é a consistência.',
  'Conhecer seus gastos é o primeiro passo para prosperar.',
  'Hoje você planta, amanhã você colhe.',
  'Sua riqueza começa na organização do dia a dia.',
  'Pequenas economias de hoje criam grandes sonhos amanhã.',
];

function renderHomeGreeting() {
  const nameEl   = document.getElementById('home-greeting-name');
  const phraseEl = document.getElementById('home-greeting-phrase');
  if (!nameEl) return;

  const hour = new Date().getHours();
  const period = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const fullName   = Auth.currentUser?.user_metadata?.name || '';
  const firstName  = fullName.trim().split(/\s+/)[0] || '';
  nameEl.textContent = firstName ? `${period}, ${firstName} 👋` : 'Olá! 👋';

  if (phraseEl) {
    const frase = _FRASES[Math.floor(Math.random() * _FRASES.length)];
    phraseEl.textContent = frase;
  }
}

// ─── HOME TRIAL BANNER ───────────────────────────────────────────────────────
function renderHomeTrial() {
  const bannerEl = document.getElementById('home-trial-banner');
  if (!bannerEl) return;

  const sub   = Auth.currentSubscription;
  const today = new Date().toISOString().split('T')[0];

  if (sub?.status === 'trial' && sub?.end_date >= today) {
    const end    = new Date(sub.end_date + 'T00:00:00');
    const now    = new Date();
    now.setHours(0,0,0,0);
    const diffMs   = end - now;
    const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const [y,m,d]  = sub.end_date.split('-');
    bannerEl.innerHTML = `🎁 <strong>Teste grátis</strong> · ${diffDays === 0 ? 'Termina hoje' : `Restam ${diffDays} dia${diffDays !== 1 ? 's' : ''}`} (até ${d}/${m}/${y})`;
    bannerEl.style.display = '';
  } else {
    bannerEl.style.display = 'none';
  }
}

// ─── HOME ALERTS ─────────────────────────────────────────────────────────────
function renderHomeAlerts() {
  const alertsEl = document.getElementById('home-alerts');
  if (!alertsEl) return;

  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();

  // Lembretes individuais — excluir compras de crédito (pertencem à fatura)
  const txReminders = Finance.getReminders()
    .filter(r => r.tx.paymentMethod !== 'credito');

  // Faturas de cartão próximas do vencimento — uma linha por cartão
  const allCards = Storage.getCards();
  const cardsToCheck = allCards.length > 0 ? allCards : [DEFAULT_CARD];
  const cardAlerts = cardsToCheck.map(card => {
    const invoice = Finance.getCardInvoice(y, m, card);
    if (invoice.total <= 0 || invoice.allPaid) return null;
    const maxDay    = new Date(y, m + 1, 0).getDate();
    const invDay    = Math.min(card.dueDay, maxDay);
    const dueDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(invDay).padStart(2, '0')}`;
    const status    = getDueStatus(dueDateStr);
    if (!['overdue', 'today', 'tomorrow'].includes(status)) return null;
    return { card, invoice, status, dueDateStr };
  }).filter(Boolean).sort((a, b) => a.dueDateStr > b.dueDateStr ? 1 : -1);

  if (txReminders.length === 0 && cardAlerts.length === 0) {
    alertsEl.style.display = 'none';
    return;
  }

  alertsEl.style.display = '';

  const labelFor = s => s === 'overdue' ? 'Vencida' : s === 'today' ? 'Vence hoje' : 'Vence amanhã';
  const dotFor   = s => s === 'overdue' ? 'var(--destructive)' : s === 'today' ? 'hsl(38,92%,50%)' : 'hsl(38,80%,60%)';

  const cardRows = cardAlerts.map(({ card, invoice, status }) => {
    const count = invoice.transactions.length;
    return `<div class="reminder-row">
        <span style="width:8px;height:8px;border-radius:50%;background:${dotFor(status)};flex-shrink:0;display:inline-block"></span>
        <span class="reminder-text">💳 ${esc(card.name)} <span style="font-size:0.72rem;color:var(--muted-fg);font-weight:400">(${count} compra${count !== 1 ? 's' : ''})</span></span>
        <span style="font-size:0.78rem;color:var(--muted-fg)">${labelFor(status)}</span>
        <span class="reminder-amount">${fmtCurrency(invoice.total)}</span>
      </div>`;
  }).join('');

  const txRows = txReminders.slice(0, 5).map(r => {
    return `<div class="reminder-row">
        <span style="width:8px;height:8px;border-radius:50%;background:${dotFor(r.status)};flex-shrink:0;display:inline-block"></span>
        <span class="reminder-text">${esc(r.tx.description)}</span>
        <span style="font-size:0.78rem;color:var(--muted-fg)">${labelFor(r.status)}</span>
        <span class="reminder-amount">${fmtCurrency(r.tx.amount)}</span>
      </div>`;
  }).join('');

  alertsEl.innerHTML =
    `<div style="font-size:0.8rem;font-weight:600;color:hsl(38,70%,40%);margin-bottom:0.5rem;letter-spacing:0.04em;text-transform:uppercase">⚠ Atenção</div>` +
    cardRows + txRows;
}

// ─── HOME BALANCE ─────────────────────────────────────────────────────────────
function renderHomeBalance() {
  const balEl = document.getElementById('home-balance-card');
  if (!balEl) return;
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const saldo   = Finance.calcSaldoDisponivel(y, m);
  const previsao = Finance.calcPrevisao(y, m);
  const saldoEl  = document.getElementById('home-saldo-amount');
  const prevEl   = document.getElementById('home-previsao-amount');
  if (saldoEl) {
    saldoEl.textContent = fmtCurrency(saldo);
    saldoEl.style.color = saldo   >= 0 ? 'var(--success)' : 'var(--destructive)';
  }
  if (prevEl) {
    prevEl.textContent = fmtCurrency(previsao);
    prevEl.style.color = previsao >= 0 ? 'var(--success)' : 'var(--destructive)';
  }
  balEl.style.display = '';
  renderHomeCashFlow();
}

// ─── CASH FLOW FORECAST (compartilhado: Início + Painel Financeiro › Visão Geral) ──
// Uma única função de renderização usada pelas duas telas, ambas consumindo
// exatamente Finance.calcCashFlowForecast(year, month) — a mesma função e
// regra de cálculo, sem duplicação de lógica entre as telas.
function buildCashFlowCardHtml(cf) {
  const ds = str => {
    if (!str) return '';
    const [, mm, dd] = str.split('-');
    return `${dd}/${mm}`;
  };

  const periodMsg = cf.firstNegativeDate
    ? (cf.recoveredDate
        ? `Seu saldo pode ficar negativo entre ${ds(cf.firstNegativeDate)} e ${ds(cf.recoveredDate)}.`
        : `Seu saldo pode ficar negativo a partir de ${ds(cf.firstNegativeDate)}.`)
    : 'Risco de saldo negativo detectado.';

  const detailRows = cf.events.map(ev => {
    const amtColor = ev.amount >= 0 ? 'var(--success)' : 'var(--destructive)';
    const balColor = ev.balanceAfter >= 0 ? 'var(--success)' : 'var(--destructive)';
    const sign     = ev.amount >= 0 ? '+' : '−';
    const absAmt   = fmtCurrency(Math.abs(ev.amount));
    return `<div style="padding:0.55rem 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem">
        <span style="font-size:0.82rem;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.label)}</span>
        <span style="font-size:0.84rem;font-weight:600;color:${amtColor};white-space:nowrap">${sign} ${absAmt}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:0.1rem">
        <span style="font-size:0.71rem;color:var(--muted-fg)">${ds(ev.date)}</span>
        <span style="font-size:0.71rem;color:${balColor}">Saldo: ${fmtCurrency(ev.balanceAfter)}</span>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="cashflow-toggle" style="display:flex;justify-content:space-between;align-items:flex-start;cursor:pointer;gap:0.5rem">
      <div style="flex:1;min-width:0">
        <div style="font-size:0.78rem;font-weight:700;color:var(--destructive);letter-spacing:0.04em;text-transform:uppercase">⚠ Risco de Saldo Negativo</div>
        <div style="font-size:0.76rem;color:var(--muted-fg);margin-top:0.2rem">${periodMsg}</div>
      </div>
      <span class="cashflow-chevron" style="font-size:1rem;color:var(--muted-fg);transition:transform 0.2s;flex-shrink:0;margin-top:0.1rem">▾</span>
    </div>
    <div style="display:flex;gap:1.5rem;margin-top:0.6rem">
      <div>
        <div style="font-size:0.64rem;font-weight:600;text-transform:uppercase;color:var(--muted-fg)">Menor saldo</div>
        <div style="font-size:1rem;font-weight:700;color:var(--destructive)">${fmtCurrency(cf.minBalance)}</div>
      </div>
      ${cf.minDate ? `<div>
        <div style="font-size:0.64rem;font-weight:600;text-transform:uppercase;color:var(--muted-fg)">Data crítica</div>
        <div style="font-size:1rem;font-weight:700;color:var(--destructive)">${ds(cf.minDate)}</div>
      </div>` : ''}
    </div>
    <div class="cashflow-detail" style="display:none;margin-top:0.75rem">
      <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted-fg);margin-bottom:0.3rem">Fluxo Previsto</div>
      <div style="max-height:300px;overflow-y:auto">${detailRows}</div>
    </div>`;
}

// Renderiza (ou esconde) o card de fluxo previsto dentro de `cfEl` para o
// (year, month) informado. Usado tanto pela tela inicial quanto pela Visão
// Geral — cada uma passa o mês que faz sentido para ela, mas ambas chamam
// exatamente a mesma Finance.calcCashFlowForecast.
function renderCashFlowCard(cfEl, year, month) {
  if (!cfEl) return;

  const cf = Finance.calcCashFlowForecast(year, month);

  if (!cf.hasNegativePeriod) {
    cfEl.style.display = 'none';
    cfEl.innerHTML = '';
    return;
  }

  cfEl.style.display = '';
  cfEl.innerHTML = buildCashFlowCardHtml(cf);

  const toggleEl = cfEl.querySelector('.cashflow-toggle');
  if (toggleEl) toggleEl.addEventListener('click', () => toggleCashFlowCard(cfEl));
}

function toggleCashFlowCard(cfEl) {
  const detail  = cfEl.querySelector('.cashflow-detail');
  const chevron = cfEl.querySelector('.cashflow-chevron');
  if (!detail) return;
  const open = detail.style.display === 'none';
  detail.style.display = open ? '' : 'none';
  if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
}

// ─── HOME CASH FLOW FORECAST ──────────────────────────────────────────────────
function renderHomeCashFlow() {
  const cfEl = document.getElementById('home-cashflow');
  if (!cfEl) return;

  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();

  // Apenas para o mês vigente (comportamento original mantido)
  if (State.year !== y || State.month !== m) {
    cfEl.style.display = 'none';
    return;
  }

  renderCashFlowCard(cfEl, y, m);
}

// ─── VISÃO GERAL CASH FLOW FORECAST ───────────────────────────────────────────
// Mesmo card e mesma função de cálculo da tela inicial, mas acompanhando o
// mês selecionado no Painel Financeiro (State.year / State.month).
function renderOverviewCashFlow() {
  const cfEl = document.getElementById('overview-cashflow');
  renderCashFlowCard(cfEl, State.year, State.month);
}

// ─── OVERVIEW TAB ────────────────────────────────────────────────────────────
function renderOverview() {
  const sum     = Finance.calcSummary(State.year, State.month);
  const previsao = Finance.calcPrevisao(State.year, State.month);
  const reminders = Finance.getReminders();

  const today = new Date();
  const isCurrentMonth = State.year === today.getFullYear() && State.month === today.getMonth();
  const saldoSection = document.getElementById('saldo-section');
  if (isCurrentMonth && saldoSection) {
    const saldo = Finance.calcSaldoDisponivel(State.year, State.month);
    const saldoEl = document.getElementById('saldo-amount');
    saldoEl.textContent = fmtCurrency(saldo);
    saldoEl.className = 'balance-amount ' + (saldo >= 0 ? 'positive' : 'negative');
    saldoSection.style.display = '';
  } else if (saldoSection) {
    saldoSection.style.display = 'none';
  }

  const balEl = document.getElementById('balance-amount');
  balEl.textContent = fmtCurrency(previsao);
  balEl.className = 'balance-amount ' + (previsao >= 0 ? 'positive' : 'negative');
  document.getElementById('balance-sub').textContent =
    'Entradas ' + fmtCurrency(sum.totalIncome) + ' · Saídas ' + fmtCurrency(sum.totalExpenses);

  document.getElementById('sum-income').textContent   = fmtCurrency(sum.totalIncome);
  document.getElementById('sum-expenses').textContent = fmtCurrency(sum.totalExpenses);
  document.getElementById('sum-paid').textContent     = fmtCurrency(sum.totalPaid);
  document.getElementById('sum-pending').textContent  = fmtCurrency(sum.totalPending);

  renderOverviewCashFlow();

  const reminderEl = document.getElementById('reminders-section');
  if (reminders.length === 0) {
    reminderEl.style.display = 'none';
  } else {
    reminderEl.style.display = '';
    document.getElementById('reminders-list').innerHTML = reminders.slice(0, 5).map(r => {
      const label = r.status === 'overdue' ? 'Vencida' : r.status === 'today' ? 'Vence hoje' : 'Vence amanhã';
      return `<div class="reminder-row">
        <span class="reminder-dot ${r.status}"></span>
        <span class="reminder-text">${esc(r.tx.description)}</span>
        <span style="font-size:0.78rem;color:var(--muted-fg)">${label}</span>
        <span class="reminder-amount">${fmtCurrency(r.tx.amount)}</span>
      </div>`;
    }).join('');
  }

  renderQuickList();
}

function renderQuickList() {
  const quick = Storage.getQuickExpenses()
    .filter(q => {
      if (q.paymentMethod === 'credito') return false;
      const d = new Date(q.date + 'T00:00:00');
      return d.getFullYear() === State.year && d.getMonth() === State.month;
    })
    .slice(0, 50);
  const el = document.getElementById('quick-list');
  if (!el) return;
  if (quick.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:var(--muted-fg);font-size:0.875rem;padding:1.5rem 0">Nenhum gasto rápido neste mês.<br>Use o botão acima para lançar.</p>';
    return;
  }
  el.innerHTML = quick.map(q => `
    <div class="quick-row">
      <div class="quick-info">
        <div class="quick-desc">${esc(q.description)}</div>
        <div class="quick-meta">${fmtDate(q.date)} · ${fmtPayment(q.paymentMethod)}</div>
      </div>
      <div class="quick-right">
        <span class="quick-amount">${fmtCurrency(q.amount)}</span>
        <button class="btn-icon" onclick="deleteQuick('${q.id}')" title="Excluir">✕</button>
      </div>
    </div>`).join('');
}

// ─── EXPENSES TAB ────────────────────────────────────────────────────────────
function quickExpenseRow(q) {
  return `<div class="tx-row is-paid">
    <div class="tx-header-row">
      <div class="tx-icon paid">✓</div>
      <div class="tx-desc">${esc(q.description)}</div>
      <div class="tx-amount paid">${fmtCurrency(Number(q.amount))}</div>
    </div>
    <div class="tx-date-line">${fmtDate(q.date)} · ${fmtPayment(q.paymentMethod)}</div>
    <div class="tx-badges"><span class="tag">Avulso</span></div>
    <div class="tx-actions">
      <button class="btn-icon" onclick="deleteQuick('${q.id}')" title="Excluir">✕</button>
    </div>
  </div>`;
}

function renderExpenses() {
  let txs = Finance.getByCompetency(State.year, State.month, 'expense');

  txs = txs.filter(t => t.paymentMethod !== 'credito');

  if (State.expSubFilter === 'once')             txs = txs.filter(t => t.subtype === 'once');
  else if (State.expSubFilter === 'installment') txs = txs.filter(t => t.subtype === 'installment');
  else if (State.expSubFilter === 'recurring')   txs = txs.filter(t => t.subtype === 'recurring');

  if (State.expFilter === 'pending') txs = txs.filter(t => !t.paid && getDueStatus(t.dueDate) !== 'overdue');
  else if (State.expFilter === 'paid')  txs = txs.filter(t => t.paid);
  else if (State.expFilter === 'late')  txs = txs.filter(t => !t.paid && getDueStatus(t.dueDate) === 'overdue');

  let quickRows = '';
  if (State.expSubFilter === 'once' || State.expSubFilter === 'all') {
    const quickItems = Storage.getQuickExpenses()
      .filter(q => {
        if (q.paymentMethod === 'credito') return false;
        const d = new Date(q.date + 'T00:00:00');
        return d.getFullYear() === State.year && d.getMonth() === State.month;
      });

    const statusFilter = State.expFilter;
    const filteredQuick = statusFilter === 'pending' || statusFilter === 'late'
      ? []
      : quickItems;

    filteredQuick.sort((a, b) => {
      const da = a.createdAt || a.date || '';
      const db = b.createdAt || b.date || '';
      return db > da ? 1 : -1;
    });

    quickRows = filteredQuick.map(q => quickExpenseRow(q)).join('');
  }

  txs.sort((a, b) => {
    const da = a.createdAt || a.dueDate || '';
    const db = b.createdAt || b.dueDate || '';
    return db > da ? 1 : -1;
  });

  const allTxs = Finance.getByCompetency(State.year, State.month, 'expense')
    .filter(t => t.paymentMethod !== 'credito');
  const allQuick = Storage.getQuickExpenses().filter(q => {
    if (q.paymentMethod === 'credito') return false;
    const d = new Date(q.date + 'T00:00:00');
    return d.getFullYear() === State.year && d.getMonth() === State.month;
  });
  const totalAll  = allTxs.reduce((s, t) => s + t.amount, 0)
                  + allQuick.reduce((s, q) => s + Number(q.amount), 0);
  const totalPaid = allTxs.filter(t => t.paid).reduce((s, t) => s + t.amount, 0)
                  + allQuick.reduce((s, q) => s + Number(q.amount), 0);
  const totalPend = allTxs.filter(t => !t.paid).reduce((s, t) => s + t.amount, 0);

  document.getElementById('exp-total').textContent  = fmtCurrency(totalAll);
  document.getElementById('exp-paid2').textContent  = fmtCurrency(totalPaid);
  document.getElementById('exp-pend2').textContent  = fmtCurrency(totalPend);

  const txsHtml = txs.map(t => txRow(t)).join('');
  const combined = txsHtml + quickRows;

  document.getElementById('expenses-list').innerHTML = combined.length === 0
    ? emptyState('🧾', 'Nenhuma despesa', 'Sem despesas para este período.')
    : combined;
}

// ─── INCOME TAB ──────────────────────────────────────────────────────────────
function renderIncome() {
  let txs = Finance.getByCompetency(State.year, State.month, 'income');
  if (State.incFilter === 'received') txs = txs.filter(t => t.paid);
  else if (State.incFilter === 'pending') txs = txs.filter(t => !t.paid);
  txs.sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);

  const all = Finance.getByCompetency(State.year, State.month, 'income');
  document.getElementById('inc-total').textContent    = fmtCurrency(all.reduce((s, t) => s + t.amount, 0));
  document.getElementById('inc-received').textContent = fmtCurrency(all.filter(t => t.paid).reduce((s, t) => s + t.amount, 0));

  document.getElementById('income-list').innerHTML = txs.length === 0
    ? emptyState('💰', 'Nenhuma entrada', 'Sem entradas para este período.')
    : txs.map(t => txRow(t)).join('');
}

// ─── CARTÕES — HELPERS ────────────────────────────────────────────────────────

// Retorna o cartão selecionado (ou cria o padrão se não houver nenhum).
function getSelectedCard() {
  let cards = Storage.getCards();

  // Garantir que existe pelo menos um cartão
  if (!cards || cards.length === 0) {
    const defaultCard = { id: 'default', name: 'Cartão de crédito', closingDay: 30, dueDay: 8 };
    Storage.setCards([defaultCard]);
    cards = [defaultCard];
    State.selectedCardId = 'default';
    Storage._set('SELECTED_CARD_ID', 'default');
    return defaultCard;
  }

  // Verificar se o selectedCardId ainda é válido
  if (State.selectedCardId) {
    const found = cards.find(c => c.id === State.selectedCardId);
    if (found) return found;
  }

  // Tentar preferência persistida
  const storedId = Storage._get('SELECTED_CARD_ID', null);
  if (storedId) {
    const found = cards.find(c => c.id === storedId);
    if (found) {
      State.selectedCardId = storedId;
      return found;
    }
  }

  // Fallback: primeiro da lista
  State.selectedCardId = cards[0].id;
  Storage._set('SELECTED_CARD_ID', cards[0].id);
  return cards[0];
}

// ─── CARD TAB ────────────────────────────────────────────────────────────────
function renderCardTab() {
  let cards = Storage.getCards();

  // Criar cartão padrão automaticamente se não existir nenhum
  if (!cards || cards.length === 0) {
    cards = [{ id: 'default', name: 'Cartão de crédito', closingDay: 30, dueDay: 8 }];
    Storage.setCards(cards);
  }

  // Selecionar cartão
  if (!State.selectedCardId || !cards.find(c => c.id === State.selectedCardId)) {
    const storedId = Storage._get('SELECTED_CARD_ID', null);
    State.selectedCardId = (storedId && cards.find(c => c.id === storedId)) ? storedId : cards[0].id;
    Storage._set('SELECTED_CARD_ID', State.selectedCardId);
  }
  const selectedCard = cards.find(c => c.id === State.selectedCardId) || cards[0];

  // Popular seletor de cartão
  const selectorEl = document.getElementById('card-selector');
  if (selectorEl) {
    selectorEl.innerHTML = cards.map(c =>
      `<option value="${esc(c.id)}"${c.id === State.selectedCardId ? ' selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  }

  // Mostrar/ocultar botão de editar (só mostra quando há cartão selecionado)
  const editBtn = document.getElementById('btn-edit-card');
  if (editBtn) editBtn.style.display = cards.length > 0 ? '' : 'none';

  const inv = Finance.getCardInvoice(State.year, State.month, selectedCard);
  document.getElementById('card-month-label').textContent = inv.title;
  document.getElementById('card-total').textContent = fmtCurrency(inv.total);
  const dueLabelEl = document.getElementById('card-due-label');
  if (dueLabelEl) dueLabelEl.textContent = inv.dueLabel;

  const statusEl   = document.getElementById('card-invoice-status');
  const paySection = document.getElementById('card-pay-section');
  if (inv.transactions.length === 0) {
    statusEl.textContent = 'Nenhuma compra nesta fatura';
    paySection.style.display = 'none';
  } else if (inv.allPaid) {
    statusEl.textContent = '✓ Fatura paga · ' + inv.dueLabel;
    paySection.style.display = 'none';
  } else {
    statusEl.textContent = 'Pendente · ' + inv.dueLabel;
    paySection.style.display = '';
  }

  // Filtro de subtipo
  let txs = [...inv.transactions];
  if (State.cardSubFilter === 'once')            txs = txs.filter(t => t.subtype === 'once');
  else if (State.cardSubFilter === 'installment') txs = txs.filter(t => t.subtype === 'installment');
  else if (State.cardSubFilter === 'recurring')   txs = txs.filter(t => t.subtype === 'recurring');

  // Ordenar: mais recente primeiro
  txs.sort((a, b) => {
    const da = a.createdAt || a.purchaseDate || a.dueDate || '';
    const db = b.createdAt || b.purchaseDate || b.dueDate || '';
    return db > da ? 1 : -1;
  });

  const listEl = document.getElementById('card-invoice-list');
  listEl.innerHTML = txs.length === 0
    ? emptyState('💳', 'Fatura vazia', 'Compras nesta categoria aparecerão aqui.')
    : txs.map(t => txRow(t, t.purchaseDate ? fmtDate(t.purchaseDate) : null)).join('');
}

function selectCard(id) {
  State.selectedCardId = id;
  Storage._set('SELECTED_CARD_ID', id);
  renderCardTab();
}

// ─── CARD MODAL ──────────────────────────────────────────────────────────────
function openAddCard() {
  State.editCardId = null;
  document.getElementById('card-form').reset();
  document.getElementById('card-closing-day').value = 30;
  document.getElementById('card-due-day').value = 8;
  document.getElementById('card-modal-title').textContent = 'Novo Cartão';
  const delBtn = document.getElementById('btn-delete-card');
  if (delBtn) delBtn.style.display = 'none';
  openModal('card-modal');
}

function openEditCard() {
  const card = getSelectedCard();
  if (!card) return;
  State.editCardId = card.id;
  document.getElementById('card-modal-title').textContent = 'Editar Cartão';
  document.getElementById('card-name').value        = card.name;
  document.getElementById('card-closing-day').value = card.closingDay || 30;
  document.getElementById('card-due-day').value     = card.dueDay || 8;
  const delBtn = document.getElementById('btn-delete-card');
  if (delBtn) {
    const cards = Storage.getCards();
    delBtn.style.display = cards.length > 1 ? '' : 'none';
  }
  openModal('card-modal');
}

function saveCardForm() {
  const name       = document.getElementById('card-name').value.trim();
  const closingDay = parseInt(document.getElementById('card-closing-day').value, 10);
  const dueDay     = parseInt(document.getElementById('card-due-day').value, 10);

  if (!name)                           { showToast('Informe o nome do cartão', 'error'); return; }
  if (!closingDay || closingDay < 1 || closingDay > 31) { showToast('Dia de fechamento inválido (1–31)', 'error'); return; }
  if (!dueDay     || dueDay < 1     || dueDay > 31)     { showToast('Dia de vencimento inválido (1–31)', 'error'); return; }

  let cards = Storage.getCards();
  if (!cards || cards.length === 0) cards = [];

  if (State.editCardId) {
    const idx = cards.findIndex(c => c.id === State.editCardId);
    if (idx !== -1) {
      cards[idx] = { ...cards[idx], name, closingDay, dueDay };
    }
    showToast('Cartão atualizado', 'success');
  } else {
    const newCard = { id: genId(), name, closingDay, dueDay, createdAt: new Date().toISOString() };
    cards.push(newCard);
    State.selectedCardId = newCard.id;
    Storage._set('SELECTED_CARD_ID', newCard.id);
    showToast('Cartão criado', 'success');
  }

  Storage.setCards(cards);
  closeModal('card-modal');
  renderCardTab();
}

function deleteCurrentCard() {
  const cards = Storage.getCards();
  if (!cards || cards.length <= 1) {
    showToast('Não é possível excluir o único cartão', 'error');
    return;
  }
  confirmDialog('Excluir este cartão? As compras associadas permanecem salvas.', () => {
    const newCards = cards.filter(c => c.id !== State.editCardId);
    Storage.setCards(newCards);
    State.selectedCardId = newCards[0].id;
    Storage._set('SELECTED_CARD_ID', newCards[0].id);
    closeModal('card-modal');
    showToast('Cartão excluído', 'success');
    renderCardTab();
  });
}

// ─── GOALS TAB ───────────────────────────────────────────────────────────────
const GOAL_PRIORITY_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const GOAL_PRIORITY_TAG   = { alta: 'tag-red', media: 'tag-gold', baixa: 'tag-blue' };

function renderGoals() {
  const goals = Finance.getActiveGoals();
  const el = document.getElementById('goals-list');
  if (goals.length === 0) {
    el.innerHTML = emptyState('🎯', 'Nenhuma meta', 'Defina objetivos para guardar dinheiro.');
    return;
  }
  el.innerHTML = `<div class="goals-grid">` + goals.map(g => goalCardHtml(g)).join('') + `</div>`;
}

function goalCardHtml(g) {
  const pct = g.target > 0 ? Math.min(100, Math.round((Number(g.saved) / Number(g.target)) * 100)) : 0;
  const remaining = Math.max(0, g.target - g.saved);
  const isCompleted = g.status === 'completed' || remaining <= 0;
  const isPaused = g.status === 'paused';

  let prazoLine;
  if (isCompleted) {
    prazoLine = `<div class="goal-deadline">Meta alcançada</div>`;
  } else if (g.monthlyContribution > 0) {
    const months = Finance.goalMonthsNeeded(g);
    const compl  = Finance.goalEstimatedCompletion(g);
    prazoLine = `<div class="goal-deadline">Restante: ${fmtCurrency(remaining)} · Prazo: ${months} ${months === 1 ? 'mês' : 'meses'} · Conclusão: ${compl.label}</div>`;
  } else if (g.deadline) {
    const now = new Date(), dl = new Date(g.deadline);
    const months = Math.max(1, (dl.getFullYear() - now.getFullYear()) * 12 + (dl.getMonth() - now.getMonth()));
    const monthlyEst = Math.ceil(remaining / months);
    prazoLine = `<div class="goal-deadline">Prazo: ${fmtDate(g.deadline)} · ~${fmtCurrency(monthlyEst)}/mês</div>`;
  } else {
    prazoLine = `<div class="goal-deadline">Sem aporte programado</div>`;
  }

  const priorityTag = `<span class="tag ${GOAL_PRIORITY_TAG[g.priority] || 'tag-gold'}">${GOAL_PRIORITY_LABEL[g.priority] || 'Média'}</span>`;
  const pausedTag = isPaused ? ' <span class="tag tag-blue">Pausado</span>' : '';

  const pauseResumeBtn = (!isCompleted && g.monthlyContribution > 0)
    ? (isPaused
        ? `<button class="btn btn-outline btn-sm form-btn-full" onclick="doResumeGoal('${g.id}')">▶ Retomar aporte</button>`
        : `<button class="btn btn-outline btn-sm form-btn-full" onclick="doPauseGoal('${g.id}')">⏸ Pausar aporte</button>`)
    : '';

  const historyBlock = g.history.length > 0 ? `
    <div class="goal-history-toggle" onclick="toggleGoalHistory('${g.id}')" style="font-size:0.78rem;color:var(--muted-fg);cursor:pointer;margin-top:0.5rem;text-align:center">Ver histórico (${g.history.length}) ▾</div>
    <div id="goal-history-${g.id}" style="display:none;margin-top:0.5rem;max-height:220px;overflow-y:auto">
      ${g.history.map(h => `
        <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem">
          <div>
            <div>${fmtDate(h.date)}</div>
            <div style="color:var(--muted-fg);font-size:0.72rem">${h.origin === 'manual' ? 'Aporte manual' : 'Aporte programado'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:600">${fmtCurrency(h.amount)}</div>
            <div style="color:var(--muted-fg);font-size:0.72rem">Total: ${fmtCurrency(h.accumulated)}</div>
          </div>
        </div>`).join('')}
    </div>` : '';

  return `<div class="goal-card${isCompleted ? ' goal-completed' : ''}">
    <div class="goal-top">
      <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0">
        <div class="goal-emoji-wrap">${esc(g.emoji || '🎯')}</div>
        <div class="goal-name-wrap">
          <div class="goal-name">${esc(g.name)}</div>
          <div class="goal-pct-label">${pct}% concluído ${priorityTag}${pausedTag}</div>
        </div>
      </div>
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" onclick="openEditGoal('${g.id}')" title="Editar">✏</button>
        <button class="btn-icon" onclick="doDeleteGoal('${g.id}')" title="Excluir">✕</button>
      </div>
    </div>
    <div class="goal-amounts">
      <span class="goal-saved">${fmtCurrency(g.saved)}</span>
      <span class="goal-target">de ${fmtCurrency(g.target)}</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    ${g.monthlyContribution > 0 ? `<div class="goal-deadline">Aporte mensal: ${fmtCurrency(g.monthlyContribution)} · dia ${g.contributionDay}</div>` : ''}
    ${prazoLine}
    ${isCompleted ? `<div class="goal-celebrate">🎉 Meta alcançada! Você juntou ${fmtCurrency(g.saved)} para ${esc(g.name)}.</div>` : ''}
    ${!isCompleted ? `<button class="btn btn-outline form-btn-full" onclick="openAddToGoal('${g.id}')">Guardar Dinheiro</button>` : ''}
    ${pauseResumeBtn ? `<div style="margin-top:0.5rem">${pauseResumeBtn}</div>` : ''}
    ${historyBlock}
  </div>`;
}

function toggleGoalHistory(id) {
  const el = document.getElementById('goal-history-' + id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

function doPauseGoal(id) {
  confirmDialog('Pausar o aporte programado desta meta? Nenhum novo compromisso será gerado até você retomar.', () => {
    Finance.pauseGoal(id);
    showToast('Aporte pausado', 'success');
    renderGoals();
  });
}

function doResumeGoal(id) {
  Finance.resumeGoal(id);
  showToast('Aporte retomado a partir do próximo mês', 'success');
  renderGoals();
}

// ─── TX ROW RENDERER ─────────────────────────────────────────────────────────
function txRow(t, dateOverride) {
  const isPaid   = t.paid;
  const status   = getDueStatus(t.dueDate);
  const isLate   = !isPaid && status === 'overdue';
  const isIncome = t.type === 'income';

  const iconClass = isIncome ? 'income' : isPaid ? 'paid' : isLate ? 'late' : 'pending';
  const iconEmoji = isIncome ? (isPaid ? '✓' : '↓') : isPaid ? '✓' : isLate ? '!' : '○';

  const badges = [];
  if (t.subtype === 'recurring')   badges.push('<span class="tag tag-blue">Recorrente</span>');
  if (t.subtype === 'installment') badges.push(`<span class="tag tag-purple">Parcela ${t.installmentCurrent}/${t.installmentTotal}</span>`);
  if (t.paymentMethod === 'credito') badges.push('<span class="tag tag-gold">💳 Crédito</span>');

  const dateDisplay = dateOverride || fmtDate(t.dueDate);
  const payBtn = isIncome
    ? (isPaid ? `<button class="btn-undo" onclick="toggleTx('${t.id}')">Desfazer</button>`
              : `<button class="btn-pay income-pay" onclick="toggleTx('${t.id}')">Receber</button>`)
    : (isPaid ? `<button class="btn-undo" onclick="toggleTx('${t.id}')">Desfazer</button>`
              : `<button class="btn-pay" onclick="toggleTx('${t.id}')">Pagar</button>`);

  return `<div class="tx-row${isPaid ? ' is-paid' : ''}${isLate ? ' is-late' : ''}">
    <div class="tx-header-row">
      <div class="tx-icon ${iconClass}">${iconEmoji}</div>
      <div class="tx-desc">${esc(t.description)}</div>
      <div class="tx-amount${isIncome ? ' income' : isPaid ? ' paid' : ''}">
        ${isIncome ? '+' : ''}${fmtCurrency(t.amount)}
      </div>
    </div>
    ${t.category ? `<div class="tx-cat">${esc(t.category)}</div>` : ''}
    <div class="tx-date-line">${dateDisplay}</div>
    ${badges.length > 0 ? `<div class="tx-badges">${badges.join('')}</div>` : ''}
    <div class="tx-actions">
      ${payBtn}
      <button class="btn-icon" onclick="openEditTx('${t.id}')" title="Editar">✏</button>
      <button class="btn-icon" onclick="doDeleteTx('${t.id}')" title="Excluir">✕</button>
    </div>
  </div>`;
}

function emptyState(emoji, title, sub) {
  return `<div class="empty-state">
    <div class="empty-icon">${emoji}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-sub">${sub}</div>
  </div>`;
}

// ─── ACTIONS ─────────────────────────────────────────────────────────────────
function toggleTx(id) { Finance.togglePaid(id); refreshAll(); }
function doDeleteTx(id) {
  if (id.startsWith('virtual_')) { showToast('Edite o lançamento original para parar a recorrência.', 'error'); return; }
  confirmDialog('Excluir este lançamento?', () => { Finance.deleteTransaction(id); showToast('Excluído'); refreshAll(); });
}
function doDeleteGoal(id) {
  confirmDialog('Excluir esta meta? Os aportes já realizados continuam no seu histórico financeiro; apenas os aportes futuros serão cancelados.', () => {
    Finance.deleteGoal(id);
    showToast('Meta excluída', 'success');
    renderGoals();
  });
}
function deleteQuick(id) {
  Finance.deleteQuickExpense(id);
  showToast('Gasto excluído');
  renderQuickList();
  renderOverview();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════════════════════
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── TX FORM ─────────────────────────────────────────────────────────────────
let _txType = 'expense';

function openAddTx(type) {
  _txType = type || 'expense';
  State.editTxId = null;
  _populateTxCardSelect(null);
  resetTxForm();
  document.getElementById('tx-modal-title').textContent = _txType === 'income' ? 'Nova Entrada' : 'Nova Despesa';
  openModal('tx-modal');
}

function openEditTx(id) {
  if (id.startsWith('virtual_')) { showToast('Para editar, use o lançamento original.', 'error'); return; }
  const tx = Storage.getTransactions().find(t => t.id === id);
  if (!tx) return;
  State.editTxId = id;
  _txType = tx.type;
  document.getElementById('tx-modal-title').textContent = _txType === 'income' ? 'Editar Entrada' : 'Editar Despesa';
  populateCategoryOptions(_txType);
  document.getElementById('tx-desc').value     = tx.description;
  document.getElementById('tx-amount').value   = tx.amount;
  document.getElementById('tx-duedate').value  = (tx.paymentMethod === 'credito' && tx.purchaseDate) ? tx.purchaseDate : tx.dueDate;
  document.getElementById('tx-category').value = tx.category;
  document.getElementById('tx-payment').value  = tx.paymentMethod;
  document.getElementById('tx-subtype').value  = tx.subtype;
  document.getElementById('tx-installments').value = tx.installmentTotal || 1;
  document.getElementById('tx-paid').checked   = tx.paid;
  // Pré-seleciona o cartão da transação no seletor do modal
  _populateTxCardSelect(tx.cardId || null);
  updateSubtypeSection();
  updateInvoicePreview();
  openModal('tx-modal');
}

function resetTxForm() {
  document.getElementById('tx-form').reset();
  document.getElementById('tx-duedate').value = todayIso();
  populateCategoryOptions(_txType);
  updateSubtypeSection();
  updateInvoicePreview();
}

function populateCategoryOptions(type) {
  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  document.getElementById('tx-category').innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function updateSubtypeSection() {
  document.getElementById('tx-installments-section').style.display =
    document.getElementById('tx-subtype').value === 'installment' ? '' : 'none';
}

// Retorna o cartão escolhido NO SELETOR DO MODAL de transação.
// Fallback para getSelectedCard() se o seletor não existir ou estiver vazio.
function _getTxCard() {
  const sel   = document.getElementById('tx-card-select');
  const selId = sel?.value;
  if (selId) {
    const found = Storage.getCards().find(c => c.id === selId);
    if (found) return found;
  }
  return getSelectedCard();
}

// Popula o <select id="tx-card-select"> e pré-seleciona o card indicado.
function _populateTxCardSelect(selectedId) {
  const sel = document.getElementById('tx-card-select');
  if (!sel) return;
  const cards = Storage.getCards();
  const list  = cards.length > 0 ? cards : [DEFAULT_CARD];
  const defId = selectedId || getSelectedCard().id;
  sel.innerHTML = list
    .map(c => `<option value="${esc(c.id)}"${c.id === defId ? ' selected' : ''}>${esc(c.name)}</option>`)
    .join('');
}

function updateInvoicePreview() {
  const payment   = document.getElementById('tx-payment').value;
  const dateVal   = document.getElementById('tx-duedate').value;
  const labelEl   = document.getElementById('tx-date-label');
  const previewEl = document.getElementById('tx-invoice-preview');
  const cardRow   = document.getElementById('tx-card-row');
  if (!labelEl || !previewEl) return;
  if (payment === 'credito') {
    if (cardRow) cardRow.style.display = '';
    labelEl.textContent = 'Data da compra';
    if (dateVal) {
      const card = _getTxCard();
      const info = getInvoiceForPurchase(dateVal, card);
      const lbl  = invoiceLabel(info.cycleKey, card.dueDay);
      previewEl.textContent = '→ Entrará na ' + lbl.title + ' · ' + lbl.dueLabel;
      previewEl.style.display = '';
    } else {
      previewEl.style.display = 'none';
    }
  } else {
    if (cardRow) cardRow.style.display = 'none';
    labelEl.textContent = 'Data / Vencimento';
    previewEl.style.display = 'none';
  }
}

function saveTxForm() {
  const desc      = document.getElementById('tx-desc').value.trim();
  const amount    = parseFloat(document.getElementById('tx-amount').value);
  const dueDate   = document.getElementById('tx-duedate').value;
  const cat       = document.getElementById('tx-category').value;
  const payment   = document.getElementById('tx-payment').value;
  const subtype   = document.getElementById('tx-subtype').value;
  const instTotal = parseInt(document.getElementById('tx-installments').value) || 1;
  const paid      = document.getElementById('tx-paid').checked;

  if (!desc)           { showToast('Informe a descrição', 'error'); return; }
  if (!amount || amount <= 0) { showToast('Informe um valor válido', 'error'); return; }
  if (!dueDate)        { showToast('Informe a data', 'error'); return; }

  // Usa o cartão escolhido no seletor do modal de transação
  const selectedCard = payment === 'credito' ? _getTxCard() : null;

  const base = {
    type: _txType, subtype, description: desc, amount,
    purchaseDate: payment === 'credito' ? dueDate : undefined,
    dueDate, category: cat, paymentMethod: payment,
    cardId: payment === 'credito' ? selectedCard.id : null,
    installmentTotal: instTotal, paid,
  };

  if (State.editTxId) {
    Finance.updateTransaction(State.editTxId, base);
    showToast('Lançamento atualizado', 'success');
  } else if (subtype === 'installment' && instTotal > 1) {
    const groupId   = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const origDate  = parseLocalDate(dueDate);
    const origDay   = origDate.getDate();
    const origMonth = origDate.getMonth();
    const origYear  = origDate.getFullYear();
    for (let i = 1; i <= instTotal; i++) {
      const totalMonths = origMonth + (i - 1);
      const instYear  = origYear + Math.floor(totalMonths / 12);
      const instMonth = totalMonths % 12;
      const dd = buildDate(instYear, instMonth, origDay);
      Finance.addTransaction({
        ...base, groupId,
        installmentCurrent: i, installmentTotal: instTotal,
        dueDate: dd,
        purchaseDate: payment === 'credito' ? dd : undefined,
        paid: false,
      });
    }
    showToast(`${instTotal} parcelas criadas`, 'success');
  } else {
    Finance.addTransaction(base);
    showToast('Lançamento salvo', 'success');
  }
  closeModal('tx-modal');
  refreshAll();
}

// ─── GASTO RÁPIDO ─────────────────────────────────────────────────────────────

let _quickBase = { saldo: 0, previsao: 0 };

function parseQuickInput(text) {
  if (!text || !text.trim()) return null;
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const PAYMENT_MAP = {
    'pix':'pix','debito':'debito','débito':'debito',
    'credito':'credito','crédito':'credito',
    'dinheiro':'dinheiro','cash':'dinheiro',
    'transferencia':'transferencia','transferência':'transferencia','boleto':'boleto',
  };
  const lastWord = parts[parts.length - 1].toLowerCase();
  let paymentMethod = null, descParts = [], amountStr = '';
  if (PAYMENT_MAP[lastWord]) {
    paymentMethod = PAYMENT_MAP[lastWord];
    const remaining = parts.slice(0, -1);
    const lastNum = remaining[remaining.length - 1];
    if (lastNum && /^[\d.,]+$/.test(lastNum)) { amountStr = lastNum; descParts = remaining.slice(0, -1); }
    else return null;
  } else {
    const lastNum = parts[parts.length - 1];
    if (/^[\d.,]+$/.test(lastNum)) { amountStr = lastNum; descParts = parts.slice(0, -1); paymentMethod = 'pix'; }
    else if (parts.length >= 3) {
      const pen = parts[parts.length - 2];
      if (/^[\d.,]+$/.test(pen)) {
        amountStr = pen; descParts = parts.slice(0, -2);
        paymentMethod = PAYMENT_MAP[parts[parts.length - 1].toLowerCase()] || 'pix';
      } else return null;
    } else return null;
  }
  const amount = parseFloat(amountStr.replace(',', '.'));
  const desc   = descParts.join(' ').trim();
  if (!desc || !amount || amount <= 0) return null;
  return { description: desc, amount, paymentMethod };
}

function openQuickModal() {
  const inp = document.getElementById('quick-input');
  inp.value = '';
  document.getElementById('quick-preview').style.display = 'none';
  document.getElementById('quick-sim-preview').style.display = 'none';
  document.getElementById('quick-card-row')?.style && (document.getElementById('quick-card-row').style.display = 'none');

  _quickBase.saldo    = Finance.calcSaldoDisponivel(State.year, State.month);
  _quickBase.previsao = Finance.calcPrevisao(State.year, State.month);

  const prevEl  = document.getElementById('quick-month-preview');
  const amtEl   = document.getElementById('quick-month-amount');
  const saldoEl = document.getElementById('quick-saldo-amount');
  if (prevEl && amtEl && saldoEl) {
    amtEl.textContent   = fmtCurrency(_quickBase.previsao);
    amtEl.style.color   = _quickBase.previsao >= 0 ? 'var(--success)' : 'var(--destructive)';
    saldoEl.textContent = fmtCurrency(_quickBase.saldo);
    saldoEl.style.color = _quickBase.saldo >= 0 ? 'var(--success)' : 'var(--destructive)';
    prevEl.style.display = '';
  }

  // Popular seletor de cartão com todos os cartões cadastrados.
  // Padrão: cartão atualmente selecionado na aba Cartão.
  const quickCardSel = document.getElementById('quick-card-select');
  if (quickCardSel) {
    const cards = Storage.getCards();
    const list  = cards.length > 0 ? cards : [DEFAULT_CARD];
    const defaultId = getSelectedCard().id;
    quickCardSel.innerHTML = list
      .map(c => `<option value="${esc(c.id)}"${c.id === defaultId ? ' selected' : ''}>${esc(c.name)}</option>`)
      .join('');
  }

  openModal('quick-modal');
  setTimeout(() => inp.focus(), 100);
}

// Retorna o cartão escolhido NO SELETOR DO MODAL de gasto rápido.
// Fallback para getSelectedCard() se o seletor não existir ou estiver vazio.
function _getQuickCard() {
  const sel   = document.getElementById('quick-card-select');
  const selId = sel?.value;
  if (selId) {
    const found = Storage.getCards().find(c => c.id === selId);
    if (found) return found;
  }
  return getSelectedCard();
}

function updateQuickPreview() {
  const val     = document.getElementById('quick-input').value;
  const preview = document.getElementById('quick-preview');
  const simEl   = document.getElementById('quick-sim-preview');
  const cardRow = document.getElementById('quick-card-row');
  const parsed  = parseQuickInput(val);

  if (parsed) {
    preview.style.display = '';
    preview.innerHTML = `<strong>${esc(parsed.description)}</strong> — ${fmtCurrency(parsed.amount)} — ${fmtPayment(parsed.paymentMethod)}`;

    const isCredito    = parsed.paymentMethod === 'credito';
    const simSaldo     = document.getElementById('quick-sim-saldo');
    const simPrevisao  = document.getElementById('quick-sim-previsao');
    const previsaoItem = document.getElementById('quick-sim-previsao-item');
    const faturaItem   = document.getElementById('quick-sim-fatura-item');
    const faturaLabel  = document.getElementById('quick-sim-fatura-label');
    const simFatura    = document.getElementById('quick-sim-fatura');

    if (isCredito) {
      // Mostrar seletor de cartão
      if (cardRow) cardRow.style.display = '';

      // Crédito: saldo atual não muda; mostrar impacto na fatura do cartão escolhido
      simSaldo.textContent = fmtCurrency(_quickBase.saldo);
      simSaldo.style.color = 'var(--muted-fg)';
      previsaoItem.style.display = 'none';

      // Usar o cartão escolhido no seletor do próprio modal
      const card        = _getQuickCard();
      const invInfo     = getInvoiceForPurchase(todayIso(), card);
      const invY        = invInfo.year;
      const invM        = invInfo.month;
      const invPrevisao = Finance.calcPrevisao(invY, invM);
      const invApos     = invPrevisao - parsed.amount;

      faturaLabel.textContent  = `Previsão ${MONTHS_PT[invM]}/${invY} (fatura ${esc(card.name)})`;
      simFatura.textContent    = fmtCurrency(invApos);
      simFatura.style.color    = invApos >= 0 ? 'var(--success)' : 'var(--destructive)';
      faturaItem.style.display = '';
    } else {
      // Ocultar seletor de cartão para pagamentos não-crédito
      if (cardRow) cardRow.style.display = 'none';

      const saldoApos    = _quickBase.saldo    - parsed.amount;
      const previsaoApos = _quickBase.previsao - parsed.amount;

      simSaldo.textContent    = fmtCurrency(saldoApos);
      simSaldo.style.color    = saldoApos    >= 0 ? 'var(--success)' : 'var(--destructive)';
      simPrevisao.textContent = fmtCurrency(previsaoApos);
      simPrevisao.style.color = previsaoApos >= 0 ? 'var(--success)' : 'var(--destructive)';
      previsaoItem.style.display = '';
      faturaItem.style.display   = 'none';
    }

    simEl.style.display = '';
  } else {
    preview.style.display = 'none';
    simEl.style.display   = 'none';
    if (cardRow) cardRow.style.display = 'none';
  }
}

function saveQuickForm() {
  const val    = document.getElementById('quick-input').value.trim();
  const parsed = parseQuickInput(val);
  if (!parsed) { showToast('Formato inválido. Ex: Mercado 120 débito', 'error'); return; }
  if (parsed.paymentMethod === 'credito') {
    // Usar o cartão escolhido no seletor do próprio modal de Gasto Rápido
    const card         = _getQuickCard();
    const purchaseDate = todayIso();
    Finance.addTransaction({
      type:'expense', subtype:'once', description:parsed.description, amount:parsed.amount,
      purchaseDate, dueDate:purchaseDate, category:'Outros',
      paymentMethod:'credito', cardId: card.id, paid:false,
    });
  } else {
    Finance.addQuickExpense(parsed.description, parsed.amount, parsed.paymentMethod);
  }
  showToast('Gasto lançado!', 'success');
  closeModal('quick-modal');
  if (State.view === 'dashboard') refreshAll();
}

// ─── RELATÓRIOS ───────────────────────────────────────────────────────────────
let _rptYear  = null;
let _rptMonth = null;
let _rptData  = null;
let _rptChart = null;
let _rptOpenCat = null;

const RPT_COLORS = [
  '#c9a227','#e07b54','#5b9bd5','#6aa84f','#cc4125',
  '#674ea7','#e69138','#45818e','#a64d79','#888888',
];

function rptChangeMonth(delta) {
  _rptMonth += delta;
  if (_rptMonth > 11) { _rptMonth = 0; _rptYear++; }
  if (_rptMonth < 0)  { _rptMonth = 11; _rptYear--; }
  _rptData    = null;
  _rptOpenCat = null;
  renderReports();
}

function refreshReports() {
  if (_rptYear === null) {
    _rptYear  = State.year;
    _rptMonth = State.month;
  }
  _rptData    = null;
  _rptOpenCat = null;
  renderReports();
}

function _buildReportExpenses(year, month) {
  // Transações de competência do mês (tx regulares + crédito rápido que virou tx)
  const txExpenses = Finance.getByCompetency(year, month)
    .filter(t => t.type === 'expense')
    .map(t => ({
      id:            t.id,
      date:          (t.paymentMethod === 'credito' && t.purchaseDate) ? t.purchaseDate : t.dueDate,
      description:   t.description,
      amount:        t.amount,
      paymentMethod: t.paymentMethod,
      category:      t.category || 'Outros',
    }));

  // Gastos rápidos não-crédito (armazenados separadamente)
  const quickExpenses = (Storage.getQuickExpenses() || [])
    .filter(q => {
      if (q.paymentMethod === 'credito') return false;
      const d = new Date((q.date || '') + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() === month;
    })
    .map(q => ({
      id:            'q_' + (q.id || q.date + q.description),
      date:          q.date || '',
      description:   q.description || q.desc || '—',
      amount:        Number(q.amount) || 0,
      paymentMethod: q.paymentMethod || 'pix',
      category:      q.category || 'Outros',
    }));

  return [...txExpenses, ...quickExpenses];
}

function _buildRptData(year, month) {
  const expenses = _buildReportExpenses(year, month);
  const total    = expenses.reduce((s, e) => s + e.amount, 0);

  const catMap = new Map();
  for (const e of expenses) {
    const cat = e.category || 'Outros';
    if (!catMap.has(cat)) catMap.set(cat, { name: cat, total: 0, items: [] });
    const g = catMap.get(cat);
    g.total += e.amount;
    g.items.push(e);
  }

  const categories = [...catMap.values()].sort((a, b) => b.total - a.total);
  for (const c of categories) {
    c.items.sort((a, b) => (b.date > a.date ? 1 : -1));
    c.pct = total > 0 ? (c.total / total * 100) : 0;
    const amts = c.items.map(i => i.amount);
    c.avg = c.items.length > 0 ? c.total / c.items.length : 0;
    c.max = amts.length > 0 ? Math.max(...amts) : 0;
    c.min = amts.length > 0 ? Math.min(...amts) : 0;
  }

  const today    = new Date();
  const isCurMon = year === today.getFullYear() && month === today.getMonth();
  const days     = isCurMon ? today.getDate() : new Date(year, month + 1, 0).getDate();
  const maxItem  = expenses.length > 0 ? expenses.reduce((a, b) => a.amount >= b.amount ? a : b) : null;

  return {
    total, categories,
    topCat:   categories[0] || null,
    maxItem,
    avgDaily: days > 0 ? total / days : 0,
  };
}

function renderReports() {
  const year = _rptYear, month = _rptMonth;

  const labelEl = document.getElementById('rpt-month-label');
  if (labelEl) labelEl.textContent = MONTHS_PT[month] + ' / ' + year;

  if (!_rptData) _rptData = _buildRptData(year, month);
  const d = _rptData;

  // KPI cards
  const sumEl = document.getElementById('rpt-summary');
  if (sumEl) {
    const topLabel = d.topCat ? esc(d.topCat.name) + ' (' + d.topCat.pct.toFixed(0) + '%)' : '—';
    const maxLabel = d.maxItem ? fmtCurrency(d.maxItem.amount) : '—';
    sumEl.innerHTML =
      '<div class="rpt-kpi"><div class="rpt-kpi-icon">💰</div><div class="rpt-kpi-label">Total gasto</div><div class="rpt-kpi-value">' + fmtCurrency(d.total) + '</div></div>' +
      '<div class="rpt-kpi"><div class="rpt-kpi-icon">🛒</div><div class="rpt-kpi-label">Maior categoria</div><div class="rpt-kpi-value rpt-kpi-sm">' + topLabel + '</div></div>' +
      '<div class="rpt-kpi"><div class="rpt-kpi-icon">💳</div><div class="rpt-kpi-label">Maior compra</div><div class="rpt-kpi-value">' + maxLabel + '</div></div>' +
      '<div class="rpt-kpi"><div class="rpt-kpi-icon">📈</div><div class="rpt-kpi-label">Média diária</div><div class="rpt-kpi-value">' + fmtCurrency(d.avgDaily) + '</div></div>';
  }

  const goalSavingsEl = document.getElementById('rpt-goal-savings');
  if (goalSavingsEl) {
    const goalTotal = Finance.getGoalSavedTotalForMonth(year, month);
    if (goalTotal > 0) {
      goalSavingsEl.style.display = '';
      goalSavingsEl.innerHTML = `<div class="summary-card" style="margin-bottom:1.25rem">
        <div class="summary-card-label">🎯 Valores guardados (metas) — não incluído no total gasto</div>
        <div class="summary-card-value primary">${fmtCurrency(goalTotal)}</div>
      </div>`;
    } else {
      goalSavingsEl.style.display = 'none';
      goalSavingsEl.innerHTML = '';
    }
  }

  _renderRptChart(d);
  _renderRptCatList(d);
}

function _renderRptChart(d) {
  const canvas = document.getElementById('rpt-chart');
  if (!canvas) return;

  if (_rptChart) { _rptChart.destroy(); _rptChart = null; }
  if (d.total === 0) return;

  const labels = d.categories.map(c => c.name);
  const values = d.categories.map(c => c.total);
  const colors = d.categories.map((_, i) => RPT_COLORS[i % RPT_COLORS.length]);
  const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#fff';
  const fgCol  = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim()   || '#1a1a1a';
  const muCol  = getComputedStyle(document.documentElement).getPropertyValue('--muted-fg').trim() || '#888';
  const totalLabel = fmtCurrency(d.total);

  _rptChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: cardBg,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '68%',
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const cat = d.categories[ctx.dataIndex];
              return [
                '  ' + fmtCurrency(cat.total),
                '  ' + cat.pct.toFixed(1) + '% do total',
                '  ' + cat.items.length + (cat.items.length === 1 ? ' compra' : ' compras'),
              ];
            },
          },
        },
      },
    },
    plugins: [{
      id: 'rptCenter',
      afterDraw(chart) {
        const { ctx, chartArea: { top, left, width, height } } = chart;
        const cx = left + width / 2, cy = top + height / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = muCol;
        ctx.font = '500 0.68rem Inter,sans-serif';
        ctx.fillText('Total gasto', cx, cy - 10);
        ctx.fillStyle = fgCol;
        ctx.font = '600 1.05rem Inter,sans-serif';
        ctx.fillText(totalLabel, cx, cy + 12);
        ctx.restore();
      },
    }],
  });

  canvas.onclick = (e) => {
    if (!_rptChart) return;
    const pts = _rptChart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
    if (!pts.length) return;
    const catName = d.categories[pts[0].index]?.name;
    if (catName) _rptToggleCat(catName);
  };
}

function _rptToggleCat(name) {
  _rptOpenCat = _rptOpenCat === name ? null : name;
  document.querySelectorAll('.rpt-cat-item').forEach(el => {
    const isThis  = el.dataset.cat === name;
    const open    = isThis && _rptOpenCat === name;
    const detail  = el.querySelector('.rpt-cat-detail');
    const arrow   = el.querySelector('.rpt-cat-arrow');
    if (detail) detail.style.display = open ? '' : 'none';
    if (arrow)  arrow.textContent    = open ? '▲' : '▼';
    el.classList.toggle('rpt-cat-open', open);
  });
}

function _fmtDateShort(iso) {
  if (!iso) return '—';
  const parts = iso.split('-');
  if (parts.length < 3) return iso;
  return parts[2] + '/' + parts[1];
}

function _renderRptCatList(d) {
  const el = document.getElementById('rpt-cat-list');
  if (!el) return;

  if (d.categories.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Nenhum gasto neste mês</div><div class="empty-sub">Lance despesas para ver o relatório</div></div>';
    return;
  }

  el.innerHTML = d.categories.map((cat, i) => {
    const color = RPT_COLORS[i % RPT_COLORS.length];
    const catKey = esc(cat.name);
    const rows = cat.items.map(item =>
      '<div class="rpt-tx-row">' +
        '<span class="rpt-tx-date">' + _fmtDateShort(item.date) + '</span>' +
        '<span class="rpt-tx-desc">' + esc(item.description) + '</span>' +
        '<span class="rpt-tx-pay">' + esc(fmtPayment(item.paymentMethod)) + '</span>' +
        '<span class="rpt-tx-amt">' + fmtCurrency(item.amount) + '</span>' +
      '</div>'
    ).join('');

    return (
      '<div class="rpt-cat-item" data-cat="' + catKey + '" onclick="_rptToggleCat(\'' + catKey.replace(/'/g, "\\'") + '\')">' +
        '<div class="rpt-cat-header">' +
          '<span class="rpt-cat-dot" style="background:' + color + '"></span>' +
          '<span class="rpt-cat-name">' + catKey + '</span>' +
          '<div class="rpt-cat-bar-wrap"><div class="rpt-cat-bar" style="width:' + cat.pct.toFixed(1) + '%;background:' + color + '"></div></div>' +
          '<span class="rpt-cat-pct">' + cat.pct.toFixed(0) + '%</span>' +
          '<span class="rpt-cat-total">' + fmtCurrency(cat.total) + '</span>' +
          '<span class="rpt-cat-arrow">▼</span>' +
        '</div>' +
        '<div class="rpt-cat-detail" style="display:none">' +
          '<div class="rpt-cat-stats">' +
            '<div class="rpt-stat"><span class="rpt-stat-lbl">Compras</span><span class="rpt-stat-val">' + cat.items.length + '</span></div>' +
            '<div class="rpt-stat"><span class="rpt-stat-lbl">Ticket médio</span><span class="rpt-stat-val">' + fmtCurrency(cat.avg) + '</span></div>' +
            '<div class="rpt-stat"><span class="rpt-stat-lbl">Maior compra</span><span class="rpt-stat-val">' + fmtCurrency(cat.max) + '</span></div>' +
            '<div class="rpt-stat"><span class="rpt-stat-lbl">Menor compra</span><span class="rpt-stat-val">' + fmtCurrency(cat.min) + '</span></div>' +
          '</div>' +
          '<div class="rpt-tx-list">' + rows + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

// ─── PROCESSAR PAGAMENTOS ─────────────────────────────────────────────────────
// _processSelectedTxIds  — IDs individuais (receitas + despesas sem cartão)
// _processSelectedInvoices — chaves "cardId::year::month" para faturas agrupadas
let _processSelectedTxIds = new Set();
let _processSelectedInvoices = new Set();
let _processSelectedGoals = new Set();

// Navegação de mês independente da Visão Geral. Sempre reinicia no mês
// vigente toda vez que o modal é aberto (não é persistida ao fechar).
let _processYear  = null;
let _processMonth = null;

function processChangeMonth(delta) {
  _processMonth += delta;
  if (_processMonth > 11) { _processMonth = 0; _processYear++; }
  if (_processMonth < 0)  { _processMonth = 11; _processYear--; }
  renderProcessList();
}

function openProcessPayments() {
  const today = new Date();
  _processYear  = today.getFullYear();
  _processMonth = today.getMonth();
  renderProcessList();
  openModal('process-modal');
}

function renderProcessList() {
  const y = _processYear, m = _processMonth;

  const labelEl = document.getElementById('process-month-label');
  if (labelEl) labelEl.textContent = `${MONTHS_PT[m]}/${y}`;

  // Receitas pendentes do mês em navegação (listagem individual)
  const pendingIncome = Finance.getByCompetency(y, m, 'income')
    .filter(t => !t.paid)
    .sort((a, b) => a.dueDate > b.dueDate ? 1 : -1);

  // Despesas não-crédito pendentes (listagem individual)
  const pendingExpenses = Finance.getPendingForProcessing(y, m)
    .filter(t => t.paymentMethod !== 'credito');

  // Faturas de cartão — uma linha por cartão
  const allCards = Storage.getCards();
  const cardsToCheck = allCards.length > 0 ? allCards : [DEFAULT_CARD];
  const cardInvoices = cardsToCheck
    .map(card => ({ card, invoice: Finance.getCardInvoice(y, m, card) }))
    .filter(({ invoice }) => invoice.total > 0 && !invoice.allPaid);

  // Aportes programados de metas (GUARDAR) — uma linha por meta com ocorrência pendente
  const goalOccurrences = Finance.getActiveGoals()
    .map(g => ({ goal: g, occ: Finance.getGoalOccurrenceForMonth(g, y, m) }))
    .filter(({ occ }) => occ && !occ.processed);

  _processSelectedTxIds = new Set();
  _processSelectedInvoices = new Set();
  _processSelectedGoals = new Set();

  const listEl = document.getElementById('process-list');
  const hasAny = pendingIncome.length > 0 || pendingExpenses.length > 0 || cardInvoices.length > 0 || goalOccurrences.length > 0;

  if (!hasAny) {
    listEl.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted-fg)">Nenhuma pendência em ${MONTHS_PT[m]}/${y} 🎉</div>`;
    document.getElementById('process-confirm-btn').style.display = 'none';
  } else {
    document.getElementById('process-confirm-btn').style.display = '';

    // Linha individual (receita ou despesa comum)
    const renderTxRow = (t, colorClass) => {
      const isLate  = getDueStatus(t.dueDate) === 'overdue';
      const isToday = getDueStatus(t.dueDate) === 'today';
      const badge   = isLate  ? '<span style="color:var(--destructive);font-size:0.72rem">● Vencida</span>'
                    : isToday ? '<span style="color:hsl(38,92%,50%);font-size:0.72rem">● Hoje</span>'
                    : '';
      return `<label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border:1px solid ${isLate?'hsl(0,70%,80%)':'var(--border)'};border-radius:var(--r-sm);margin-bottom:0.5rem;cursor:pointer;background:${isLate?'hsla(0,70%,55%,0.04)':'transparent'}">
        <input type="checkbox" data-process-id="${t.id}" style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0" onchange="toggleProcessItem('tx','${t.id}',this.checked)" />
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:0.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description)}</div>
          <div style="font-size:0.78rem;color:var(--muted-fg);display:flex;gap:0.5rem;align-items:center">${fmtDate(t.dueDate)}${t.subtype==='installment'?` · Parcela ${t.installmentCurrent}/${t.installmentTotal}`:''}${badge?` · ${badge}`:''}</div>
        </div>
        <div style="font-weight:600;color:${colorClass};white-space:nowrap">${fmtCurrency(t.amount)}</div>
      </label>`;
    };

    // Linha de fatura de cartão (agrupada)
    const renderInvoiceRow = (card, invoice) => {
      const invoiceKey = `${card.id}::${y}::${m}`;
      const count = invoice.transactions.length;
      return `<label style="display:flex;align-items:center;gap:0.75rem;padding:0.85rem 0.75rem;border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:0.5rem;cursor:pointer;background:transparent">
        <input type="checkbox" style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0" onchange="toggleProcessItem('invoice','${invoiceKey}',this.checked)" />
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:0.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">💳 ${esc(card.name)}</div>
          <div style="font-size:0.78rem;color:var(--muted-fg)">${esc(invoice.title)} · ${esc(invoice.dueLabel)} · ${count} compra${count !== 1 ? 's' : ''}</div>
        </div>
        <div style="font-weight:700;color:var(--destructive);white-space:nowrap">${fmtCurrency(invoice.total)}</div>
      </label>`;
    };

    // Linha de aporte programado de meta (seção GUARDAR)
    const renderGoalRow = (goal, occ) => {
      return `<label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:0.5rem;cursor:pointer;background:transparent">
        <input type="checkbox" style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0" onchange="toggleProcessItem('goal','${occ.id}',this.checked)" />
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:0.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(goal.emoji || '🎯')} ${esc(goal.name)}</div>
          <div style="font-size:0.78rem;color:var(--muted-fg)">Aporte mensal · ${fmtDate(occ.dueDate)}</div>
        </div>
        <div style="font-weight:600;color:var(--primary);white-space:nowrap">${fmtCurrency(occ.amount)}</div>
      </label>`;
    };

    let html = '';

    if (pendingIncome.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--success);margin:0.75rem 0 0.5rem">▲ Receber</div>`;
      html += pendingIncome.map(t => renderTxRow(t, 'var(--success)')).join('');
    }

    if (cardInvoices.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--destructive);margin:0.75rem 0 0.5rem">▼ Faturas de Cartão</div>`;
      html += cardInvoices.map(({ card, invoice }) => renderInvoiceRow(card, invoice)).join('');
    }

    if (pendingExpenses.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--destructive);margin:0.75rem 0 0.5rem">▼ Outras Despesas</div>`;
      html += pendingExpenses.map(t => renderTxRow(t, 'var(--destructive)')).join('');
    }

    if (goalOccurrences.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--primary);margin:0.75rem 0 0.5rem">🎯 Guardar</div>`;
      html += goalOccurrences.map(({ goal, occ }) => renderGoalRow(goal, occ)).join('');
    }

    listEl.innerHTML = html;
  }
}

function toggleProcessItem(kind, id, checked) {
  if (kind === 'invoice') {
    if (checked) _processSelectedInvoices.add(id); else _processSelectedInvoices.delete(id);
  } else if (kind === 'goal') {
    if (checked) _processSelectedGoals.add(id); else _processSelectedGoals.delete(id);
  } else {
    if (checked) _processSelectedTxIds.add(id); else _processSelectedTxIds.delete(id);
  }
}

function confirmProcessPayments() {
  const txIds = Array.from(_processSelectedTxIds);
  const invoiceKeys = Array.from(_processSelectedInvoices);
  const goalKeys = Array.from(_processSelectedGoals);
  if (txIds.length === 0 && invoiceKeys.length === 0 && goalKeys.length === 0) {
    showToast('Nenhum item selecionado', 'error');
    return;
  }

  if (txIds.length > 0) Finance.processPayments(txIds);

  invoiceKeys.forEach(key => {
    const [cardId, yearStr, monthStr] = key.split('::');
    const year  = Number(yearStr);
    const month = Number(monthStr);
    const cards = Storage.getCards();
    const card  = cards.find(c => c.id === cardId) || DEFAULT_CARD;
    Finance.markInvoicePaid(year, month, card);
  });

  goalKeys.forEach(key => {
    const idx = key.indexOf('::');
    const goalId = key.slice(0, idx);
    const competency = key.slice(idx + 2);
    Finance.processGoalContribution(goalId, competency);
  });

  const total = txIds.length + invoiceKeys.length + goalKeys.length;
  showToast(`${total} item(s) processado(s)!`, 'success');
  closeModal('process-modal');
  refreshAll();
  renderHomeBalance();
}

// ─── FATURA ───────────────────────────────────────────────────────────────────
function payInvoice() {
  const card = getSelectedCard();
  Finance.markInvoicePaid(State.year, State.month, card);
  showToast('Fatura ' + MONTHS_PT[State.month] + '/' + State.year + ' marcada como paga!', 'success');
  renderCardTab();
  renderOverview();
}

// ─── GOALS ────────────────────────────────────────────────────────────────────
function openAddGoal() {
  State.editGoalId = null;
  document.getElementById('goal-form').reset();
  document.getElementById('goal-emoji').value = '🎯';
  document.getElementById('goal-priority').value = 'media';
  document.getElementById('goal-day').value = 10;
  document.getElementById('goal-modal-title').textContent = 'Nova Meta';
  updateGoalPreview();
  openModal('goal-modal');
}
function openEditGoal(id) {
  const g = Finance.getGoalById(id);
  if (!g) return;
  State.editGoalId = id;
  document.getElementById('goal-modal-title').textContent = 'Editar Meta';
  document.getElementById('goal-name').value     = g.name;
  document.getElementById('goal-emoji').value    = g.emoji || '🎯';
  document.getElementById('goal-target').value   = g.target;
  document.getElementById('goal-saved').value    = g.saved;
  document.getElementById('goal-deadline').value = g.deadline || '';
  document.getElementById('goal-priority').value = g.priority || 'media';
  document.getElementById('goal-monthly').value  = g.monthlyContribution || '';
  document.getElementById('goal-day').value      = g.contributionDay || 10;
  updateGoalPreview();
  openModal('goal-modal');
}

// Atualiza em tempo real (item 4): recalcula prazo/conclusão a cada
// alteração de meta, guardado, aporte mensal ou dia do aporte.
function updateGoalPreview() {
  const previewEl = document.getElementById('goal-preview');
  if (!previewEl) return;
  const target  = parseFloat(document.getElementById('goal-target').value) || 0;
  const saved   = parseFloat(document.getElementById('goal-saved').value) || 0;
  const monthly = parseFloat(document.getElementById('goal-monthly').value) || 0;
  const remaining = Math.max(0, target - saved);

  if (target > 0 && remaining <= 0) {
    previewEl.innerHTML = `<div class="goal-preview-line">Meta alcançada</div>`;
    return;
  }
  if (!monthly || monthly <= 0) {
    previewEl.innerHTML = `<div class="goal-preview-line">Sem aporte programado</div>`;
    return;
  }
  const months = Math.ceil(remaining / monthly);
  const base = new Date();
  let y = base.getFullYear(), m = base.getMonth() + months;
  while (m > 11) { m -= 12; y++; }
  previewEl.innerHTML =
    `<div class="goal-preview-line">Restante: ${fmtCurrency(remaining)}</div>` +
    `<div class="goal-preview-line">Prazo estimado: ${months} ${months === 1 ? 'mês' : 'meses'}</div>` +
    `<div class="goal-preview-line">Conclusão prevista: ${MONTHS_PT[m]}/${y}</div>`;
}

function saveGoalForm() {
  const name     = document.getElementById('goal-name').value.trim();
  const emoji    = document.getElementById('goal-emoji').value || '🎯';
  const target   = parseFloat(document.getElementById('goal-target').value);
  const saved    = parseFloat(document.getElementById('goal-saved').value) || 0;
  const deadline = document.getElementById('goal-deadline').value;
  const priority = document.getElementById('goal-priority').value || 'media';
  const monthlyContribution = parseFloat(document.getElementById('goal-monthly').value) || 0;
  const contributionDay = Math.min(31, Math.max(1, parseInt(document.getElementById('goal-day').value, 10) || 10));
  if (!name)           { showToast('Informe o nome da meta', 'error'); return; }
  if (!target || target <= 0) { showToast('Informe um valor alvo válido', 'error'); return; }
  const data = { name, emoji, target, saved, deadline, priority, monthlyContribution, contributionDay };
  if (State.editGoalId) {
    Finance.updateGoal(State.editGoalId, data);
    showToast('Meta atualizada', 'success');
  } else {
    Finance.addGoal(data);
    showToast('Meta criada', 'success');
  }
  closeModal('goal-modal');
  renderGoals();
}
let _addToGoalId = null;
function openAddToGoal(id) {
  _addToGoalId = id;
  const g = Finance.getGoalById(id);
  document.getElementById('addgoal-modal-title').textContent = 'Guardar em: ' + (g ? g.name : '');
  document.getElementById('addgoal-amount').value = '';
  openModal('addgoal-modal');
}
function saveAddToGoal() {
  const amount = parseFloat(document.getElementById('addgoal-amount').value);
  if (!amount || amount <= 0) { showToast('Informe um valor', 'error'); return; }
  const g = Finance.getGoalById(_addToGoalId);
  const doSave = () => {
    Finance.addToGoal(_addToGoalId, amount);
    showToast('Valor guardado!', 'success');
    closeModal('addgoal-modal');
    renderGoals();
  };
  if (g) {
    const remaining = Math.max(0, g.target - g.saved);
    if (remaining > 0 && amount > remaining) {
      confirmDialog(`Esse valor é maior que o restante para a meta (${fmtCurrency(remaining)}). O excedente não será somado. Continuar?`, doSave);
      return;
    }
  }
  doSave();
}

// ─── BACKUP ──────────────────────────────────────────────────────────────────
function exportBackup() {
  const data = Storage.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'financas-backup-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exportado', 'success');
}
function importBackup() {
  const inp  = document.createElement('input');
  inp.type   = 'file';
  inp.accept = '.json';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.version) throw new Error();
        confirmDialog('Importar backup? Os dados atuais serão substituídos.', () => {
          Storage.importAll(data);
          showToast('Backup importado com sucesso', 'success');
          refreshAll();
        });
      } catch { showToast('Arquivo inválido', 'error'); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // ── Confirm dialog ──────────────────────────────────────────────────────────
  document.getElementById('confirm-ok').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.remove('open');
    if (_confirmCb) _confirmCb();
    _confirmCb = null;
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.remove('open');
    _confirmCb = null;
  });

  // ── Auth views ──────────────────────────────────────────────────────────────
  document.getElementById('login-btn').addEventListener('click', Auth.login.bind(Auth));
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') Auth.login(); });
  document.getElementById('go-signup').addEventListener('click', () => showAuthView('signup'));
  document.getElementById('go-forgot').addEventListener('click', () => showAuthView('forgot-pw'));
  document.getElementById('signup-btn').addEventListener('click', Auth.signup.bind(Auth));
  document.getElementById('go-login-from-signup').addEventListener('click', () => showAuthView('login'));
  document.getElementById('forgot-btn').addEventListener('click', Auth.forgotPassword.bind(Auth));
  document.getElementById('go-login-from-forgot').addEventListener('click', () => showAuthView('login'));
  document.getElementById('reset-btn').addEventListener('click', Auth.resetPassword.bind(Auth));
  document.getElementById('sub-btn').addEventListener('click', () => Subscription.subscribe());
  document.getElementById('sub-check-btn').addEventListener('click', () => Subscription.checkStatus());
  document.getElementById('sub-logout-btn').addEventListener('click', () => Auth.logout());

  // ── Home ────────────────────────────────────────────────────────────────────
  document.getElementById('home-go-quick').addEventListener('click', openQuickModal);
  document.getElementById('home-go-dashboard').addEventListener('click', () => showView('dashboard'));
  document.getElementById('home-go-process').addEventListener('click', () => {
    openProcessPayments();
  });

  // ── Dashboard header ────────────────────────────────────────────────────────
  document.getElementById('btn-back-home').addEventListener('click', () => showView('home'));
  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('btn-import').addEventListener('click', importBackup);
  document.getElementById('btn-account').addEventListener('click', openAccountModal);

  // ── Month nav ───────────────────────────────────────────────────────────────
  document.getElementById('btn-prev-month').addEventListener('click', prevMonth);
  document.getElementById('btn-next-month').addEventListener('click', nextMonth);

  // ── Tabs ────────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  // ── Expense subtype filter ────────────────────────────────────────────────
  document.querySelectorAll('[data-expsubtypefilter]').forEach(btn =>
    btn.addEventListener('click', () => {
      State.expSubFilter = btn.dataset.expsubtypefilter;
      document.querySelectorAll('[data-expsubtypefilter]').forEach(b => b.classList.toggle('active', b === btn));
      renderExpenses();
    }));

  // ── Expense filters ─────────────────────────────────────────────────────────
  document.querySelectorAll('[data-expfilter]').forEach(btn =>
    btn.addEventListener('click', () => {
      State.expFilter = btn.dataset.expfilter;
      document.querySelectorAll('[data-expfilter]').forEach(b => b.classList.toggle('active', b === btn));
      renderExpenses();
    }));

  // ── Card subtype filter ───────────────────────────────────────────────────
  document.querySelectorAll('[data-cardsubtypefilter]').forEach(btn =>
    btn.addEventListener('click', () => {
      State.cardSubFilter = btn.dataset.cardsubtypefilter;
      document.querySelectorAll('[data-cardsubtypefilter]').forEach(b => b.classList.toggle('active', b === btn));
      renderCardTab();
    }));

  // ── Income filters ──────────────────────────────────────────────────────────
  document.querySelectorAll('[data-incfilter]').forEach(btn =>
    btn.addEventListener('click', () => {
      State.incFilter = btn.dataset.incfilter;
      document.querySelectorAll('[data-incfilter]').forEach(b => b.classList.toggle('active', b === btn));
      renderIncome();
    }));

  // ── TX modal ──────────────────────────────────────────────────────────────
  document.getElementById('close-tx-modal').addEventListener('click', () => closeModal('tx-modal'));
  document.getElementById('tx-save-btn').addEventListener('click', saveTxForm);
  document.getElementById('tx-subtype').addEventListener('change', updateSubtypeSection);
  document.getElementById('tx-payment').addEventListener('change', updateInvoicePreview);
  document.getElementById('tx-card-select')?.addEventListener('change', updateInvoicePreview);
  document.getElementById('tx-duedate').addEventListener('change', updateInvoicePreview);
  document.getElementById('btn-add-expense').addEventListener('click', () => openAddTx('expense'));
  document.getElementById('btn-add-income').addEventListener('click', () => openAddTx('income'));
  document.getElementById('btn-add-income-2').addEventListener('click', () => {
    openAddTx('income');
    setTimeout(() => {
      const s = document.getElementById('tx-subtype');
      if (s) { s.value = 'recurring'; updateSubtypeSection(); }
    }, 50);
  });
  document.getElementById('btn-add-quick').addEventListener('click', openQuickModal);

  // ── Quick modal ────────────────────────────────────────────────────────────
  document.getElementById('close-quick-modal').addEventListener('click', () => closeModal('quick-modal'));
  document.getElementById('quick-save-btn').addEventListener('click', saveQuickForm);
  document.getElementById('quick-input').addEventListener('input', updateQuickPreview);
  document.getElementById('quick-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveQuickForm(); });

  // ── Process modal ──────────────────────────────────────────────────────────
  document.getElementById('close-process-modal').addEventListener('click', () => closeModal('process-modal'));
  document.getElementById('process-confirm-btn').addEventListener('click', confirmProcessPayments);

  // ── Invoice pay ────────────────────────────────────────────────────────────
  document.getElementById('btn-pay-invoice').addEventListener('click', payInvoice);

  // ── Card modal (novo / editar cartão) ─────────────────────────────────────
  document.getElementById('close-card-modal')?.addEventListener('click', () => closeModal('card-modal'));
  document.getElementById('card-save-btn')?.addEventListener('click', saveCardForm);
  document.getElementById('btn-delete-card')?.addEventListener('click', deleteCurrentCard);
  document.getElementById('btn-add-card')?.addEventListener('click', openAddCard);
  document.getElementById('btn-edit-card')?.addEventListener('click', openEditCard);

  // ── Goal modal ─────────────────────────────────────────────────────────────
  document.getElementById('close-goal-modal').addEventListener('click', () => closeModal('goal-modal'));
  document.getElementById('goal-save-btn').addEventListener('click', saveGoalForm);
  document.getElementById('btn-add-goal').addEventListener('click', openAddGoal);
  document.getElementById('close-addgoal-modal').addEventListener('click', () => closeModal('addgoal-modal'));
  document.getElementById('addgoal-save-btn').addEventListener('click', saveAddToGoal);
  ['goal-target', 'goal-saved', 'goal-monthly', 'goal-day'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateGoalPreview);
  });

  // ── Account modal ─────────────────────────────────────────────────────────
  document.getElementById('close-account-modal').addEventListener('click', () => closeModal('account-modal'));
  document.getElementById('acct-cancel-btn').addEventListener('click', () => Subscription.cancel());
  document.getElementById('acct-logout-btn').addEventListener('click', () => Auth.logout());

  // ── Editar nome ────────────────────────────────────────────────────────────
  document.getElementById('close-edit-name-modal')?.addEventListener('click', () => closeModal('edit-name-modal'));
  document.getElementById('edit-name-save-btn')?.addEventListener('click', () => Support.saveEditName());

  // ── Novidades / FAQ ─────────────────────────────────────────────────────────
  document.getElementById('close-news-modal')?.addEventListener('click', () => closeModal('news-modal'));
  document.getElementById('close-faq-modal')?.addEventListener('click', () => closeModal('faq-modal'));

  // ── Central de suporte: abrir chamado ───────────────────────────────────────
  document.getElementById('close-ticket-new-modal')?.addEventListener('click', () => closeModal('ticket-new-modal'));
  document.getElementById('ticket-new-save-btn')?.addEventListener('click', () => Support.saveNewTicket());

  // ── Meus chamados ────────────────────────────────────────────────────────────
  document.getElementById('close-tickets-modal')?.addEventListener('click', () => closeModal('tickets-modal'));

  // ── Chat do chamado ──────────────────────────────────────────────────────────
  document.getElementById('close-ticket-chat-modal')?.addEventListener('click', () => closeModal('ticket-chat-modal'));
  document.getElementById('ticket-chat-send-btn')?.addEventListener('click', () => Support.sendTicketMessage());
  document.getElementById('ticket-chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') Support.sendTicketMessage(); });
  document.getElementById('ticket-close-btn')?.addEventListener('click', () => Support.closeTicket());

  // ── Signup CPF mask ────────────────────────────────────────────────────────
  const signupCpf = document.getElementById('signup-cpf');
  if (signupCpf) signupCpf.addEventListener('input', () => Subscription.maskCpf(signupCpf));

  // ── Init Auth ──────────────────────────────────────────────────────────────
  Auth.init();
});
