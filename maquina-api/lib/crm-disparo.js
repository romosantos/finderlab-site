'use strict';
// Disparo agendado do convite (WhatsApp) para os contatos do CRM.
// Regras de segurança, todas aplicadas na hora de escolher quem recebe:
//   status "novo", com nome e WhatsApp, autorização diferente de "não", ainda sem nenhuma conversa e sem convite anterior.
// O envio só acontece com o template aprovado pela Meta, dentro da janela do dia, no ritmo configurado,
// e pausa sozinho se aparecerem falhas de entrega ou muitos pedidos de PARAR.

const TEMPLATE_PADRAO = 'HXde4088ab10c6fb2f0d76d9d36fd3a5ae'; // maquina_convite_imersao (Marketing, pt_BR), com o primeiro nome
const TEMPLATE_GERAL_PADRAO = 'HX3cd3ea79c853888c0f418e999b25d0f8'; // maquina_convite_imersao_geral, mesma mensagem sem o nome (contato sem nome)
const FUSO = 'America/Sao_Paulo';
const LOCK_ID = 7331001;

// Texto igual ao do template aprovado: é o que fica gravado na conversa para o Drigo saber o que a pessoa recebeu.
const TEXTO_CONVITE = [
  'Oi, {{1}}, tudo bem? Aqui é o Drigo, agente de IA do Rodrigo Moraes, da Finder Lab. 😊',
  'Você provavelmente já experimentou ferramentas de IA. Mas já pensou em como usá-las para analisar cenários, antecipar tendências e tomar decisões melhores no seu negócio — e não apenas para escrever textos ou automatizar tarefas?',
  'Nos dias 9 e 10 de dezembro, em Alphaville (SP), o Rodrigo vai conduzir a Máquina de Decisões, uma imersão presencial para empresários e líderes que querem sair da experimentação e levar a IA para dentro das decisões reais da empresa.',
  'Serão dois dias para aplicar esse método ao seu negócio, fazer um diagnóstico e aprender a construir um agente de IA a partir de uma decisão real.',
  'São apenas 50 vagas.',
  'Posso te explicar como vai funcionar?',
  'Para não receber mais mensagens, responda PARAR.',
].join('\n');

// Igual ao template sem nome aprovado na Meta.
const TEXTO_GERAL = TEXTO_CONVITE.replace('Oi, {{1}}, tudo bem?', 'Oi, tudo bem?').replace(' — e não apenas', ', e não apenas');

const PLANO_INICIAL = [
  ['2026-10-19', 19, ['Meus Contatos']],
  ['2026-10-20', 50, ['Comunidade RainMakers', 'Comunidade Código Diário']],
  ['2026-10-21', 70, ['Comunidade RainMakers', 'Comunidade Código Diário']],
  ['2026-10-22', 70, ['Comunidade RainMakers', 'Comunidade Código Diário']],
];

// Só o primeiro nome, com a primeira letra maiúscula quando o nome veio todo em caixa alta ou baixa.
function primeiroNome(nome) {
  const limpa = (x) => String(x || '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  const partes = String(nome || '').trim().split(/\s+/);
  if (partes.length > 1 && /^(dr|dra|sr|sra|prof|profa|pastor|pr)$/i.test(limpa(partes[0]))) partes.shift();
  const t = limpa(partes[0]);
  if (t.length < 2 || /\d/.test(t)) return '';
  if (t === t.toUpperCase() || t === t.toLowerCase()) return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return t;
}

// { dia: '2026-10-19', hora: 10 } no horário de Brasília.
function agoraBrasilia(d = new Date()) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d)) p[x.type] = x.value;
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24 };
}

