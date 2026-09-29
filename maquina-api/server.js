'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Modelo padrão. Se um modelo mais novo estiver disponível, defina ANTHROPIC_MODEL
// no Railway em vez de mudar aqui. Lista atual em: https://docs.claude.com/en/docs/about-claude/models
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
const CHAT_MAX_TOKENS = 700;
const CHAT_MAX_HISTORY = 16; // mensagens (user+assistant) mantidas de contexto
const CHAT_MAX_MESSAGE_LEN = 2000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida. Adicione o Postgres do Railway a este serviço.');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD precisa existir e ter pelo menos 8 caracteres.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const STATUSES = ['novo', 'contatado', 'pago'];

// ---------- agente de chat: persona + base de conhecimento ----------
let SYSTEM_PROMPT = '';
let chatReady = false;
try {
  const instructions = fs.readFileSync(path.join(__dirname, 'knowledge', 'system-instructions.md'), 'utf8');
  const knowledge = fs.readFileSync(path.join(__dirname, 'knowledge', 'base-conhecimento.md'), 'utf8');
  SYSTEM_PROMPT = instructions + '\n\n---\n\n# BASE DE CONHECIMENTO (fonte de verdade, use só o que está aqui)\n\n' + knowledge;
  chatReady = true;
} catch (err) {
  console.error('Não foi possível carregar knowledge/system-instructions.md ou knowledge/base-conhecimento.md. O agente de chat ficará desligado.', err.message);
}

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
if (!anthropic) {
  console.error('ANTHROPIC_API_KEY não definida. O agente de chat ficará desligado até você configurá-la.');
}

// ---------- WhatsApp (Twilio): confirmação pra quem se inscreve + aviso pro Rodrigo ----------
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
// Número que envia, com prefixo whatsapp:. No Sandbox de teste é whatsapp:+14155238886;
// depois que o WhatsApp Business for aprovado, troca pelo número definitivo.
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';
// Opcional: WhatsApp do Rodrigo (com DDI, só dígitos ou já em E.164), pra receber um
// aviso a cada nova inscrição. Se ficar vazio, só a confirmação pra pessoa é enviada.
const TWILIO_OWNER_WHATSAPP = process.env.TWILIO_OWNER_WHATSAPP || '';

// SIDs dos Content Templates aprovados no console da Twilio (obrigatórios pra mensagem
// business-initiated no WhatsApp — não dá pra mandar texto livre nesse caso).
const TWILIO_CONFIRM_TEMPLATE_SID = process.env.TWILIO_CONFIRM_TEMPLATE_SID || '';
const TWILIO_OWNER_TEMPLATE_SID = process.env.TWILIO_OWNER_TEMPLATE_SID || '';

const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;
if (!twilioClient || !TWILIO_WHATSAPP_FROM) {
  console.error('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM não definidas. Notificação por WhatsApp ficará desligada.');
}

// ---------- Pagamentos (Asaas) ----------
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
// 'sandbox' pra testar sem dinheiro de verdade, 'production' pra cobrar de verdade.
const ASAAS_ENV = (process.env.ASAAS_ENV || 'sandbox').trim().toLowerCase();
const ASAAS_BASE_URL = ASAAS_ENV === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
// Token escolhido por você ao criar o Webhook no painel do Asaas (Integrações > Webhooks).
// O Asaas devolve esse mesmo valor no header "asaas-access-token" em toda notificação,
// e comparamos aqui pra confirmar que a chamada realmente veio do Asaas.
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || '';
// Valor da inscrição pra 1 pessoa, em reais (ex.: 2000 = R$ 2.000,00). Parcelamento em
// até COURSE_MAX_INSTALLMENTS vezes sem juros no cartão.
const COURSE_PRICE = Number(process.env.COURSE_PRICE) || 2000;
const COURSE_MAX_INSTALLMENTS = Number(process.env.COURSE_MAX_INSTALLMENTS) || 10;

if (!ASAAS_API_KEY) {
  console.error('ASAAS_API_KEY não definida. O pagamento via Asaas ficará desligado.');
}

// Chamada genérica à API do Asaas. Autenticação é pelo header access_token (não é
// "Authorization: Bearer"), conforme a documentação oficial.
async function asaasRequest(method, endpoint, body) {
  const res = await fetch(ASAAS_BASE_URL + endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: ASAAS_API_KEY,
      'User-Agent': 'FinderLab-MaquinaDeDecisoes',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data && data.errors && data.errors[0] && data.errors[0].description) || ('Asaas respondeu ' + res.status);
    const asaasErr = new Error(msg);
    asaasErr.asaasStatus = res.status;
    asaasErr.asaasBody = data;
    throw asaasErr;
  }
  return data;
}

