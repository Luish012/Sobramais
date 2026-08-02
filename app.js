'use strict';

const INCOME_CATEGORIES = ['Salário','Comissão','Freelance','Bônus','Renda Extra','Aluguel','Investimento','Outros'];
const EXPENSE_CATEGORIES = ['Alimentação','Transporte','Saúde','Moradia','Lazer','Educação','Roupas','Tecnologia','Assinatura','Outros'];
const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ─── CARTÃO PADRÃO ────────────────────────────────────────────────────────────
const DEFAULT_CARD = { id: 'default', name: 'Cartão de crédito', closingDay: 30, dueDay: 8 };

// ─── CARD BILLING RULES ───────────────────────────────────────────────────────
function getInvoiceForPurchase(purchaseDateStr, card) {
  const closingDay = (card && card.closingDay) || DEFAULT_CARD.closingDay;
  const dueDay     = (card && card.dueDay)     || DEFAULT_CARD.dueDay;

  const d = parseLocalDate(purchaseDateStr);
  const day    = d.getDate();
  const pMonth = d.getMonth();
  const pYear  = d.getFullYear();

  let invMonth = pMonth + 1;
  if (day > closingDay) invMonth = pMonth + 2;

  let invYear = pYear;
  if (invMonth > 11) { invYear += Math.floor(invMonth / 12); invMonth = invMonth % 12; }

  const maxDay  = new Date(invYear, invMonth + 1, 0).getDate();
  const realDue = Math.min(dueDay, maxDay);

  const dueDate  = `${invYear}-${String(invMonth + 1).padStart(2,'0')}-${String(realDue).padStart(2,'0')}`;
  const cycleKey = `${invYear}-${String(invMonth + 1).padStart(2,'0')}`;
  return { year: invYear, month: invMonth, dueDate, cycleKey };
}

