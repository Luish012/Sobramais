'use strict';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const Storage = {
  userId: null,   // preenchido em Auth.afterLogin

  _key(name) {
    const uid = this.userId || 'guest';
    return `fin4_${uid}_${name}`;
  },

  _get(k, fallback) {
    try { return JSON.parse(localStorage.getItem(this._key(k))) ?? fallback; }
    catch { return fallback; }
  },
  _set(k, val) { localStorage.setItem(this._key(k), JSON.stringify(val)); },

  // ── Getters/setters locais (síncronos) ──────────────────────────────────────
  getTransactions()   { return this._get('TX', []); },
  setTransactions(d)  {
    const prev = this.getTransactions();
    this._set('TX', d);
    this._syncCollection('transactions', prev, d, this._txToRow.bind(this)).catch(e => console.warn('[sync-tx]', e));
  },

  getQuickExpenses()  { return this._get('QUICK', []); },
  setQuickExpenses(d) {
    const prev = this.getQuickExpenses();
    this._set('QUICK', d);
    this._syncCollection('quick_expenses', prev, d, this._quickToRow.bind(this)).catch(e => console.warn('[sync-quick]', e));
  },

  getGoals()    { return this._get('GOALS', []); },
  setGoals(d)   {
    const prev = this.getGoals();
    this._set('GOALS', d);
    this._syncCollection('goals', prev, d, this._goalToRow.bind(this)).catch(e => console.warn('[sync-goals]', e));
  },

  getCards()    { return this._get('CARDS', []); },
  setCards(d)   {
    const prev = this.getCards();
    this._set('CARDS', d);
    this._syncCollection('cards', prev, d, this._cardToRow.bind(this)).catch(e => console.warn('[sync-cards]', e));
  },

  // ── Conversores local → banco ───────────────────────────────────────────────
  _txToRow(t) {
    return {
      id: t.id, user_id: this.userId,
      group_id: t.groupId || null,
      type: t.type, subtype: t.subtype,
      description: t.description, category: t.category,
      amount: t.amount, payment_method: t.paymentMethod,
      card_id: t.cardId || null,
      due_date: t.dueDate || null,
      purchase_date: t.purchaseDate || null,
      invoice_cycle_key: t.invoiceCycleKey || null,
      paid: t.paid, paid_date: t.paidDate || null,
      installment_current: t.installmentCurrent || 1,
      installment_total: t.installmentTotal || 1,
      is_generated: t.isGenerated || false,
      created_at: t.createdAt || new Date().toISOString(),
    };
  },
  _quickToRow(q) {
    return {
      id: q.id, user_id: this.userId,
      description: q.description, amount: q.amount,
      payment_method: q.paymentMethod, date: q.date,
      created_at: q.createdAt || new Date().toISOString(),
    };
  },
  _goalToRow(g) {
    return {
      id: g.id, user_id: this.userId,
      name: g.name, emoji: g.emoji,
      target: g.target, saved: g.saved,
      deadline: g.deadline || null,
      monthly_contribution: g.monthlyContribution || 0,
      contribution_day: g.contributionDay || 10,
      priority: g.priority || 'media',
      status: g.status || 'active',
      start_date: g.startDate || null,
      history: g.history || [],
      deleted: !!g.deleted,
      updated_at: g.updatedAt || new Date().toISOString(),
      created_at: g.createdAt || new Date().toISOString(),
    };
  },
  _cardToRow(c) {
    return {
      id: c.id, user_id: this.userId,
      name: c.name,
      closing_day: c.closingDay || 30,
      due_day: c.dueDay || 8,
      created_at: c.createdAt || new Date().toISOString(),
    };
  },

  // ── Sync incremental: upsert changed + delete removed ──────────────────────
  async _syncCollection(table, prevArr, newArr, toRow) {
    if (!this.userId || typeof db === 'undefined') return;

    const prevMap = new Map(prevArr.map(r => [r.id, r]));
    const newMap  = new Map(newArr.map(r => [r.id, r]));

    const toDelete = prevArr.filter(r => !newMap.has(r.id)).map(r => r.id);
    const toUpsert = newArr.filter(r => {
      const old = prevMap.get(r.id);
      return !old || JSON.stringify(old) !== JSON.stringify(r);
    }).map(toRow);

    if (toDelete.length > 0) {
      await db.from(table).delete().eq('user_id', this.userId).in('id', toDelete);
    }
    if (toUpsert.length > 0) {
      await db.from(table).upsert(toUpsert, { onConflict: 'id' });
    }
  },

  // ── Carga inicial do banco após login ───────────────────────────────────────
  async loadFromCloud(userId) {
    this.userId = userId;
    if (typeof db === 'undefined') return;

    // Carregar dados principais (transações, gastos rápidos, metas)
    const [
      { data: txRows },
      { data: quickRows },
      { data: goalRows },
    ] = await Promise.all([
      db.from('transactions').select('*').eq('user_id', userId),
      db.from('quick_expenses').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      db.from('goals').select('*').eq('user_id', userId),
    ]);

    if (txRows) {
      this._set('TX', txRows.map(r => ({
        id: r.id, groupId: r.group_id,
        type: r.type, subtype: r.subtype,
        description: r.description, category: r.category,
        amount: Number(r.amount), paymentMethod: r.payment_method,
        cardId: r.card_id,
        dueDate: r.due_date, purchaseDate: r.purchase_date,
        invoiceCycleKey: r.invoice_cycle_key,
        paid: r.paid, paidDate: r.paid_date,
        installmentCurrent: r.installment_current,
        installmentTotal: r.installment_total,
        isGenerated: r.is_generated,
        createdAt: r.created_at,
      })));
    }

    if (quickRows) {
      this._set('QUICK', quickRows.map(r => ({
        id: r.id, description: r.description,
        amount: Number(r.amount), paymentMethod: r.payment_method,
        date: r.date, createdAt: r.created_at,
      })));
    }

    if (goalRows) {
      this._set('GOALS', goalRows.map(r => ({
        id: r.id, name: r.name, emoji: r.emoji,
        target: Number(r.target), saved: Number(r.saved),
        deadline: r.deadline,
        monthlyContribution: Number(r.monthly_contribution) || 0,
        contributionDay: Number(r.contribution_day) || 10,
        priority: r.priority || 'media',
        status: r.status || 'active',
        startDate: r.start_date || null,
        history: Array.isArray(r.history) ? r.history : [],
        deleted: !!r.deleted,
        createdAt: r.created_at,
        updatedAt: r.updated_at || r.created_at,
      })));
    }

    // Carregar cartões separadamente — tabela pode não existir se migração não
    // foi executada; isolar para nunca interromper o fluxo de inicialização.
    try {
      const { data: cardRows, error: cardErr } = await db
        .from('cards').select('*').eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (!cardErr && cardRows && cardRows.length > 0) {
        this._set('CARDS', cardRows.map(r => ({
          id: r.id,
          name: r.name,
          closingDay: r.closing_day || 30,
          dueDay: r.due_day || 8,
          createdAt: r.created_at,
        })));
      }
    } catch (e) {
      console.warn('[loadFromCloud] cards:', e.message || e);
    }
  },

  clearUserCache() { this.userId = null; },

  // ── Backup / Restore ────────────────────────────────────────────────────────
  exportAll() {
    return {
      version: 4, exportedAt: new Date().toISOString(),
      transactions: this.getTransactions(),
      quickExpenses: this.getQuickExpenses(),
      goals: this.getGoals(), cards: this.getCards(),
    };
  },
  importAll(data) {
    if (Array.isArray(data.transactions))  this.setTransactions(data.transactions);
    if (Array.isArray(data.quickExpenses)) this.setQuickExpenses(data.quickExpenses);
    if (Array.isArray(data.goals))         this.setGoals(data.goals);
    if (Array.isArray(data.cards))         this.setCards(data.cards);
  },
};
