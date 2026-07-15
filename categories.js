'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIAS INTELIGENTES
// - Categorias 100% personalizáveis pelo usuário (sem categorias fixas no código)
// - Motor de categorização local (sem IA externa, sem OpenAI, sem APIs)
// - Aprendizado por usuário: associa descrição → categoria após escolha manual
// ═══════════════════════════════════════════════════════════════════════════

// Conjunto padrão criado apenas na primeira vez que o usuário não tem nenhuma
// categoria (nova conta OU conta antiga migrada). Pode ser editado, renomeado,
// ocultado ou excluído livremente — não é usado em nenhum outro lugar do código.
const DEFAULT_CATEGORIES_SEED = [
  { name: 'Alimentação',   icon: '🍔', color: '#f97316', keywords: ['lanche','hamburguer','pizza','salgado','esfiha','pastel','padaria','restaurante','mcdonalds','burger king','habibs','subway','acai','ifood','comida','almoco','jantar','lanchonete'] },
  { name: 'Mercado',       icon: '🛒', color: '#22c55e', keywords: ['mercado','atacadao','assai','extra','carrefour','tenda','spani','supermercado','hortifruti','feira'] },
  { name: 'Combustível',   icon: '⛽', color: '#eab308', keywords: ['shell','ipiranga','petrobras','etanol','gasolina','diesel','posto','combustivel'] },
  { name: 'Moradia',       icon: '🏠', color: '#0ea5e9', keywords: ['aluguel','condominio','iptu','luz','energia','agua','gas','internet','reforma'] },
  { name: 'Saúde',         icon: '💊', color: '#ef4444', keywords: ['farmacia','remedio','medico','consulta','exame','plano de saude','dentista','hospital'] },
  { name: 'Lazer',         icon: '🎮', color: '#a855f7', keywords: ['cinema','show','viagem','passeio','jogo','streaming','netflix','bar','balada','parque'] },
  { name: 'Roupas',        icon: '👕', color: '#ec4899', keywords: ['roupa','loja','calcado','tenis','sapato','vestuario','moda'] },
  { name: 'Contas',        icon: '🧾', color: '#64748b', keywords: ['boleto','fatura','conta','taxa','mensalidade'] },
  { name: 'Transporte',    icon: '🚗', color: '#3b82f6', keywords: ['uber','99','taxi','onibus','metro','pedagio','estacionamento','ipva','licenciamento'] },
  { name: 'Pets',          icon: '🐶', color: '#84cc16', keywords: ['cobasi','petz','racao','veterinario','banho','tosa','pet shop'] },
  { name: 'Educação',      icon: '🎓', color: '#6366f1', keywords: ['curso','faculdade','escola','mensalidade escolar','livro','material escolar'] },
  { name: 'Trabalho',      icon: '💼', color: '#0f766e', keywords: ['material de escritorio','ferramenta de trabalho','coworking'] },
  { name: 'Presentes',     icon: '🎁', color: '#f43f5e', keywords: ['presente','aniversario','lembranca'] },
  { name: 'Cartão',        icon: '💳', color: '#7c3aed', keywords: ['fatura do cartao','anuidade'] },
  { name: 'Investimentos', icon: '💰', color: '#059669', keywords: ['investimento','aporte','corretora','tesouro direto','acoes'] },
  { name: 'Outros',        icon: '📦', color: '#78716c', keywords: [] },
];

