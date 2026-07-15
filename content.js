'use strict';
// ─── CONTEÚDO EDITÁVEL: NOVIDADES E PERGUNTAS FREQUENTES ──────────────────────
// Arquivo simples de conteúdo estático. Edite os arrays abaixo para atualizar
// a área "Novidades" e a "Central de Ajuda / FAQ" dentro de Minha Conta.
// Não contém lógica — apenas dados.

// ── NOVIDADES ──────────────────────────────────────────────────────────────
// Ordem: mais recente primeiro. Cada item aparece como um card em "Novidades".
const NEWS_DATA = [
  {
    version: '1.3.0',
    date: '2026-07-15',
    title: 'Categorias Inteligentes',
    changes: [
      'Crie e personalize suas próprias categorias',
      'Edite nome, ícone, cor e palavras-chave',
      'Classificação automática dos Gastos Rápidos',
      'O SobraMais aprende com suas escolhas'
    ]
  },
  {
    version: '1.1.0',
    date: '2026-07-13',
    title: 'Conta, suporte e novidades',
    changes: [
      'Central de suporte com chamados e mensagens',
      'Perfil completo em Minha Conta',
      'Instagram oficial do SobraMais',
      'Perguntas frequentes',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-01',
    title: 'Lançamento do SobraMais',
    changes: [
      'Controle de despesas e receitas',
      'Cartão de crédito e faturas',
      'Recorrências e parcelamentos',
      'Metas de poupança',
      'Saldo disponível e previsão do mês',
    ],
  },
];

// ── PERGUNTAS FREQUENTES ────────────────────────────────────────────────────
const FAQ_DATA = [
  {
    q: 'Como funciona o saldo disponível?',
    a: 'O saldo disponível mostra quanto dinheiro você realmente tem hoje, considerando as entradas já recebidas e as despesas já pagas. Ele não inclui contas que ainda não venceram.',
  },
  {
    q: 'O que é previsão do mês?',
    a: 'A previsão do mês é o resultado esperado somando tudo que ainda vai entrar e sair até o fim do mês selecionado, incluindo contas pendentes e entradas futuras.',
  },
  {
    q: 'Como funciona o fluxo previsto?',
    a: 'O fluxo previsto projeta dia a dia como seu saldo deve se comportar com base nos lançamentos já cadastrados, alertando quando existe risco de saldo negativo.',
  },
  {
    q: 'Como registrar uma compra no cartão?',
    a: 'Vá em Painel Financeiro → Cartão, selecione o cartão desejado e toque em "+ Novo" na tela de Despesas escolhendo a forma de pagamento "Crédito", ou use o Gasto Rápido na tela inicial.',
  },
  {
    q: 'Como pagar uma fatura?',
    a: 'Na aba Cartão, abra a fatura do mês desejado e toque em "Pagar Fatura". Isso marca todos os lançamentos daquela fatura como pagos.',
  },
  {
    q: 'Como funciona o trial gratuito?',
    a: 'Ao criar sua conta, você tem 7 dias grátis para usar o SobraMais sem pagar nada. O período começa no seu primeiro acesso e é vinculado ao seu CPF.',
  },
  {
    q: 'Como cancelar a assinatura?',
    a: 'Em Minha Conta → Assinatura, toque em "Cancelar Assinatura". Você continua com acesso normalmente até o fim do período já pago.',
  },
  {
    q: 'Como abrir um chamado?',
    a: 'Em Minha Conta → Suporte, toque em "Abrir chamado", preencha assunto, categoria e mensagem. Você pode acompanhar a resposta em "Meus chamados".',
  },
];