// Cria um Asaas Checkout (página hospedada pelo próprio Asaas) pra uma inscrição.
// A pessoa digita CPF e dados de cartão/PIX lá dentro, nunca no nosso formulário — por
// isso Checkout em vez de criar Customer/Payment diretamente por aqui.
async function createAsaasCheckout(lead, originUrl) {
  const payload = {
    billingTypes: ['PIX', 'CREDIT_CARD'],
    chargeTypes: ['DETACHED', 'INSTALLMENT'],
    minutesToExpire: 1440, // checkout válido por 24h
    externalReference: 'lead-' + lead.id,
    items: [
      {
        name: 'Máquina de Decisões',
        description: 'Inscrição no curso Máquina de Decisões',
        quantity: 1,
        value: COURSE_PRICE,
      },
    ],
    installment: { maxInstallmentCount: COURSE_MAX_INSTALLMENTS },
    customerData: {
      name: lead.nome,
      email: lead.email,
      phone: String(lead.whats || '').replace(/\D/g, ''),
    },
    callback: {
      successUrl: originUrl + '/inscricao.html?pagamento=ok',
      cancelUrl: originUrl + '/inscricao.html?pagamento=cancelado',
      expiredUrl: originUrl + '/inscricao.html?pagamento=expirado',
      autoRedirect: true,
    },
  };
  return asaasRequest('POST', '/checkouts', payload);
}

async function getAsaasPayment(paymentId) {
  return asaasRequest('GET', '/payments/' + encodeURIComponent(paymentId));
}

// Assume número brasileiro: aceita como a pessoa digitou (com ou sem DDI, com ou sem
// pontuação) e devolve no formato que a API de WhatsApp da Twilio exige.
function toWhatsAppAddress(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits.startsWith('55')) digits = '55' + digits;
  return 'whatsapp:+' + digits;
}

// A inscrição já foi salva no banco antes disso ser chamado, então uma falha aqui
// nunca derruba o cadastro: só loga o erro e segue.
// Mensagem business-initiated no WhatsApp exige um Content Template aprovado — não dá
// pra mandar texto livre (`body`) nesse caso, por isso usamos contentSid + contentVariables.
async function sendWhatsApp(toRaw, contentSid, contentVariables) {
  if (!twilioClient || !TWILIO_WHATSAPP_FROM || !contentSid) return;
  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: toWhatsAppAddress(toRaw),
      contentSid,
      contentVariables: JSON.stringify(contentVariables || {}),
    });
  } catch (err) {
    console.error('Falha ao enviar WhatsApp via Twilio', err && err.message ? err.message : err);
  }
}