// ─── Normalização de texto (sem libs externas) ───────────────────────────────
function normalizeText(str) {
  return (str || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const Categories = {

  // ── CRUD local (sincroniza via Storage) ─────────────────────────────────────
  list() {
    return [...Storage.getCategories()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  },
  active() {
    return this.list().filter(c => c.active !== false);
  },
  getById(id) {
    if (!id) return null;
    return Storage.getCategories().find(c => c.id === id) || null;
  },
  getByName(name) {
    if (!name) return null;
    const norm = normalizeText(name);
    return Storage.getCategories().find(c => normalizeText(c.name) === norm) || null;
  },

  create({ name, icon, color, keywords }) {
    const list = Storage.getCategories();
    const cat = {
      id: genId(),
      name: (name || '').trim() || 'Nova categoria',
      icon: icon || '📦',
      color: color || '#78716c',
      position: list.length,
      active: true,
      keywords: (keywords || []).map(k => k.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(cat);
    Storage.setCategories(list);
    return cat;
  },

  update(id, data) {
    const list = Storage.getCategories();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return null;
    list[idx] = {
      ...list[idx],
      ...('name' in data ? { name: (data.name || '').trim() || list[idx].name } : {}),
      ...('icon' in data ? { icon: data.icon || list[idx].icon } : {}),
      ...('color' in data ? { color: data.color || list[idx].color } : {}),
      ...('active' in data ? { active: !!data.active } : {}),
      ...('keywords' in data ? { keywords: (data.keywords || []).map(k => k.trim()).filter(Boolean) } : {}),
      updatedAt: new Date().toISOString(),
    };
    Storage.setCategories(list);
    return list[idx];
  },

  remove(id) {
    // Não apaga histórico: lançamentos antigos mantêm o texto da categoria,
    // apenas o vínculo (category_id) fica órfão e pode ser reatribuído.
    const list = Storage.getCategories().filter(c => c.id !== id);
    Storage.setCategories(list);
  },

  reorder(orderedIds) {
    const list = Storage.getCategories();
    const map = new Map(list.map(c => [c.id, c]));
    const reordered = orderedIds.map((id, i) => {
      const c = map.get(id);
      if (!c) return null;
      return { ...c, position: i, updatedAt: new Date().toISOString() };
    }).filter(Boolean);
    // mantém quaisquer categorias não listadas (segurança) ao final
    const remaining = list.filter(c => !orderedIds.includes(c.id));
    Storage.setCategories([...reordered, ...remaining]);
  },

  move(id, dir) {
    const list = this.list();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= list.length) return;
    [list[idx], list[swapWith]] = [list[swapWith], list[idx]];
    this.reorder(list.map(c => c.id));
  },

  addKeyword(id, keyword) {
    const cat = this.getById(id);
    if (!cat) return;
    const kw = (keyword || '').trim();
    if (!kw) return;
    const norm = normalizeText(kw);
    if (cat.keywords.some(k => normalizeText(k) === norm)) return;
    this.update(id, { keywords: [...cat.keywords, kw] });
  },

  removeKeyword(id, keyword) {
    const cat = this.getById(id);
    if (!cat) return;
    const norm = normalizeText(keyword);
    this.update(id, { keywords: cat.keywords.filter(k => normalizeText(k) !== norm) });
  },

  // Garante que todo usuário tenha ao menos o conjunto padrão de categorias.
  // Roda uma única vez (quando a lista local está vazia) — tanto para contas
  // novas (caso o trigger do banco não tenha rodado) quanto para contas antigas
  // criadas antes desta funcionalidade existir.
  ensureDefaults() {
    if (Storage.getCategories().length > 0) return;
    const seeded = DEFAULT_CATEGORIES_SEED.map((c, i) => ({
      id: genId(),
      name: c.name, icon: c.icon, color: c.color,
      keywords: [...c.keywords],
      position: i,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    Storage.setCategories(seeded);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE CATEGORIZAÇÃO (100% local — sem IA externa/API)
// ═══════════════════════════════════════════════════════════════════════════
const CatIntel = {

  // Chave usada para "lembrar" uma descrição exata já classificada pelo usuário.
  learnKey(description) {
    return normalizeText(description);
  },

  // Consulta o aprendizado do usuário para esta descrição exata.
  findLearned(description) {
    const key = this.learnKey(description);
    if (!key) return null;
    const entry = Storage.getCategoryLearning().find(l => l.matchKey === key);
    if (!entry) return null;
    const cat = Categories.getById(entry.categoryId);
    return cat && cat.active !== false ? cat : null;
  },

  // Pontua cada categoria ativa por correspondência de palavras-chave e
  // retorna a categoria vencedora (ou null se nada bateu).
  matchByKeywords(description) {
    const norm = normalizeText(description);
    if (!norm) return null;
    let best = null;
    let bestScore = 0;
    for (const cat of Categories.active()) {
      let score = 0;
      for (const kw of (cat.keywords || [])) {
        const kwNorm = normalizeText(kw);
        if (kwNorm && norm.includes(kwNorm)) score += kwNorm.length;
      }
      if (score > bestScore) { bestScore = score; best = cat; }
    }
    return bestScore > 0 ? best : null;
  },

  // Classificação principal: aprendizado exato > palavras-chave > desconhecido.
  classify(description) {
    return this.findLearned(description) || this.matchByKeywords(description);
  },

  // Salva/atualiza o aprendizado do usuário para esta descrição.
  learn(description, categoryId) {
    const key = this.learnKey(description);
    if (!key || !categoryId) return;
    const list = Storage.getCategoryLearning();
    const idx = list.findIndex(l => l.matchKey === key);
    if (idx === -1) {
      list.push({ id: genId(), matchKey: key, categoryId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    } else {
      list[idx] = { ...list[idx], categoryId, updatedAt: new Date().toISOString() };
    }
    Storage.setCategoryLearning(list);
  },
};
