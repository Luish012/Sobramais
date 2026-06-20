'use strict';

const Subscription = {
  _pollTimer: null,

  // ── Render da tela de assinatura ───────────────────────────────────────────
  renderView(sub) {
    const status   = sub?.status || 'inactive';
    const messages = {
      inactive:  { title: 'Assinatura necessária', msg: 'Assine o plano para começar a controlar suas finanças.' },
      past_due:  { title: 'Pagamento pendente',    msg: 'Regularize seu pagamento para continuar usando o sistema.' },
      cancelled: { title: 'Assinatura cancelada',  msg: 'Assine novamente para recuperar o acesso.' },
    };
    const info = messages[status] || messages.inactive;
    const titleEl = document.getElementById('sub-title');
    const msgEl   = document.getElementById('sub-msg');
    const endEl   = document.getElementById('sub-end-date');
    if (titleEl) titleEl.textContent = info.title;
    if (msgEl)   msgEl.textContent   = info.msg;
    if (endEl) {
      if (sub?.end_date) {
        const [y,m,d] = sub.end_date.split('-');
        endEl.textContent = `Acesso até ${d}/${m}/${y}`;
        endEl.style.display = '';
      } else {
        endEl.style.display = 'none';
      }
    }
    // Ocultar área de pagamento
    const pa = document.getElementById('sub-payment-area');
    if (pa) pa.style.display = 'none';
  },

  // ── Criar assinatura via backend ──────────────────────────────────────────
  async subscribe() {
    const user = Auth.currentUser;
    if (!user) return;
    const btn   = document.getElementById('sub-btn');
    const errEl = document.getElementById('sub-error');
    if (errEl) errEl.textContent = '';
    if (btn) { btn.textContent = 'Aguarde...'; btn.disabled = true; }

    try {
      const res  = await fetch(CONFIG.BACKEND_URL + '/api/subscription/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email:  user.email,
          name:   user.user_metadata?.name || user.email.split('@')[0],
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao gerar link de pagamento');

      // Mostrar link de pagamento
      const pa = document.getElementById('sub-payment-area');
      const pl = document.getElementById('sub-payment-link');
      if (pa) pa.style.display = '';
      if (pl) { pl.href = data.paymentLink; pl.textContent = data.paymentLink; }
      window.open(data.paymentLink, '_blank');
      Subscription._startPolling();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
    } finally {
      if (btn) { btn.textContent = 'Assinar — R$ 9,90/mês'; btn.disabled = false; }
    }
  },

  // ── Poll a cada 6 s após clicar no link de pagamento ─────────────────────
  _startPolling() {
    clearInterval(Subscription._pollTimer);
    Subscription._pollTimer = setInterval(async () => {
      try {
        const sub = await Auth._getSub(Auth.currentUser?.id);
        if (sub?.status === 'active') {
          clearInterval(Subscription._pollTimer);
          Auth.currentSubscription = sub;
          await Storage.loadFromCloud(Auth.currentUser.id);
          showView('home');
          showToast('Assinatura ativa! Bem-vindo!', 'success');
        }
      } catch {}
    }, 6000);
  },

  // ── Verificação manual ────────────────────────────────────────────────────
  async checkStatus() {
    const btn = document.getElementById('sub-check-btn');
    if (btn) { btn.textContent = 'Verificando...'; btn.disabled = true; }
    try {
      const sub = await Auth._getSub(Auth.currentUser?.id);
      if (sub?.status === 'active') {
        clearInterval(Subscription._pollTimer);
        Auth.currentSubscription = sub;
        await Storage.loadFromCloud(Auth.currentUser.id);
        showView('home');
        showToast('Assinatura ativa! Bem-vindo!', 'success');
      } else {
        showToast('Pagamento ainda não confirmado. Aguarde.', 'error');
      }
    } finally {
      if (btn) { btn.textContent = 'Já paguei — verificar status'; btn.disabled = false; }
    }
  },

  // ── Cancelar assinatura (chamado pelo modal de conta) ────────────────────
  async cancel() {
    const user = Auth.currentUser;
    if (!user) return;
    confirmDialog(
      'Cancelar assinatura? Você continua com acesso até o fim do período já pago.',
      async () => {
        try {
          const res = await fetch(CONFIG.BACKEND_URL + '/api/subscription/cancel', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id }),
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || 'Erro ao cancelar');
          showToast('Assinatura cancelada com sucesso.', 'success');
          const sub = await Auth._getSub(user.id);
          Auth.currentSubscription = sub;
          _renderAccountModal(sub);
        } catch (e) {
          showToast('Erro ao cancelar: ' + e.message, 'error');
        }
      }
    );
  },
};

// ── Modal de conta / assinatura ───────────────────────────────────────────────
function openAccountModal() {
  const user = Auth.currentUser;
  const sub  = Auth.currentSubscription;
  document.getElementById('acct-email').textContent = user?.email || '—';
  document.getElementById('acct-name').textContent  = user?.user_metadata?.name || '—';
  _renderAccountModal(sub);
  openModal('account-modal');
}

function _renderAccountModal(sub) {
  const status = sub?.status || 'inactive';
  const labels = { active:'Ativa ✓', inactive:'Inativa', cancelled:'Cancelada', past_due:'Pagamento pendente' };
  const colors = { active:'var(--success)', inactive:'var(--muted-fg)', cancelled:'var(--destructive)', past_due:'hsl(38,80%,40%)' };
  document.getElementById('acct-sub-status').textContent  = labels[status] || status;
  document.getElementById('acct-sub-status').style.color  = colors[status] || 'inherit';

  const endEl  = document.getElementById('acct-sub-end');
  const cancelEl = document.getElementById('acct-cancel-btn');
  if (sub?.end_date) {
    const [y,m,d] = sub.end_date.split('-');
    endEl.textContent  = `Válido até ${d}/${m}/${y}`;
    endEl.style.display = '';
  } else { endEl.style.display = 'none'; }

  if (cancelEl) cancelEl.style.display = (status === 'active') ? '' : 'none';
}
