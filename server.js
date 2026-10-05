/**
 * SolAura Energia — Dashboard executivo (demonstração)
 * Stack: Node.js + Express + SQLite (better-sqlite3) + Tailwind via CDN
 *
 * Estrutura:
 *   server.js          → todo o backend (este arquivo)
 *   views/*.html       → templates HTML com marcadores {{chave}}
 *   public/style.css   → CSS próprio, servido como estático
 *
 * Rodar:  npm install && npm start   →  http://localhost:3000
 */

const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

/* -------------------------------------------------------------------------- */
/* 1. Banco de dados                                                          */
/* -------------------------------------------------------------------------- */

// Cria (ou abre) o arquivo database.sqlite ao lado deste script.
const db = new Database(path.join(__dirname, 'database.sqlite'));

// Tabela de KPIs. `formato` é um molde de exibição (ex.: "{v} MWp") para que
// valor e meta fiquem numéricos no banco e a unidade seja só apresentação.
db.exec(`
  CREATE TABLE IF NOT EXISTS kpis (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    metrica       TEXT NOT NULL UNIQUE,
    valor         REAL NOT NULL,
    meta          REAL NOT NULL,
    formato       TEXT NOT NULL DEFAULT '{v}',
    atualizado_em TEXT NOT NULL
  )
`);

// Povoa com dados de exemplo apenas se a tabela estiver vazia.
if (db.prepare('SELECT COUNT(*) AS n FROM kpis').get().n === 0) {
  const insert = db.prepare(
    'INSERT INTO kpis (metrica, valor, meta, formato, atualizado_em) VALUES (?, ?, ?, ?, ?)'
  );
  const agora = new Date().toISOString();
  db.transaction(() => {
    insert.run('Capacidade Instalada', 12.4, 15, '{v} MWp', agora);
    insert.run('Faturamento Mês', 850, 1000, 'R$ {v}k', agora);
    insert.run('Projetos Ativos', 34, 40, '{v}', agora);
  })();
}

/* -------------------------------------------------------------------------- */
/* 2. Templates e formatação                                                  */
/* -------------------------------------------------------------------------- */

// Lê os templates uma única vez, na inicialização.
const carregar = (nome) => fs.readFileSync(path.join(__dirname, 'views', `${nome}.html`), 'utf8');
const tpl = {
  index: carregar('index'),
  card: carregar('card'),
  aviso: carregar('aviso'),
  option: carregar('option'),
};

// Escapa HTML para evitar injeção de código nos valores vindos do banco.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Substitui {{chave}} pelos valores. Textos são escapados aqui;
// trechos já em HTML (cards, avisos...) vêm de `raw` e entram sem escape.
const render = (template, vars = {}, raw = {}) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in raw ? raw[k] : esc(vars[k] ?? '')));

// Número no padrão brasileiro (12,4 / 1.250).
const num = (n) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);

// Aplica o molde de formato: "R$ {v}k" + 850 → "R$ 850k".
const fmt = (formato, n) => formato.replace('{v}', num(n));

// Data/hora no fuso de Manaus.
const dataHora = (iso) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

/* -------------------------------------------------------------------------- */
/* 3. Rotas                                                                   */
/* -------------------------------------------------------------------------- */

const app = express();
app.use(express.urlencoded({ extended: false })); // lê o corpo de formulários HTML
app.use(express.static(path.join(__dirname, 'public'))); // serve /style.css

// GET / → lista os KPIs e exibe o formulário de atualização.
app.get('/', (req, res) => {
  const kpis = db.prepare('SELECT * FROM kpis ORDER BY id').all();

  // Um card por KPI, com a porcentagem da meta limitada entre 0 e 100.
  const cards = kpis
    .map((k) => {
      const pct = Math.max(0, Math.min(100, (k.valor / k.meta) * 100));
      return render(tpl.card, {
        metrica: k.metrica,
        valor: fmt(k.formato, k.valor),
        meta: fmt(k.formato, k.meta),
        pct: pct.toFixed(1),
        pct_int: Math.round(pct),
        atualizado: dataHora(k.atualizado_em),
      });
    })
    .join('');

  // Opções do <select> do formulário.
  const opcoes = kpis.map((k) => render(tpl.option, { id: k.id, metrica: k.metrica })).join('');

  // Mensagem de retorno após o POST (?ok=1 ou ?erro=1).
  let aviso = '';
  if (req.query.ok === '1') {
    aviso = render(tpl.aviso, { tipo: 'ok', role: 'status', mensagem: 'Indicador atualizado.' });
  } else if (req.query.erro === '1') {
    aviso = render(tpl.aviso, {
      tipo: 'erro',
      role: 'alert',
      mensagem: 'Informe um valor numérico maior ou igual a zero.',
    });
  }

  res.send(render(tpl.index, {}, { cards, opcoes, aviso }));
});

// POST /kpis/update → valida, grava no SQLite e redireciona para a home.
app.post('/kpis/update', (req, res) => {
  const id = Number.parseInt(req.body.id, 10);
  // Aceita vírgula decimal ("13,2") e ponto ("13.2").
  const valor = Number.parseFloat(String(req.body.valor ?? '').trim().replace(',', '.'));

  if (!Number.isInteger(id) || !Number.isFinite(valor) || valor < 0) {
    return res.redirect('/?erro=1');
  }

  const info = db
    .prepare('UPDATE kpis SET valor = ?, atualizado_em = ? WHERE id = ?')
    .run(valor, new Date().toISOString(), id);

  res.redirect(info.changes ? '/?ok=1' : '/?erro=1');
});

app.listen(PORT, '0.0.0.0', () => console.log(`SolAura Dashboard em http://localhost:${PORT}`));
