'use strict';
// Aviso ao Rodrigo de lead quente (ferramenta avisar_rodrigo do Drigo).
// Nas conversas reais, quem pediu para ligar, quis levar o time ou ia "falar com o diretor" recebia só
// o número do Rodrigo, e ele nunca ficava sabendo. Aqui o Drigo manda um e-mail para ele na hora,
// com o motivo, o resumo e o contato, e o mesmo motivo da mesma conversa não gera aviso repetido.

const MOTIVOS = {
  falar_com_rodrigo: 'Pediu para falar ou ligar com o Rodrigo',
  grupo_empresa: 'Quer levar mais pessoas da empresa',
  decisor: 'Vai levar a decisão a sócio, diretor ou chefe',
  interesse_travado: 'Interesse claro, mas travou antes de se inscrever',
  outro: 'Outro caso que pede o Rodrigo',
};

const DEFINICAO = {
  name: 'avisar_rodrigo',
  description:
    'Avisa o Rodrigo na hora, por e-mail, que esta conversa tem um lead quente que ele precisa chamar pessoalmente. Use quando a pessoa: pedir para falar ou ligar com o Rodrigo (ou se dirigir a ele como se o conhecesse); quiser levar mais gente da mesma empresa; disser que vai levar ao sócio, diretor ou chefe; ou mostrar interesse claro na imersão e travar antes de se inscrever (dúvida que só ele resolve, condição especial, "vou pensar" depois de perguntar valor). Não use para curiosidade solta, recusa ou resposta automática. No WhatsApp você já tem o número da pessoa. No site, antes de chamar, pergunte uma vez se ela quer deixar nome e WhatsApp para o Rodrigo chamar; se não quiser, chame mesmo assim, sem contato. Nunca invente dado. Não mencione e-mail nem detalhes do aviso: diga que avisou o Rodrigo e, só se a pessoa deixou um contato (ou no WhatsApp), que ele vai chamar pessoalmente, sem prometer prazo.',
  input_schema: {
    type: 'object',
    properties: {
      motivo: { type: 'string', enum: Object.keys(MOTIVOS), description: 'Por que o Rodrigo precisa entrar.' },
      resumo: { type: 'string', description: 'Duas ou três frases para o Rodrigo: quem é, o que quer, o que já foi dito (valor, ingresso, objeção) e como abordar.' },
      nome: { type: 'string', description: 'Nome que a pessoa disse. Omita se ela não disse.' },
      whats: { type: 'string', description: 'WhatsApp com DDD que a pessoa informou no site. No WhatsApp, omita (o sistema já sabe).' },
      email: { type: 'string', description: 'E-mail que a pessoa informou. Omita se não informou.' },
      empresa: { type: 'string', description: 'Empresa, se a pessoa disse.' },
    },
    required: ['motivo', 'resumo'],
  },
};

function init({ pool, clean, avisa, adminUrl }) {
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alertas_rodrigo (
        id          SERIAL PRIMARY KEY,
        canal       TEXT NOT NULL,
        chave       TEXT NOT NULL,
        motivo      TEXT NOT NULL,
        resumo      TEXT NOT NULL DEFAULT '',
        nome        TEXT NOT NULL DEFAULT '',
        whats       TEXT NOT NULL DEFAULT '',
        email       TEXT NOT NULL DEFAULT '',
        empresa     TEXT NOT NULL DEFAULT '',
        enviado     BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS alertas_rodrigo_chave_idx ON alertas_rodrigo (chave, motivo, created_at DESC);
    `);
  }

  async function executar(input, ctx) {
    const i = input || {};
    const motivo = Object.prototype.hasOwnProperty.call(MOTIVOS, i.motivo) ? i.motivo : 'outro';
    const canal = ctx && ctx.phone ? 'whatsapp' : 'site';
    const whats = clean(ctx && ctx.phone ? ctx.phone : i.whats, 40);
    const chave = canal === 'whatsapp' ? 'w:' + whats.replace(/\D/g, '') : 's:' + clean(ctx && ctx.sessionId, 80);
    const dados = {
      resumo: clean(i.resumo, 800), nome: clean(i.nome, 120), email: clean(i.email, 160), empresa: clean(i.empresa, 120),
    };
    const instrucaoOk = 'Rodrigo avisado. Diga em uma frase que avisou o Rodrigo e que ele vai chamar pessoalmente, sem prometer prazo e sem citar e-mail. Se a pessoa quiser falar já, pode passar o WhatsApp dele.';
    try {
      if (chave.length > 2) {
        const dup = await pool.query(
          `SELECT id FROM alertas_rodrigo WHERE chave=$1 AND motivo=$2 AND created_at > now() - interval '12 hours' LIMIT 1`,
          [chave, motivo]
        );
        if (dup.rows.length) return { ok: true, ja_avisado: true, instrucao: instrucaoOk };
      }
      const { rows } = await pool.query(
        `INSERT INTO alertas_rodrigo (canal, chave, motivo, resumo, nome, whats, email, empresa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [canal, chave, motivo, dados.resumo, dados.nome, whats, dados.email, dados.empresa]
      );
      const linhas = [
        ['Motivo', MOTIVOS[motivo]], ['Canal', canal === 'whatsapp' ? 'WhatsApp do Drigo' : 'Chat do site'],
        ['Nome', dados.nome], ['WhatsApp', whats], ['E-mail', dados.email], ['Empresa', dados.empresa],
        ['Resumo do Drigo', dados.resumo],
      ].filter(([, v]) => v);
      const quem = dados.nome || (whats ? 'final ' + whats.replace(/\D/g, '').slice(-4) : 'visitante do site');
      const texto = 'Lead quente pedindo você, captado pelo Drigo agora:\n\n'
        + linhas.map(([k, v]) => `${k}: ${v}`).join('\n')
        + (adminUrl ? `\n\nConversa completa no painel: ${adminUrl}` : '')
        + '\n\nO Drigo disse à pessoa que você vai chamar pessoalmente.';
      let enviado = false;
      try {
        await avisa(`Lead quente: ${quem} (${MOTIVOS[motivo]})`, texto);
        enviado = true;
      } catch (err) {
        console.error('avisar_rodrigo: falha no e-mail', err && err.message ? err.message : err);
      }
      await pool.query('UPDATE alertas_rodrigo SET enviado=$2 WHERE id=$1', [rows[0].id, enviado]);
      if (!enviado) return { ok: false, error: 'O aviso não saiu. NÃO diga que avisou. Passe o WhatsApp (11) 3164-3783 do Rodrigo para a pessoa chamar direto.' };
      return { ok: true, instrucao: instrucaoOk };
    } catch (err) {
      console.error('avisar_rodrigo', err && err.message ? err.message : err);
      return { ok: false, error: 'Não consegui avisar agora. NÃO diga que avisou. Passe o WhatsApp (11) 3164-3783 do Rodrigo para a pessoa chamar direto.' };
    }
  }

  return { migrate, executar };
}

module.exports = { init, DEFINICAO, MOTIVOS };
