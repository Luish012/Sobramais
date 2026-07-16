'use strict';

const Subscription = {
  _pollTimer: null,

  // ── Render da tela de assinatura ───────────────────────────────────────────
  renderView(sub) {
    const status  = sub?.status || 'inactive';
    const today   = new Date().toISOString().split('T')[0];
    const isExpiredTrial = status === 'trial' && (!sub?.end_date || sub.end_date < today);

    const titleEl = document.getElementById('sub-title');
    const msgEl   = document.getElementById('sub-msg');
    const endEl   = document.getElementById('sub-end-date');
    const planEl  = document.getElementById('sub-plan-card');
    const cpfArea = document.getElementById('sub-cpf-area');
    const btnEl   = document.getElementById('sub-btn');

    if (isExpiredTrial) {
      if (titleEl) titleEl.textContent = 'Teste grátis encerrado';
      if (msgEl)   msgEl.textContent   = 'Assine por apenas R$ 9,99/mês para continuar usando o SobraMais.';
      if (endEl)   endEl.style.display = 'none';
    } else {
      const messages = {
        inactive:  { title: 'Assinatura necessária',  msg: 'Assine o plano para começar a controlar suas finanças.' },
        past_due:  { title: 'Pagamento pendente',     msg: 'Regularize seu pagamento para continuar usando o sistema.' },
        cancelled: { title: 'Assinatura cancelada',   msg: 'Assine novamente para recuperar o acesso.' },
      };
      const info = messages[status] || messages.inactive;
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
    }

    // Ocultar área de pagamento
    const pa = document.getElementById('sub-payment-area');
    if (pa) pa.style.display = 'none';

    // Pré-preencher CPF do cadastro (fallback: campo vazio)
    const cpfEl = document.getElementById('sub-cpfcnpj');
    if (cpfEl) {
      const savedCpf = Auth.currentUser?.user_metadata?.cpf || '';
      if (savedCpf) {
        // Exibir com máscara
        const d = savedCpf.replace(/\D/g, '');
        cpfEl.value = d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        if (cpfArea) cpfArea.style.display = 'none'; // ocultar campo se já temos o CPF
      } else {
        if (cpfArea) cpfArea.style.display = '';
      }
    }

    if (btnEl) btnEl.textContent = 'Assinar — R$ 9,99/mês';
  },

  // ── Máscara visual para CPF/CNPJ ─────────────────────────────────────────
  maskCpfCnpj(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 14);
    if (v.length <= 11) {
      v = v.replace(/(\d{3})(\d)/, '$1.$2');
      v = v.replace(/(\d{3})(\d)/, '$1.$2');
      v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    } else {
      v = v.replace(/(\d{2})(\d)/, '$1.$2');
      v = v.replace(/(\d{3})(\d)/, '$1.$2');
      v = v.replace(/(\d{3})(\d)/, '$1/$2');
      v = v.replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    }
    input.value = v;
  },

  // ── Máscara visual para CPF no cadastro ──────────────────────────────────
  maskCpf(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    input.value = v;
  },

  // ── Criar assinatura via backend ──────────────────────────────────────────
  async subscribe() {
    const user = Auth.currentUser;
    if (!user) return;
    const btn      = document.getElementById('sub-btn');
    const errEl    = document.getElementById('sub-error');
    const cpfEl    = document.getElementById('sub-cpfcnpj');
    if (errEl) errEl.textContent = '';

    if (btn?.disabled) return;

    // Usar CPF do cadastro como fonte primária
    const savedCpf = (user.user_metadata?.cpf || '').replace(/\D/g, '');
    const fieldCpf = (cpfEl?.value || '').replace(/\D/g, '');
    const cpfCnpj  = savedCpf.length === 11 ? savedCpf : fieldCpf;

    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      if (errEl) errEl.textContent = 'Informe um CPF ou CNPJ válido.';
      cpfEl?.focus();
      return;
    }

    if (btn) { btn.textContent = 'Aguarde...'; btn.disabled = true; }

    try {
      const res  = await fetch(CONFIG.BACKEND_URL + '/api/subscription/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:  user.id,
          email:   user.email,
          name:    user.user_metadata?.name || user.email.split('@')[0],
          cpfCnpj,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao gerar link de pagamento');

      const pa = document.getElementById('sub-payment-area');
      const pl = document.getElementById('sub-payment-link');
      if (pa) pa.style.display = '';
      if (pl) { pl.href = data.paymentLink; pl.textContent = data.paymentLink; }
      window.open(data.paymentLink, '_blank');
      Subscription._startPolling();
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Não foi possível processar sua assinatura. Tente novamente.';
    } finally {
      if (btn) { btn.textContent = 'Assinar — R$ 9,99/mês'; btn.disabled = false; }
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

  // ── Cancelar assinatura ───────────────────────────────────────────────────
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
          Support.renderProfile();
        } catch (e) {
          showToast('Erro ao cancelar: ' + e.message, 'error');
        }
      }
    );
  },
};

// ── Modal de conta / assinatura ───────────────────────────────────────────────
// Perfil completo (dados pessoais, assinatura, suporte, novidades) é renderizado
// por Support.renderProfile() em support.js — mantém este arquivo focado em
// autenticação/assinatura, sem duplicar lógica.
function openAccountModal() {
  try { Support.renderProfile(); } catch (e) { console.error('[openAccountModal]', e); }
  const el2 = document.getElementById('acct-app-version-2');
  if (el2) el2.textContent = 'Versão ' + (CONFIG.APP_VERSION || '—');
  openModal('account-modal');
  // Carregar seção "Indique e Ganhe" de forma assíncrona (não bloqueia abertura do modal)
  try { Referral.renderSection(); } catch (e) { console.warn('[openAccountModal] Referral.renderSection:', e.message); }
}
