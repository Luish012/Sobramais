'use strict';
// ─── SUPORTE, PERFIL COMPLETO E NOVIDADES ─────────────────────────────────────
// Módulo isolado: nenhuma função aqui participa de cálculos financeiros,
// lançamentos, saldo, previsão, cartões, trial ou assinatura.
// Qualquer falha aqui é isolada com try/catch e nunca trava o carregamento do app.

const Support = {

  _tickets: [],
  _currentTicketId: null,

  // ── Utilitário: mascarar CPF (mostra só os 2 últimos dígitos) ──────────────
  maskCpfPartial(cpf) {
    const d = String(cpf || '').replace(/\D/g, '');
    if (d.length !== 11) return '—';
    return `***.***.***-${d.slice(-2)}`;
  },

  // ── Renderização do perfil completo em "Minha Conta" ───────────────────────
  renderProfile() {
    const user = Auth.currentUser;
    const sub  = Auth.currentSubscription;
    if (!user) return;

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setText('acct-name', user.user_metadata?.name || '—');
    setText('acct-email', user.email || '—');
    setText('acct-cpf', Support.maskCpfPartial(user.user_metadata?.cpf));
    setText('acct-app-version', 'Versão ' + (CONFIG.APP_VERSION || '—'));

    // ── Assinatura ──────────────────────────────────────────────────────────
    const status = sub?.status || 'inactive';
    const today  = new Date().toISOString().split('T')[0];

    const statusLabels = {
      active:    'Ativa ✓',
      inactive:  'Inativa',
      cancelled: 'Cancelada',
      past_due:  'Pagamento pendente',
      trial:     sub?.end_date >= today ? 'Teste grátis 🎁' : 'Teste encerrado',
    };
    const statusColors = {
      active:    'var(--success)',
      inactive:  'var(--muted-fg)',
      cancelled: 'var(--destructive)',
      past_due:  'hsl(38,80%,40%)',
      trial:     sub?.end_date >= today ? 'hsl(220,80%,55%)' : 'var(--muted-fg)',
    };
    const statusEl = document.getElementById('acct-sub-status');
    if (statusEl) {
      statusEl.textContent = statusLabels[status] || status;
      statusEl.style.color = statusColors[status] || 'inherit';
    }

    setText('acct-sub-plan', sub?.plan || CONFIG.PLAN_NAME || '—');
    setText('acct-sub-price', sub?.price ? fmtCurrency(sub.price) + '/mês' : fmtCurrency(CONFIG.PLAN_PRICE) + '/mês');

    const endEl    = document.getElementById('acct-sub-end');
    const cancelEl = document.getElementById('acct-cancel-btn');

    if (status === 'trial' && sub?.end_date) {
      const [y, m, d] = sub.end_date.split('-');
      const isActive = sub.end_date >= today;
      if (endEl) {
        endEl.textContent = isActive ? `Teste grátis válido até ${d}/${m}/${y}` : `Teste encerrado em ${d}/${m}/${y}`;
        endEl.style.display = '';
      }
    } else if (sub?.end_date) {
      const [y, m, d] = sub.end_date.split('-');
      if (endEl) { endEl.textContent = `Válido até ${d}/${m}/${y}`; endEl.style.display = ''; }
    } else if (endEl) {
      endEl.style.display = 'none';
    }

    if (cancelEl) cancelEl.style.display = (status === 'active') ? '' : 'none';
  },

  // ── Editar nome ─────────────────────────────────────────────────────────
  openEditName() {
    const input = document.getElementById('edit-name-input');
    if (input) input.value = Auth.currentUser?.user_metadata?.name || '';
    openModal('edit-name-modal');
  },

  async saveEditName() {
    const input = document.getElementById('edit-name-input');
    const btn   = document.getElementById('edit-name-save-btn');
    const name  = (input?.value || '').trim();
    if (!name) { showToast('Informe seu nome completo', 'error'); return; }

    if (btn) { btn.textContent = 'Salvando...'; btn.disabled = true; }
    try {
      const { data, error } = await db.auth.updateUser({ data: { name } });
      if (error) throw error;
      if (data?.user) Auth.currentUser = data.user;

      // Manter profiles.name sincronizado (não afeta trial/assinatura/RLS de role)
      try { await db.from('profiles').update({ name }).eq('id', Auth.currentUser.id); } catch (e) { console.warn('[Support.saveEditName] profiles:', e.message || e); }

      Support.renderProfile();
      closeModal('edit-name-modal');
      showToast('Nome atualizado', 'success');
    } catch (e) {
      showToast('Erro ao atualizar nome: ' + (e.message || e), 'error');
    } finally {
      if (btn) { btn.textContent = 'Salvar'; btn.disabled = false; }
    }
  },

  // ── Alterar senha (fluxo seguro do Supabase — envia e-mail) ────────────────
  async changePassword() {
    const user = Auth.currentUser;
    if (!user?.email) return;
    try {
      const { error } = await db.auth.resetPasswordForEmail(user.email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
      showToast('Enviamos um link para redefinir sua senha por e-mail.', 'success');
    } catch (e) {
      showToast('Não foi possível enviar o link: ' + (e.message || e), 'error');
    }
  },

  // ── Instagram institucional ─────────────────────────────────────────────
  openInstagram() {
    window.open(CONFIG.INSTAGRAM_URL, '_blank');
  },

  // ── Novidades ────────────────────────────────────────────────────────────
  openNews() {
    try {
      const list = document.getElementById('news-list');
      if (!list) return;
      if (!Array.isArray(NEWS_DATA) || NEWS_DATA.length === 0) {
        list.innerHTML = '<div class="support-empty">Nenhuma novidade por aqui ainda.</div>';
      } else {
        list.innerHTML = NEWS_DATA.map(n => `
          <div class="news-card">
            <div class="news-card-head">
              <span class="news-version">Versão ${esc(n.version)}</span>
              <span class="news-date">${fmtDateSimple(n.date)}</span>
            </div>
            <div class="news-title">${esc(n.title)}</div>
            <ul class="news-changes">
              ${(n.changes || []).map(c => `<li>${esc(c)}</li>`).join('')}
            </ul>
          </div>
        `).join('');
      }
      openModal('news-modal');
    } catch (e) {
      console.error('[Support.openNews]', e);
      showToast('Não foi possível carregar as novidades agora.', 'error');
    }
  },

  // ── FAQ ──────────────────────────────────────────────────────────────────
  openFaq() {
    try {
      const list = document.getElementById('faq-list');
      if (!list) return;
      if (!Array.isArray(FAQ_DATA) || FAQ_DATA.length === 0) {
        list.innerHTML = '<div class="support-empty">Nenhuma pergunta cadastrada ainda.</div>';
      } else {
        list.innerHTML = FAQ_DATA.map((f, i) => `
          <div class="faq-item">
            <button class="faq-question" type="button" onclick="Support.toggleFaq(${i})">
              <span>${esc(f.q)}</span>
              <span class="faq-caret" id="faq-caret-${i}">▾</span>
            </button>
            <div class="faq-answer" id="faq-answer-${i}">${esc(f.a)}</div>
          </div>
        `).join('');
      }
      openModal('faq-modal');
    } catch (e) {
      console.error('[Support.openFaq]', e);
      showToast('Não foi possível carregar as perguntas agora.', 'error');
    }
  },

  toggleFaq(i) {
    const ans   = document.getElementById('faq-answer-' + i);
    const caret = document.getElementById('faq-caret-' + i);
    if (!ans) return;
    const isOpen = ans.classList.toggle('open');
    if (caret) caret.textContent = isOpen ? '▴' : '▾';
  },

  // ── Central de suporte: abrir chamado ───────────────────────────────────
  openNewTicket() {
    const form = document.getElementById('ticket-new-form');
    if (form) form.reset ? form.reset() : null;
    document.getElementById('ticket-subject').value  = '';
    document.getElementById('ticket-category').value = 'duvida';
    document.getElementById('ticket-message').value  = '';
    document.getElementById('ticket-new-error').textContent = '';
    openModal('ticket-new-modal');
  },

  async saveNewTicket() {
    const user    = Auth.currentUser;
    const subject = document.getElementById('ticket-subject').value.trim();
    const category = document.getElementById('ticket-category').value;
    const message = document.getElementById('ticket-message').value.trim();
    const errEl   = document.getElementById('ticket-new-error');
    const btn     = document.getElementById('ticket-new-save-btn');
    if (errEl) errEl.textContent = '';

    if (!subject)  { if (errEl) errEl.textContent = 'Informe o assunto.'; return; }
    if (!category) { if (errEl) errEl.textContent = 'Selecione uma categoria.'; return; }
    if (!message)  { if (errEl) errEl.textContent = 'Escreva sua mensagem.'; return; }
    if (!user || typeof db === 'undefined') { if (errEl) errEl.textContent = 'Não foi possível conectar ao suporte agora.'; return; }

    if (btn) { btn.textContent = 'Enviando...'; btn.disabled = true; }
    try {
      const { data: ticket, error: ticketErr } = await db.from('support_tickets').insert({
        user_id: user.id,
        subject,
        category,
        status: 'open',
        app_version: CONFIG.APP_VERSION || null,
        user_agent: navigator.userAgent || null,
      }).select().single();
      if (ticketErr) throw ticketErr;

      const { error: msgErr } = await db.from('support_messages').insert({
        ticket_id: ticket.id,
        sender_user_id: user.id,
        sender_type: 'user',
        message,
      });
      if (msgErr) throw msgErr;

      closeModal('ticket-new-modal');
      showToast('Chamado aberto com sucesso!', 'success');
      Support.openMyTickets();
    } catch (e) {
      console.error('[Support.saveNewTicket]', e);
      if (errEl) errEl.textContent = 'Não foi possível abrir o chamado. Tente novamente.';
    } finally {
      if (btn) { btn.textContent = 'Enviar'; btn.disabled = false; }
    }
  },

  // ── Meus chamados ───────────────────────────────────────────────────────
  async openMyTickets() {
    const list = document.getElementById('tickets-list');
    if (!list) return;
    list.innerHTML = '<div class="support-empty">Carregando…</div>';
    openModal('tickets-modal');

    const user = Auth.currentUser;
    if (!user || typeof db === 'undefined') {
      list.innerHTML = '<div class="support-empty">Suporte indisponível no momento.</div>';
      return;
    }

    try {
      const { data, error } = await db
        .from('support_tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      Support._tickets = data || [];
      if (Support._tickets.length === 0) {
        list.innerHTML = '<div class="support-empty">Você ainda não abriu nenhum chamado.</div>';
        return;
      }

      list.innerHTML = Support._tickets.map(t => `
        <button class="ticket-item" type="button" onclick="Support.openTicket('${t.id}')">
          <div class="ticket-item-top">
            <span class="ticket-subject">${esc(t.subject)}</span>
            <span class="ticket-status ticket-status-${esc(t.status)}">${Support._statusLabel(t.status)}</span>
          </div>
          <div class="ticket-item-bottom">
            <span class="ticket-category">${Support._categoryLabel(t.category)}</span>
            <span class="ticket-date">${fmtDateTimeSimple(t.updated_at || t.created_at)}</span>
          </div>
        </button>
      `).join('');
    } catch (e) {
      console.error('[Support.openMyTickets]', e);
      list.innerHTML = '<div class="support-empty">Não foi possível carregar seus chamados agora.</div>';
    }
  },

  _statusLabel(status) {
    const map = { open: 'Aberto', waiting: 'Aguardando resposta', answered: 'Respondido', closed: 'Encerrado' };
    return map[status] || status;
  },
  _categoryLabel(cat) {
    const map = { duvida: 'Dúvida', tecnico: 'Problema técnico', pagamento: 'Pagamento', conta: 'Conta', sugestao: 'Sugestão', outro: 'Outro' };
    return map[cat] || cat;
  },

  // ── Chat do chamado ──────────────────────────────────────────────────────
  async openTicket(id) {
    Support._currentTicketId = id;
    const box = document.getElementById('ticket-chat-messages');
    if (box) box.innerHTML = '<div class="support-empty">Carregando…</div>';
    openModal('ticket-chat-modal');
    await Support._loadTicketChat();
  },

  async _loadTicketChat() {
    const id  = Support._currentTicketId;
    const box = document.getElementById('ticket-chat-messages');
    const titleEl  = document.getElementById('ticket-chat-title');
    const closeBtn = document.getElementById('ticket-close-btn');
    if (!id || !box || typeof db === 'undefined') return;

    try {
      const [{ data: ticket, error: tErr }, { data: messages, error: mErr }] = await Promise.all([
        db.from('support_tickets').select('*').eq('id', id).single(),
        db.from('support_messages').select('*').eq('ticket_id', id).order('created_at', { ascending: true }),
      ]);
      if (tErr) throw tErr;
      if (mErr) throw mErr;

      if (titleEl) titleEl.textContent = ticket?.subject || 'Chamado';
      if (closeBtn) closeBtn.style.display = (ticket?.status === 'closed') ? 'none' : '';

      if (!messages || messages.length === 0) {
        box.innerHTML = '<div class="support-empty">Sem mensagens ainda.</div>';
      } else {
        box.innerHTML = messages.map(m => `
          <div class="chat-msg chat-msg-${m.sender_type === 'user' ? 'user' : 'support'}">
            <div class="chat-msg-bubble">${esc(m.message)}</div>
            <div class="chat-msg-meta">${m.sender_type === 'user' ? 'Você' : (m.sender_type === 'admin' ? 'Suporte' : 'Sistema')} · ${fmtDateTimeSimple(m.created_at)}</div>
          </div>
        `).join('');
      }
      box.scrollTop = box.scrollHeight;
    } catch (e) {
      console.error('[Support._loadTicketChat]', e);
      box.innerHTML = '<div class="support-empty">Não foi possível carregar a conversa agora.</div>';
    }
  },

  async sendTicketMessage() {
    const id    = Support._currentTicketId;
    const input = document.getElementById('ticket-chat-input');
    const user  = Auth.currentUser;
    const text  = (input?.value || '').trim();
    if (!text || !id || !user || typeof db === 'undefined') return;

    const btn = document.getElementById('ticket-chat-send-btn');
    if (btn) btn.disabled = true;
    try {
      const { error } = await db.from('support_messages').insert({
        ticket_id: id,
        sender_user_id: user.id,
        sender_type: 'user',
        message: text,
      });
      if (error) throw error;
      if (input) input.value = '';
      await Support._loadTicketChat();
    } catch (e) {
      console.error('[Support.sendTicketMessage]', e);
      showToast('Não foi possível enviar sua mensagem. Tente novamente.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  closeTicket() {
    const id = Support._currentTicketId;
    if (!id || typeof db === 'undefined') return;
    confirmDialog('Encerrar este chamado? Você pode abrir um novo depois, se precisar.', async () => {
      try {
        const { error } = await db.from('support_tickets')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        showToast('Chamado encerrado.', 'success');
        await Support._loadTicketChat();
      } catch (e) {
        console.error('[Support.closeTicket]', e);
        showToast('Não foi possível encerrar o chamado agora.', 'error');
      }
    });
  },
};

// ── Helpers de data usados apenas pelo módulo de suporte ─────────────────────
function fmtDateSimple(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}
function fmtDateTimeSimple(str) {
  if (!str) return '';
  try {
    const dt = new Date(str);
    return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
