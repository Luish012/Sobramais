'use strict';
// ─── NOTIFICAÇÕES INTERNAS ────────────────────────────────────────────────────
// Módulo isolado: nenhuma função aqui participa de cálculos financeiros,
// lançamentos, saldo, previsão, cartões, trial ou assinatura.
// Qualquer falha aqui é isolada com try/catch e nunca trava o app.

const Notifications = {
  _items: [],
  _pollTimer: null,

  async _authHeader() {
    try {
      const { data } = await db.auth.getSession();
      const token = data?.session?.access_token;
      return token ? { Authorization: 'Bearer ' + token } : {};
    } catch { return {}; }
  },

  // ── Chamado uma vez por login: gera notificações de trial acabando/encerrado
  async syncOnLogin() {
    try {
      const headers = await Notifications._authHeader();
      if (!headers.Authorization) return;
      await fetch(CONFIG.BACKEND_URL + '/api/notifications/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    } catch (e) {
      console.warn('[Notifications.syncOnLogin]', e.message || e);
    }
    Notifications.refreshBell();
    Notifications._startPolling();
  },

  _startPolling() {
    clearInterval(Notifications._pollTimer);
    Notifications._pollTimer = setInterval(() => Notifications.refreshBell(), 60000);
  },
  stopPolling() {
    clearInterval(Notifications._pollTimer);
    Notifications._pollTimer = null;
  },

  // ── Badge do sino: conta não lidas ────────────────────────────────────────
  async refreshBell() {
    try {
      const user = Auth.currentUser;
      if (!user || typeof db === 'undefined') return;
      const { count, error } = await db
        .from('notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('is_read', false);
      if (error) throw error;
      Notifications._setBadge(count || 0);
    } catch (e) {
      console.warn('[Notifications.refreshBell]', e.message || e);
    }
  },

  _setBadge(count) {
    document.querySelectorAll('.notif-bell-badge').forEach(el => {
      if (count > 0) {
        el.textContent = count > 9 ? '9+' : String(count);
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  },

  // ── Abrir painel de notificações ──────────────────────────────────────────
  async openPanel() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    list.innerHTML = '<div class="support-empty">Carregando…</div>';
    openModal('notif-modal');

    const user = Auth.currentUser;
    if (!user || typeof db === 'undefined') {
      list.innerHTML = '<div class="support-empty">Notificações indisponíveis no momento.</div>';
      return;
    }

    try {
      const { data, error } = await db
        .from('notifications').select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;

      Notifications._items = data || [];
      Notifications._render();
    } catch (e) {
      console.error('[Notifications.openPanel]', e);
      list.innerHTML = '<div class="support-empty">Não foi possível carregar suas notificações agora.</div>';
    }
  },

  _render() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (Notifications._items.length === 0) {
      list.innerHTML = '<div class="support-empty">Nenhuma notificação por aqui ainda.</div>';
      return;
    }
    list.innerHTML = Notifications._items.map(n => `
      <button class="notif-item ${n.is_read ? '' : 'notif-item-unread'}" type="button" onclick="Notifications.open('${n.id}')">
        <div class="notif-item-icon">${Notifications._icon(n.type)}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${esc(n.title)}</div>
          <div class="notif-item-msg">${esc(n.message)}</div>
          <div class="notif-item-time">${fmtDateTimeSimple(n.created_at)}</div>
        </div>
        ${n.is_read ? '' : '<span class="notif-item-dot"></span>'}
      </button>
    `).join('');
  },

  _icon(type) {
    const map = {
      support_reply: '💬', trial_ending: '⏳', trial_ended: '⛔',
      subscription_activated: '✅', payment_pending: '⚠️',
      subscription_cancelled: '🚫', invoice_due: '📄', account_due: '📄',
      app_update: '✨', admin_message: '📣',
    };
    return map[type] || '🔔';
  },

  // ── Clique: marca como lida e roteia contextualmente ──────────────────────
  async open(id) {
    const n = Notifications._items.find(x => x.id === id);
    if (!n) return;

    if (!n.is_read) await Notifications.markRead(id, false);

    try {
      if (n.action_type === 'ticket' && n.action_id) {
        closeModal('notif-modal');
        await Support.openTicket(n.action_id);
      } else if (n.action_type === 'subscription') {
        closeModal('notif-modal');
        openAccountModal();
      } else if (n.action_type === 'news') {
        closeModal('notif-modal');
        Support.openNews();
      }
    } catch (e) {
      console.warn('[Notifications.open] roteamento:', e.message || e);
    }
  },

  async markRead(id, rerender = true) {
    try {
      const { error } = await db.from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      const item = Notifications._items.find(x => x.id === id);
      if (item) { item.is_read = true; }
      if (rerender) Notifications._render();
      Notifications.refreshBell();
    } catch (e) {
      console.warn('[Notifications.markRead]', e.message || e);
    }
  },

  async markAllRead() {
    const user = Auth.currentUser;
    if (!user) return;
    try {
      const { error } = await db.from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('is_read', false);
      if (error) throw error;
      Notifications._items.forEach(n => { n.is_read = true; });
      Notifications._render();
      Notifications.refreshBell();
      showToast('Todas marcadas como lidas', 'success');
    } catch (e) {
      console.error('[Notifications.markAllRead]', e);
      showToast('Não foi possível marcar todas como lidas.', 'error');
    }
  },
};
