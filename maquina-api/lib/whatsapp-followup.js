'use strict';
// Follow-up automático no WhatsApp. Nas conversas do convite, quem respondia "sim" e depois ficava em
// silêncio nunca recebia uma segunda mensagem. Aqui, uma única vez por pessoa, o Drigo manda um lembrete
// curto, escrito a partir da conversa (retoma o assunto dela; o link só vai se ela mostrou interesse na imersão), quando:
//   a pessoa escreveu (não foi resposta automática), o Drigo respondeu por último, e já se passaram
//   de 14 a 23h30 desde a última mensagem dela (ainda dentro da janela de 24h do WhatsApp, em que
//   texto livre é permitido sem template);
//   o contato não pediu para sair, não recusou, não se inscreveu e não é conversa de turma fechada;
//   é horário comercial em Brasília e a imersão ainda não aconteceu.
// Desliga com WHATSAPP_FOLLOWUP=off.

const FUSO = 'America/Sao_Paulo';
const LOCK_ID = 7331002;
const HORA_INI = 9;
const HORA_FIM = 20;
const ULTIMO_DIA = '2026-12-08'; // véspera da imersão: depois disso o lembrete não faz sentido
const LINK = 'https://www.maquina.finderlab.com.br/inscricao';

function primeiroNome(nome) {
  const t = String(nome || '').trim().split(/\s+/)[0].replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (t.length < 2 || /\d/.test(t)) return '';
  return t === t.toUpperCase() || t === t.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t;
}

function textoFollowup(nome) {
  const n = primeiroNome(nome);
  return `Oi${n ? ', ' + n : ''}, passando só pra não deixar nossa conversa solta.. se fizer sentido garantir sua vaga na Máquina de Decisões (9 e 10 de dezembro, em Alphaville), a inscrição é por aqui: ${LINK}\n\nSe ficou alguma dúvida, me responde aqui que eu te ajudo.`;
}

// Instrução para o modelo escrever o lembrete a partir da conversa. A conversa vai como histórico normal e
// esta instrução entra como última mensagem do "usuário" pedindo o texto.
function pedidoFollowup(nome) {
  return [
    '[INSTRUÇÃO INTERNA, não é mensagem da pessoa] A pessoa parou de responder há algumas horas. Escreva UMA mensagem curta de WhatsApp para retomar a conversa, como o Rodrigo escreveria de verdade.',
    nome ? `Ela se chama ${nome}: comece com "Oi ${nome},".` : 'Comece com "Oi,".',
    'Retome o assunto específico que ela trouxe (o negócio, a dúvida, a decisão dela) com algo útil e novo: um passo seguinte, um exemplo ou uma pergunta simples sobre o caso dela. Não repita o que já foi dito.',
    `Só fale da imersão e só mande o link ${LINK} se, nesta conversa, ela mesma perguntou da imersão, de valor, de data, ou disse que tem interesse. Se ela só pediu ajuda com o negócio, não cite a imersão nem mande link.`,
    'Nada de "passando só pra não deixar nossa conversa solta", "só pra lembrar" ou cobrança. No máximo 3 linhas, no máximo uma pergunta, sem emoji, sem travessão, sem lista, sem markdown. Responda só com o texto da mensagem.',
  ].join(' ');
}

function agoraBrasilia(d = new Date()) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d)) p[x.type] = x.value;
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24 };
}

