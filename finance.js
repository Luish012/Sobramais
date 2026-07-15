'use strict';

const INCOME_CATEGORIES = ['Salário','Comissão','Freelance','Bônus','Renda Extra','Aluguel','Investimento','Outros'];
const EXPENSE_CATEGORIES = ['Alimentação','Transporte','Saúde','Moradia','Lazer','Educação','Roupas','Tecnologia','Assinatura','Outros'];
const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ─── CARTÃO PADRÃO ────────────────────────────────────────────────────────────
const DEFAULT_CARD = { id: 'default', name: 'Cartão de crédito', closingDay: 30, dueDay: 8 };

// ─── CARD BILLING RULES ───────────────────────────────────────────────────────
// Regra geral:
//   Se compra <= fechamento → fatura do mês seguinte, vencendo no dueDay
//   Se compra > fechamento  → fatura do mês subsequente, vencendo no dueDay
//
// card pode ser undefined/null → usa DEFAULT_CARD (closingDay=30, dueDay=8)

function getInvoiceForPurchase(purchaseDateStr, card) {
  const closingDay = (card && card.closingDay) || DEFAULT_CARD.closingDay;
  const dueDay     = (card && card.dueDay)     || DEFAULT_CARD.dueDay;

  const d = parseLocalDate(purchaseDateStr);
  const day    = d.getDate();
  const pMonth = d.getMonth();
  const pYear  = d.getFullYear();

  // compras até o fechamento → fatura do próximo mês
  // compras depois do fechamento → fatura do mês seguinte ao próximo
  let invMonth = pMonth + 1;
  if (day > closingDay) invMonth = pMonth + 2;

  let invYear = pYear;
  if (invMonth > 11) { invYear += Math.floor(invMonth / 12); invMonth = invMonth % 12; }

  // Garantir que dueDay não ultrapasse o número de dias do mês de vencimento
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

// Build a YYYY-MM-DD date for a given year/month (0-indexed) and day.
// Handles day overflow: if month has fewer days, clamps to last day.
function buildDate(year, month, day) {
  const max = new Date(year, month + 1, 0).getDate();
  return `${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(day, max)).padStart(2,'0')}`;
}

// ─── RECURRING OCCURRENCE PROJECTOR ──────────────────────────────────────────
//
// DESIGN:
//   Recurring items are stored as a single "template" record (subtype='recurring').
//   Future occurrences are VIRTUALLY PROJECTED on demand — never pre-generated.
//   Paying an occurrence materialises exactly ONE real row for that month.
//   Navigating to any future month always shows the correct recurring items.

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

  // Look for a real stored occurrence for this group + month
  const real = allTxs.find(t =>
    t !== tx &&
    t.groupId === tx.groupId &&
    t.subtype === 'recurring' &&
    t.isGenerated === true &&
    parseLocalDate(t.dueDate).getFullYear() === year &&
    parseLocalDate(t.dueDate).getMonth() === month
  );
  if (real) return real;

  // If the template itself falls in this month, return it as-is
  const tStart = recurringStart(tx);
  if (tStart.year === year && tStart.month === month) return tx;

  // Return a virtual (unpersisted) projection
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

// ─── GOALS: HELPERS (Objetivos com Poupança Programada) ──────────────────────
// Metas antigas (sem os novos campos) continuam funcionando: valores padrão
// são aplicados apenas em memória, nunca reescritos silenciosamente no
// registro salvo — só passam a persistir quando o usuário editar a meta.
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

// Meses necessários = arredondar para cima((meta - guardado) / aporte mensal)
function goalMonthsNeeded(g) {
  const remaining = goalRemaining(g);
  if (remaining <= 0) return 0;
  if (!g.monthlyContribution || g.monthlyContribution <= 0) return null;
  return Math.ceil(remaining / g.monthlyContribution);
}

// Data prevista de conclusão a partir de hoje, respeitando o dia do aporte
// (dias além do fim do mês usam o último dia válido — via buildDate).
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

// Retorna a ocorrência (compromisso) de aporte programado de uma meta para o
// competência (year, month) informado — ou null se não houver ocorrência
// naquele mês (meta pausada/concluída, sem aporte definido, ou mês anterior
// ao início do cronograma). Se já processada, retorna com processed:true.
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
  if (remaining <= 0) return null; // meta alcançada — sem novos compromissos

  const amount = Math.min(g.monthlyContribution, remaining); // última ocorrência pode ser menor
  const dueDate = buildDate(year, month, g.contributionDay);
  return { id: `${g.id}::${key}`, goalId: g.id, competency: key, dueDate, amount, processed: false };
}

