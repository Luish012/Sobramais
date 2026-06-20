# Finanças SaaS — Guia de Configuração

## Pré-requisitos

- [Supabase](https://supabase.com) — conta gratuita
- [Asaas](https://asaas.com) — conta para cobranças (sandbox disponível)
- [Node.js](https://nodejs.org) 18+ — para o servidor backend

---

## 1. Configurar Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Acesse **SQL Editor** e execute o arquivo `setup/supabase-setup.sql`
3. Anote as credenciais em **Settings → API**:
   - `Project URL`
   - `anon public key`
   - `service_role key` (apenas para o servidor — nunca expor no frontend)

### Configurar e-mail (autenticação)

- Vá em **Authentication → Settings → Email**
- Ative "Confirm email" se quiser verificação de e-mail
- Configure o "Site URL" para a URL onde o `index.html` está hospedado

### Criar usuários de teste

1. Acesse **Authentication → Users → Add user**
2. Crie:
   - `luishalves017@gmail.com`
   - `mayarasuzuki121@gmail.com`

---

## 2. Configurar o Frontend

Edite `config.js`:

```javascript
const CONFIG = {
  SUPABASE_URL:      'https://SEU_PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'sua_anon_key_aqui',
  BACKEND_URL:       'https://seu-servidor.com',  // URL do server.js em produção
  PLAN_NAME:  'Plano Controle Financeiro',
  PLAN_PRICE: 9.90,
};
```

---

## 3. Configurar o Servidor Backend

```bash
cd server/
cp .env.example .env
```

Edite `.env`:

```env
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_KEY=sua_service_role_key
ASAAS_API_KEY=$aact_sua_chave_aqui
ASAAS_SANDBOX=true           # false em produção
FRONTEND_URL=http://localhost:8080
PORT=3001
```

Instale as dependências e inicie:

```bash
npm install
npm start
```

---

## 4. Configurar Webhook do Asaas

1. Acesse [app.asaas.com](https://app.asaas.com) → Integrações → Webhooks
2. Adicione a URL: `https://seu-servidor.com/api/asaas/webhook`
3. Selecione os eventos:
   - `PAYMENT_RECEIVED`
   - `PAYMENT_CONFIRMED`
   - `PAYMENT_OVERDUE`
   - `SUBSCRIPTION_CANCELLED`
   - `SUBSCRIPTION_RENEWED`

---

## 5. Testar localmente

### Frontend (qualquer servidor estático)

```bash
# Com Python
python3 -m http.server 8080

# Com Node.js (npx)
npx serve . -p 8080
```

Abra: `http://localhost:8080`

### Backend

```bash
cd server && npm start
```

---

## 6. Estrutura dos arquivos

```
/
├── index.html          — App principal (todas as telas)
├── config.js           — Configuração (Supabase + Backend URL)
├── supabase-client.js  — Inicialização do cliente Supabase
├── auth.js             — Login, cadastro, recuperação de senha
├── subscription.js     — Gerenciamento de assinatura
├── storage.js          — Cache local + sincronização com Supabase
├── finance.js          — Lógica financeira (recorrências, faturas)
├── app.js              — Interface do usuário
├── style.css           — Estilos
├── favicon.png
├── setup/
│   └── supabase-setup.sql   — SQL para criar tabelas + RLS
└── server/
    ├── server.js            — Backend Express (webhook Asaas)
    ├── package.json
    └── .env.example
```

---

## Fluxo do usuário

1. Acessa o site → tela de login
2. Cria conta → confirma e-mail (se ativado)
3. Faz login → tela de assinatura (se não assinou)
4. Clica em "Assinar" → link de pagamento Asaas abre
5. Paga via Pix ou Cartão
6. Asaas envia webhook → servidor ativa assinatura no Supabase
7. Frontend detecta status = active → libera acesso ao painel
8. Usuário controla finanças com dados salvos na nuvem