function init(deps) {
  const { pool, crmChaveSql, sendWhatsAppFreeform, saveWhatsAppMessage, respostaAutomatica, ativo } = deps;
  const relogio = deps.agora || agoraBrasilia;
  let timer = null;
  let rodando = false;

  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_followups (
        chave       TEXT PRIMARY KEY,
        phone       TEXT NOT NULL,
        texto       TEXT NOT NULL DEFAULT '',
        erro        TEXT NOT NULL DEFAULT '',
        enviado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  // Quem está na hora de receber o lembrete (no máximo alguns por rodada, para não disparar em lote).
  async function candidatos(limite) {
    const k = crmChaveSql('m.phone');
    const { rows } = await pool.query(
      `WITH m AS (
         SELECT ${k} AS chave, m.phone, m.direction, m.body, m.profile_name, m.created_at FROM whatsapp_messages m
       ), ult AS (
         SELECT DISTINCT ON (chave) chave, phone, direction FROM m WHERE chave IS NOT NULL ORDER BY chave, created_at DESC
       ), ult_in AS (
         SELECT DISTINCT ON (chave) chave, body, profile_name, created_at FROM m
         WHERE chave IS NOT NULL AND direction = 'in' ORDER BY chave, created_at DESC
       )
       SELECT ult.chave, ult.phone, ult_in.body AS ultima_dela, ult_in.profile_name,
              (SELECT c.nome FROM crm_contatos c WHERE ${crmChaveSql('c.whats')} = ult.chave ORDER BY c.id LIMIT 1) AS nome
       FROM ult JOIN ult_in USING (chave)
       WHERE ult.direction = 'out'
         AND ult_in.created_at BETWEEN now() - interval '23 hours 30 minutes' AND now() - interval '14 hours'
         AND NOT EXISTS (SELECT 1 FROM whatsapp_followups f WHERE f.chave = ult.chave)
         AND NOT EXISTS (SELECT 1 FROM whatsapp_turma t WHERE ${crmChaveSql('t.phone')} = ult.chave)
         AND NOT EXISTS (
           SELECT 1 FROM crm_contatos c WHERE ${crmChaveSql('c.whats')} = ult.chave
             AND (c.status IN ('sem_interesse', 'nao_quer_receber', 'inscrito') OR c.optout_em IS NOT NULL)
         )
       ORDER BY ult_in.created_at
       LIMIT $1`,
      [limite]
    );
    return rows.filter((r) => !respostaAutomatica(r.ultima_dela));
  }

  async function tick() {
    if (!ativo || rodando) return;
    const { dia, hora } = relogio();
    if (dia > ULTIMO_DIA || hora < HORA_INI || hora >= HORA_FIM) return;
    rodando = true;
    let client = null;
    let lock = false;
    try {
      // A trava é da sessão do Postgres: pega e solta na mesma conexão.
      client = await pool.connect();
      lock = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])).rows[0].ok;
      if (!lock) return;
      for (const c of await candidatos(5)) {
        // O texto é escrito a partir da conversa (gerarTexto). Se não der para gerar, não manda nada nesta rodada:
        // um lembrete genérico de "garanta sua vaga" para quem só pediu ajuda faz mais mal do que bem.
        let texto = '';
        if (deps.gerarTexto) {
          try { texto = String((await deps.gerarTexto({ phone: c.phone, nome: primeiroNome(c.nome || c.profile_name) })) || '').trim(); }
          catch (err) { console.error('whatsapp-followup: falha ao escrever o lembrete', err && err.message ? err.message : err); }
        } else {
          texto = textoFollowup(c.nome || c.profile_name);
        }
        if (!texto) continue;
        // Reserva antes de enviar: se outra instância ou rodada pegar a mesma pessoa, o INSERT falha e ninguém manda duas vezes.
        const reservado = await pool.query(
          'INSERT INTO whatsapp_followups (chave, phone, texto) VALUES ($1,$2,$3) ON CONFLICT (chave) DO NOTHING RETURNING chave',
          [c.chave, c.phone, texto]
        );
        if (!reservado.rows.length) continue;
        try {
          await sendWhatsAppFreeform(c.phone, texto);
          await saveWhatsAppMessage({ phone: c.phone, direction: 'out', body: texto });
          console.log('whatsapp-followup: lembrete enviado para final %s', String(c.phone).slice(-4));
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          await pool.query('UPDATE whatsapp_followups SET erro=$2 WHERE chave=$1', [c.chave, msg.slice(0, 300)]);
          console.error('whatsapp-followup: falha para final %s', String(c.phone).slice(-4), msg);
        }
      }
    } catch (err) {
      console.error('whatsapp-followup', err && err.message ? err.message : err);
    } finally {
      if (lock) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
      if (client) client.release();
      rodando = false;
    }
  }

  function start() {
    if (!ativo || timer) return;
    timer = setInterval(tick, 10 * 60 * 1000);
    setTimeout(tick, 30 * 1000);
  }

  return { migrate, start, tick, candidatos };
}

module.exports = { init, textoFollowup, primeiroNome, pedidoFollowup };