// Projeta os próximos compromissos (visual) simulando a redução do restante
// a cada ocorrência não processada — usado apenas para pré-visualização,
// nunca grava nada.
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

    // purchaseDate: for credit, use the explicit purchaseDate or the raw dueDate the user entered
    const purchaseDate = isCredit ? (data.purchaseDate || data.dueDate || todayStr()) : null;

    // Usar o cardId passado; fallback para 'default' para compatibilidade
    const cardId = isCredit ? (data.cardId || 'default') : null;

    // Buscar card para calcular fatura corretamente
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
      // For credit: dueDate stored = invoice due date; for others: the date entered
      dueDate: isCredit ? invoiceInfo.dueDate : (data.dueDate || todayStr()),
      purchaseDate,
      invoiceCycleKey: isCredit ? invoiceInfo.cycleKey : null,
      paid: !!data.paid,
      paidDate: data.paid ? todayStr() : null,
      installmentCurrent: Number(data.installmentCurrent)||1,
      installmentTotal: Number(data.installmentTotal)||1,
      createdAt: new Date().toISOString(),
      isGenerated: !!data.isGenerated,
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
      // Template: remove template + all generated children
      Storage.setTransactions(txs.filter(t =>
        t.id !== id && !(t.groupId === tx.groupId && t.isGenerated)
      ));
    } else {
      Storage.setTransactions(txs.filter(t => t.id !== id));
    }
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

  // Materialise a virtual recurring occurrence and mark it paid
  _materialiseAndPay(virtualId) {
    // virtualId format: "virtual_{groupId}_{year}_{month}"
    const parts   = virtualId.split('_');
    const month   = parseInt(parts.pop(), 10);
    const year    = parseInt(parts.pop(), 10);
    const groupId = parts.slice(1).join('_'); // remove leading "virtual"

    const txs = Storage.getTransactions();
    const template = txs.find(t => t.groupId === groupId && t.subtype === 'recurring' && !t.isGenerated)
      || txs.find(t => t.groupId === groupId && t.subtype === 'recurring');
    if (!template) return;

    // Guard: don't create if already exists
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

  // ── SUMMARY ────────────────────────────────────────────────────────────────
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

  // ── SALDO DISPONÍVEL (apenas mês vigente) ──────────────────────────────────
  calcSaldoDisponivel(year, month) {
    const txs = this.getByCompetency(year, month);

    const totalReceived = txs
      .filter(t => t.type === 'income' && t.paid)
      .reduce((s, t) => s + t.amount, 0);

    const totalPaidNonCredit = txs
      .filter(t => t.type === 'expense' && t.paid && t.paymentMethod !== 'credito')
      .reduce((s, t) => s + t.amount, 0);

    const invoicePaid = txs
      .filter(t => t.type === 'expense' && t.paid && t.paymentMethod === 'credito')
      .reduce((s, t) => s + t.amount, 0);

    const quickTotal = Storage.getQuickExpenses()
      .filter(q => {
        if (q.paymentMethod === 'credito') return false;
        const d = new Date(q.date + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .reduce((s, q) => s + (Number(q.amount) || 0), 0);

    const goalProcessed = sumProcessedGoalContributions(year, month);

    return totalReceived - totalPaidNonCredit - invoicePaid - quickTotal - goalProcessed;
  },

  // ── PREVISÃO INTELIGENTE ───────────────────────────────────────────────────
  calcPrevisao(year, month) {
    const today = new Date();
    const todayYear = today.getFullYear(), todayMonth = today.getMonth();
    const isCurrentMonth = year === todayYear && month === todayMonth;

    let nextY = todayYear, nextM = todayMonth + 1;
    if (nextM > 11) { nextM = 0; nextY++; }
    const isNextMonth = year === nextY && month === nextM;

    if (isCurrentMonth) {
      const txs  = this.getByCompetency(year, month);
      const saldo = this.calcSaldoDisponivel(year, month);

      const entradasPendentes  = txs.filter(t => t.type === 'income'  && !t.paid)
                                     .reduce((s, t) => s + t.amount, 0);
      const despesasPendentes  = txs.filter(t => t.type === 'expense' && !t.paid && t.paymentMethod !== 'credito')
                                     .reduce((s, t) => s + t.amount, 0);
      const faturaPendente     = txs.filter(t => t.type === 'expense' && !t.paid && t.paymentMethod === 'credito')
                                     .reduce((s, t) => s + t.amount, 0);

      const totalReceived = txs.filter(t => t.type === 'income' && t.paid).reduce((s, t) => s + t.amount, 0);
      const quickNonCredit = Storage.getQuickExpenses()
        .filter(q => {
          if (q.paymentMethod === 'credito') return false;
          const d = new Date(q.date + 'T00:00:00');
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((s, q) => s + (Number(q.amount) || 0), 0);

      const goalPendente = sumPendingGoalContributions(year, month);

      if (totalReceived === 0 && quickNonCredit === 0) {
        const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        return inc - exp - goalPendente;
      }

      return saldo + entradasPendentes - despesasPendentes - faturaPendente - goalPendente;
    }

    if (isNextMonth) {
      const prevPrevisao = this.calcPrevisao(todayYear, todayMonth);
      const txs = this.getByCompetency(year, month);
      const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      return prevPrevisao + inc - exp - sumPendingGoalContributions(year, month);
    }

    const txs = this.getByCompetency(year, month);
    const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return inc - exp - sumPendingGoalContributions(year, month);
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
  // card: objeto com { id, closingDay, dueDay } — se omitido usa DEFAULT_CARD
  getCardInvoice(year, month, card) {
    const activeCard = card || DEFAULT_CARD;
    const cycleKey = `${year}-${String(month+1).padStart(2,'0')}`;

    const txs = Storage.getTransactions().filter(tx => {
      if (tx.paymentMethod !== 'credito' || tx.type !== 'expense') return false;
      // Compatibilidade: cardId null ou 'default' ambos mapeiam para 'default'
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
  // Retorna projeção dia-a-dia do saldo para QUALQUER mês (ano, mês).
  // Detecta se e quando o saldo ficará negativo.
  //
  // Regra do saldo inicial (não deve nunca divergir do card "Previsão do Mês"):
  //   - Mês vigente: usa o saldo disponível real (calcSaldoDisponivel), exatamente
  //     como já funcionava antes desta função aceitar outros meses.
  //   - Qualquer outro mês (passado ou futuro): o saldo final da projeção é
  //     travado para ser sempre igual a calcPrevisao(year, month) — a mesma
  //     função e regra já usadas pelo card "Previsão do Mês" — calculando o
  //     saldo inicial em função disso, garantindo zero divergência.
  calcCashFlowForecast(year, month) {
    const today = new Date();
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

    const events = [];

    // Entradas pendentes (listadas individualmente)
    this.getByCompetency(year, month, 'income')
      .filter(t => !t.paid)
      .forEach(t => events.push({
        date: t.dueDate, label: t.description,
        amount: t.amount, type: 'income',
      }));

    // Despesas não-crédito pendentes (listadas individualmente)
    this.getByCompetency(year, month, 'expense')
      .filter(t => !t.paid && t.paymentMethod !== 'credito')
      .forEach(t => events.push({
        date: t.dueDate, label: t.description,
        amount: -t.amount, type: 'expense',
      }));

    // Faturas de cartão (agrupadas por cartão — sem duplicar compras individuais)
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

    // Aportes programados de metas (Guardar) — reduzem o fluxo previsto,
    // sem entrar em "Pagar contas" nem nos relatórios de gasto.
    getGoalsForCompetency().forEach(g => {
      const occ = getGoalOccurrenceForMonth(g, year, month);
      if (!occ || occ.processed) return;
      events.push({
        date: occ.dueDate, label: `Aporte para ${g.name}`,
        amount: -occ.amount, type: 'goal',
      });
    });

    // Ordenar por data; na mesma data, entradas antes das saídas
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? 1 : -1;
      if (a.type === 'income' && b.type !== 'income') return -1;
      if (b.type === 'income' && a.type !== 'income') return 1;
      return 0;
    });

    const eventsTotal = events.reduce((s, ev) => s + ev.amount, 0);

    // Mês vigente: comportamento 100% original (saldo disponível real).
    // Demais meses: parte-se de calcPrevisao(year, month) — a MESMA função
    // usada pelo card "Previsão do Mês" — e o saldo inicial é derivado dela,
    // de forma que startBalance + eventsTotal === calcPrevisao(year, month)
    // sempre, sem exceção.
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

  // ── GOALS (Objetivos com Poupança Programada) ───────────────────────────────
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
    // Se o aporte mensal estava zerado e passou a existir agora, o cronograma
    // começa a contar a partir de hoje (não retroage).
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
    // Reavaliar conclusão após a edição (ex.: aumento da meta reabre um objetivo concluído)
    if (goals[idx].status === 'completed' && goalRemaining(goals[idx]) > 0) goals[idx].status = 'active';
    if (goalRemaining(goals[idx]) <= 0) goals[idx].status = 'completed';
    Storage.setGoals(goals);
  },

  // Aporte manual (botão "Guardar Dinheiro") — comportamento original preservado:
  // não mexe em saldo/previsão, apenas soma ao valor guardado da meta.
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

  // Processa o aporte programado (mensal) de uma competência — chamado pelo
  // modal Receber/Pagar › Guardar. Reduz saldo/previsão (via sumProcessed/
  // sumPending acima), aumenta o valor guardado e registra no histórico.
  // Idempotente: uma mesma competência nunca é processada duas vezes.
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
    // Reinicia no próximo mês válido (não gera compromissos retroativos)
    const today = new Date();
    let ny = today.getFullYear(), nm = today.getMonth() + 1;
    if (nm > 11) { nm = 0; ny++; }
    g.startDate = buildDate(ny, nm, 1);
    g.updatedAt = new Date().toISOString();
    goals[idx] = g;
    Storage.setGoals(goals);
  },

  // Exclusão lógica: preserva o histórico de aportes já processados (para
  // não alterar retroativamente saldo/previsão de meses fechados) e cancela
  // compromissos futuros, removendo a meta apenas das listagens ativas.
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

  // Metas ativas (não excluídas), normalizadas e ordenadas por prioridade
  // (Alta > Média > Baixa) e, dentro da mesma prioridade, mais recente primeiro.
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

  // Total guardado (manual + programado) no mês informado — usado apenas na
  // seção informativa "Valores guardados" dos relatórios, nunca somado ao
  // total de gastos.
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

// ─── HELPER: buscar card pelo id (acessa Storage) ────────────────────────────
function _findCardById(cardId) {
  if (!cardId) return DEFAULT_CARD;
  const cards = Storage.getCards();
  return cards.find(c => c.id === cardId) || DEFAULT_CARD;
}