// Dispara as duas mensagens de uma inscrição nova/atualizada: confirmação pra pessoa e
// aviso pro Rodrigo. Fire-and-forget, não bloqueia a resposta pro cliente.
function notifyLeadWhatsApp(lead) {
  // Template maquina_confirmacao_inscricao: "Oi {{1}}, aqui é da Máquina de Decisões. ..."
  sendWhatsApp(lead.whats, TWILIO_CONFIRM_TEMPLATE_SID, { '1': lead.nome });
  if (TWILIO_OWNER_WHATSAPP) {
    // Template maquina_aviso_inscricao: "Nova inscrição na Máquina de Decisões: {{1}} ({{2}}), WhatsApp {{3}}."
    sendWhatsApp(TWILIO_OWNER_WHATSAPP, TWILIO_OWNER_TEMPLATE_SID, {
      '1': lead.nome,
      '2': lead.email,
      '3': lead.whats,
    });
  }
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id          SERIAL PRIMARY KEY,
      nome        TEXT NOT NULL,
      email       TEXT NOT NULL,
      whats       TEXT NOT NULL,
      empresa     TEXT NOT NULL DEFAULT '',
      cargo       TEXT NOT NULL DEFAULT '',
      consent     BOOLEAN NOT NULL,
      status      TEXT NOT NULL DEFAULT 'novo',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS leads_email_uq ON leads (lower(email));

    CREATE TABLE IF NOT EXISTS chat_logs (
      id          SERIAL PRIMARY KEY,
      session_id  TEXT NOT NULL DEFAULT '',
      ip_hash     TEXT NOT NULL DEFAULT '',
      user_msg    TEXT NOT NULL,
      reply_msg   TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chat_logs_created_idx ON chat_logs (created_at DESC);

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id            SERIAL PRIMARY KEY,
      phone         TEXT NOT NULL,
      direction     TEXT NOT NULL,
      body          TEXT NOT NULL,
      profile_name  TEXT NOT NULL DEFAULT '',
      message_sid   TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_idx ON whatsapp_messages (phone, created_at);

    CREATE TABLE IF NOT EXISTS payments (
      id                SERIAL PRIMARY KEY,
      lead_id           INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      asaas_checkout_id TEXT NOT NULL,
      asaas_payment_id  TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'PENDING',
      value             NUMERIC(10,2) NOT NULL,
      checkout_url      TEXT NOT NULL DEFAULT '',
      raw_event         JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_uq ON payments (asaas_checkout_id);
    CREATE INDEX IF NOT EXISTS payments_lead_idx ON payments (lead_id, created_at DESC);
  `);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// ---------- helpers ----------
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    if (safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin Maquina de Decisoes", charset="UTF-8"');
  res.status(401).send('Autenticação necessária.');
}

const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const failLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------- API pública: recebe a inscrição ----------
const publicCors = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl, healthcheck
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['POST', 'OPTIONS'],
  maxAge: 86400,
});

const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
});

// Validação + gravação de uma inscrição. Usado tanto pelo POST /leads (formulário
// do site) quanto pela ferramenta registrar_inscricao que o agente de chat pode
// chamar no meio da conversa, pra não duplicar a mesma lógica (nem o disparo do
// WhatsApp) em dois lugares.
async function saveLead(input) {
  const b = input || {};
  const nome = clean(b.nome, 160);
  const email = clean(b.email, 200).toLowerCase();
  const whats = clean(b.whats, 30);
  const empresa = clean(b.empresa, 160);
  const cargo = clean(b.cargo, 120);
  const consent = b.consent === true;

  const errors = {};
  if (nome.length < 2) errors.nome = 'Informe o nome completo.';
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Informe um email válido.';
  if (whats.replace(/\D/g, '').length < 10) errors.whats = 'Informe o número com DDD.';
  if (!consent) errors.consent = 'É necessário aceitar os termos.';
  if (Object.keys(errors).length) return { ok: false, status: 400, error: 'Dados inválidos.', errors };

  // mesma pessoa reenviando: atualiza os dados e preserva o andamento
  const { rows } = await pool.query(
    `INSERT INTO leads (nome, email, whats, empresa, cargo, consent)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (lower(email)) DO UPDATE
       SET nome=EXCLUDED.nome, whats=EXCLUDED.whats, empresa=EXCLUDED.empresa,
           cargo=EXCLUDED.cargo, consent=EXCLUDED.consent, updated_at=now()
     RETURNING id`,
    [nome, email, whats, empresa, cargo, consent]
  );
  notifyLeadWhatsApp({ id: rows[0].id, nome, email, whats, empresa, cargo });
  return { ok: true, id: rows[0].id };
}

app.options('/leads', publicCors);
app.post('/leads', publicCors, leadLimiter, async (req, res) => {
  try {
    const b = req.body || {};

    // campo invisível: robôs preenchem, pessoas não. Responde ok sem gravar.
    if (clean(b.website, 200)) return res.status(201).json({ ok: true });

    if (ALLOWED_ORIGINS.length && req.headers.origin && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
      return res.status(403).json({ error: 'Origem não permitida.' });
    }

    const result = await saveLead(b);
    if (!result.ok) return res.status(result.status).json({ error: result.error, errors: result.errors });
    res.status(201).json({ ok: true, id: result.id });
  } catch (err) {
    console.error('POST /leads', err);
    res.status(500).json({ error: 'Não foi possível registrar agora.' });
  }
});

// ---------- Pagamento: cria o checkout no Asaas pra uma inscrição já salva ----------
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
});

app.options('/payments/checkout', publicCors);
app.post('/payments/checkout', publicCors, paymentLimiter, async (req, res) => {
  try {
    if (!ASAAS_API_KEY) return res.status(503).json({ error: 'Pagamento indisponível no momento.' });

    if (ALLOWED_ORIGINS.length && req.headers.origin && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
      return res.status(403).json({ error: 'Origem não permitida.' });
    }

    const leadId = Number(req.body && req.body.leadId);
    if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ error: 'Pedido inválido.' });

    const { rows } = await pool.query('SELECT * FROM leads WHERE id=$1', [leadId]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Inscrição não encontrada.' });

    // já existe um checkout aberto pra essa inscrição? reaproveita em vez de criar outro
    const existing = await pool.query(
      `SELECT checkout_url FROM payments
       WHERE lead_id=$1 AND status NOT IN ('EXPIRED', 'CANCELLED', 'REFUNDED')
       ORDER BY created_at DESC LIMIT 1`,
      [leadId]
    );
    if (existing.rows[0] && existing.rows[0].checkout_url) {
      return res.json({ ok: true, url: existing.rows[0].checkout_url });
    }

    const originUrl = req.protocol + '://' + req.get('host');
    const checkout = await createAsaasCheckout(lead, originUrl);
    const url = checkout.link || ('https://asaas.com/checkoutSession/show?id=' + checkout.id);

    await pool.query(
      `INSERT INTO payments (lead_id, asaas_checkout_id, status, value, checkout_url)
       VALUES ($1,$2,$3,$4,$5)`,
      [leadId, checkout.id, checkout.status || 'PENDING', COURSE_PRICE, url]
    );

    res.json({ ok: true, url });
  } catch (err) {
    console.error('POST /payments/checkout', err && err.message ? err.message : err, err && err.asaasBody);
    res.status(502).json({ error: 'Não foi possível gerar o pagamento agora.' });
  }
});

// ---------- Webhook: Asaas avisa aqui quando o pagamento muda de status ----------
app.post('/payments/webhook', async (req, res) => {
  const token = req.header('asaas-access-token') || '';
  if (ASAAS_WEBHOOK_TOKEN && !safeEqual(token, ASAAS_WEBHOOK_TOKEN)) {
    console.error('POST /payments/webhook: token inválido, ignorando');
    return res.status(401).json({ error: 'Token inválido.' });
  }
  // responde rápido: o Asaas espera 200 sem demora, processamos de verdade depois
  res.status(200).json({ ok: true });

  try {
    const event = clean(req.body && req.body.event, 60);
    const paymentId = clean(req.body && req.body.payment && req.body.payment.id, 60);
    if (!event || !paymentId) return;

    let externalReference = '';
    let status = event;
    try {
      const payment = await getAsaasPayment(paymentId);
      externalReference = clean(payment.externalReference, 200);
      status = clean(payment.status, 40) || event;
    } catch (err) {
      console.error('POST /payments/webhook: falha ao buscar payment', paymentId, err.message);
    }

    const match = /^lead-(\d+)$/.exec(externalReference);
    if (!match) {
      console.error('POST /payments/webhook: sem externalReference reconhecível pro payment', paymentId, externalReference);
      return;
    }
    const leadId = Number(match[1]);

    await pool.query(
      `UPDATE payments SET status=$1, asaas_payment_id=$2, raw_event=$3, updated_at=now()
       WHERE id = (SELECT id FROM payments WHERE lead_id=$4 ORDER BY created_at DESC LIMIT 1)`,
      [status, paymentId, JSON.stringify(req.body), leadId]
    );

    const PAID_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
    if (PAID_EVENTS.includes(event)) {
      await pool.query(`UPDATE leads SET status='pago', updated_at=now() WHERE id=$1`, [leadId]);
    }
  } catch (err) {
    console.error('POST /payments/webhook', err && err.message ? err.message : err);
  }
});

// ---------- Agente de chat ----------
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas mensagens. Espera um pouco e tenta de novo.' },
});

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 24);
}

// Rede de segurança: o prompt instrui o modelo a nunca mostrar o [PENSAMENTO INTERNO],
// mas se ele vazar por qualquer motivo, cortamos aqui antes de responder ou gravar o log.
function stripInternalReasoning(text) {
  if (!text) return text;
  let out = text.replace(/\[PENSAMENTO INTERNO\][\s\S]*?\[\/PENSAMENTO INTERNO\]/gi, '');
  out = out.replace(/\[PENSAMENTO INTERNO\][\s\S]*$/gi, ''); // abriu e não fechou: corta até o fim
  return out.trim();
}

// Rede de segurança: o chat exibe a resposta como texto puro (sem renderizar markdown),
// então qualquer "**negrito**", "# título" ou lista numerada que o modelo escrever por engano
// apareceria com os símbolos literais na tela. O prompt já instrui a nunca usar isso, mas
// removemos aqui de qualquer forma antes de responder ou gravar o log.
function stripMarkdown(text) {
  if (!text) return text;
  let out = text;
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  out = out.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, '$1$2');
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s*[-*•]\s+/gm, '');
  out = out.replace(/^\s*\d+[.)]\s+/gm, '');
  return out.trim();
}

// Ferramenta que o agente pode chamar no meio da conversa pra registrar a inscrição
// direto no banco (mesmo destino do formulário, incluindo o disparo do WhatsApp), sem
// a pessoa precisar preencher nada no site. O prompt (knowledge/system-instructions.md)
// instrui quando e como usar isso.
const CHAT_TOOLS = [
  {
    name: 'registrar_inscricao',
    description:
      'Registra a inscrição da pessoa no curso Máquina de Decisões, salvando nome, email, WhatsApp (e empresa/cargo se informados) no mesmo cadastro que o formulário do site usa. Só chame depois de ter nome completo, email e WhatsApp confirmados pela pessoa na conversa, de ter repetido esses dados pra ela confirmar que estão certos, e de ela ter confirmado explicitamente (algo como "sim", "aceito", "pode registrar") que concorda com os termos de uso e privacidade (LGPD). Nunca invente, deduza ou preencha nenhum desses campos sozinho.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome completo, exatamente como a pessoa informou.' },
        email: { type: 'string', description: 'Email, exatamente como a pessoa informou.' },
        whats: { type: 'string', description: 'WhatsApp com DDD, exatamente como a pessoa informou.' },
        empresa: { type: 'string', description: 'Empresa da pessoa, se ela informou. String vazia se não informou.' },
        cargo: { type: 'string', description: 'Cargo da pessoa, se ela informou. String vazia se não informou.' },
        consent: {
          type: 'boolean',
          description:
            'true somente se a pessoa confirmou explicitamente, nesta conversa, que aceita os termos de uso e privacidade. Nunca true por suposição.',
        },
      },
      required: ['nome', 'email', 'whats', 'consent'],
    },
  },
];

async function runChatTool(name, toolInput) {
  if (name === 'registrar_inscricao') {
    const result = await saveLead(toolInput);
    return result.ok
      ? { sucesso: true, id: result.id }
      : { sucesso: false, erro: result.error, campos_invalidos: result.errors || null };
  }
  return { sucesso: false, erro: 'Ferramenta desconhecida.' };
}

// Chama o modelo com o loop de tool use (registrar_inscricao) até ele responder só com
// texto ou até um limite de segurança. Compartilhado entre o chat do site e o WhatsApp,
// pra não duplicar essa lógica em dois lugares.
async function getAgentReply(messages) {
  let response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages,
    tools: CHAT_TOOLS,
  });

  let toolRounds = 0;
  while (response.stop_reason === 'tool_use' && toolRounds < 3) {
    toolRounds += 1;
    const toolUseBlocks = (response.content || []).filter((block) => block.type === 'tool_use');
    const toolResults = [];
    for (const block of toolUseBlocks) {
      const result = await runChatTool(block.name, block.input);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
      tools: CHAT_TOOLS,
    });
  }

  const rawReply = (response.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return { reply: stripMarkdown(stripInternalReasoning(rawReply)), toolRounds };
}

app.options('/chat', publicCors);
app.post('/chat', publicCors, chatLimiter, async (req, res) => {
  if (!chatReady || !anthropic) {
    return res.status(503).json({ error: 'O assistente está indisponível no momento. Fala com a gente pelo WhatsApp (11) 3164-3783.' });
  }

  const chatStartedAt = Date.now();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      console.error('POST /chat: cliente desconectou antes da resposta (%dms decorridos)', Date.now() - chatStartedAt);
    }
  });

  try {
    const b = req.body || {};

    if (ALLOWED_ORIGINS.length && req.headers.origin && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
      return res.status(403).json({ error: 'Origem não permitida.' });
    }

    const message = clean(b.message, CHAT_MAX_MESSAGE_LEN);
    if (!message) return res.status(400).json({ error: 'Mensagem vazia.' });

    const historyIn = Array.isArray(b.history) ? b.history : [];
    const history = historyIn
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-CHAT_MAX_HISTORY)
      .map((m) => ({ role: m.role, content: clean(m.content, CHAT_MAX_MESSAGE_LEN) }));

    const messages = history.concat([{ role: 'user', content: message }]);

    const { reply, toolRounds } = await getAgentReply(messages);

    const elapsedMs = Date.now() - chatStartedAt;
    if (elapsedMs > 12000) {
      console.error('POST /chat: resposta demorou %dms (rounds=%d) — perto ou acima do timeout do cliente', elapsedMs, toolRounds);
    }

    if (!reply) return res.status(502).json({ error: 'Não veio resposta do assistente. Tenta de novo.' });

    const sessionId = clean(b.sessionId, 80);
    pool
      .query(
        `INSERT INTO chat_logs (session_id, ip_hash, user_msg, reply_msg) VALUES ($1,$2,$3,$4)`,
        [sessionId, hashIp(req.ip), message, reply]
      )
      .catch((err) => console.error('Falha ao gravar chat_logs', err));

    if (!clientGone) res.json({ reply });
  } catch (err) {
    console.error('POST /chat', err && err.message ? err.message : err, `(${Date.now() - chatStartedAt}ms decorridos)`);
    if (!res.headersSent) res.status(500).json({ error: 'Não consegui responder agora. Tenta de novo em instantes.' });
  }
});

// ---------- WhatsApp inbound: Drigo responde quem manda mensagem pro número ----------
// Janela de histórico igual à do chat do site, pra manter a mesma qualidade de contexto.
const WHATSAPP_HISTORY_LIMIT = CHAT_MAX_HISTORY;

// "whatsapp:+5511999998888" -> "+5511999998888"
function fromWhatsAppAddress(raw) {
  return String(raw || '').replace(/^whatsapp:/, '').trim();
}

async function saveWhatsAppMessage({ phone, direction, body, profileName, messageSid }) {
  await pool.query(
    `INSERT INTO whatsapp_messages (phone, direction, body, profile_name, message_sid)
     VALUES ($1,$2,$3,$4,$5)`,
    [phone, direction, body, profileName || '', messageSid || '']
  );
}

async function loadWhatsAppHistory(phone) {
  const { rows } = await pool.query(
    `SELECT direction, body FROM whatsapp_messages
     WHERE phone = $1 ORDER BY created_at DESC LIMIT $2`,
    [phone, WHATSAPP_HISTORY_LIMIT]
  );
  return rows.reverse().map((r) => ({ role: r.direction === 'in' ? 'user' : 'assistant', content: r.body }));
}

// Resposta dentro da janela de atendimento (a pessoa escreveu primeiro): pode mandar
// texto livre, sem Content Template — diferente do envio business-initiated em notifyLeadWhatsApp.
async function sendWhatsAppFreeform(phoneRaw, body) {
  if (!twilioClient || !TWILIO_WHATSAPP_FROM) return;
  await twilioClient.messages.create({ from: TWILIO_WHATSAPP_FROM, to: toWhatsAppAddress(phoneRaw), body });
}

// Roda depois de já termos respondido 200 pra Twilio (veja a rota abaixo), então uma
// demora aqui (o modelo pode levar vários segundos, mais ainda se chamar
// registrar_inscricao) não atrasa nem derruba o webhook.
async function handleWhatsAppInbound({ phone, body, profileName, messageSid }) {
  try {
    await saveWhatsAppMessage({ phone, direction: 'in', body, profileName, messageSid });

    if (!chatReady || !anthropic) {
      console.error('WhatsApp inbound: agente indisponível (chatReady=%s) para %s', chatReady, phone);
      return;
    }

    const history = await loadWhatsAppHistory(phone);
    const { reply } = await getAgentReply(history);
    if (!reply) {
      console.error('WhatsApp inbound: sem resposta do modelo pra %s', phone);
      return;
    }

    await sendWhatsAppFreeform(phone, reply);
    await saveWhatsAppMessage({ phone, direction: 'out', body: reply });
  } catch (err) {
    console.error('WhatsApp inbound: falha ao processar mensagem de %s', phone, err && err.message ? err.message : err);
  }
}

const whatsappWebhookParser = express.urlencoded({ extended: false });

app.post('/whatsapp/inbound', whatsappWebhookParser, (req, res) => {
  // Responde já: a Twilio espera 200 em poucos segundos, e o modelo pode demorar bem
  // mais que isso. O processamento de verdade acontece depois, sem bloquear a resposta.
  res.status(200).type('text/xml').send('<Response></Response>');

  try {
    if (TWILIO_AUTH_TOKEN) {
      const signature = req.header('X-Twilio-Signature') || '';
      const url = req.protocol + '://' + req.get('host') + req.originalUrl;
      const valid = twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body || {});
      if (!valid) {
        console.error('POST /whatsapp/inbound: assinatura da Twilio inválida, ignorando');
        return;
      }
    }

    const from = fromWhatsAppAddress(req.body && req.body.From);
    if (!from) return;
    const profileName = clean(req.body && req.body.ProfileName, 160);
    const messageSid = clean(req.body && req.body.MessageSid, 60);
    const bodyText = clean(req.body && req.body.Body, CHAT_MAX_MESSAGE_LEN);
    const numMedia = Number(req.body && req.body.NumMedia) || 0;

    const body = bodyText || (numMedia > 0 ? '[mensagem sem texto: áudio, imagem ou anexo]' : '');
    if (!body) return;

    handleWhatsAppInbound({ phone: from, body, profileName, messageSid });
  } catch (err) {
    console.error('POST /whatsapp/inbound', err && err.message ? err.message : err);
  }
});

// ---------- Admin (protegido por senha) ----------
app.use('/admin', adminLimiter, failLimiter, basicAuth);
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/whatsapp', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-whatsapp.html')));

app.get('/admin/api/leads', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
  res.json(rows);
});

app.patch('/admin/api/leads/:id', async (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body && req.body.status, 20);
  if (!Number.isInteger(id) || !STATUSES.includes(status)) return res.status(400).json({ error: 'Pedido inválido.' });
  const { rowCount } = await pool.query('UPDATE leads SET status=$1, updated_at=now() WHERE id=$2', [status, id]);
  res.status(rowCount ? 200 : 404).json({ ok: !!rowCount });
});

app.delete('/admin/api/leads/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Pedido inválido.' });
  const { rowCount } = await pool.query('DELETE FROM leads WHERE id=$1', [id]);
  res.status(rowCount ? 200 : 404).json({ ok: !!rowCount });
});

app.get('/admin/api/leads.csv', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
  const esc = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmula no Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['Data', 'Nome', 'Email', 'WhatsApp', 'Empresa', 'Cargo', 'Status'];
  const lines = [head.map(esc).join(';')].concat(
    rows.map((l) =>
      [new Date(l.created_at).toISOString(), l.nome, l.email, l.whats, l.empresa, l.cargo, l.status].map(esc).join(';')
    )
  );
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="inscricoes-maquina-de-decisoes.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

app.get('/admin/api/whatsapp/conversations', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.phone, c.last_at, c.count, m.body AS last_body, m.direction AS last_direction, m.profile_name
      FROM (
        SELECT phone, MAX(created_at) AS last_at, COUNT(*) AS count
        FROM whatsapp_messages GROUP BY phone
      ) c
      JOIN LATERAL (
        SELECT body, direction, profile_name FROM whatsapp_messages wm
        WHERE wm.phone = c.phone ORDER BY created_at DESC LIMIT 1
      ) m ON true
      ORDER BY c.last_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /admin/api/whatsapp/conversations', err);
    res.status(500).json({ error: 'Não foi possível carregar as conversas.' });
  }
});

app.get('/admin/api/whatsapp/conversations/:phone', async (req, res) => {
  try {
    const phone = clean(req.params.phone, 30);
    const { rows } = await pool.query(
      `SELECT direction, body, profile_name, created_at FROM whatsapp_messages
       WHERE phone = $1 ORDER BY created_at ASC LIMIT 500`,
      [phone]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /admin/api/whatsapp/conversations/:phone', err);
    res.status(500).json({ error: 'Não foi possível carregar a conversa.' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------- Site estático (landing + inscrição) ----------
// Registrado DEPOIS das rotas /admin (protegidas por basicAuth) de propósito:
// com { extensions: ['html'] } o Express resolveria /admin -> public/admin.html
// diretamente por aqui, pulando a autenticação, se este middleware viesse antes.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((_req, res) => res.status(404).send('Not found'));

migrate()
  .then(() => app.listen(PORT, () => console.log('maquina-api na porta ' + PORT)))
  .catch((err) => {
    console.error('Falha ao preparar o banco', err);
    process.exit(1);
  });
