'use strict';
// Importa as clínicas da prospecção do Zelus Vet (CRM do Zelus, finderlab.com.br/crmzelus) para o CRM do
// Drigo, com origem "Clínicas Vet SP", para o disparo do convite pelo WhatsApp.
//
// Uso: DATABASE_URL=... node scripts/importar-clinicas-vet.js leads.json [--gravar]
//   leads.json: exportação de crm_zelus_leads (crm = 'vet'), com nome, telefone, celular, rede, bairro, etc.
//   Sem --gravar, só mostra o que entraria.
//
// Entram só as clínicas com celular, que ninguém trabalhou ainda (status nao_contatado), fora das redes
// que não devem ser abordadas (WeVets é parceira; unidades da Petz decidem na matriz). Número que já existe
// no CRM do Drigo fica como está. Ordem de envio: prioridade A, B, C e, dentro dela, mais avaliações primeiro.

const fs = require('fs');
const { Pool } = require('pg');
const { ORIGEM_CLINICAS } = require('../lib/perfil-zelus-vet');

const REDES_FORA = /wevets|seres|petz/i;
const NAO_ABORDAR = /n[aã]o abordar/i;

function normalizaWhats(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 11 && d[2] === '9') return '55' + d;
  return '';
}

function observacoes(l) {
  const partes = [];
  const lugar = [l.bairro, l.cidade].filter(Boolean).join(', ');
  if (lugar) partes.push(lugar);
  if (l.tipo && l.tipo !== '—') partes.push(String(l.tipo).toLowerCase());
  if (l.nota) partes.push(`nota ${String(l.nota).replace('.', ',')} com ${l.avaliacoes || 0} avaliações no Google`);
  if (l.prioridade) partes.push('prioridade ' + l.prioridade);
  return partes.join('; ');
}

async function main() {
  const arquivo = process.argv[2];
  const gravar = process.argv.includes('--gravar');
  if (!arquivo) throw new Error('Informe o arquivo JSON das clínicas.');
  const leads = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const ordem = { A: 0, B: 1, C: 2 };
  const fora = { semCelular: 0, rede: 0, jaTrabalhada: 0, repetida: 0 };
  const vistos = new Set();
  const linhas = [];
  for (const l of leads) {
    const whats = normalizaWhats(l.telefone);
    if (!l.celular || !whats) { fora.semCelular += 1; continue; }
    if (REDES_FORA.test(l.rede || '') || REDES_FORA.test(l.nome || '') || NAO_ABORDAR.test(l.observacao || '')) { fora.rede += 1; continue; }
    if (l.status && l.status !== 'nao_contatado') { fora.jaTrabalhada += 1; continue; }
    if (vistos.has(whats)) { fora.repetida += 1; continue; }
    vistos.add(whats);
    linhas.push({ l, whats });
  }
  linhas.sort((a, b) => (ordem[a.l.prioridade] ?? 3) - (ordem[b.l.prioridade] ?? 3) || (b.l.avaliacoes || 0) - (a.l.avaliacoes || 0));
  console.log(`Clínicas no arquivo: ${leads.length}. Entram: ${linhas.length}. Fora: ${JSON.stringify(fora)}`);
  console.log(linhas.slice(0, 5).map(({ l, whats }) => `  ${l.prioridade || '-'} ${l.nome} (${whats.slice(0, 4)}…${whats.slice(-4)}) ${observacoes(l)}`).join('\n'));
  if (!gravar) { console.log('Nada gravado (use --gravar).'); return; }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: false } });
  let novos = 0;
  try {
    for (const { l, whats } of linhas) {
      const r = await pool.query(
        `INSERT INTO crm_contatos (nome, whats, empresa, status, origem, observacoes)
         VALUES ('', $1, $2, 'novo', $3, $4)
         ON CONFLICT (whats) WHERE whats <> '' DO NOTHING`,
        [whats, String(l.nome || '').slice(0, 160), ORIGEM_CLINICAS, observacoes(l).slice(0, 500)]
      );
      novos += r.rowCount;
    }
  } finally {
    await pool.end();
  }
  console.log(`Gravadas: ${novos} (as outras já estavam no CRM do Drigo).`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
