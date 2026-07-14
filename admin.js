'use strict';
// ─── PAINEL ADMINISTRATIVO ────────────────────────────────────────────────────
// Módulo isolado: nenhuma função aqui participa de cálculos financeiros,
// lançamentos, saldo, previsão, cartões, trial ou assinatura pessoal do
// usuário logado. Qualquer falha aqui é isolada com try/catch e nunca trava
// o carregamento do app. Todas as chamadas passam por rotas /api/admin/* do
// backend, protegidas por requireAdmin — o botão só some da tela, o acesso
// real é sempre bloqueado no servidor.

const Admin = {
  _section: 'overview',
  _isAdmin: false,
  _currentTicketId: null,
  _currentUserId: null,

  // ── Verifica papel do usuário logado (só decide exibir o botão) ──────────
  async checkAccess() {
    try {
      const user = Auth.currentUser;
      if (!user || typeof db === 'undefined') { Admin._isAdmin = false; Admin._toggleButton(); return; }
      const { data, error } = await db.from('profiles').select('role').eq('id', user.id).single();
      if (error) throw error;
      Admin._isAdmin = data?.role === 'admin';
    } catch (e) {
      console.warn('[Admin.checkAccess]', e.message || e);
      Admin._isAdmin = false;
    }
    Admin._toggleButton();
  },

  _toggleButton() {
    document.querySelectorAll('.admin-panel-btn').forEach(el => {
      el.style.display = Admin._isAdmin ? '' : 'none';
    });
  },

  async _authHeader() {
    try {
      const { data } = await db.auth.getSession();
      const token = data?.session?.access_token;
      return token ? { Authorization: 'Bearer ' + token } : {};
    } catch { return {}; }
  },

  async _api(path, options = {}) {
    const headers = await Admin._authHeader();
    const res = await fetch(CONFIG.BACKEND_URL + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...headers, ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao comunicar com o servidor.');
    return data;
  },

  // ── Abrir painel ───────────────────────────────────────────────────────────
  openPanel() {
    if (!Admin._isAdmin) { showToast('Acesso não autorizado.', 'error'); return; }
    showView('admin');
    Admin.showSection('overview');
  },

  closePanel() {
    showView('home');
  },

  showSection(name) {
    Admin._section = name;
    document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.adminsection === name));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.toggle('active', s.dataset.adminsection === name));
    if (name === 'overview')      Admin.loadOverview();
    if (name === 'users')         Admin.loadUsers();
    if (name === 'subscriptions') Admin.loadSubscriptions();
    if (name === 'trials')        Admin.loadTrials();
    if (name === 'support')       Admin.loadTickets();
    // "notifications" (envio) não carrega lista — é um formulário.
  },

  // ── VISÃO GERAL ────────────────────────────────────────────────────────────
  async loadOverview() {
    const el = document.getElementById('admin-overview-cards');
    if (!el) return;
    el.innerHTML = '<div class="support-empty">Carregando…</div>';
    try {
      const d = await Admin._api('/api/admin/overview');
      const cards = [
        ['Usuários totais',            d.totalUsers],
        ['Trials ativos',              d.activeTrials],
        ['Trials expirados',           d.expiredTrials],
        ['Assinaturas ativas',         d.activeSubs],
        ['Assinaturas inativas',       d.inactiveSubs],
        ['Pagamentos pendentes',       d.pendingPayments],
        ['Assinaturas canceladas',     d.cancelledSubs],
        ['Chamados abertos',           d.openTickets],
        ['Chamados aguardando resposta', d.waitingTickets],
      ];
      el.innerHTML = cards.map(([label, val]) => `
        <div class="admin-card">
          <div class="admin-card-value">${val ?? 0}</div>
          <div class="admin-card-label">${esc(label)}</div>
        </div>
      `).join('');
    } catch (e) {
      console.error('[Admin.loadOverview]', e);
      el.innerHTML = '<div class="support-empty">Não foi possível carregar a visão geral agora.</div>';
    }
  },

  // ── USUÁRIOS ───────────────────────────────────────────────────────────────
  _userFilter: 'todos',
  setUserFilter(f) {
    Admin._userFilter = f;
    document.querySelectorAll('[data-adminuserfilter]').forEach(b => b.classList.toggle('active', b.dataset.adminuserfilter === f));
    Admin.loadUsers();
  },
  async loadUsers() {
    const el = document.getElementById('admin-users-list');
    if (!el) return;
    el.innerHTML = '<div class="support-empty">Carregando…</div>';
    try {
      const search = document.getElementById('admin-users-search')?.value || '';
      const q = new URLSearchParams({ filter: Admin._userFilter, search }).toString();
      const rows = await Admin._api('/api/admin/users?' + q);
      if (!rows.length) { el.innerHTML = '<div class="support-empty">Nenhum usuário encontrado.</div>'; return; }
      el.innerHTML = rows.map(u => `
        <button class="admin-list-item" type="button" onclick="Admin.openUser('${u.userId}')">
          <div class="admin-list-item-main">
            <div class="admin-list-item-title">${esc(u.name || u.email || u.userId)}</div>
            <div class="admin-list-item-sub">${esc(u.email || '')} · CPF ${esc(u.cpfMasked || '—')}</div>
          </div>
          <span class="admin-badge admin-badge-${esc(u.subscriptionStatus || 'inactive')}">${Admin._statusLabel(u.subscriptionStatus)}</span>
        </button>
      `).join('');
    } catch (e) {
      console.error('[Admin.loadUsers]', e);
      el.innerHTML = '<div class="support-empty">Não foi possível carregar os usuários agora.</div>';
    }
  },
  _statusLabel(s) {
    const map = { trial: 'Trial', active: 'Ativa', inactive: 'Inativa', past_due: 'Pendente', cancelled: 'Cancelada' };
    return map[s] || s || '—';
  },

  async openUser(id) {
    Admin._currentUserId = id;
    const box = document.getElementById('admin-user-detail');
    if (!box) return;
    box.innerHTML = '<div class="support-empty">Carregando…</div>';
    openModal('admin-user-modal');
    try {
      const u = await Admin._api('/api/admin/users/' + id);
      box.innerHTML = `
        <div class="acct-section">
          <div class="acct-section-title">Dados</div>
          <div class="acct-field"><div class="acct-field-label">Nome</div><div class="acct-field-value">${esc(u.name || '—')}</div></div>
          <div class="acct-field"><div class="acct-field-label">E-mail</div><div class="acct-field-value">${esc(u.email || '—')}</div></div>
          <div class="acct-field"><div class="acct-field-label">CPF</div><div class="acct-field-value">${esc(u.cpfMasked || '—')}</div></div>
          <div class="acct-field"><div class="acct-field-label">Cadastro</div><div class="acct-field-value">${fmtDateTimeSimple(u.signupAt)}</div></div>
          <div class="acct-field"><div class="acct-field-label">ID do usuário</div>
            <div class="acct-field-row"><div class="acct-field-value" style="font-size:0.72rem;word-break:break-all">${esc(u.userId)}</div>
              <button class="acct-field-edit" type="button" onclick="Admin.copyUserId('${u.userId}')">Copiar</button></div>
          </div>
        </div>
        <div class="acct-section">
          <div class="acct-section-title">Assinatura</div>
          <div class="acct-field"><div class="acct-field-label">Status</div><div class="acct-field-value">${Admin._statusLabel(u.subscriptionStatus)}</div></div>
          <div class="acct-field"><div class="acct-field-label">Tipo de acesso</div><div class="acct-field-value">${esc(u.accessType || '—')}${u.manualAccess ? ' (manual)' : ''}</div></div>
          <div class="acct-field"><div class="acct-field-label">Vigência</div><div class="acct-field-value">${fmtDate(u.startDate) || '—'} até ${fmtDate(u.endDate) || '—'}</div></div>
          <div class="acct-field"><div class="acct-field-label">Nota manual</div><div class="acct-field-value">${esc(u.manualNote || '—')}</div></div>
        </div>
        <div class="acct-section">
          <div class="acct-section-title">Ações administrativas</div>
          <div class="acct-menu">
            <button class="acct-menu-item" type="button" onclick="Admin.promptRole('${u.userId}', '${u.role}')"><span>Alterar papel (atual: ${esc(u.role)})</span></button>
            <button class="acct-menu-item" type="button" onclick="Admin.promptActivate('${u.userId}')"><span>Ativar manualmente</span></button>
            <button class="acct-menu-item" type="button" onclick="Admin.promptDeactivate('${u.userId}')"><span>Desativar acesso</span></button>
            <button class="acct-menu-item" type="button" onclick="Admin.promptExtraDays('${u.userId}')"><span>Conceder dias extras de trial</span></button>
            <button class="acct-menu-item" type="button" onclick="Admin.promptLifetime('${u.userId}')"><span>Marcar acesso vitalício</span></button>
          </div>
        </div>
        <div class="acct-section" style="border-bottom:none">
          <div class="acct-section-title">Chamados do usuário</div>
          ${(u.tickets || []).length === 0 ? '<div class="support-empty">Sem chamados.</div>' : u.tickets.map(t => `
            <button class="ticket-item" type="button" onclick="Admin.openTicket('${t.id}')">
              <div class="ticket-item-top"><span class="ticket-subject">${esc(t.subject)}</span><span class="ticket-status ticket-status-${esc(t.status)}">${Support._statusLabel(t.status)}</span></div>
            </button>
          `).join('')}
        </div>
      `;
    } catch (e) {
      console.error('[Admin.openUser]', e);
      box.innerHTML = '<div class="support-empty">Não foi possível carregar este usuário agora.</div>';
    }
  },

  copyUserId(id) {
    navigator.clipboard?.writeText(id).then(() => showToast('ID copiado', 'success')).catch(() => {});
  },

  promptRole(userId, currentRole) {
    const next = currentRole === 'admin' ? 'user' : 'admin';
    confirmDialog(`Alterar papel deste usuário para "${next}"?`, async () => {
      try {
        await Admin._api(`/api/admin/users/${userId}/role`, { method: 'POST', body: JSON.stringify({ role: next }) });
        showToast('Papel atualizado.', 'success');
        Admin.openUser(userId);
      } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    });
  },
  promptActivate(userId) {
    confirmDialog('Ativar manualmente o acesso deste usuário?', async () => {
      try {
        await Admin._api(`/api/admin/users/${userId}/access`, { method: 'POST', body: JSON.stringify({ status: 'active', accessType: 'manual', manualAccess: true }) });
        showToast('Acesso ativado.', 'success');
        Admin.openUser(userId);
      } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    });
  },
  promptDeactivate(userId) {
    confirmDialog('Cancelar o acesso interno deste usuário?', async () => {
      try {
        await Admin._api(`/api/admin/users/${userId}/access`, { method: 'POST', body: JSON.stringify({ status: 'inactive', manualAccess: false }) });
        showToast('Acesso desativado.', 'success');
        Admin.openUser(userId);
      } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    });
  },
  promptExtraDays(userId) {
    const days = parseInt(prompt('Quantos dias extras de trial deseja conceder?', '7') || '0', 10);
    if (!days || days <= 0) return;
    confirmDialog(`Conceder ${days} dia(s) extra(s) de trial a este usuário?`, async () => {
      try {
        await Admin._api(`/api/admin/users/${userId}/access`, { method: 'POST', body: JSON.stringify({ extraTrialDays: days }) });
        showToast('Dias extras concedidos.', 'success');
        Admin.openUser(userId);
      } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    });
  },
  promptLifetime(userId) {
    confirmDialog('Marcar este usuário como acesso vitalício?', async () => {
      try {
        await Admin._api(`/api/admin/users/${userId}/access`, { method: 'POST', body: JSON.stringify({ status: 'active', accessType: 'lifetime', manualAccess: true }) });
        showToast('Acesso vitalício concedido.', 'success');
        Admin.openUser(userId);
      } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    });
  },

  // ── ASSINATURAS ────────────────────────────────────────────────────────────
  _subFilter: 'todas',
  setSubFilter(f) {
    Admin._subFilter = f;
    document.querySelectorAll('[data-adminsubfilter]').forEach(b => b.classList.toggle('active', b.dataset.adminsubfilter === f));
    Admin.loadSubscriptions();
  },
  async loadSubscriptions() {
    const el = document.getElementById('admin-subs-list');
    if (!el) return;
    el.innerHTML = '<div class="support-empty">Carregando…</div>';
    try {
      const rows = await Admin._api('/api/admin/subscriptions?filter=' + Admin._subFilter);
      if (!rows.length) { el.innerHTML = '<div class="support-empty">Nenhuma assinatura encontrada.</div>'; return; }
      el.innerHTML = rows.map(s => `
        <div class="admin-list-item admin-list-item-static">
          <div class="admin-list-item-main">
            <div class="admin-list-item-title">${esc(s.name || s.email || s.userId)}</div>
            <div class="admin-list-item-sub">${esc(s.plan || '')} · ${fmtCurrency(s.price || 0)} · até ${fmtDate(s.endDate) || '—'}</div>
          </div>
          <span class="admin-badge admin-badge-${esc(s.status || 'inactive')}">${Admin._statusLabel(s.status)}${s.accessType === 'lifetime' ? ' · vitalícia' : ''}</span>
        </div>
      `).join('');
    } catch (e) {
      console.error('[Admin.loadSubscriptions]', e);
      el.innerHTML = '<div class="support-empty">Não foi possível carregar as assinaturas agora.</div>';
    }
  },

  // ── TRIALS ─────────────────────────────────────────────────────────────────
  _trialFilter: 'todos',
  setTrialFilter(f) {
    Admin._trialFilter = f;
    document.querySelectorAll('[data-admintrialfilter]').forEach(b => b.classList.toggle('active', b.dataset.admintrialfilter === f));
    Admin.loadTrials();
  },
  async loadTrials() {
    const el = document.getElementById('admin-trials-list');
    if (!el) return;
    el.innerHTML = '<div class="support-empty">Carregando…</div>';
    try {
      const rows = await Admin._api('/api/admin/trials?filter=' + Admin._trialFilter);
      if (!rows.length) { el.innerHTML = '<div class="support-empty">Nenhum trial encontrado.</div>'; return; }
      el.innerHTML = rows.map(t => `
        <button class="admin-list-item" type="button" onclick="Admin.openUser('${t.userId}')">
          <div class="admin-list-item-main">
            <div class="admin-list-item-title">${esc(t.name || t.email || t.userId)}</div>
            <div class="admin-list-item-sub">CPF ${esc(t.cpfMasked || '—')} · até ${fmtDate(t.endDate) || '—'}</div>
          </div>
          <span class="admin-badge ${t.daysLeft < 0 ? 'admin-badge-cancelled' : 'admin-badge-trial'}">${t.daysLeft < 0 ? 'Vencido' : t.daysLeft + ' dia(s)'}</span>
        </button>
      `).join('');
    } catch (e) {
      console.error('[Admin.loadTrials]', e);
      el.innerHTML = '<div class="support-empty">Não foi possível carregar os trials agora.</div>';
    }
  },

  // ── SUPORTE (CENTRAL ADMINISTRATIVA) ──────────────────────────────────────
  _ticketFilter: 'todos',
  setTicketFilter(f) {
    Admin._ticketFilter = f;
    document.querySelectorAll('[data-adminticketfilter]').forEach(b => b.classList.toggle('active', b.dataset.adminticketfilter === f));
    Admin.loadTickets();
  },
  async loadTickets() {
    const el = document.getElementById('admin-tickets-list');
    if (!el) return;
    el.innerHTML = '<div class="support-empty">Carregando…</div>';
    try {
      const rows = await Admin._api('/api/admin/support/tickets?filter=' + Admin._ticketFilter);
      if (!rows.length) { el.innerHTML = '<div class="support-empty">Nenhum chamado encontrado.</div>'; return; }
      el.innerHTML = rows.map(t => `
        <button class="admin-list-item" type="button" onclick="Admin.openTicket('${t.id}')">
          <div class="admin-list-item-main">
            <div class="admin-list-item-title">${esc(t.subject)}</div>
            <div class="admin-list-item-sub">${esc(t.userName || t.userEmail || '')} · ${esc((t.lastMessage || '').slice(0, 60))}</div>
          </div>
          <span class="ticket-status ticket-status-${esc(t.status)}">${Support._statusLabel(t.status)}</span>
        </button>
      `).join('');
    } catch (e) {
      console.error('[Admin.loadTickets]', e);
      el.innerHTML = '<div class="support-empty">Não foi possível carregar os chamados agora.</div>';
    }
  },

  async openTicket(id) {
    Admin._currentTicketId = id;
    const box = document.getElementById('admin-ticket-messages');
    if (box) box.innerHTML = '<div class="support-empty">Carregando…</div>';
    openModal('admin-ticket-modal');
    await Admin._loadTicket();
  },

  async _loadTicket() {
    const id = Admin._currentTicketId;
    const box = document.getElementById('admin-ticket-messages');
    const titleEl = document.getElementById('admin-ticket-title');
    if (!id || !box) return;
    try {
      const d = await Admin._api('/api/admin/support/tickets/' + id);
      if (titleEl) titleEl.textContent = `${d.ticket.subject} — ${d.userName || d.userEmail || ''}`;
      box.innerHTML = (d.messages || []).map(m => `
        <div class="chat-msg chat-msg-${m.sender_type === 'admin' ? 'support' : 'user'}">
          <div class="chat-msg-bubble">${esc(m.message)}</div>
          <div class="chat-msg-meta">${m.sender_type === 'admin' ? 'Suporte' : 'Usuário'} · ${fmtDateTimeSimple(m.created_at)}</div>
        </div>
      `).join('') || '<div class="support-empty">Sem mensagens.</div>';
      box.scrollTop = box.scrollHeight;

      const reopenBtn = document.getElementById('admin-ticket-reopen-btn');
      const closeBtn  = document.getElementById('admin-ticket-close-btn');
      if (closeBtn)  closeBtn.style.display  = d.ticket.status === 'closed' ? 'none' : '';
      if (reopenBtn) reopenBtn.style.display = d.ticket.status === 'closed' ? '' : 'none';
    } catch (e) {
      console.error('[Admin._loadTicket]', e);
      box.innerHTML = '<div class="support-empty">Não foi possível carregar a conversa agora.</div>';
    }
  },

  async sendTicketReply() {
    const id = Admin._currentTicketId;
    const input = document.getElementById('admin-ticket-input');
    const text = (input?.value || '').trim();
    if (!id || !text) return;
    const btn = document.getElementById('admin-ticket-send-btn');
    if (btn) btn.disabled = true;
    try {
      await Admin._api(`/api/admin/support/tickets/${id}/reply`, { method: 'POST', body: JSON.stringify({ message: text }) });
      if (input) input.value = '';
      await Admin._loadTicket();
    } catch (e) {
      showToast('Erro ao responder: ' + e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  closeTicket() {
    const id = Admin._currentTicketId;
    if (!id) return;
    confirmDialog('Encerrar este chamado?', async () => {
      try {
        await Admin._api(`/api/admin/support/tickets/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'closed' }) });
        showToast('Chamado encerrado.', 'success');
        await Admin._loadTicket();
        Admin.loadTickets();
      } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    });
  },
  reopenTicket() {
    const id = Admin._currentTicketId;
    if (!id) return;
    confirmDialog('Reabrir este chamado?', async () => {
      try {
        await Admin._api(`/api/admin/support/tickets/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'open' }) });
        showToast('Chamado reaberto.', 'success');
        await Admin._loadTicket();
        Admin.loadTickets();
      } catch (e) { showToast('Erro: ' + e.message, 'error'); }
    });
  },

  // ── NOTIFICAÇÕES (ENVIO) ──────────────────────────────────────────────────
  async sendNotification() {
    const audience = document.getElementById('admin-notif-audience')?.value;
    const userId   = document.getElementById('admin-notif-userid')?.value.trim();
    const title    = document.getElementById('admin-notif-title')?.value.trim();
    const message  = document.getElementById('admin-notif-message')?.value.trim();
    const errEl    = document.getElementById('admin-notif-error');
    if (errEl) errEl.textContent = '';

    if (!title)   { if (errEl) errEl.textContent = 'Informe o título.'; return; }
    if (!message) { if (errEl) errEl.textContent = 'Informe a mensagem.'; return; }
    if (audience === 'user' && !userId) { if (errEl) errEl.textContent = 'Informe o ID do usuário.'; return; }

    let count = 0;
    try {
      const q = new URLSearchParams({ audience, userId: userId || '' }).toString();
      const d = await Admin._api('/api/admin/notifications/audience-count?' + q);
      count = d.count || 0;
    } catch (e) {
      if (errEl) errEl.textContent = 'Erro ao calcular audiência: ' + e.message;
      return;
    }

    if (count === 0) { if (errEl) errEl.textContent = 'Nenhum usuário encontrado para essa audiência.'; return; }

    confirmDialog(`Esta notificação será enviada para ${count} usuário(s). Confirmar envio?`, async () => {
      try {
        await Admin._api('/api/admin/notifications/send', {
          method: 'POST',
          body: JSON.stringify({ audience, userId: userId || undefined, title, message, type: 'admin_message' }),
        });
        showToast('Notificação enviada.', 'success');
        document.getElementById('admin-notif-title').value = '';
        document.getElementById('admin-notif-message').value = '';
      } catch (e) {
        showToast('Erro ao enviar: ' + e.message, 'error');
      }
    });
  },
};