function invoiceLabel(cycleKey, dueDay) {
  const [y, m] = cycleKey.split('-').map(Number);
  const effectiveDueDay = dueDay || DEFAULT_CARD.dueDay;
  const maxDay = new Date(y, m, 0).getDate();
  const realDue = Math.min(effectiveDueDay, maxDay);
  const due = `${String(realDue).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  return {
    title:    `Fatura ${MONTHS_PT[m-1]}/${y}`,
    dueLabel: `Vencimento: ${due}`,
    dueDate:  `${y}-${String(m).padStart(2,'0')}-${String(realDue).padStart(2,'0')}`,
  };
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function todayStr()  { return new Date().toISOString().split('T')[0]; }
function todayDate() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function parseLocalDate(str) {
  if (!str) return new Date();
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getDueStatus(str) {
  if (!str) return 'none';
  const today = todayDate();
  const [y,m,d] = str.split('-').map(Number);
  const due  = new Date(y, m-1, d);
  const diff = Math.floor((due - today) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return 'future';
}

function buildDate(year, month, day) {
  const max = new Date(year, month + 1, 0).getDate();
  return `${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(day, max)).padStart(2,'0')}`;
}

// ─── RECURRING OCCURRENCE PROJECTOR ──────────────────────────────────────────
function recurringDayOfMonth(tx) {
  return parseLocalDate(tx.dueDate).getDate();
}

function recurringStart(tx) {
  const d = parseLocalDate(tx.dueDate);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function monthGTE(year, month, sy, sm) {
  return year > sy || (year === sy && month >= sm);
}

function getRecurringOccurrence(tx, year, month, allTxs) {
  const start = recurringStart(tx);
  if (!monthGTE(year, month, start.year, start.month)) return null;

  const day        = recurringDayOfMonth(tx);
  const expectedDue = buildDate(year, month, day);

  const real = allTxs.find(t =>
    t !== tx &&
    t.groupId === tx.groupId &&
    t.subtype === 'recurring' &&
    t.isGenerated === true &&
    parseLocalDate(t.dueDate).getFullYear() === year &&
    parseLocalDate(t.dueDate).getMonth() === month
  );
  if (real) return real;

  const tStart = recurringStart(tx);
  if (tStart.year === year && tStart.month === month) return tx;

  return {
    _virtual: true,
    id: `virtual_${tx.groupId}_${year}_${month}`,
    groupId: tx.groupId,
    type: tx.type,
    subtype: 'recurring',
    description: tx.description,
    category: tx.category,
    amount: tx.amount,
    paymentMethod: tx.paymentMethod,
    cardId: tx.cardId || null,
    dueDate: expectedDue,
    paid: false,
    paidDate: null,
    installmentCurrent: 1,
    installmentTotal: 1,
    createdAt: tx.createdAt,
    isGenerated: true,
  };
}

// ─── GOALS: HELPERS ──────────────────────────────────────────────────────────
function goalDefaults(g) {
  return {
    ...g,
    monthlyContribution: Number(g.monthlyContribution) || 0,
    contributionDay: Math.min(31, Math.max(1, Number(g.contributionDay) || 10)),
    priority: g.priority || 'media',
    status: g.status || 'active',
    startDate: g.startDate || (g.createdAt ? g.createdAt.split('T')[0] : todayStr()),
    history: Array.isArray(g.history) ? g.history : [],
    updatedAt: g.updatedAt || g.createdAt || new Date().toISOString(),
    deleted: !!g.deleted,
  };
}

function goalCompetencyKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function goalRemaining(g) {
  return Math.max(0, Number(g.target) - Number(g.saved));
}

function goalMonthsNeeded(g) {
  const remaining = goalRemaining(g);
  if (remaining <= 0) return 0;
  if (!g.monthlyContribution || g.monthlyContribution <= 0) return null;
  return Math.ceil(remaining / g.monthlyContribution);
}

function goalEstimatedCompletion(g) {
  const remaining = goalRemaining(g);
  if (remaining <= 0) return { label: 'Meta alcançada', date: null, months: 0 };
  if (!g.monthlyContribution || g.monthlyContribution <= 0) {
    return { label: 'Sem aporte programado', date: null, months: null };
  }
  const months = goalMonthsNeeded(g);
  const base = new Date();
  let year = base.getFullYear(), month = base.getMonth() + months;
  while (month > 11) { month -= 12; year++; }
  const dateStr = buildDate(year, month, g.contributionDay);
  return { label: `${MONTHS_PT[month]}/${year}`, date: dateStr, months };
}

function getGoalsForCompetency() {
  return Storage.getGoals().filter(g => !g.deleted).map(goalDefaults);
}

function getGoalOccurrenceForMonth(goal, year, month) {
  const g = goalDefaults(goal);
  if (g.status !== 'active' && g.status !== 'completed') return null;
  if (!g.monthlyContribution || g.monthlyContribution <= 0) return null;

  const startD = parseLocalDate(g.startDate);
  if (!monthGTE(year, month, startD.getFullYear(), startD.getMonth())) return null;

  const key = goalCompetencyKey(year, month);
  const processed = g.history.find(h => h.origin === 'scheduled' && h.competency === key);
  if (processed) {
    return {
      id: `${g.id}::${key}`, goalId: g.id, competency: key,
      dueDate: processed.date, amount: processed.amount, processed: true,
    };
  }

  const remaining = goalRemaining(g);
  if (remaining <= 0) return null;

  const amount = Math.min(g.monthlyContribution, remaining);
  const dueDate = buildDate(year, month, g.contributionDay);
  return { id: `${g.id}::${key}`, goalId: g.id, competency: key, dueDate, amount, processed: false };
}

function projectGoalOccurrences(goal, maxCount) {
  const g = goalDefaults(goal);
  const list = [];
  if (g.status !== 'active' || !g.monthlyContribution || g.monthlyContribution <= 0) return list;
  let remaining = goalRemaining(g);
  if (remaining <= 0) return list;

  const startD = parseLocalDate(g.startDate);
  const today = todayDate();
  const cursor = startD > today ? startD : today;
  let cy = cursor.getFullYear(), cm = cursor.getMonth();
  const limit = maxCount || 6;

  while (remaining > 0 && list.length < limit) {
    const key = goalCompetencyKey(cy, cm);
    const already = g.history.find(h => h.origin === 'scheduled' && h.competency === key);
    if (already) {
      remaining -= already.amount;
    } else {
      const amount = Math.min(g.monthlyContribution, remaining);
      list.push({ competency: key, dueDate: buildDate(cy, cm, g.contributionDay), amount });
      remaining -= amount;
    }
    cm++; if (cm > 11) { cm = 0; cy++; }
  }
  return list;
}

function sumProcessedGoalContributions(year, month) {
  const key = goalCompetencyKey(year, month);
  return getGoalsForCompetency().reduce((s, g) =>
    s + g.history.filter(h => h.origin === 'scheduled' && h.competency === key)
                  .reduce((s2, h) => s2 + h.amount, 0), 0);
}

function sumPendingGoalContributions(year, month) {
  return getGoalsForCompetency().reduce((s, g) => {
    const occ = getGoalOccurrenceForMonth(g, year, month);
    return (occ && !occ.processed) ? s + occ.amount : s;
  }, 0);
}

// ─── FINANCE CORE ─────────────────────────────────────────────────────────────
const Finance = {

  // ── QUICK EXPENSE ──────────────────────────────────────────────────────────
  addQuickExpense(desc, amount, paymentMethod, category, categoryId) {
    const list = Storage.getQuickExpenses();
    const item = {
      id: genId(),
      description: (desc||'').trim(),
      amount: Math.abs(Number(amount)||0),
      paymentMethod: paymentMethod||'pix',
      category: category || null,
      categoryId: categoryId || null,
      date: todayStr(),
      createdAt: new Date().toISOString(),
    };
    list.unshift(item);
    Storage.setQuickExpenses(list);
    return item;
  },

  updateQuickExpenseCategory(id, category, categoryId) {
    const list = Storage.getQuickExpenses();
    const idx = list.findIndex(i => i.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], category: category || null, categoryId: categoryId || null };
    Storage.setQuickExpenses(list);
    return list[idx];
  },

  deleteQuickExpense(id) {
    Storage.setQuickExpenses(Storage.getQuickExpenses().filter(i => i.id !== id));
  },

  // ── TRANSACTIONS ───────────────────────────────────────────────────────────
  addTransaction(data) {
    const groupId  = data.groupId || genId();
    const isCredit = data.paymentMethod === 'credito';

    const purchaseDate = isCredit ? (data.purchaseDate || data.dueDate || todayStr()) : null;
    const cardId = isCredit ? (data.cardId || 'default') : null;
    const card = isCredit ? _findCardById(cardId) : null;
    const invoiceInfo = isCredit ? getInvoiceForPurchase(purchaseDate, card) : null;

    const tx = {
      id: genId(),
      groupId,
      type: data.type,
      subtype: data.subtype || 'once',
      description: (data.description||'').trim(),
      category: data.category || 'Outros',
      categoryId: data.categoryId || null,
      amount: Math.abs(Number(data.amount)||0),
      paymentMethod: data.paymentMethod || 'pix',
      cardId,
      dueDate: isCredit ? invoiceInfo.dueDate : (data.dueDate || todayStr()),
      purchaseDate,
      invoiceCycleKey: isCredit ? invoiceInfo.cycleKey : null,
      paid: !!data.paid,
      paidDate: data.paid ? todayStr() : null,
      installmentCurrent: Number(data.installmentCurrent)||1,
      installmentTotal: Number(data.installmentTotal)||1,
      createdAt: new Date().toISOString(),
      isGenerated: !!data.isGenerated,
      isQuick: !!data.isQuick,
    };
    const txs = Storage.getTransactions();
    txs.push(tx);
    Storage.setTransactions(txs);
    return tx;
  },

  updateTransaction(id, data) {
    const txs = Storage.getTransactions();
    const idx = txs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const old = txs[idx];
    const isCredit = (data.paymentMethod || old.paymentMethod) === 'credito';
    const purchaseDate = isCredit
      ? (data.purchaseDate || data.dueDate || old.purchaseDate || old.dueDate || todayStr())
      : null;
    const cardId = isCredit ? (data.cardId || old.cardId || 'default') : null;
    const card = isCredit ? _findCardById(cardId) : null;
    const invoiceInfo = isCredit ? getInvoiceForPurchase(purchaseDate, card) : null;
    txs[idx] = {
      ...old,
      description: (data.description||'').trim(),
      category: data.category || old.category,
      categoryId: 'categoryId' in data ? (data.categoryId || null) : old.categoryId,
      amount: Math.abs(Number(data.amount)||old.amount),
      paymentMethod: data.paymentMethod || old.paymentMethod,
      cardId,
      dueDate: isCredit ? invoiceInfo.dueDate : (data.dueDate || old.dueDate),
      purchaseDate: purchaseDate || old.purchaseDate,
      invoiceCycleKey: isCredit ? invoiceInfo.cycleKey : null,
      subtype: data.subtype || old.subtype,
      installmentTotal: Number(data.installmentTotal)||old.installmentTotal,
      installmentCurrent: Number(data.installmentCurrent)||old.installmentCurrent,
      paid: data.paid !== undefined ? !!data.paid : old.paid,
      paidDate: data.paid ? todayStr() : (data.paid === false ? null : old.paidDate),
    };
    Storage.setTransactions(txs);
  },

  deleteTransaction(id) {
    const txs = Storage.getTransactions();
    const tx  = txs.find(t => t.id === id);
    if (tx && tx.subtype === 'recurring' && !tx.isGenerated) {
      Storage.setTransactions(txs.filter(t =>
        t.id !== id && !(t.groupId === tx.groupId && t.isGenerated)
      ));
    } else {
      Storage.setTransactions(txs.filter(t => t.id !== id));
    }
  },

  // ── REBUILD INSTALLMENT SERIES ────────────────────────────────────────────
  //
  // Reconstrói a série parcelada quando o usuário altera a quantidade de parcelas.
  // Mantém parcelas já processadas (paid === true) intactas.
  // Cria novas parcelas para os índices adicionados.
  // Remove parcelas futuras/pendentes excedentes ao reduzir.
  // Atualiza installmentTotal em todas as parcelas remanescentes.
  //
  // Retorna { ok, message, created, removed, preserved } para log de auditoria.
  rebuildInstallmentSeries(groupId, newTotal, options = {}) {
    if (!groupId) return { ok: false, message: 'groupId ausente' };
    newTotal = Number(newTotal);
    if (!newTotal || newTotal < 1) return { ok: false, message: 'newTotal inválido' };

    const txs = Storage.getTransactions();
    const series = txs
      .filter(t => t.groupId === groupId && t.subtype === 'installment')
      .sort((a, b) => a.installmentCurrent - b.installmentCurrent);

    if (series.length === 0) return { ok: false, message: 'Série não encontrada' };

    const oldTotal = series[0].installmentTotal;

    console.log('[InstallmentAudit] groupId', groupId);
    console.log('[InstallmentAudit] oldCount', oldTotal);
    console.log('[InstallmentAudit] newCount', newTotal);
    console.log('[InstallmentAudit] existingInstallments', series.length);

    // Verificar se existem parcelas realizadas que impediriam a redução
    if (newTotal < oldTotal) {
      const processedBeyond = series.filter(t => t.installmentCurrent > newTotal && t.paid);
      if (processedBeyond.length > 0) {
        const msg = `Existem ${processedBeyond.length} parcela(s) já processada(s) além da nova quantidade (${newTotal}). Não é possível reduzir sem apagar histórico realizado.`;
        console.log('[InstallmentAudit] BLOQUEADO:', msg);
        return { ok: false, message: msg };
      }
    }

    // Preservar as parcelas que permanecem (1..newTotal)
    const preserved = series.filter(t => t.installmentCurrent <= newTotal);
    const toRemove  = series.filter(t => t.installmentCurrent > newTotal && !t.paid);

    console.log('[InstallmentAudit] preservedProcessedInstallments', preserved.filter(t => t.paid).length);
    console.log('[InstallmentAudit] removedInstallments', toRemove.length);

    // Remover excedentes não pagos
    const removeIds = new Set(toRemove.map(t => t.id));
    let updatedTxs = txs.filter(t => !removeIds.has(t.id));

    // Atualizar installmentTotal nas parcelas preservadas
    updatedTxs = updatedTxs.map(t => {
      if (t.groupId !== groupId || t.subtype !== 'installment') return t;
      return { ...t, installmentTotal: newTotal };
    });

    // Criar parcelas novas (caso newTotal > oldTotal)
    const existingNumbers = new Set(preserved.map(t => t.installmentCurrent));
    const created = [];

    if (newTotal > oldTotal) {
      // Encontrar a última parcela para calcular a data de início da sequência
      const lastExisting = preserved.length > 0
        ? preserved[preserved.length - 1]
        : series[series.length - 1];

      const lastDate    = parseLocalDate(lastExisting.dueDate);
      const lastDay     = lastDate.getDate();
      let   lastYear    = lastDate.getFullYear();
      let   lastMonth   = lastDate.getMonth();

      for (let i = oldTotal + 1; i <= newTotal; i++) {
        if (existingNumbers.has(i)) continue; // já existe (não deveria, mas protege)

        lastMonth++;
        if (lastMonth > 11) { lastMonth = 0; lastYear++; }

        const dueDate = buildDate(lastYear, lastMonth, lastDay);
        const isCredit = lastExisting.paymentMethod === 'credito';
        const card = isCredit ? _findCardById(lastExisting.cardId) : null;
        const invoiceInfo = isCredit ? getInvoiceForPurchase(dueDate, card) : null;

        const newTx = {
          id: genId(),
          groupId,
          type: lastExisting.type,
          subtype: 'installment',
          description: lastExisting.description,
          category: lastExisting.category,
          categoryId: lastExisting.categoryId || null,
          amount: lastExisting.amount,
          paymentMethod: lastExisting.paymentMethod,
          cardId: lastExisting.cardId || null,
          dueDate: isCredit ? invoiceInfo.dueDate : dueDate,
          purchaseDate: isCredit ? dueDate : null,
          invoiceCycleKey: isCredit ? invoiceInfo.cycleKey : null,
          paid: false,
          paidDate: null,
          installmentCurrent: i,
          installmentTotal: newTotal,
          createdAt: new Date().toISOString(),
          isGenerated: false,
          isQuick: false,
        };

        updatedTxs.push(newTx);
        created.push(newTx);
        console.log('[InstallmentAudit] createdInstallments parcela', i, 'vencimento', dueDate);
      }
    }

    Storage.setTransactions(updatedTxs);

    console.log('[InstallmentAudit] createdInstallments', created.length);

    return {
      ok: true,
      message: `Série atualizada: ${oldTotal} → ${newTotal} parcelas. ${created.length} criada(s), ${toRemove.length} removida(s).`,
      created,
      removed: toRemove,
      preserved,
    };
  },

  // ── TOGGLE PAID ────────────────────────────────────────────────────────────
  togglePaid(id) {
    if (id.startsWith('virtual_')) {
      this._materialiseAndPay(id);
      return;
    }

    const txs = Storage.getTransactions();
    const idx = txs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tx = txs[idx];

    if (!tx.paid) {
      tx.paid    = true;
      tx.paidDate = todayStr();
    } else {
      tx.paid    = false;
      tx.paidDate = null;
    }
    Storage.setTransactions(txs);
  },

  _materialiseAndPay(virtualId) {
    const parts   = virtualId.split('_');
    const month   = parseInt(parts.pop(), 10);
    const year    = parseInt(parts.pop(), 10);
    const groupId = parts.slice(1).join('_');

    const txs = Storage.getTransactions();
    const template = txs.find(t => t.groupId === groupId && t.subtype === 'recurring' && !t.isGenerated)
      || txs.find(t => t.groupId === groupId && t.subtype === 'recurring');
    if (!template) return;

    if (txs.some(t =>
      t.groupId === groupId && t.subtype === 'recurring' && t.isGenerated &&
      parseLocalDate(t.dueDate).getFullYear() === year &&
      parseLocalDate(t.dueDate).getMonth()    === month
    )) return;

    const day     = recurringDayOfMonth(template);
    const dueDate = buildDate(year, month, day);

    const newTx = {
      id: genId(),
      groupId,
      type: template.type,
      subtype: 'recurring',
      description: template.description,
      category: template.category,
      amount: template.amount,
      paymentMethod: template.paymentMethod,
      cardId: template.cardId || null,
      dueDate,
      paid: true,
      paidDate: todayStr(),
      installmentCurrent: 1,
      installmentTotal: 1,
      createdAt: new Date().toISOString(),
      isGenerated: true,
    };
    txs.push(newTx);
    Storage.setTransactions(txs);
  },

  // ── GET BY COMPETENCY (with virtual recurring projection) ──────────────────
  getByCompetency(year, month, type) {
    const allTxs = Storage.getTransactions();
    const result = [];
    const seenGroups = new Set();

    for (const tx of allTxs) {
      if (type && tx.type !== type) continue;

      if (tx.subtype === 'recurring') {
        if (seenGroups.has(tx.groupId)) continue;

        const isTemplate = !tx.isGenerated;
        if (!isTemplate) {
          const hasTemplate = allTxs.some(t =>
            t.groupId === tx.groupId && t.subtype === 'recurring' && !t.isGenerated
          );
          if (hasTemplate) continue;
        }

        seenGroups.add(tx.groupId);
        const occ = getRecurringOccurrence(tx, year, month, allTxs);
        if (occ) result.push(occ);
        continue;
      }

      // Non-recurring: match by dueDate month
      const d = parseLocalDate(tx.dueDate);
      if (d.getFullYear() === year && d.getMonth() === month) {
        result.push(tx);
      }
    }

    return result;
  },

  // ── MOTOR FINANCEIRO CENTRALIZADO ─────────────────────────────────────────
  //
  // Regras:
  //   - Mês encerrado (passado): saldo final realizado = saldo anterior + realizados
  //   - Mês vigente: saldo disponível = anterior + realizados | previsão = disponível + pendentes
  //   - Mês futuro: previsão encadeada a partir do mês anterior
  //
  // Uma única fonte de verdade para TODAS as telas.
  // ─────────────────────────────────────────────────────────────────────────

  // Retorna o delta realizado (entrada - saída) de um mês específico.
  // Somente valores com paid === true são incluídos.
  _getMonthRealizedDelta(year, month) {
    const txs = this.getByCompetency(year, month);

    const realizedIncome = txs
      .filter(t => t.type === 'income' && t.paid)
      .reduce((s, t) => s + t.amount, 0);

    const realizedExpenseNonCredit = txs
      .filter(t => t.type === 'expense' && t.paid && t.paymentMethod !== 'credito')
      .reduce((s, t) => s + t.amount, 0);

    const realizedInvoicePaid = txs
      .filter(t => t.type === 'expense' && t.paid && t.paymentMethod === 'credito')
      .reduce((s, t) => s + t.amount, 0);

    // Gastos rápidos: armazenados separadamente, sempre "pagos" no ato
    const quickExpenses = Storage.getQuickExpenses()
      .filter(q => {
        if (q.paymentMethod === 'credito') return false;
        const d = parseLocalDate(q.date || '');
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .reduce((s, q) => s + (Number(q.amount) || 0), 0);

    const goalContribs = sumProcessedGoalContributions(year, month);

    return realizedIncome - realizedExpenseNonCredit - realizedInvoicePaid - quickExpenses - goalContribs;
  },

  // Retorna o delta projetado (entrada - saída, incluindo pendentes) de um mês futuro.
  _getMonthProjectedDelta(year, month) {
    const txs = this.getByCompetency(year, month);

    const totalIncome = txs
      .filter(t => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);

    const totalExpenseNonCredit = txs
      .filter(t => t.type === 'expense' && t.paymentMethod !== 'credito')
      .reduce((s, t) => s + t.amount, 0);

    const totalInvoice = txs
      .filter(t => t.type === 'expense' && t.paymentMethod === 'credito')
      .reduce((s, t) => s + t.amount, 0);

    const goalTotal = sumPendingGoalContributions(year, month) + sumProcessedGoalContributions(year, month);

    return totalIncome - totalExpenseNonCredit - totalInvoice - goalTotal;
  },

  // Retorna o saldo de abertura do mês (saldo trazido do mês anterior).
  // Iterativo: parte do mês mais antigo e acumula mês a mês.
  // Nunca zera o saldo na virada.
  getMonthOpeningBalance(year, month) {
    const allTxs  = Storage.getTransactions().filter(t => !t._virtual);
    const allQuick = Storage.getQuickExpenses();

    const targetKey = year * 12 + month;

    // Encontrar o mês mais antigo com algum dado
    let earliestKey = targetKey;
    for (const t of allTxs) {
      const d = parseLocalDate(t.dueDate);
      const k = d.getFullYear() * 12 + d.getMonth();
      if (k < earliestKey) earliestKey = k;
    }
    for (const q of allQuick) {
      if (!q.date) continue;
      const d = parseLocalDate(q.date);
      const k = d.getFullYear() * 12 + d.getMonth();
      if (k < earliestKey) earliestKey = k;
    }

    // Não há histórico anterior — saldo inicial é R$ 0,00
    if (earliestKey >= targetKey) return 0;

    const today    = new Date();
    const todayKey = today.getFullYear() * 12 + today.getMonth();
    const prevKey  = targetKey - 1;

    let balance = 0;

    for (let key = earliestKey; key <= prevKey; key++) {
      const cy = Math.floor(key / 12);
      const cm = key % 12;

      if (key <= todayKey) {
        // Mês encerrado ou vigente: usar somente realizados
        balance += this._getMonthRealizedDelta(cy, cm);
      } else {
        // Mês futuro (entre o vigente e o mês-alvo - 1): usar projeção
        balance += this._getMonthProjectedDelta(cy, cm);
      }
    }

    return balance;
  },

  // ── SALDO DISPONÍVEL ──────────────────────────────────────────────────────
  //
  // Para o mês vigente:
  //   saldo disponível = saldo do mês anterior + realizados deste mês
  //
  // Para meses passados (encerrados):
  //   retorna o saldo final realizado (mesmo cálculo).
  //
  // Para meses futuros:
  //   retorna o saldo previsto de abertura (ainda não há "realizado" futuro).
  calcSaldoDisponivel(year, month) {
    const today = new Date();
    const todayKey = today.getFullYear() * 12 + today.getMonth();
    const targetKey = year * 12 + month;

    const opening = this.getMonthOpeningBalance(year, month);

    if (targetKey > todayKey) {
      // Mês futuro: saldo inicial previsto
      return opening;
    }

    // Mês vigente ou encerrado: opening + realizados
    return opening + this._getMonthRealizedDelta(year, month);
  },

  // ── PREVISÃO DO MÊS ───────────────────────────────────────────────────────
  //
  // Mês encerrado:   saldo final realizado (= calcSaldoDisponivel)
  // Mês vigente:     saldo disponível + entradas/saídas ainda pendentes
  // Meses futuros:   opening previsto + projeção do mês
  calcPrevisao(year, month) {
    const today = new Date();
    const todayYear  = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayKey   = todayYear * 12 + todayMonth;
    const targetKey  = year * 12 + month;

    // Mês encerrado: somente realizados, sem pendentes
    if (targetKey < todayKey) {
      return this.calcSaldoDisponivel(year, month);
    }

    const opening = this.getMonthOpeningBalance(year, month);

    if (targetKey === todayKey) {
      // Mês vigente: saldo disponível + pendentes
      const saldo = opening + this._getMonthRealizedDelta(year, month);

      const txs = this.getByCompetency(year, month);

      const entradasPendentes = txs
        .filter(t => t.type === 'income' && !t.paid)
        .reduce((s, t) => s + t.amount, 0);

      const despesasPendentes = txs
        .filter(t => t.type === 'expense' && !t.paid && t.paymentMethod !== 'credito')
        .reduce((s, t) => s + t.amount, 0);

      const faturaPendente = txs
        .filter(t => t.type === 'expense' && !t.paid && t.paymentMethod === 'credito')
        .reduce((s, t) => s + t.amount, 0);

      const goalPendente = sumPendingGoalContributions(year, month);

      return saldo + entradasPendentes - despesasPendentes - faturaPendente - goalPendente;
    }

    // Mês futuro: opening + projeção
    return opening + this._getMonthProjectedDelta(year, month);
  },

  // ── RESUMO DO MÊS ─────────────────────────────────────────────────────────
  calcSummary(year, month) {
    const all      = this.getByCompetency(year, month);
    const income   = all.filter(t => t.type === 'income');
    const expenses = all.filter(t => t.type === 'expense');
    const totalIncome   = income.reduce((s,t) => s+t.amount, 0);
    const totalExpenses = expenses.reduce((s,t) => s+t.amount, 0);
    const totalReceived = income.filter(t => t.paid).reduce((s,t) => s+t.amount, 0);
    const totalPaid     = expenses.filter(t => t.paid).reduce((s,t) => s+t.amount, 0);
    const totalPending  = expenses.filter(t => !t.paid).reduce((s,t) => s+t.amount, 0);
    const previsao = totalIncome - totalExpenses;
    return { totalIncome, totalExpenses, totalReceived, totalPaid, totalPending, previsao };
  },

  getReminders() {
    const now  = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    return this.getByCompetency(year, month, 'expense')
      .filter(t => !t.paid && ['overdue','today','tomorrow'].includes(getDueStatus(t.dueDate)))
      .map(t => ({ tx: t, status: getDueStatus(t.dueDate) }))
      .sort((a,b) => a.tx.dueDate > b.tx.dueDate ? 1 : -1);
  },

  getPendingForProcessing(year, month) {
    return this.getByCompetency(year, month, 'expense')
      .filter(t => !t.paid)
      .sort((a,b) => a.dueDate > b.dueDate ? 1 : -1);
  },

  processPayments(ids) {
    ids.forEach(id => this.togglePaid(id));
  },

  // ── CARD INVOICE ───────────────────────────────────────────────────────────
  getCardInvoice(year, month, card) {
    const activeCard = card || DEFAULT_CARD;
    const cycleKey = `${year}-${String(month+1).padStart(2,'0')}`;

    const txs = Storage.getTransactions().filter(tx => {
      if (tx.paymentMethod !== 'credito' || tx.type !== 'expense') return false;
      const txCardId = tx.cardId || 'default';
      if (txCardId !== activeCard.id) return false;
      const key = tx.invoiceCycleKey
        || getInvoiceForPurchase(tx.purchaseDate || tx.dueDate, activeCard).cycleKey;
      return key === cycleKey;
    });

    const total   = txs.reduce((s,t) => s+t.amount, 0);
    const allPaid = txs.length > 0 && txs.every(t => t.paid);
    const lbl     = invoiceLabel(cycleKey, activeCard.dueDay);
    return { transactions: txs, total, allPaid, cycleKey, ...lbl };
  },

  markInvoicePaid(year, month, card) {
    const activeCard = card || DEFAULT_CARD;
    const cycleKey = `${year}-${String(month+1).padStart(2,'0')}`;
    const txs = Storage.getTransactions();
    txs.forEach(tx => {
      if (tx.paymentMethod !== 'credito' || tx.type !== 'expense') return;
      const txCardId = tx.cardId || 'default';
      if (txCardId !== activeCard.id) return;
      const key = tx.invoiceCycleKey
        || getInvoiceForPurchase(tx.purchaseDate || tx.dueDate, activeCard).cycleKey;
      if (key === cycleKey && !tx.paid) { tx.paid = true; tx.paidDate = todayStr(); }
    });
    Storage.setTransactions(txs);
  },

  // ── CASH FLOW FORECAST ────────────────────────────────────────────────────
  calcCashFlowForecast(year, month) {
    const today = new Date();
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

    const events = [];

    this.getByCompetency(year, month, 'income')
      .filter(t => !t.paid)
      .forEach(t => events.push({
        date: t.dueDate, label: t.description,
        amount: t.amount, type: 'income',
      }));

    this.getByCompetency(year, month, 'expense')
      .filter(t => !t.paid && t.paymentMethod !== 'credito')
      .forEach(t => events.push({
        date: t.dueDate, label: t.description,
        amount: -t.amount, type: 'expense',
      }));

    const allCards = Storage.getCards();
    const cardsToCheck = allCards.length > 0 ? allCards : [DEFAULT_CARD];
    cardsToCheck.forEach(card => {
      const invoice = this.getCardInvoice(year, month, card);
      if (invoice.total <= 0 || invoice.allPaid) return;
      const dueDateStr = buildDate(year, month, card.dueDay);
      events.push({
        date: dueDateStr, label: `Fatura ${card.name}`,
        amount: -invoice.total, type: 'invoice',
      });
    });

    getGoalsForCompetency().forEach(g => {
      const occ = getGoalOccurrenceForMonth(g, year, month);
      if (!occ || occ.processed) return;
      events.push({
        date: occ.dueDate, label: `Aporte para ${g.name}`,
        amount: -occ.amount, type: 'goal',
      });
    });

    events.sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? 1 : -1;
      if (a.type === 'income' && b.type !== 'income') return -1;
      if (b.type === 'income' && a.type !== 'income') return 1;
      return 0;
    });

    const eventsTotal = events.reduce((s, ev) => s + ev.amount, 0);

    const startBalance = isCurrentMonth
      ? this.calcSaldoDisponivel(year, month)
      : this.calcPrevisao(year, month) - eventsTotal;

    let balance = startBalance;
    let minBalance = startBalance;
    let minDate = null;
    let firstNegativeDate = null;
    let recoveredDate = null;

    const timeline = events.map(ev => {
      balance += ev.amount;
      if (balance < minBalance) { minBalance = balance; minDate = ev.date; }
      if (balance < 0 && !firstNegativeDate) firstNegativeDate = ev.date;
      if (balance >= 0 && firstNegativeDate && !recoveredDate) recoveredDate = ev.date;
      return { ...ev, balanceAfter: balance };
    });

    return {
      startBalance,
      events: timeline,
      minBalance,
      minDate,
      firstNegativeDate,
      recoveredDate,
      finalBalance: balance,
      hasNegativePeriod: minBalance < 0,
    };
  },

  // ── GOALS ──────────────────────────────────────────────────────────────────
  addGoal(data) {
    const goals = Storage.getGoals();
    const now = new Date().toISOString();
    const g = {
      id: genId(),
      name: (data.name || '').trim(),
      emoji: data.emoji || '🎯',
      target: Number(data.target),
      saved: Number(data.saved) || 0,
      deadline: data.deadline || '',
      monthlyContribution: Number(data.monthlyContribution) || 0,
      contributionDay: Math.min(31, Math.max(1, Number(data.contributionDay) || 10)),
      priority: data.priority || 'media',
      status: 'active',
      startDate: todayStr(),
      history: [],
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };
    goals.push(g);
    Storage.setGoals(goals);
    return g;
  },

  updateGoal(id, data) {
    const goals = Storage.getGoals();
    const idx = goals.findIndex(g => g.id === id);
    if (idx === -1) return;
    const old = goalDefaults(goals[idx]);
    const newMonthly = data.monthlyContribution !== undefined
      ? (Number(data.monthlyContribution) || 0) : old.monthlyContribution;
    const newDay = data.contributionDay !== undefined
      ? Math.min(31, Math.max(1, Number(data.contributionDay) || old.contributionDay)) : old.contributionDay;
    const startDate = (old.monthlyContribution <= 0 && newMonthly > 0) ? todayStr() : old.startDate;

    goals[idx] = {
      ...old,
      name: (data.name || '').trim(),
      emoji: data.emoji || old.emoji || '🎯',
      target: Number(data.target),
      saved: data.saved !== undefined ? (Number(data.saved) || 0) : old.saved,
      deadline: data.deadline !== undefined ? data.deadline : old.deadline,
      monthlyContribution: newMonthly,
      contributionDay: newDay,
      priority: data.priority || old.priority,
      startDate,
      updatedAt: new Date().toISOString(),
    };
    if (goals[idx].status === 'completed' && goalRemaining(goals[idx]) > 0) goals[idx].status = 'active';
    if (goalRemaining(goals[idx]) <= 0) goals[idx].status = 'completed';
    Storage.setGoals(goals);
  },

  addToGoal(id, amount) {
    const goals = Storage.getGoals();
    const idx = goals.findIndex(g => g.id === id);
    if (idx === -1) return;
    const g = goalDefaults(goals[idx]);
    const amt = Math.abs(Number(amount)) || 0;
    const newSaved = Math.min(g.saved + amt, g.target);
    const actuallyAdded = newSaved - g.saved;
    g.saved = newSaved;
    g.history = [{
      id: genId(), competency: null, date: todayStr(),
      amount: actuallyAdded, origin: 'manual', accumulated: newSaved,
    }, ...g.history];
    if (g.saved >= g.target) g.status = 'completed';
    g.updatedAt = new Date().toISOString();
    goals[idx] = g;
    Storage.setGoals(goals);
  },

  processGoalContribution(goalId, competency) {
    const goals = Storage.getGoals();
    const idx = goals.findIndex(g => g.id === goalId);
    if (idx === -1) return;
    const g = goalDefaults(goals[idx]);
    if (g.history.some(h => h.origin === 'scheduled' && h.competency === competency)) return;

    const remaining = goalRemaining(g);
    if (remaining <= 0) { g.status = 'completed'; goals[idx] = g; Storage.setGoals(goals); return; }

    const [cy, cm] = competency.split('-').map(Number);
    const dueDate = buildDate(cy, cm - 1, g.contributionDay);
    const amount = Math.min(g.monthlyContribution, remaining);
    const newSaved = g.saved + amount;

    g.saved = newSaved;
    g.history = [{
      id: `${goalId}::${competency}`, competency, date: dueDate,
      amount, origin: 'scheduled', accumulated: newSaved,
    }, ...g.history];
    if (newSaved >= g.target) g.status = 'completed';
    g.updatedAt = new Date().toISOString();
    goals[idx] = g;
    Storage.setGoals(goals);
  },

  pauseGoal(id) {
    const goals = Storage.getGoals();
    const idx = goals.findIndex(g => g.id === id);
    if (idx === -1) return;
    goals[idx].status = 'paused';
    goals[idx].updatedAt = new Date().toISOString();
    Storage.setGoals(goals);
  },

  resumeGoal(id) {
    const goals = Storage.getGoals();
    const idx = goals.findIndex(g => g.id === id);
    if (idx === -1) return;
    const g = goalDefaults(goals[idx]);
    g.status = 'active';
    const today = new Date();
    let ny = today.getFullYear(), nm = today.getMonth() + 1;
    if (nm > 11) { nm = 0; ny++; }
    g.startDate = buildDate(ny, nm, 1);
    g.updatedAt = new Date().toISOString();
    goals[idx] = g;
    Storage.setGoals(goals);
  },

  deleteGoal(id) {
    const goals = Storage.getGoals();
    const idx = goals.findIndex(g => g.id === id);
    if (idx === -1) return;
    goals[idx].deleted = true;
    goals[idx].status = 'deleted';
    goals[idx].updatedAt = new Date().toISOString();
    Storage.setGoals(goals);
  },

  getGoalById(id) {
    const g = Storage.getGoals().find(g => g.id === id);
    return g ? goalDefaults(g) : null;
  },

  getActiveGoals() {
    const order = { alta: 0, media: 1, baixa: 2 };
    return getGoalsForCompetency().sort((a, b) => {
      const pa = order[a.priority] ?? 1, pb = order[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1;
    });
  },

  goalRemaining,
  goalMonthsNeeded,
  goalEstimatedCompletion,
  getGoalOccurrenceForMonth,
  getGoalUpcomingOccurrences(goal, maxCount) { return projectGoalOccurrences(goal, maxCount); },

  getGoalSavedTotalForMonth(year, month) {
    const key = goalCompetencyKey(year, month);
    return getGoalsForCompetency().reduce((s, g) => {
      const monthTotal = g.history.filter(h => {
        if (h.origin === 'scheduled') return h.competency === key;
        if (!h.date) return false;
        const d = parseLocalDate(h.date);
        return d.getFullYear() === year && d.getMonth() === month;
      }).reduce((s2, h) => s2 + h.amount, 0);
      return s + monthTotal;
    }, 0);
  },
};

// ─── HELPER: buscar card pelo id ─────────────────────────────────────────────
function _findCardById(cardId) {
  if (!cardId) return DEFAULT_CARD;
  const cards = Storage.getCards();
  return cards.find(c => c.id === cardId) || DEFAULT_CARD;
}
