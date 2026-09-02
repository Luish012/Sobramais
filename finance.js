'use strict';

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

  // Dia efetivo de fechamento: se o mês tem menos dias que o fechamento configurado
  // (ex.: fechamento dia 31 em fevereiro → usa o último dia válido do mês).
  const daysInPurchaseMonth = new Date(pYear, pMonth + 1, 0).getDate();
  const effectiveClosingDay = Math.min(closingDay, daysInPurchaseMonth);

  // No próprio dia do fechamento (ou depois) → compra vai para a PRÓXIMA fatura
  // Antes do fechamento → fatura do mês seguinte normal
  let invMonth = pMonth + 1;
  if (day >= effectiveClosingDay) invMonth = pMonth + 2;

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

function addMonthsToDateString(str, offset) {
  const d = parseLocalDate(str);
  const absoluteMonth = d.getFullYear() * 12 + d.getMonth() + offset;
  const year = Math.floor(absoluteMonth / 12);
  const month = ((absoluteMonth % 12) + 12) % 12;
  return buildDate(year, month, d.getDate());
}

function dateIsInMonth(str, year, month) {
  if (!str) return false;
  const d = parseLocalDate(str);
  return d.getFullYear() === year && d.getMonth() === month;
}

function transactionRealDate(tx) {
  // paidDate is the real cash movement date. The fallback keeps old records
  // usable when they were saved before this distinction existed.
  return tx.paidDate || tx.dueDate;
}