function init(app, deps) {
  const { pool, twilioClient, from, templateSid: tplEnv, templateSidGeral: tplGeralEnv, saveWhatsAppMessage, toWhatsAppAddress, crmChaveSql, clean, avisa, ownerWhats } = deps;
  const relogio = deps.agora || agoraBrasilia;
  const TEMPLATE_SID = tplEnv || TEMPLATE_PADRAO;
  const TEMPLATE_GERAL_SID = tplGeralEnv || TEMPLATE_GERAL_PADRAO;
  let tickRodando = false;
  let proximoEm = 0;
  const cacheAprov = {};
  let timer = null;

  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_disparo_config (
        id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        ativo            BOOLEAN NOT NULL DEFAULT false,
        hora_ini         INT NOT NULL DEFAULT 10,
        hora_fim         INT NOT NULL DEFAULT 17,
        lote             INT NOT NULL DEFAULT 10,
        pausa_min_s      INT NOT NULL DEFAULT 30,
        pausa_max_s      INT NOT NULL DEFAULT 60,
        pausa_lote_min   INT NOT NULL DEFAULT 15,
        motivo_pausa     TEXT NOT NULL DEFAULT '',
        pausado_em       TIMESTAMPTZ,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS crm_disparo_dias (
        dia      DATE PRIMARY KEY,
        limite   INT NOT NULL,
        origens  TEXT[] NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS crm_disparos (
        id            SERIAL PRIMARY KEY,
        contato_id    INT NOT NULL,
        whats         TEXT NOT NULL DEFAULT '',
        dia           DATE NOT NULL,
        enviado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
        message_sid   TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'pendente',
        status_final  TEXT NOT NULL DEFAULT '',
        erro          TEXT NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX IF NOT EXISTS crm_disparos_contato_uidx ON crm_disparos (contato_id);
      CREATE INDEX IF NOT EXISTS crm_disparos_dia_idx ON crm_disparos (dia, status);
    `);
    const novo = await pool.query('INSERT INTO crm_disparo_config (id) VALUES (1) ON CONFLICT DO NOTHING');
    if (novo.rowCount) {
      for (const [dia, limite, origens] of PLANO_INICIAL) {
        await pool.query('INSERT INTO crm_disparo_dias (dia, limite, origens) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [dia, limite, origens]);
      }
    }
  }

  // ---- aprovação do template (Content API da Twilio), com cache curto ----
  async function aprovacao(forca, sid) {
    sid = sid || TEMPLATE_SID;
    const c = cacheAprov[sid] || { em: 0, st: 'desconhecido' };
    if (!forca && Date.now() - c.em < (c.st === 'approved' ? 30 * 60e3 : 3 * 60e3)) return c.st;
    let st = 'desconhecido';
    try {
      const r = await twilioClient.content.v1.contents(sid).approvalFetch().fetch();
      st = String((r && r.whatsapp && r.whatsapp.status) || 'desconhecido').toLowerCase();
    } catch (e) {
      console.error('disparo: não consegui ler a aprovação do template', e && e.message ? e.message : e);
      st = c.st === 'approved' ? 'approved' : 'desconhecido';
    }
    cacheAprov[sid] = { em: Date.now(), st };
    return st;
  }

  async function pausar(motivo) {
    await pool.query(`UPDATE crm_disparo_config SET ativo=false, motivo_pausa=$1, pausado_em=now(), updated_at=now() WHERE id=1`, [motivo]);
    console.error('disparo: pausado. ' + motivo);
    try { await avisa('Disparos do convite pausados', 'Os disparos do convite da Máquina de Decisões foram pausados automaticamente.\n\nMotivo: ' + motivo + '\n\nConfira a qualidade do número na Meta e, se estiver tudo certo, reative em /admin/crm (botão Disparos).'); } catch (_) { /* aviso é best-effort */ }
  }

  // Atualiza o andamento das mensagens recentes e pausa se houver sinal de problema.
  async function verificaSinais(dia) {
    const pend = await pool.query(
      `SELECT id, message_sid FROM crm_disparos
        WHERE status='enviado' AND message_sid <> '' AND enviado_em > now() - interval '6 hours'
          AND status_final NOT IN ('delivered','read','failed','undelivered')
        ORDER BY enviado_em DESC LIMIT 15`);
    for (const p of pend.rows) {
      try {
        const m = await twilioClient.messages(p.message_sid).fetch();
        await pool.query('UPDATE crm_disparos SET status_final=$2, erro=CASE WHEN $3::text <> \'\' THEN $3 ELSE erro END WHERE id=$1', [p.id, m.status || '', m.errorCode ? 'Twilio ' + m.errorCode : '']);
      } catch (e) { /* tenta de novo no próximo ciclo */ }
    }
    const c = (await pool.query(
      `SELECT count(*) FILTER (WHERE d.status IN ('enviado','pendente'))::int AS enviados,
              count(*) FILTER (WHERE d.status_final IN ('failed','undelivered'))::int AS falhas,
              count(*) FILTER (WHERE c.status = 'nao_quer_receber')::int AS parar
         FROM crm_disparos d LEFT JOIN crm_contatos c ON c.id = d.contato_id
        WHERE d.dia = $1`, [dia])).rows[0];
    if (c.falhas >= 3) { await pausar(`${c.falhas} mensagens não foram entregues hoje.`); return true; }
    if (c.parar >= 3 && c.parar * 100 >= c.enviados * 10) { await pausar(`${c.parar} pessoas pediram para parar de receber (de ${c.enviados} enviados hoje).`); return true; }
    const seguidos = (await pool.query(`SELECT status FROM crm_disparos WHERE status IN ('enviado','erro') ORDER BY id DESC LIMIT 3`)).rows;
    if (seguidos.length === 3 && seguidos.every((r) => r.status === 'erro')) { await pausar('3 falhas seguidas ao enviar pela Twilio.'); return true; }
    return false;
  }

  // Candidatos na ordem das origens do dia (primeiro as primeiras da lista), mais antigos primeiro.
  // aceitaSemNome: só quando o template sem nome está aprovado; senão contato sem nome fica esperando.
  function sqlElegiveis(select, limite, aceitaSemNome) {
    return `SELECT ${select} FROM crm_contatos c
       WHERE c.status = 'novo' AND c.whats ~ '^55[0-9]{10,11}$' ${aceitaSemNome ? '' : "AND btrim(c.nome) <> ''"} AND c.consentimento <> 'nao'
         AND (cardinality($1::text[]) = 0 OR c.origem = ANY($1::text[]))
         AND NOT EXISTS (SELECT 1 FROM crm_disparos d WHERE d.contato_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM whatsapp_messages w WHERE ${crmChaveSql('w.phone')} = ${crmChaveSql('c.whats')})
       ${limite ? `ORDER BY array_position($1::text[], c.origem), c.id LIMIT ${limite}` : ''}`;
  }

  async function enviaConvite(contato, dia) {
    const nome = primeiroNome(contato.nome);
    const ins = await pool.query(
      `INSERT INTO crm_disparos (contato_id, whats, dia, status) VALUES ($1,$2,$3,'pendente') ON CONFLICT DO NOTHING RETURNING id`,
      [contato.id, contato.whats, dia]);
    if (!ins.rowCount) return 'repetido';
    const id = ins.rows[0].id;
    try {
      const m = await twilioClient.messages.create({
        from, to: toWhatsAppAddress(contato.whats),
        contentSid: nome ? TEMPLATE_SID : TEMPLATE_GERAL_SID,
        ...(nome ? { contentVariables: JSON.stringify({ 1: nome }) } : {}),
      });
      await pool.query(`UPDATE crm_disparos SET status='enviado', message_sid=$2, status_final=$3, enviado_em=now() WHERE id=$1`, [id, m.sid || '', m.status || '']);
      await saveWhatsAppMessage({ phone: '+' + contato.whats, direction: 'out', body: nome ? TEXTO_CONVITE.replace('{{1}}', nome) : TEXTO_GERAL, messageSid: m.sid || '' });
      await pool.query(`UPDATE crm_contatos SET status='convite_enviado', ultima_interacao=now(), updated_at=now() WHERE id=$1 AND status='novo'`, [contato.id]);
      return 'enviado';
    } catch (e) {
      await pool.query(`UPDATE crm_disparos SET status='erro', erro=$2 WHERE id=$1`, [id, clean(e && e.message ? e.message : e, 300)]);
      console.error('disparo: falha ao enviar para o contato', contato.id, e && e.message ? e.message : e);
      return 'erro';
    }
  }

  async function passo() {
    const cfg = (await pool.query('SELECT * FROM crm_disparo_config WHERE id=1')).rows[0];
    if (!cfg || !cfg.ativo) return;
    const { dia, hora } = relogio();
    if (hora < cfg.hora_ini || hora >= cfg.hora_fim) return;
    const plano = (await pool.query('SELECT limite, origens FROM crm_disparo_dias WHERE dia = $1', [dia])).rows[0];
    if (!plano) return;
    const hoje = (await pool.query(
      `SELECT count(*)::int AS n, max(enviado_em) AS ultimo FROM crm_disparos WHERE dia = $1 AND status IN ('pendente','enviado')`, [dia])).rows[0];
    if (hoje.n >= plano.limite) return;
    if ((await aprovacao()) !== 'approved') return;
    if (await verificaSinais(dia)) return;
    if (!proximoEm && hoje.ultimo) proximoEm = new Date(hoje.ultimo).getTime() + cfg.pausa_min_s * 1000;
    if (Date.now() < proximoEm) return;

    const geralOk = (await aprovacao(false, TEMPLATE_GERAL_SID)) === 'approved';
    const cand = (await pool.query(sqlElegiveis('c.id, c.nome, c.whats', 25, geralOk), [plano.origens])).rows;
    for (const c of cand) {
      if (!geralOk && !primeiroNome(c.nome)) continue; // nome inútil e sem template geral aprovado: espera
      const r = await enviaConvite(c, dia);
      if (r === 'repetido') continue;
      const enviadosAgora = hoje.n + (r === 'enviado' ? 1 : 0);
      const fimDeLote = r === 'enviado' && enviadosAgora % cfg.lote === 0;
      const espera = fimDeLote
        ? cfg.pausa_lote_min * 60e3
        : (cfg.pausa_min_s + Math.random() * Math.max(0, cfg.pausa_max_s - cfg.pausa_min_s)) * 1000;
      proximoEm = Date.now() + espera;
      return;
    }
  }

  async function tick() {
    if (tickRodando) return;
    tickRodando = true;
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
      if (!rows[0].ok) return;
      try { await passo(); } finally { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); }
    } catch (e) {
      console.error('disparo: erro no ciclo', e && e.message ? e.message : e);
    } finally {
      if (client) client.release();
      tickRodando = false;
    }
  }

  function start() {
    if (!twilioClient || !from) { console.error('disparo: Twilio não configurada, agendador desligado.'); return; }
    if (timer) return;
    timer = setInterval(tick, 20000);
    if (timer.unref) timer.unref();
  }

  // ---------------- rotas do painel ----------------
  app.get('/admin/api/disparo', async (_req, res) => {
    try {
      const cfg = (await pool.query('SELECT * FROM crm_disparo_config WHERE id=1')).rows[0];
      const agora = relogio();
      const geralSt = await aprovacao(false, TEMPLATE_GERAL_SID);
      const geralOk = geralSt === 'approved';
      const dias = (await pool.query(`SELECT to_char(dia,'YYYY-MM-DD') AS dia, limite, origens FROM crm_disparo_dias ORDER BY dia`)).rows;
      for (const d of dias) {
        const r = await pool.query(`SELECT count(*) FILTER (WHERE status IN ('pendente','enviado'))::int AS enviados,
                                           count(*) FILTER (WHERE status = 'erro')::int AS erros,
                                           count(*) FILTER (WHERE status_final = 'delivered' OR status_final = 'read')::int AS entregues
                                      FROM crm_disparos WHERE dia = $1`, [d.dia]);
        Object.assign(d, r.rows[0]);
        d.elegiveis = (await pool.query(`SELECT count(*)::int AS n FROM (${sqlElegiveis('c.id', 0, geralOk)}) x`, [d.origens])).rows[0].n;
      }
      const tot = (await pool.query(
        `SELECT count(*) FILTER (WHERE d.status IN ('pendente','enviado'))::int AS enviados,
                count(*) FILTER (WHERE d.status = 'erro')::int AS erros,
                count(*) FILTER (WHERE d.status_final IN ('failed','undelivered'))::int AS nao_entregues,
                count(*) FILTER (WHERE c.status IN ('respondeu','interessado','inscrito','sem_interesse'))::int AS responderam,
                count(*) FILTER (WHERE c.status = 'nao_quer_receber')::int AS parar
           FROM crm_disparos d LEFT JOIN crm_contatos c ON c.id = d.contato_id`)).rows[0];
      const recentes = (await pool.query(
        `SELECT d.id, d.contato_id, c.nome, d.whats, d.status, d.status_final, d.erro, d.enviado_em, c.status AS contato_status
           FROM crm_disparos d LEFT JOIN crm_contatos c ON c.id = d.contato_id ORDER BY d.id DESC LIMIT 20`)).rows;
      const origens = (await pool.query(
        `SELECT origem, count(*)::int AS n FROM crm_contatos WHERE origem <> '' GROUP BY origem ORDER BY origem`)).rows;
      res.json({
        ativo: cfg.ativo, motivo_pausa: cfg.motivo_pausa, pausado_em: cfg.pausado_em,
        template: { sid: TEMPLATE_SID, status: await aprovacao() },
        template_geral: { sid: TEMPLATE_GERAL_SID, status: geralSt },
        agora, janela: { ini: cfg.hora_ini, fim: cfg.hora_fim },
        ritmo: { lote: cfg.lote, pausa_min_s: cfg.pausa_min_s, pausa_max_s: cfg.pausa_max_s, pausa_lote_min: cfg.pausa_lote_min },
        dias, totais: tot, recentes, origens,
      });
    } catch (e) {
      console.error('disparo painel:', e.message);
      res.status(500).json({ error: 'Não foi possível carregar os disparos.' });
    }
  });

  app.post('/admin/api/disparo/ativar', async (req, res) => {
    try {
      const ativo = !!(req.body && req.body.ativo);
      await pool.query(
        `UPDATE crm_disparo_config SET ativo=$1, motivo_pausa=CASE WHEN $1 THEN '' ELSE motivo_pausa END, pausado_em=CASE WHEN $1 THEN NULL ELSE pausado_em END, updated_at=now() WHERE id=1`, [ativo]);
      if (ativo) proximoEm = 0;
      res.json({ ok: true, ativo });
    } catch (e) { res.status(500).json({ error: 'Não foi possível salvar.' }); }
  });

  app.put('/admin/api/disparo/dia', async (req, res) => {
    const b = req.body || {};
    const dia = String(b.dia || '');
    const limite = Number(b.limite);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(dia))) return res.status(400).json({ error: 'Data inválida.' });
    if (!Number.isInteger(limite) || limite < 1 || limite > 300) return res.status(400).json({ error: 'O limite do dia deve ficar entre 1 e 300.' });
    const origens = (Array.isArray(b.origens) ? b.origens : []).map((o) => clean(o, 120)).filter(Boolean).slice(0, 20);
    try {
      await pool.query(
        `INSERT INTO crm_disparo_dias (dia, limite, origens) VALUES ($1,$2,$3) ON CONFLICT (dia) DO UPDATE SET limite=$2, origens=$3`, [dia, limite, origens]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Não foi possível salvar o dia.' }); }
  });

  app.delete('/admin/api/disparo/dia/:dia', async (req, res) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.dia)) return res.status(400).json({ error: 'Data inválida.' });
    await pool.query('DELETE FROM crm_disparo_dias WHERE dia = $1', [req.params.dia]);
    res.json({ ok: true });
  });

  // Envia o convite para um número só (o seu, por padrão) para ver a mensagem chegando antes de ativar.
  app.post('/admin/api/disparo/teste', async (req, res) => {
    try {
      const geral = !!(req.body && req.body.geral);
      if ((await aprovacao(true, geral ? TEMPLATE_GERAL_SID : TEMPLATE_SID)) !== 'approved') return res.status(409).json({ error: 'Esse template ainda não foi aprovado pela Meta.' });
      const alvo = String((req.body && req.body.whats) || ownerWhats || '');
      if (!alvo) return res.status(400).json({ error: 'Informe um WhatsApp.' });
      const nome = primeiroNome((req.body && req.body.nome) || 'Rodrigo') || 'Rodrigo';
      const m = await twilioClient.messages.create({ from, to: toWhatsAppAddress(alvo), contentSid: geral ? TEMPLATE_GERAL_SID : TEMPLATE_SID, ...(geral ? {} : { contentVariables: JSON.stringify({ 1: nome }) }) });
      // Grava o convite na conversa, como no envio real, para o Drigo ter o contexto quando você responder ao teste.
      try { await saveWhatsAppMessage({ phone: '+' + String(alvo).replace(/\D/g, ''), direction: 'out', body: geral ? TEXTO_GERAL : TEXTO_CONVITE.replace('{{1}}', nome), messageSid: m.sid || '' }); } catch (_) { /* só contexto */ }
      res.json({ ok: true, sid: m.sid });
    } catch (e) {
      res.status(500).json({ error: 'Falha no envio de teste: ' + clean(e && e.message ? e.message : e, 200) });
    }
  });

  return { migrate, start, tick, _t: { liberaProximo: () => { proximoEm = 1; }, limpaCache: () => { for (const k of Object.keys(cacheAprov)) delete cacheAprov[k]; } } };
}

module.exports = { init, primeiroNome, agoraBrasilia, TEXTO_CONVITE, TEXTO_GERAL };
