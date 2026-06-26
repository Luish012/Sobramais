'use strict';

const Auth = {
  currentUser: null,
  currentSubscription: null,

  // ── Inicializa o listener de sessão ────────────────────────────────────────
  async init() {
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('type=email_change')) {
      showAuthView('reset-pw');
      db.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') showAuthView('reset-pw');
      });
      return;
    }

    db.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        Auth.currentUser = null;
        Auth.currentSubscription = null;
        Storage.clearUserCache();
        showAuthView('login');
        return;
      }
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        Auth.currentUser = session.user;
        await Auth._afterLogin(session.user);
      }
    });

    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) showAuthView('login');
    } catch (e) {
      console.error('[auth.init] Falha ao verificar sessão:', e.message);
      showAuthView('login');
    }
  },

  async _afterLogin(user) {
    showAuthView('loading');
    try {
      await Storage.loadFromCloud(user.id);
      let sub = await Auth._getSub(user.id);

      // Se não tem assinatura, tentar iniciar trial pelo CPF
      if (!sub || !sub.status || sub.status === 'inactive') {
        const cpf = (user.user_metadata?.cpf || '').replace(/\D/g, '');
        if (cpf.length === 11) {
          await Auth._initTrial(user, cpf);
          sub = await Auth._getSub(user.id);
        }
      }

      Auth.currentSubscription = sub;

      const today = new Date().toISOString().split('T')[0];
      const isTrialActive = sub?.status === 'trial' && sub?.end_date >= today;

      if (sub && (sub.status === 'active' || sub.status === 'past_due' || isTrialActive)) {
        showView('home');
      } else {
        Subscription.renderView(sub);
        showAuthView('subscription');
      }
    } catch (e) {
      console.error('afterLogin error:', e);
      showAuthView('login');
    }
  },

  async _initTrial(user, cpf) {
    try {
      await fetch(CONFIG.BACKEND_URL + '/api/trial/init', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, cpf }),
      });
    } catch (e) {
      console.error('[_initTrial]', e.message);
    }
  },

  async _getSub(userId) {
    try {
      const { data } = await db.from('subscriptions').select('*').eq('user_id', userId).single();
      return data;
    } catch { return null; }
  },

  // ── Login ───────────────────────────────────────────────────────────────────
  async login() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn      = document.getElementById('login-btn');
    const errEl    = document.getElementById('login-error');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'Preencha e-mail e senha.'; return; }

    btn.textContent = 'Entrando...';
    btn.disabled = true;
    try {
      await db.auth.signInWithPassword({ email, password });
    } catch (e) {
      errEl.textContent = _authError(e.message);
      btn.textContent = 'Entrar';
      btn.disabled = false;
    }
  },

  // ── Cadastro ────────────────────────────────────────────────────────────────
  async signup() {
    const name     = document.getElementById('signup-name').value.trim();
    const cpfRaw   = document.getElementById('signup-cpf').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm  = document.getElementById('signup-confirm').value;
    const btn      = document.getElementById('signup-btn');
    const errEl    = document.getElementById('signup-error');
    errEl.textContent = '';

    if (!name)    { errEl.textContent = 'Informe seu nome completo.'; return; }

    const cpf = cpfRaw.replace(/\D/g, '');
    if (cpf.length !== 11) { errEl.textContent = 'CPF deve ter 11 dígitos.'; return; }

    if (!email)   { errEl.textContent = 'Informe seu e-mail.'; return; }
    if (password.length < 6) { errEl.textContent = 'Senha deve ter no mínimo 6 caracteres.'; return; }
    if (password !== confirm) { errEl.textContent = 'As senhas não coincidem.'; return; }

    btn.textContent = 'Criando conta...';
    btn.disabled = true;
    try {
      const { data, error } = await db.auth.signUp({
        email, password,
        options: { data: { name, cpf } },
      });
      if (error) throw error;
      if (data.user && !data.session) {
        showAuthView('confirm-email');
      }
    } catch (e) {
      errEl.textContent = _authError(e.message);
      btn.textContent = 'Criar Conta';
      btn.disabled = false;
    }
  },

  // ── Recuperar senha ─────────────────────────────────────────────────────────
  async forgotPassword() {
    const email = document.getElementById('forgot-email').value.trim();
    const btn   = document.getElementById('forgot-btn');
    const errEl = document.getElementById('forgot-error');
    errEl.textContent = '';
    if (!email) { errEl.textContent = 'Informe seu e-mail.'; return; }

    btn.textContent = 'Enviando...';
    btn.disabled = true;
    try {
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + (window.location.pathname),
      });
      if (error) throw error;
      document.getElementById('forgot-success').style.display = '';
      document.getElementById('forgot-form').style.display = 'none';
    } catch (e) {
      errEl.textContent = _authError(e.message);
      btn.textContent = 'Enviar Link';
      btn.disabled = false;
    }
  },

  // ── Redefinir senha ─────────────────────────────────────────────────────────
  async resetPassword() {
    const pw1   = document.getElementById('reset-pw1').value;
    const pw2   = document.getElementById('reset-pw2').value;
    const btn   = document.getElementById('reset-btn');
    const errEl = document.getElementById('reset-error');
    errEl.textContent = '';
    if (pw1.length < 6) { errEl.textContent = 'Senha deve ter no mínimo 6 caracteres.'; return; }
    if (pw1 !== pw2)    { errEl.textContent = 'As senhas não coincidem.'; return; }

    btn.textContent = 'Salvando...';
    btn.disabled = true;
    try {
      const { error } = await db.auth.updateUser({ password: pw1 });
      if (error) throw error;
      document.getElementById('reset-success').style.display = '';
      document.getElementById('reset-form').style.display = 'none';
      setTimeout(() => {
        window.location.hash = '';
        showAuthView('login');
      }, 2500);
    } catch (e) {
      errEl.textContent = _authError(e.message);
      btn.textContent = 'Salvar Nova Senha';
      btn.disabled = false;
    }
  },

  // ── Logout ──────────────────────────────────────────────────────────────────
  async logout() {
    clearInterval(Subscription._pollTimer);
    Subscription._pollTimer = null;
    Storage.clearUserCache();
    Auth.currentUser = null;
    Auth.currentSubscription = null;
    await db.auth.signOut();
    showAuthView('login');
  },
};

function _authError(msg) {
  const map = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed':       'Confirme seu e-mail antes de entrar.',
    'User already registered':   'Este e-mail já possui cadastro.',
    'Password should be at least 6 characters': 'Senha muito curta (mínimo 6 caracteres).',
  };
  for (const [k, v] of Object.entries(map)) {
    if (msg.includes(k)) return v;
  }
  return msg;
}

// ── Alternância de views de autenticação ──────────────────────────────────────
function showAuthView(name) {
  const ids = ['view-loading','view-login','view-signup','view-forgot-pw',
               'view-confirm-email','view-reset-pw','view-subscription',
               'view-home','view-dashboard'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'none';
  });
  const target = document.getElementById('view-' + name);
  if (target) target.style.display = 'flex';
}