function monthIsBefore(year, month, refYear, refMonth) {
  return year < refYear || (year === refYear && month < refMonth);
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

function sumRealizedGoalContributions(year, month) {
  return getGoalsForCompetency().reduce((s, g) =>
    s + g.history
      .filter(h => h.origin === 'scheduled' && dateIsInMonth(h.realDate || h.date, year, month))
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

  updateInstallmentSeries(id, data) {
    const txs = Storage.getTransactions();
    const source = txs.find(t => t.id === id);
    if (!source || source.subtype !== 'installment' || !source.groupId) {
      this.updateTransaction(id, data);
      return;
    }

    const series = txs
      .filter(t => t.groupId === source.groupId && t.subtype === 'installment')
      .sort((a, b) => (a.installmentCurrent || 0) - (b.installmentCurrent || 0));
    const targetTotal = Math.max(1, Number(data.installmentTotal) || source.installmentTotal || 1);
    const anchorDate = series[0].purchaseDate || series[0].dueDate;
    const isCredit = (data.paymentMethod || source.paymentMethod) === 'credito';
    const cardId = isCredit ? (data.cardId || source.cardId || 'default') : null;
    const card = isCredit ? _findCardById(cardId) : null;
    const used = new Set();
    const updated = [];

    const applySlot = (row, slot) => {
      if (row.paid) {
        // A paid installment is historical data: preserve its amount, date and
        // label instead of changing it retroactively.
        used.add(row.id);
        updated.push(row);
        return;
      }

      const occurrenceDate = addMonthsToDateString(anchorDate, slot - 1);
      const invoiceInfo = isCredit ? getInvoiceForPurchase(occurrenceDate, card) : null;
      Object.assign(row, {
        description: (data.description || source.description || '').trim(),
        category: data.category || source.category || 'Outros',
        categoryId: 'categoryId' in data ? (data.categoryId || null) : row.categoryId || null,
        amount: Math.abs(Number(data.amount) || row.amount),
        paymentMethod: data.paymentMethod || source.paymentMethod,
        cardId,
        dueDate: isCredit ? invoiceInfo.dueDate : occurrenceDate,
        purchaseDate: isCredit ? occurrenceDate : null,
        invoiceCycleKey: isCredit ? invoiceInfo.cycleKey : null,
        installmentCurrent: slot,
        installmentTotal: targetTotal,
      });
      used.add(row.id);
      updated.push(row);
    };

    for (let slot = 1; slot <= targetTotal; slot++) {
      const exact = series.find(t => !used.has(t.id) && t.installmentCurrent === slot);
      const row = exact || series.find(t => !used.has(t.id) && !t.paid);
      if (row) {
        applySlot(row, slot);
        continue;
      }

      const occurrenceDate = addMonthsToDateString(anchorDate, slot - 1);
      const invoiceInfo = isCredit ? getInvoiceForPurchase(occurrenceDate, card) : null;
      const newTx = {
        id: genId(),
        groupId: source.groupId,
        type: source.type,
        subtype: 'installment',
        description: (data.description || source.description || '').trim(),
        category: data.category || source.category || 'Outros',
        categoryId: 'categoryId' in data ? (data.categoryId || null) : source.categoryId || null,
        amount: Math.abs(Number(data.amount) || source.amount),
        paymentMethod: data.paymentMethod || source.paymentMethod,
        cardId,
        dueDate: isCredit ? invoiceInfo.dueDate : occurrenceDate,
        purchaseDate: isCredit ? occurrenceDate : null,
        invoiceCycleKey: isCredit ? invoiceInfo.cycleKey : null,
        paid: false,
        paidDate: null,
        installmentCurrent: slot,
        installmentTotal: targetTotal,
        createdAt: new Date().toISOString(),
        isGenerated: false,
        isQuick: !!source.isQuick,
      };
      updated.push(newTx);
    }

    // Future unpaid occurrences beyond the new total are cancelled by removal.
    // Paid occurrences are always appended unchanged, even when they exceed
    // the new total, so historical payments can never disappear silently.
    series.forEach(row => {
      if (!used.has(row.id) && row.paid) updated.push(row);
    });

    const ids = new Set(updated.map(t => t.id));
    const firstIndex = txs.findIndex(t => t.id === source.id);
    const before = txs.slice(0, firstIndex).filter(t => !(t.groupId === source.groupId && t.subtype === 'installment'));
    const after = txs.slice(firstIndex + 1).filter(t => !(t.groupId === source.groupId && t.subtype === 'installment'));
    // Preserve the series position in the list while replacing every member.
    const rebuilt = [...before, ...updated, ...after];
    Storage.setTransactions(rebuilt.filter(t => ids.has(t.id) || t.groupId !== source.groupId || t.subtype !== 'installment'));
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
    const previsao = this.calcPrevisao(year, month);
    return { totalIncome, totalExpenses, totalReceived, totalPaid, totalPending, previsao };
  },

  // ── COMPETÊNCIA, DATA REAL E SALDO INICIAL ─────────────────────────────────
  // O mês do dueDate continua sendo a competência. O mês do paidDate é o mês
  // em que o dinheiro realmente entrou ou saiu.
  isMonthClosed(year, month) {
    const today = new Date();
    return monthIsBefore(year, month, today.getFullYear(), today.getMonth());
  },

  getMonthOpeningBalance(year, month) {
    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    // Uma previsão futura nunca vira saldo inicial. Só o mês anterior já
    // encerrado pode carregar seu saldo real para este mês.
    return this.isMonthClosed(py, pm) ? this._calcClosedMonthFinal(py, pm, 0) : 0;
  },

  _getRealMovements(year, month) {
    const txs = Storage.getTransactions().filter(t =>
      t.paid && dateIsInMonth(transactionRealDate(t), year, month)
    );
    const income = txs.filter(t => t.type === 'income')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const expenses = txs.filter(t => t.type === 'expense')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const quick = Storage.getQuickExpenses()
      .filter(q => q.paymentMethod !== 'credito' && dateIsInMonth(q.date, year, month))
      .reduce((s, q) => s + Number(q.amount || 0), 0);
    return {
      income,
      expenses: expenses + quick,
      goals: sumRealizedGoalContributions(year, month),
    };
  },

  // Saldo disponível é dinheiro real, independentemente da competência do
  // lançamento. Isso inclui uma conta/parcela futura paga antecipadamente.
  calcSaldoDisponivel(year, month) {
    const real = this._getRealMovements(year, month);
    return this.getMonthOpeningBalance(year, month) + real.income - real.expenses - real.goals;
  },

  _pendingForForecast(year, month) {
    const txs = this.getByCompetency(year, month);
    return {
      income: txs.filter(t => t.type === 'income' && !t.paid)
        .reduce((s, t) => s + Number(t.amount || 0), 0),
      expenses: txs.filter(t => t.type === 'expense' && !t.paid)
        .reduce((s, t) => s + Number(t.amount || 0), 0),
      goals: sumPendingGoalContributions(year, month),
    };
  },

  // ── PREVISÃO INTELIGENTE (fonte única) ──────────────────────────────────────
  // Mês atual: saldo real até hoje + compromissos ainda pendentes na
  // competência atual. Mês futuro: somente o próprio resultado previsto,
  // acrescido do saldo real do mês anterior se ele já estiver encerrado.
  calcPrevisao(year, month) {
    const today = new Date();
    const currentYear = today.getFullYear(), currentMonth = today.getMonth();
    const isCurrent = year === currentYear && month === currentMonth;
    if (monthIsBefore(year, month, currentYear, currentMonth)) {
      return this.calcSaldoFinalMesEncerrado(year, month).saldoFinal;
    }

    const pending = this._pendingForForecast(year, month);
    const base = isCurrent
      ? this.calcSaldoDisponivel(year, month)
      : this.getMonthOpeningBalance(year, month);
    return base + pending.income - pending.expenses - pending.goals;
  },

  // ── AUDITORIA (uso interno/depuração) ───────────────────────────────────────
  // Detalhamento numérico de como o saldo/previsão de um mês foi produzido —
  // não é usado por nenhuma tela, apenas disponível para inspeção (ex.: no
  // console: Finance.getFinanceAudit(2026,7) para agosto/2026).
  getFinanceAudit(year, month) {
    const txs = this.getByCompetency(year, month);
    const realizedIncome    = txs.filter(t => t.type === 'income'  && t.paid).reduce((s,t)=>s+t.amount,0);
    const pendingIncome     = txs.filter(t => t.type === 'income'  && !t.paid).reduce((s,t)=>s+t.amount,0);
    const realizedExpenses  = txs.filter(t => t.type === 'expense' && t.paid  && t.paymentMethod !== 'credito').reduce((s,t)=>s+t.amount,0);
    const pendingExpenses   = txs.filter(t => t.type === 'expense' && !t.paid && t.paymentMethod !== 'credito').reduce((s,t)=>s+t.amount,0);
    const paidInvoices      = txs.filter(t => t.type === 'expense' && t.paid  && t.paymentMethod === 'credito').reduce((s,t)=>s+t.amount,0);
    const pendingInvoices   = txs.filter(t => t.type === 'expense' && !t.paid && t.paymentMethod === 'credito').reduce((s,t)=>s+t.amount,0);
    const realizedContributions = sumRealizedGoalContributions(year, month);
    const pendingContributions  = sumPendingGoalContributions(year, month);
    return {
      month: `${year}-${String(month+1).padStart(2,'0')}`,
      previousBalance: this.getMonthOpeningBalance(year, month),
      realizedIncome, pendingIncome, realizedExpenses, pendingExpenses,
      paidInvoices, pendingInvoices, realizedContributions, pendingContributions,
      availableBalance: this.calcSaldoDisponivel(year, month),
      forecast: this.calcPrevisao(year, month),
    };
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
  // O fluxo acompanha exatamente a regra da previsão: eventos pendentes da
  // competência e, para mês futuro, somente o saldo real de um mês anterior
  // que já tenha sido encerrado.
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

    const startBalance = isCurrentMonth
      ? this.calcSaldoDisponivel(year, month)
      : this.getMonthOpeningBalance(year, month);

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

  // ── SALDO FINAL MÊS ENCERRADO ──────────────────────────────────────────────
  // Calcula o saldo consolidado de um mês já encerrado sem usar a rotina de
  // previsão. Retorna saldoFinal, saldoMesAnterior e os componentes realizados.
  calcSaldoFinalMesEncerrado(year, month) {
    let prevYear = year, prevMonth = month - 1;
    if (prevMonth < 0) { prevMonth = 11; prevYear--; }
    const saldoMesAnterior = this.isMonthClosed(prevYear, prevMonth)
      ? this._calcClosedMonthFinal(prevYear, prevMonth, 0)
      : 0;
    const real = this._getRealMovements(year, month);
    const saldoFinal = saldoMesAnterior + real.income - real.expenses - real.goals;
    return {
      saldoFinal,
      saldoMesAnterior,
      entradasRealizadas: real.income,
      saidasRealizadas: real.expenses,
      faturasPagas: 0,
      aportesRealizados: real.goals,
    };
  },

  _calcClosedMonthFinal(year, month, depth) {
    if (depth >= 120) return 0;
    let prevYear = year, prevMonth = month - 1;
    if (prevMonth < 0) { prevMonth = 11; prevYear--; }
    const opening = this.isMonthClosed(prevYear, prevMonth)
      ? this._calcClosedMonthFinal(prevYear, prevMonth, depth + 1)
      : 0;
    const real = this._getRealMovements(year, month);
    return opening + real.income - real.expenses - real.goals;
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
      id: `${goalId}::${competency}`, competency, date: dueDate, realDate: todayStr(),
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
