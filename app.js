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
  editTxId: null,
  editGoalId: null,
};

// ─── VIEW MANAGEMENT ─────────────────────────────────────────────────────────
// showView — app views (home / dashboard) após autenticação
function showView(v) {
  State.view = v;
  const allViews = [
    'view-loading','view-login','view-signup','view-forgot-pw',
    'view-confirm-email','view-reset-pw','view-subscription',
    'view-home','view-dashboard',
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

// ─── HOME ALERTS ─────────────────────────────────────────────────────────────
function renderHomeAlerts() {
  const alertsEl = document.getElementById('home-alerts');
  if (!alertsEl) return;
  const reminders = Finance.getReminders();
  if (reminders.length === 0) {
    alertsEl.style.display = 'none';
    return;
  }
  alertsEl.style.display = '';
  alertsEl.innerHTML =
    `<div style="font-size:0.8rem;font-weight:600;color:hsl(38,70%,40%);margin-bottom:0.5rem;letter-spacing:0.04em;text-transform:uppercase">⚠ Atenção</div>` +
    reminders.slice(0, 5).map(r => {
      const label = r.status === 'overdue' ? 'Vencida' : r.status === 'today' ? 'Vence hoje' : 'Vence amanhã';
      const dotColor = r.status === 'overdue' ? 'var(--destructive)' : r.status === 'today' ? 'hsl(38,92%,50%)' : 'hsl(38,80%,60%)';
      return `<div class="reminder-row">
        <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block"></span>
        <span class="reminder-text">${esc(r.tx.description)}</span>
        <span style="font-size:0.78rem;color:var(--muted-fg)">${label}</span>
        <span class="reminder-amount">${fmtCurrency(r.tx.amount)}</span>
      </div>`;
    }).join('');
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
}

// ─── OVERVIEW TAB ────────────────────────────────────────────────────────────
function renderOverview() {
  const sum     = Finance.calcSummary(State.year, State.month);
  const previsao = Finance.calcPrevisao(State.year, State.month);
  const reminders = Finance.getReminders();

  // Saldo disponível — apenas no mês vigente
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

  // Previsão inteligente
  const balEl = document.getElementById('balance-amount');
  balEl.textContent = fmtCurrency(previsao);
  balEl.className = 'balance-amount ' + (previsao >= 0 ? 'positive' : 'negative');
  document.getElementById('balance-sub').textContent =
    'Entradas ' + fmtCurrency(sum.totalIncome) + ' · Saídas ' + fmtCurrency(sum.totalExpenses);

  document.getElementById('sum-income').textContent   = fmtCurrency(sum.totalIncome);
  document.getElementById('sum-expenses').textContent = fmtCurrency(sum.totalExpenses);
  document.getElementById('sum-paid').textContent     = fmtCurrency(sum.totalPaid);
  document.getElementById('sum-pending').textContent  = fmtCurrency(sum.totalPending);

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
  const quick = Storage.getQuickExpenses().slice(0, 15);
  const el = document.getElementById('quick-list');
  if (!el) return;
  if (quick.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:var(--muted-fg);font-size:0.875rem;padding:1.5rem 0">Nenhum gasto rápido ainda.<br>Use o botão acima para lançar.</p>';
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
function renderExpenses() {
  let txs = Finance.getByCompetency(State.year, State.month, 'expense');

  // Excluir cartão de crédito desta aba (tem aba própria)
  txs = txs.filter(t => t.paymentMethod !== 'credito');

  // Filtro de subtipo (avulso, parcelado, recorrente)
  if (State.expSubFilter === 'once')        txs = txs.filter(t => t.subtype === 'once');
  else if (State.expSubFilter === 'installment') txs = txs.filter(t => t.subtype === 'installment');
  else if (State.expSubFilter === 'recurring')   txs = txs.filter(t => t.subtype === 'recurring');

  // Filtro de status (pendente, pago, vencido)
  if (State.expFilter === 'pending') txs = txs.filter(t => !t.paid && getDueStatus(t.dueDate) !== 'overdue');
  else if (State.expFilter === 'paid')  txs = txs.filter(t => t.paid);
  else if (State.expFilter === 'late')  txs = txs.filter(t => !t.paid && getDueStatus(t.dueDate) === 'overdue');

  // Ordenar por lançamento mais recente primeiro
  txs.sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);

  // Totais da aba (sem crédito)
  const all = Finance.getByCompetency(State.year, State.month, 'expense')
    .filter(t => t.paymentMethod !== 'credito');
  document.getElementById('exp-total').textContent  = fmtCurrency(all.reduce((s, t) => s + t.amount, 0));
  document.getElementById('exp-paid2').textContent  = fmtCurrency(all.filter(t => t.paid).reduce((s, t) => s + t.amount, 0));
  document.getElementById('exp-pend2').textContent  = fmtCurrency(all.filter(t => !t.paid).reduce((s, t) => s + t.amount, 0));

  document.getElementById('expenses-list').innerHTML = txs.length === 0
    ? emptyState('🧾', 'Nenhuma despesa', 'Sem despesas para este período.')
    : txs.map(t => txRow(t)).join('');
}

// ─── INCOME TAB ──────────────────────────────────────────────────────────────
function renderIncome() {
  let txs = Finance.getByCompetency(State.year, State.month, 'income');
  if (State.incFilter === 'received') txs = txs.filter(t => t.paid);
  else if (State.incFilter === 'pending') txs = txs.filter(t => !t.paid);
  // Ordenar por lançamento mais recente primeiro
  txs.sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);

  const all = Finance.getByCompetency(State.year, State.month, 'income');
  document.getElementById('inc-total').textContent    = fmtCurrency(all.reduce((s, t) => s + t.amount, 0));
  document.getElementById('inc-received').textContent = fmtCurrency(all.filter(t => t.paid).reduce((s, t) => s + t.amount, 0));

  document.getElementById('income-list').innerHTML = txs.length === 0
    ? emptyState('💰', 'Nenhuma entrada', 'Sem entradas para este período.')
    : txs.map(t => txRow(t)).join('');
}

// ─── CARD TAB ────────────────────────────────────────────────────────────────
function renderCardTab() {
  const inv = Finance.getCardInvoice(State.year, State.month);
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

  const listEl = document.getElementById('card-invoice-list');
  listEl.innerHTML = inv.transactions.length === 0
    ? emptyState('💳', 'Fatura vazia', 'Compras em crédito aparecerão aqui.')
    : inv.transactions
        .sort((a, b) => (a.purchaseDate || a.dueDate) > (b.purchaseDate || b.dueDate) ? 1 : -1)
        .map(t => txRow(t, t.purchaseDate ? fmtDate(t.purchaseDate) : null)).join('');
}

// ─── GOALS TAB ───────────────────────────────────────────────────────────────
function renderGoals() {
  const goals = Storage.getGoals();
  const el = document.getElementById('goals-list');
  if (goals.length === 0) {
    el.innerHTML = emptyState('🎯', 'Nenhuma meta', 'Defina objetivos para guardar dinheiro.');
    return;
  }
  el.innerHTML = `<div class="goals-grid">` + goals.map(g => {
    const pct = Math.min(100, Math.round((Number(g.saved) / Number(g.target)) * 100));
    const monthly = g.deadline ? (() => {
      const now = new Date(), dl = new Date(g.deadline);
      const months = Math.max(1, (dl.getFullYear() - now.getFullYear()) * 12 + (dl.getMonth() - now.getMonth()));
      return Math.ceil((g.target - g.saved) / months);
    })() : null;
    return `<div class="goal-card">
      <div class="goal-top">
        <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0">
          <div class="goal-emoji-wrap">${esc(g.emoji || '🎯')}</div>
          <div class="goal-name-wrap">
            <div class="goal-name">${esc(g.name)}</div>
            <div class="goal-pct-label">${pct}% concluído</div>
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
      ${g.deadline ? `<div class="goal-deadline">Prazo: ${fmtDate(g.deadline)}${monthly ? ' · ~' + fmtCurrency(monthly) + '/mês' : ''}</div>` : ''}
      <button class="btn btn-outline form-btn-full" onclick="openAddToGoal('${g.id}')">Guardar Dinheiro</button>
    </div>`;
  }).join('') + `</div>`;
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
  confirmDialog('Excluir esta meta?', () => { Finance.deleteGoal(id); showToast('Meta excluída'); renderGoals(); });
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

function updateInvoicePreview() {
  const payment  = document.getElementById('tx-payment').value;
  const dateVal  = document.getElementById('tx-duedate').value;
  const labelEl  = document.getElementById('tx-date-label');
  const previewEl = document.getElementById('tx-invoice-preview');
  if (!labelEl || !previewEl) return;
  if (payment === 'credito' && dateVal) {
    labelEl.textContent = 'Data da compra';
    const info = getInvoiceForPurchase(dateVal);
    const lbl  = invoiceLabel(info.cycleKey);
    previewEl.textContent = '→ Entrará na ' + lbl.title + ' · ' + lbl.dueLabel;
    previewEl.style.display = '';
  } else {
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

  const base = {
    type: _txType, subtype, description: desc, amount,
    purchaseDate: payment === 'credito' ? dueDate : undefined,
    dueDate, category: cat, paymentMethod: payment,
    cardId: payment === 'credito' ? 'default' : null,
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

// Base corrigida para simulação do gasto rápido.
// Preenchida ao abrir o modal e usada por updateQuickPreview()
// sem recalcular a cada keystroke.
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

  // Usa os novos cálculos unificados
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

  openModal('quick-modal');
  setTimeout(() => inp.focus(), 100);
}

function updateQuickPreview() {
  const val     = document.getElementById('quick-input').value;
  const preview = document.getElementById('quick-preview');
  const simEl   = document.getElementById('quick-sim-preview');
  const parsed  = parseQuickInput(val);

  if (parsed) {
    preview.style.display = '';
    preview.innerHTML = `<strong>${esc(parsed.description)}</strong> — ${fmtCurrency(parsed.amount)} — ${fmtPayment(parsed.paymentMethod)}`;

    const isCredito       = parsed.paymentMethod === 'credito';
    const simSaldo        = document.getElementById('quick-sim-saldo');
    const simPrevisao     = document.getElementById('quick-sim-previsao');
    const previsaoItem    = document.getElementById('quick-sim-previsao-item');
    const faturaItem      = document.getElementById('quick-sim-fatura-item');
    const faturaLabel     = document.getElementById('quick-sim-fatura-label');
    const simFatura       = document.getElementById('quick-sim-fatura');

    if (isCredito) {
      // Crédito: saldo atual não muda, previsão atual não muda
      // Mostra o impacto real no próximo mês (fatura)
      simSaldo.textContent = fmtCurrency(_quickBase.saldo);
      simSaldo.style.color = 'var(--muted-fg)';

      previsaoItem.style.display = 'none';

      const nextMonth   = State.month === 11 ? 0 : State.month + 1;
      const nextYear    = State.month === 11 ? State.year + 1 : State.year;
      const nextPrevisao = Finance.calcPrevisao(nextYear, nextMonth);
      const nextApos    = nextPrevisao - parsed.amount;

      faturaLabel.textContent   = `Previsão ${MONTHS_PT[nextMonth]}/${nextYear} (fatura)`;
      simFatura.textContent     = fmtCurrency(nextApos);
      simFatura.style.color     = nextApos >= 0 ? 'var(--success)' : 'var(--destructive)';
      faturaItem.style.display  = '';
    } else {
      // PIX / débito / dinheiro / transferência: reduz saldo e previsão do mês atual
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
  }
}

function saveQuickForm() {
  const val    = document.getElementById('quick-input').value.trim();
  const parsed = parseQuickInput(val);
  if (!parsed) { showToast('Formato inválido. Ex: Mercado 120 débito', 'error'); return; }
  if (parsed.paymentMethod === 'credito') {
    const purchaseDate = todayIso();
    Finance.addTransaction({
      type:'expense', subtype:'once', description:parsed.description, amount:parsed.amount,
      purchaseDate, dueDate:purchaseDate, category:'Outros',
      paymentMethod:'credito', cardId:'default', paid:false,
    });
  } else {
    Finance.addQuickExpense(parsed.description, parsed.amount, parsed.paymentMethod);
  }
  showToast('Gasto lançado!', 'success');
  closeModal('quick-modal');
  if (State.view === 'dashboard') refreshAll();
}
// ─── PROCESSAR PAGAMENTOS ─────────────────────────────────────────────────────
let _processSelectedIds = new Set();
function openProcessPayments() {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();

  // Coletar entradas pendentes (RECEBER)
  const pendingIncome = Finance.getByCompetency(y, m, 'income')
    .filter(t => !t.paid)
    .sort((a, b) => a.dueDate > b.dueDate ? 1 : -1);

  // Coletar despesas pendentes (PAGAR) — todos os meses relevantes
  const pendingExpenses = Finance.getPendingForProcessing(State.year, State.month);

  _processSelectedIds = new Set([
    ...pendingIncome.map(t => t.id),
    ...pendingExpenses.map(t => t.id),
  ]);

  const listEl = document.getElementById('process-list');
  const hasAny = pendingIncome.length > 0 || pendingExpenses.length > 0;

  if (!hasAny) {
    listEl.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted-fg)">Nenhuma pendência em ${MONTHS_PT[State.month]}/${State.year} 🎉</div>`;
    document.getElementById('process-confirm-btn').style.display = 'none';
  } else {
    document.getElementById('process-confirm-btn').style.display = '';

    const renderRow = (t, colorClass) => {
      const isLate  = getDueStatus(t.dueDate) === 'overdue';
      const isToday = getDueStatus(t.dueDate) === 'today';
      const badge   = isLate  ? '<span style="color:var(--destructive);font-size:0.72rem">● Vencida</span>'
                    : isToday ? '<span style="color:hsl(38,92%,50%);font-size:0.72rem">● Hoje</span>'
                    : '';
      return `<label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border:1px solid ${isLate?'hsl(0,70%,80%)':'var(--border)'};border-radius:var(--r-sm);margin-bottom:0.5rem;cursor:pointer;background:${isLate?'hsla(0,70%,55%,0.04)':'transparent'}">
        <input type="checkbox" checked data-process-id="${t.id}" style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0" onchange="toggleProcessItem('${t.id}',this.checked)" />
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:0.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description)}</div>
          <div style="font-size:0.78rem;color:var(--muted-fg);display:flex;gap:0.5rem;align-items:center">${fmtDate(t.dueDate)}${t.subtype==='installment'?` · Parcela ${t.installmentCurrent}/${t.installmentTotal}`:''}${badge?` · ${badge}`:''}</div>
        </div>
        <div style="font-weight:600;color:${colorClass};white-space:nowrap">${fmtCurrency(t.amount)}</div>
      </label>`;
    };

    let html = '';

    if (pendingIncome.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--success);margin:0.75rem 0 0.5rem">▲ Receber</div>`;
      html += pendingIncome.map(t => renderRow(t, 'var(--success)')).join('');
    }

    if (pendingExpenses.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--destructive);margin:0.75rem 0 0.5rem">▼ Pagar</div>`;
      html += pendingExpenses.map(t => renderRow(t, 'var(--destructive)')).join('');
    }

    listEl.innerHTML = html;
  }
  openModal('process-modal');
}
function toggleProcessItem(id, checked) { if (checked) _processSelectedIds.add(id); else _processSelectedIds.delete(id); }
function confirmProcessPayments() {
  const ids = Array.from(_processSelectedIds);
  if (ids.length === 0) { showToast('Nenhum item selecionado', 'error'); return; }
  Finance.processPayments(ids);
  showToast(`${ids.length} item(s) processado(s)!`, 'success');
  closeModal('process-modal');
  refreshAll();
  renderHomeBalance();
}

// ─── FATURA ───────────────────────────────────────────────────────────────────
function payInvoice() {
  Finance.markInvoicePaid(State.year, State.month);
  showToast('Fatura ' + MONTHS_PT[State.month] + '/' + State.year + ' marcada como paga!', 'success');
  renderCardTab();
  renderOverview();
}

// ─── GOALS ────────────────────────────────────────────────────────────────────
function openAddGoal() {
  State.editGoalId = null;
  document.getElementById('goal-form').reset();
  document.getElementById('goal-emoji').value = '🎯';
  document.getElementById('goal-modal-title').textContent = 'Nova Meta';
  openModal('goal-modal');
}
function openEditGoal(id) {
  const g = Storage.getGoals().find(g => g.id === id);
  if (!g) return;
  State.editGoalId = id;
  document.getElementById('goal-modal-title').textContent = 'Editar Meta';
  document.getElementById('goal-name').value     = g.name;
  document.getElementById('goal-emoji').value    = g.emoji || '🎯';
  document.getElementById('goal-target').value   = g.target;
  document.getElementById('goal-saved').value    = g.saved;
  document.getElementById('goal-deadline').value = g.deadline || '';
  openModal('goal-modal');
}
function saveGoalForm() {
  const name     = document.getElementById('goal-name').value.trim();
  const emoji    = document.getElementById('goal-emoji').value || '🎯';
  const target   = parseFloat(document.getElementById('goal-target').value);
  const saved    = parseFloat(document.getElementById('goal-saved').value) || 0;
  const deadline = document.getElementById('goal-deadline').value;
  if (!name)           { showToast('Informe o nome da meta', 'error'); return; }
  if (!target || target <= 0) { showToast('Informe um valor alvo válido', 'error'); return; }
  if (State.editGoalId) {
    Finance.updateGoal(State.editGoalId, { name, emoji, target, saved, deadline });
    showToast('Meta atualizada', 'success');
  } else {
    Finance.addGoal({ name, emoji, target, saved, deadline });
    showToast('Meta criada', 'success');
  }
  closeModal('goal-modal');
  renderGoals();
}
let _addToGoalId = null;
function openAddToGoal(id) {
  _addToGoalId = id;
  const g = Storage.getGoals().find(g => g.id === id);
  document.getElementById('addgoal-modal-title').textContent = 'Guardar em: ' + (g ? g.name : '');
  document.getElementById('addgoal-amount').value = '';
  openModal('addgoal-modal');
}
function saveAddToGoal() {
  const amount = parseFloat(document.getElementById('addgoal-amount').value);
  if (!amount || amount <= 0) { showToast('Informe um valor', 'error'); return; }
  Finance.addToGoal(_addToGoalId, amount);
  showToast('Valor guardado!', 'success');
  closeModal('addgoal-modal');
  renderGoals();
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
  // Login
  document.getElementById('login-btn').addEventListener('click', Auth.login.bind(Auth));
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') Auth.login(); });
  document.getElementById('go-signup').addEventListener('click', () => showAuthView('signup'));
  document.getElementById('go-forgot').addEventListener('click', () => showAuthView('forgot-pw'));
  // Signup
  document.getElementById('signup-btn').addEventListener('click', Auth.signup.bind(Auth));
  document.getElementById('go-login-from-signup').addEventListener('click', () => showAuthView('login'));
  // Forgot pw
  document.getElementById('forgot-btn').addEventListener('click', Auth.forgotPassword.bind(Auth));
  document.getElementById('go-login-from-forgot').addEventListener('click', () => showAuthView('login'));
  // Reset pw
  document.getElementById('reset-btn').addEventListener('click', Auth.resetPassword.bind(Auth));
  // Subscription
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

  // ── Expense subtype filter (Avulso / Parcelado / Recorrente) ────────────────
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

  // ── Income filters ──────────────────────────────────────────────────────────
  document.querySelectorAll('[data-incfilter]').forEach(btn =>
    btn.addEventListener('click', () => {
      State.incFilter = btn.dataset.incfilter;
      document.querySelectorAll('[data-incfilter]').forEach(b => b.classList.toggle('active', b === btn));
      renderIncome();
    }));

  // ── Add tx buttons ──────────────────────────────────────────────────────────
  document.getElementById('btn-add-expense').addEventListener('click', () => openAddTx('expense'));
  document.getElementById('btn-add-expense-2').addEventListener('click', () => openAddTx('expense'));
  document.getElementById('btn-add-income').addEventListener('click',   () => openAddTx('income'));
  document.getElementById('btn-add-income-2').addEventListener('click', () => openAddTx('income'));

  // ── TX modal ────────────────────────────────────────────────────────────────
  document.getElementById('close-tx-modal').addEventListener('click', () => closeModal('tx-modal'));
  document.getElementById('tx-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('tx-modal'); });
  document.getElementById('tx-subtype').addEventListener('change', updateSubtypeSection);
  document.getElementById('tx-payment').addEventListener('change', updateInvoicePreview);
  document.getElementById('tx-duedate').addEventListener('change', updateInvoicePreview);
  document.getElementById('tx-save-btn').addEventListener('click', saveTxForm);

  // ── Quick modal ─────────────────────────────────────────────────────────────
  document.getElementById('btn-add-quick').addEventListener('click', openQuickModal);
  document.getElementById('close-quick-modal').addEventListener('click', () => closeModal('quick-modal'));
  document.getElementById('quick-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('quick-modal'); });
  document.getElementById('quick-save-btn').addEventListener('click', saveQuickForm);
  document.getElementById('quick-input').addEventListener('input', updateQuickPreview);
  document.getElementById('quick-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveQuickForm(); });

  // ── Process payments ────────────────────────────────────────────────────────
  document.getElementById('btn-process-payments').addEventListener('click', openProcessPayments);
  document.getElementById('close-process-modal').addEventListener('click', () => closeModal('process-modal'));
  document.getElementById('process-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('process-modal'); });
  document.getElementById('process-confirm-btn').addEventListener('click', confirmProcessPayments);

  // ── Card invoice ─────────────────────────────────────────────────────────────
  document.getElementById('btn-pay-invoice').addEventListener('click', payInvoice);

  // ── Goals ────────────────────────────────────────────────────────────────────
  document.getElementById('btn-add-goal').addEventListener('click', openAddGoal);
  document.getElementById('close-goal-modal').addEventListener('click', () => closeModal('goal-modal'));
  document.getElementById('goal-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('goal-modal'); });
  document.getElementById('goal-save-btn').addEventListener('click', saveGoalForm);
  document.getElementById('close-addgoal-modal').addEventListener('click', () => closeModal('addgoal-modal'));
  document.getElementById('addgoal-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('addgoal-modal'); });
  document.getElementById('addgoal-save-btn').addEventListener('click', saveAddToGoal);

  // ── Account modal ────────────────────────────────────────────────────────────
  document.getElementById('close-account-modal').addEventListener('click', () => closeModal('account-modal'));
  document.getElementById('account-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('account-modal'); });
  document.getElementById('acct-logout-btn').addEventListener('click', () => { closeModal('account-modal'); Auth.logout(); });
  document.getElementById('acct-cancel-btn').addEventListener('click', () => { closeModal('account-modal'); Subscription.cancel(); });

  // ── Iniciar Auth (verifica sessão) ───────────────────────────────────────────
  Auth.init();
});
