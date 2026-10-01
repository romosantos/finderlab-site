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
const { extractRegistrationTerms, registrationTermsReply, registrationConsentReply } = require('./lib/registration-terms');
const { splitWhatsAppText } = require('./lib/whatsapp-text');
const { lookupCep } = require('./lib/cep-address');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Usado como originUrl quando não existe req HTTP pra derivar um (fluxo do WhatsApp).
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://maquina.finderlab.com.br';

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
let REGISTRATION_TERMS = '';
let DIAGNOSTIC_ADDENDUM = '';
let chatReady = false;
try {
  const instructions = fs.readFileSync(path.join(__dirname, 'knowledge', 'system-instructions.md'), 'utf8');
  const knowledge = fs.readFileSync(path.join(__dirname, 'knowledge', 'base-conhecimento.md'), 'utf8');
  REGISTRATION_TERMS = extractRegistrationTerms(fs.readFileSync(path.join(__dirname, 'public', 'inscricao.html'), 'utf8'));
  SYSTEM_PROMPT = instructions + '\n\n---\n\n# BASE DE CONHECIMENTO (fonte de verdade, use só o que está aqui)\n\n' + knowledge +
    '\n\n---\n\n# TERMOS PUBLICADOS NA PÁGINA DE INSCRIÇÃO (texto completo e oficial)\n\n' + REGISTRATION_TERMS;
  chatReady = true;
} catch (err) {
  console.error('Não foi possível carregar as instruções, a base de conhecimento ou os termos de inscrição. O agente de chat ficará desligado.', err.message);
}
// Modo diagnóstico: addendum carregado à parte, nunca derruba o chat normal se faltar.
try {
  DIAGNOSTIC_ADDENDUM = fs.readFileSync(path.join(__dirname, 'knowledge', 'modo-diagnostico.md'), 'utf8');
} catch (err) {
  console.error('knowledge/modo-diagnostico.md não encontrado. Modo diagnóstico ficará desligado (chat normal segue funcionando).', err.message);
}

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
if (!anthropic) {
  console.error('ANTHROPIC_API_KEY não definida. O agente de chat ficará desligado até você configurá-la.');
}

// ---------- Voz do Drigo (Gemini: STT + TTS) ----------
// O Claude continua sendo o cérebro (chamado normalmente em /chat); o Gemini
// só transcreve áudio e sintetiza fala, como um passo antes/depois do /chat.
// Nomes de modelo em variável porque a Google tem trocado essa lista com frequência —
// se parar de funcionar, confira https://ai.google.dev/gemini-api/docs/models antes de mexer no código.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_STT_MODEL = process.env.GEMINI_STT_MODEL || 'gemini-3.5-transcribe';
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Puck';
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY não definida. O modo de voz do Drigo (falar/ouvir) ficará desligado.');
}

// Gemini TTS devolve PCM cru (16-bit, geralmente 24kHz mono) em base64, sem cabeçalho.
// Embrulhamos num WAV aqui no servidor pra o navegador tocar com um <audio> comum,
// sem precisar de nenhuma lógica especial de decodificação no cliente.
function pcmToWavBase64(pcmBase64, sampleRate, channels, bitDepth) {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

const voiceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos pedidos de voz. Espera um pouco e tenta de novo.' },
});

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
const TWILIO_PAYMENT_TEMPLATE_SID = process.env.TWILIO_PAYMENT_TEMPLATE_SID || '';
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
// A API de Checkout do Asaas em produção (diferente do que o comentário original
// assumia) exige CPF/CNPJ, telefone num formato válido e endereço completo já na
// criação do checkout — não deixa pra pessoa preencher isso na página hospedada.
// "province" aqui é como o Asaas chama o bairro (não o estado/UF).
function buildAsaasCustomerData(lead) {
  const digits = String(lead.whats || '').replace(/\D/g, '');
  // Celular (WhatsApp) tem 11 dígitos com DDD (ex.: 11988887777); o Asaas valida o
  // formato de forma diferente pra `phone` (fixo) e `mobilePhone` (celular).
  const phoneField = digits.length === 11 ? { mobilePhone: digits } : { phone: digits };
  const data = Object.assign(
    {
      name: lead.nome,
      email: lead.email,
      cpfCnpj: String(lead.cpf_cnpj || '').replace(/\D/g, ''),
      postalCode: String(lead.cep || '').replace(/\D/g, ''),
      address: lead.endereco || '',
      addressNumber: lead.numero || '',
      province: lead.bairro || '',
    },
    phoneField
  );
  if (lead.complemento) data.complement = lead.complemento;
  return data;
}

async function createAsaasCheckout(lead, originUrl, billingType) {
  // Se a pessoa já disse a forma de pagamento (pix ou cartão), gera o checkout já
  // restrito a ela, pra página do Asaas abrir direto na forma escolhida em vez de
  // mostrar a escolha. Pix não parcela, então junto com billingType='PIX' o checkout
  // também fica só à vista.
  const billingTypes = billingType === 'PIX' || billingType === 'CREDIT_CARD' ? [billingType] : ['PIX', 'CREDIT_CARD'];
  const chargeTypes = billingType === 'PIX' ? ['DETACHED'] : ['DETACHED', 'INSTALLMENT'];
  const payload = {
    billingTypes,
    chargeTypes,
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
    customerData: buildAsaasCustomerData(lead),
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
  if (!twilioClient || !TWILIO_WHATSAPP_FROM || !contentSid) return false;
  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: toWhatsAppAddress(toRaw),
      contentSid,
      contentVariables: JSON.stringify(contentVariables || {}),
    });
    return true;
  } catch (err) {
    console.error('Falha ao enviar WhatsApp via Twilio', err && err.message ? err.message : err);
    return false;
  }
}

// A pessoa recebe o lembrete somente depois que o checkout existir.
// Aqui permanece apenas o aviso interno de recebimento dos dados.
function notifyLeadWhatsApp(lead) {
  if (TWILIO_OWNER_WHATSAPP) {
    // Template maquina_aviso_inscricao: "Nova inscrição na Máquina de Decisões: {{1}} ({{2}}), WhatsApp {{3}}."
    sendWhatsApp(TWILIO_OWNER_WHATSAPP, TWILIO_OWNER_TEMPLATE_SID, {
      '1': lead.nome,
      '2': lead.email,
      '3': lead.whats,
    });
  }
}

async function notifyPaymentWhatsApp(lead, paymentId, url) {
  if (!TWILIO_PAYMENT_TEMPLATE_SID || !twilioClient || !TWILIO_WHATSAPP_FROM || lead.status === 'pago') return;
  try {
    // Claim once per checkout, including concurrent requests. Failed sends can retry.
    const claimed = await pool.query(
      `UPDATE payments SET whatsapp_payment_notified_at=now()
       WHERE id=$1 AND whatsapp_payment_notified_at IS NULL
       AND status NOT IN ('CONFIRMED','RECEIVED','RECEIVED_IN_CASH','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','EXPIRED','CANCELLED','REFUNDED')
       RETURNING id`, [paymentId]
    );
    if (!claimed.rows.length) return;
    const sent = await sendWhatsApp(lead.whats, TWILIO_PAYMENT_TEMPLATE_SID, { '1': lead.nome, '2': url });
    if (!sent) await pool.query('UPDATE payments SET whatsapp_payment_notified_at=NULL WHERE id=$1', [paymentId]);
  } catch (err) {
    console.error('Falha no lembrete de pagamento WhatsApp', err && err.message ? err.message : err);
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
      cpf_cnpj    TEXT NOT NULL DEFAULT '',
      cep         TEXT NOT NULL DEFAULT '',
      endereco    TEXT NOT NULL DEFAULT '',
      numero      TEXT NOT NULL DEFAULT '',
      complemento TEXT NOT NULL DEFAULT '',
      bairro      TEXT NOT NULL DEFAULT '',
      cidade      TEXT NOT NULL DEFAULT '',
      estado      TEXT NOT NULL DEFAULT '',
      consent     BOOLEAN NOT NULL,
      status      TEXT NOT NULL DEFAULT 'novo',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS leads_email_uq ON leads (lower(email));

    -- Colunas de CPF/CNPJ e endereço foram adicionadas depois: em produção a tabela já
    -- existe sem elas, então o CREATE TABLE acima não as cria. ALTER ... IF NOT EXISTS
    -- garante que o banco existente seja atualizado também, sem quebrar nada.
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS cpf_cnpj    TEXT NOT NULL DEFAULT '';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS cep         TEXT NOT NULL DEFAULT '';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco    TEXT NOT NULL DEFAULT '';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS numero      TEXT NOT NULL DEFAULT '';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS complemento TEXT NOT NULL DEFAULT '';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS bairro      TEXT NOT NULL DEFAULT '';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS cidade      TEXT NOT NULL DEFAULT '';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS estado      TEXT NOT NULL DEFAULT '';

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
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS whatsapp_payment_notified_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS page_views (
      id            SERIAL PRIMARY KEY,
      path          TEXT NOT NULL,
      visitor_id    TEXT NOT NULL,
      referrer      TEXT NOT NULL DEFAULT '',
      referrer_host TEXT NOT NULL DEFAULT '',
      utm_source    TEXT NOT NULL DEFAULT '',
      utm_medium    TEXT NOT NULL DEFAULT '',
      utm_campaign  TEXT NOT NULL DEFAULT '',
      user_agent    TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS page_views_created_idx ON page_views (created_at DESC);
    CREATE INDEX IF NOT EXISTS page_views_visitor_idx ON page_views (visitor_id);

    -- Contatos do diagnóstico gratuito (modo diagnóstico, entrada via diagnostico.finderlab.com.br).
    -- Tabela separada de leads: aqui não há consentimento formal nem intenção de compra
    -- confirmada, é captação de topo de funil. Não dispara notificação de WhatsApp por
    -- registro (o volume esperado é maior que o de inscrição).
    CREATE TABLE IF NOT EXISTS diagnostico_leads (
      id           SERIAL PRIMARY KEY,
      nome         TEXT NOT NULL,
      whats        TEXT NOT NULL DEFAULT '',
      email        TEXT NOT NULL DEFAULT '',
      instagram    TEXT NOT NULL DEFAULT '',
      linkedin     TEXT NOT NULL DEFAULT '',
      decisao      TEXT NOT NULL DEFAULT '',
      tipo_negocio TEXT NOT NULL DEFAULT '',
      area         TEXT NOT NULL DEFAULT '',
      porte_time   TEXT NOT NULL DEFAULT '',
      faturamento  TEXT NOT NULL DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS diagnostico_leads_created_idx ON diagnostico_leads (created_at DESC);
  `);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// ---------- helpers ----------
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// ---------- rastreamento de acessos (aba "Acessos" do admin) ----------
const BOT_UA_RE = /(bot|spider|crawl|slurp|facebookexternalhit|whatsapp|telegrambot|pingdom|uptimerobot|headlesschrome|phantomjs|python-requests|curl\/|wget\/|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|google-inspectiontool|bingpreview)/i;
const VISITOR_COOKIE = 'mdv';

function extractHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function trackPageView(req, res) {
  try {
    const ua = req.headers['user-agent'] || '';
    if (BOT_UA_RE.test(ua)) return;

    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + VISITOR_COOKIE + '=([a-f0-9-]{36})'));
    let visitorId = match ? match[1] : '';
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      res.setHeader(
        'Set-Cookie',
        VISITOR_COOKIE + '=' + visitorId + '; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax'
      );
    }

    const referrer = clean(req.headers.referer || req.headers.referrer, 500);
    const referrerHost = referrer ? extractHost(referrer) : '';
    const utmSource = clean(req.query.utm_source, 80);
    const utmMedium = clean(req.query.utm_medium, 80);
    const utmCampaign = clean(req.query.utm_campaign, 120);
    const pagePath = req.path === '/' || req.path === '/index.html' ? '/' : '/inscricao';

    await pool.query(
      `INSERT INTO page_views (path, visitor_id, referrer, referrer_host, utm_source, utm_medium, utm_campaign, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [pagePath, visitorId, referrer, referrerHost, utmSource, utmMedium, utmCampaign, clean(ua, 300)]
    );
  } catch (err) {
    console.error('trackPageView', err && err.message ? err.message : err);
  }
}

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
  // CPF/CNPJ e endereço: exigidos pelo formulário do site (pra gerar o checkout no
  // Asaas), mas opcionais aqui porque o agente de chat também chama saveLead sem pedir
  // esses dados. Quem valida se estão presentes na hora de cobrar é o POST /payments/checkout.
  const cpfCnpj = clean(b.cpfCnpj, 20).replace(/\D/g, '');
  const cep = clean(b.cep, 12).replace(/\D/g, '');
  const endereco = clean(b.endereco, 200);
  const numero = clean(b.numero, 20);
  const complemento = clean(b.complemento, 120);
  const bairro = clean(b.bairro, 120);
  const cidade = clean(b.cidade, 120);
  const estado = clean(b.estado, 2).toUpperCase();
  const consent = b.consent === true;

  const errors = {};
  if (nome.length < 2) errors.nome = 'Informe o nome completo.';
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Informe um email válido.';
  if (whats.replace(/\D/g, '').length < 10) errors.whats = 'Informe o número com DDD.';
  if (!consent) errors.consent = 'É necessário aceitar os termos.';
  if (Object.keys(errors).length) return { ok: false, status: 400, error: 'Dados inválidos.', errors };

  // mesma pessoa reenviando: atualiza os dados e preserva o andamento
  const { rows } = await pool.query(
    `INSERT INTO leads (nome, email, whats, empresa, cargo, cpf_cnpj, cep, endereco, numero, complemento, bairro, cidade, estado, consent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (lower(email)) DO UPDATE
       SET nome=EXCLUDED.nome, whats=EXCLUDED.whats, empresa=EXCLUDED.empresa,
           cargo=EXCLUDED.cargo,
           cpf_cnpj=CASE WHEN EXCLUDED.cpf_cnpj <> '' THEN EXCLUDED.cpf_cnpj ELSE leads.cpf_cnpj END,
           cep=CASE WHEN EXCLUDED.cep <> '' THEN EXCLUDED.cep ELSE leads.cep END,
           endereco=CASE WHEN EXCLUDED.endereco <> '' THEN EXCLUDED.endereco ELSE leads.endereco END,
           numero=CASE WHEN EXCLUDED.numero <> '' THEN EXCLUDED.numero ELSE leads.numero END,
           complemento=CASE WHEN EXCLUDED.complemento <> '' THEN EXCLUDED.complemento ELSE leads.complemento END,
           bairro=CASE WHEN EXCLUDED.bairro <> '' THEN EXCLUDED.bairro ELSE leads.bairro END,
           cidade=CASE WHEN EXCLUDED.cidade <> '' THEN EXCLUDED.cidade ELSE leads.cidade END,
           estado=CASE WHEN EXCLUDED.estado <> '' THEN EXCLUDED.estado ELSE leads.estado END,
           consent=EXCLUDED.consent, updated_at=now()
     RETURNING id`,
    [nome, email, whats, empresa, cargo, cpfCnpj, cep, endereco, numero, complemento, bairro, cidade, estado, consent]
  );
  notifyLeadWhatsApp({ id: rows[0].id, nome, email, whats, empresa, cargo });
  return { ok: true, id: rows[0].id };
}

async function saveDiagnostico(input) {
  const b = input || {};
  const nome = clean(b.nome, 160);
  const whats = clean(b.whats, 30);
  const email = clean(b.email, 200).toLowerCase();
  const instagram = clean(b.instagram, 120);
  const linkedin = clean(b.linkedin, 200);
  const decisao = clean(b.decisao, 400);
  const tipoNegocio = clean(b.tipo_negocio, 160);
  const area = clean(b.area, 120);
  const porteTime = clean(b.porte_time, 160);
  const faturamento = clean(b.faturamento, 160);

  const errors = {};
  if (nome.length < 2) errors.nome = 'Informe o nome.';
  if (!whats && !email) errors.contato = 'Informe WhatsApp ou email.';
  if (Object.keys(errors).length) return { ok: false, status: 400, error: 'Dados inválidos.', errors };

  const { rows } = await pool.query(
    `INSERT INTO diagnostico_leads (nome, whats, email, instagram, linkedin, decisao, tipo_negocio, area, porte_time, faturamento)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [nome, whats, email, instagram, linkedin, decisao, tipoNegocio, area, porteTime, faturamento]
  );
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

// Valida os dados da inscrição e gera (ou reaproveita) o link de pagamento no Asaas.
// Extraído do POST /payments/checkout pra ser chamado também pela ferramenta de chat
// gerar_pagamento_inscricao, sem duplicar a lógica de validação/checkout em dois lugares.
async function createCheckoutForLead(leadId, originUrl, billingType) {
  if (!ASAAS_API_KEY) return { ok: false, status: 503, error: 'Pagamento indisponível no momento.' };

  const { rows } = await pool.query('SELECT * FROM leads WHERE id=$1', [leadId]);
  const lead = rows[0];
  if (!lead) return { ok: false, status: 404, error: 'Inscrição não encontrada.' };

  if (!lead.cpf_cnpj || !lead.cep || !lead.endereco || !lead.numero || !lead.bairro) {
    return {
      ok: false,
      status: 400,
      error: 'Faltam CPF/CNPJ ou dados de endereço para gerar o pagamento.',
    };
  }

  // já existe um checkout aberto pra essa inscrição? reaproveita em vez de criar outro
  const existing = await pool.query(
    `SELECT id, checkout_url FROM payments
     WHERE lead_id=$1 AND status NOT IN ('EXPIRED', 'CANCELLED', 'REFUNDED')
     ORDER BY created_at DESC LIMIT 1`,
    [leadId]
  );
  if (existing.rows[0] && existing.rows[0].checkout_url) {
    await notifyPaymentWhatsApp(lead, existing.rows[0].id, existing.rows[0].checkout_url);
    return { ok: true, url: existing.rows[0].checkout_url };
  }

  const checkout = await createAsaasCheckout(lead, originUrl, billingType);
  const url = checkout.link || ('https://asaas.com/checkoutSession/show?id=' + checkout.id);

  const payment = await pool.query(
    `INSERT INTO payments (lead_id, asaas_checkout_id, status, value, checkout_url)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [leadId, checkout.id, checkout.status || 'PENDING', COURSE_PRICE, url]
  );

  await notifyPaymentWhatsApp(lead, payment.rows[0].id, url);

  return { ok: true, url };
}

app.options('/payments/checkout', publicCors);
app.post('/payments/checkout', publicCors, paymentLimiter, async (req, res) => {
  try {
    if (ALLOWED_ORIGINS.length && req.headers.origin && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
      return res.status(403).json({ error: 'Origem não permitida.' });
    }

    const leadId = Number(req.body && req.body.leadId);
    if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ error: 'Pedido inválido.' });

    const originUrl = req.protocol + '://' + req.get('host');
    const result = await createCheckoutForLead(leadId, originUrl);
    if (!result.ok) return res.status(result.status || 502).json({ error: result.error });

    res.json({ ok: true, url: result.url });
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
    name: 'solicitar_concordancia_termos',
    description: 'Apresenta o aviso de uso e privacidade dos dados e pede concordância explícita com botão sim, concordo no site. Use sempre na etapa de autorização, após confirmar os dados, antes de registrar inscrição ou gerar pagamento. Para ler o documento completo, use consultar_termos_privacidade. Esta ferramenta não registra aceite, inscrição nem pagamento; aguarde a próxima resposta da pessoa.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'consultar_endereco_cep',
    description: 'Consulta o endereço oficial pelo CEP informado pela pessoa. Use assim que receber o CEP no fluxo de inscrição e pagamento, antes de perguntar rua ou bairro. Retorna rua, bairro, cidade e estado; peça somente número, complemento opcional e campos que a consulta não preencher. Não registra inscrição nem gera pagamento.',
    input_schema: {
      type: 'object',
      properties: { cep: { type: 'string', description: 'CEP informado pela pessoa, com 8 dígitos, podendo conter hífen.' } },
      required: ['cep'],
    },
  },
  {
    name: 'consultar_termos_privacidade',
    description:
      'Mostra na própria conversa o texto completo e fiel dos termos de uso e privacidade publicados na página de inscrição. Use sempre que a pessoa pedir para ler, receber ou disponibilizar os termos, inclusive para não precisar abrir o site. Esta ferramenta só exibe os termos: não registra inscrição nem consentimento. A resposta completa será enviada diretamente à pessoa.',
    input_schema: {
      type: 'object',
      properties: {
        solicitar_aceite: {
          type: 'boolean',
          description: 'true somente se a conversa já está no passo de aceite da inscrição, com nome, email e WhatsApp confirmados pela pessoa. Nesse caso, após o texto, pergunta se aceita os termos e autoriza o contato. Nos demais casos, false.',
        },
      },
      required: ['solicitar_aceite'],
    },
  },
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
  {
    name: 'registrar_diagnostico',
    description:
      'Registra o contato de quem está fazendo o diagnóstico gratuito de decisão (modo diagnóstico, entrada via diagnostico.finderlab.com.br). Diferente de registrar_inscricao: não exige consentimento formal de termos, só nome e pelo menos um contato (whats ou email). Chame assim que tiver esses dois campos, mesmo que instagram, linkedin ou decisao ainda estejam vazios. Se conseguir mais dados depois na mesma conversa, pode chamar de novo, mesmo que isso gere um novo registro.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome da pessoa, exatamente como ela informou.' },
        whats: { type: 'string', description: 'WhatsApp com DDD, se ela informou. String vazia se não informou.' },
        email: { type: 'string', description: 'Email, se ela informou. String vazia se não informou.' },
        instagram: { type: 'string', description: '@ do Instagram, se ela informou. String vazia se não informou.' },
        linkedin: { type: 'string', description: 'Perfil ou URL do LinkedIn, se ela informou. String vazia se não informou.' },
        decisao: { type: 'string', description: 'Resumo curto, em 1 frase, da decisão ou problema que ela trouxe no diagnóstico, na visão dela.' },
        tipo_negocio: { type: 'string', description: 'Tipo de negócio ou setor, do jeito que você entendeu pela conversa (ex: "clínica odontológica", "e-commerce de moda"). String vazia se não deu pra inferir nem foi dito.' },
        area: { type: 'string', description: 'Área ou departamento onde a decisão vive (ex: "comercial", "operações", "financeiro"). String vazia se não deu pra inferir nem foi dito.' },
        porte_time: { type: 'string', description: 'Porte do time, em texto livre, do jeito que você entendeu (ex: "só ele, sem time ainda", "por volta de 20 pessoas", "time grande, várias áreas"). Nunca invente um número exato que a pessoa não disse. String vazia se não deu pra inferir nem foi dito.' },
        faturamento: { type: 'string', description: 'Porte de faturamento, em texto livre e por faixa, nunca um valor exato inventado (ex: "negócio pequeno, começando", "faixa de alguns milhões por ano", "não sei, não veio à tona"). String vazia se não deu pra inferir nem foi dito.' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'gerar_pagamento_inscricao',
    description:
      'Registra a inscrição COM os dados de cobrança e devolve o link de pagamento do Asaas, pra pessoa terminar a inscrição inteira ali na conversa, sem precisar ir pro site. Só use esta ferramenta (em vez de registrar_inscricao) quando a própria pessoa tiver escolhido explicitamente terminar o cadastro e o pagamento ali com você, em vez de receber o link da página de inscrição. Colete cada campo separadamente, um de cada vez, nunca peça vários de uma vez. Antes de pedir o CPF/CNPJ, deixe claro que esse dado é só pra gerar o link de cobrança no Asaas, e que cartão e senha nunca são digitados no chat — isso acontece só na página segura do Asaas depois que o link é gerado. Repita todos os dados coletados num resumo e só chame a ferramenta depois de confirmação explícita ("sim", "confirmo", "pode gerar") de que os dados estão certos e de que a pessoa concorda com os termos de uso e privacidade (LGPD). Nunca invente, deduza ou preencha nenhum campo sozinho. Chame só uma vez por inscrição.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome completo, exatamente como a pessoa informou.' },
        email: { type: 'string', description: 'Email, exatamente como a pessoa informou.' },
        whats: { type: 'string', description: 'WhatsApp com DDD, exatamente como a pessoa informou.' },
        empresa: { type: 'string', description: 'Empresa da pessoa, se ela informou. String vazia se não informou.' },
        cargo: { type: 'string', description: 'Cargo da pessoa, se ela informou. String vazia se não informou.' },
        cpfCnpj: { type: 'string', description: 'CPF ou CNPJ, exatamente como a pessoa informou (com ou sem pontuação).' },
        cep: { type: 'string', description: 'CEP, exatamente como a pessoa informou.' },
        endereco: { type: 'string', description: 'Rua/logradouro, exatamente como a pessoa informou.' },
        numero: { type: 'string', description: 'Número do endereço, exatamente como a pessoa informou.' },
        complemento: { type: 'string', description: 'Complemento do endereço, se a pessoa informou. String vazia se não informou.' },
        bairro: { type: 'string', description: 'Bairro, exatamente como a pessoa informou.' },
        cidade: { type: 'string', description: 'Cidade, se a pessoa informou. String vazia se não informou.' },
        estado: { type: 'string', description: 'Estado (UF, 2 letras), se a pessoa informou. String vazia se não informou.' },
        formaPagamento: {
          type: 'string',
          enum: ['pix', 'cartao', ''],
          description:
            'Forma de pagamento que a pessoa disse preferir: "pix" ou "cartao". String vazia se ela não tiver preferência ou não tiver dito — nesse caso o link de pagamento mostra as duas opções pra ela escolher lá.',
        },
        consent: {
          type: 'boolean',
          description:
            'true somente se a pessoa confirmou explicitamente, nesta conversa, que aceita os termos de uso e privacidade. Nunca true por suposição.',
        },
      },
      required: ['nome', 'email', 'whats', 'cpfCnpj', 'cep', 'endereco', 'numero', 'bairro', 'consent'],
    },
    cache_control: { type: 'ephemeral' },
  },
];

async function runChatTool(name, toolInput, originUrl) {
  if (name === 'consultar_endereco_cep') return lookupCep(toolInput?.cep);
  if (name === 'registrar_inscricao') {
    const result = await saveLead(toolInput);
    return result.ok
      ? { sucesso: true, id: result.id }
      : { sucesso: false, erro: result.error, campos_invalidos: result.errors || null };
  }
  if (name === 'registrar_diagnostico') {
    const result = await saveDiagnostico(toolInput);
    return result.ok
      ? { sucesso: true, id: result.id }
      : { sucesso: false, erro: result.error, campos_invalidos: result.errors || null };
  }
  if (name === 'gerar_pagamento_inscricao') {
    const saved = await saveLead(toolInput);
    if (!saved.ok) {
      return { sucesso: false, erro: saved.error, campos_invalidos: saved.errors || null };
    }
    const billingType =
      toolInput && toolInput.formaPagamento === 'pix'
        ? 'PIX'
        : toolInput && toolInput.formaPagamento === 'cartao'
          ? 'CREDIT_CARD'
          : undefined;
    const checkout = await createCheckoutForLead(saved.id, originUrl || SITE_ORIGIN, billingType);
    if (!checkout.ok) {
      return { sucesso: false, erro: checkout.error, inscricao_id: saved.id };
    }
    return { sucesso: true, inscricao_id: saved.id, url_pagamento: checkout.url };
  }
  return { sucesso: false, erro: 'Ferramenta desconhecida.' };
}

// Chama o modelo com o loop de tool use (registrar_inscricao) até ele responder só com
// texto ou até um limite de segurança. Compartilhado entre o chat do site e o WhatsApp,
// pra não duplicar essa lógica em dois lugares.
async function getAgentReply(messages, systemPromptOverride, originUrl) {
  const system = systemPromptOverride || SYSTEM_PROMPT;
  // Prompt caching: system prompt e tools são estáticos entre chamadas -- sem isso, cada
  // chamada (e cada rodada de tool use) reprocessava ~16k tokens do zero, que era a maior
  // parte da demora sentida no chat e na voz. Com cache_control, só a 1a chamada depois de
  // ~5min paga o preço cheio; as seguintes reaproveitam o cache e saem bem mais rápido.
  const systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  let response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system: systemBlocks,
    messages,
    tools: CHAT_TOOLS,
  });

  let toolRounds = 0;
  while (response.stop_reason === 'tool_use' && toolRounds < 3) {
    toolRounds += 1;
    const toolUseBlocks = (response.content || []).filter((block) => block.type === 'tool_use');
    const termsRequest = toolUseBlocks.find((block) => block.name === 'consultar_termos_privacidade');
    if (termsRequest) {
      // Deliver the published document verbatim, without model truncation or rewriting.
      // Stop here even if the model also requested registration: reading is not consent.
      return {
        reply: registrationTermsReply(REGISTRATION_TERMS, termsRequest.input?.solicitar_aceite),
        showTermsAcceptance: true,
        toolRounds,
      };
    }
    if (toolUseBlocks.some((block) => block.name === 'solicitar_concordancia_termos')) {
      // Showing the consent question must never execute registration/payment tools.
      return {
        reply: registrationConsentReply(),
        showTermsAcceptance: true,
        termsAcceptanceLabel: 'sim, concordo',
        toolRounds,
      };
    }
    const toolResults = [];
    for (const block of toolUseBlocks) {
      const result = await runChatTool(block.name, block.input, originUrl);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: systemBlocks,
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

    // Modo diagnóstico: ativado pelo domínio de entrada (diagnostico.finderlab.com.br),
    // não muda a persona nem a base de conhecimento, só acrescenta o addendum de fluxo.
    const isDiagnostico = /diagnostico/i.test(req.hostname || '');
    const systemPrompt = isDiagnostico && DIAGNOSTIC_ADDENDUM
      ? SYSTEM_PROMPT + '\n\n---\n\n# MODO DIAGNÓSTICO (ativo nesta conversa)\n\n' + DIAGNOSTIC_ADDENDUM
      : SYSTEM_PROMPT;

    const originUrl = req.protocol + '://' + req.get('host');
    const { reply, toolRounds, showTermsAcceptance, termsAcceptanceLabel } = await getAgentReply(messages, systemPrompt, originUrl);

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

    if (!clientGone) res.json({ reply, showTermsAcceptance: showTermsAcceptance === true, termsAcceptanceLabel });
  } catch (err) {
    console.error('POST /chat', err && err.message ? err.message : err, `(${Date.now() - chatStartedAt}ms decorridos)`);
    if (!res.headersSent) res.status(500).json({ error: 'Não consegui responder agora. Tenta de novo em instantes.' });
  }
});

// ---------- /voice/transcribe: áudio -> texto (Gemini), cai no /chat normal depois ----------
app.options('/voice/transcribe', publicCors);
app.post(
  '/voice/transcribe',
  publicCors,
  voiceLimiter,
  express.raw({ type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav'], limit: '15mb' }),
  async (req, res) => {
    try {
      if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Transcrição de voz indisponível no momento.' });
      if (ALLOWED_ORIGINS.length && req.headers.origin && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
        return res.status(403).json({ error: 'Origem não permitida.' });
      }
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'Áudio vazio.' });
      }

      const mimeType = (req.headers['content-type'] || 'audio/webm').split(';')[0].trim();
      const audioB64 = req.body.toString('base64');
      console.error('POST /voice/transcribe: recebido content-type=%s tamanho=%dB', req.headers['content-type'] || '(vazio)', req.body.length);

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_STT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: 'Transcreva o áudio a seguir em português do Brasil. Responda só com o texto transcrito, sem comentários nem pontuação extra.' },
                  { inline_data: { mime_type: mimeType, data: audioB64 } },
                ],
              },
            ],
          }),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text().catch(() => '');
        console.error('POST /voice/transcribe: Gemini respondeu %d — %s', geminiRes.status, errText.slice(0, 300));
        return res.status(502).json({ error: 'Não consegui entender o áudio agora.' });
      }

      const data = await geminiRes.json();
      // O modelo dedicado de transcrição (gemini-*-transcribe) devolve o texto em
      // parts[].audioTranscription.text, não em parts[].text como um generateContent comum.
      // Aceita os dois formatos pra não quebrar se a Google mudar de novo.
      const text = (data.candidates || [])
        .flatMap((c) => (c.content && c.content.parts) || [])
        .map((p) => p.text || (p.audioTranscription && p.audioTranscription.text) || '')
        .join('')
        .trim();

      if (!text) {
        const finishReason = data.candidates && data.candidates[0] && data.candidates[0].finishReason;
        console.error('POST /voice/transcribe: Gemini respondeu 200 mas sem texto (finishReason=%s) — %s', finishReason || '?', JSON.stringify(data).slice(0, 400));
        return res.status(502).json({ error: 'Não consegui entender o áudio agora.' });
      }
      res.json({ text: clean(text, CHAT_MAX_MESSAGE_LEN) });
    } catch (err) {
      console.error('POST /voice/transcribe', err && err.message ? err.message : err);
      res.status(500).json({ error: 'Não consegui entender o áudio agora.' });
    }
  }
);

// ---------- /voice/speak: texto -> áudio (Gemini), usado na resposta do Drigo ----------
app.options('/voice/speak', publicCors);
app.post('/voice/speak', publicCors, voiceLimiter, async (req, res) => {
  try {
    if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Voz indisponível no momento.' });
    if (ALLOWED_ORIGINS.length && req.headers.origin && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
      return res.status(403).json({ error: 'Origem não permitida.' });
    }

    const text = clean((req.body || {}).text, 1200);
    if (!text) return res.status(400).json({ error: 'Texto vazio.' });

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('POST /voice/speak: Gemini respondeu %d — %s', geminiRes.status, errText.slice(0, 300));
      return res.status(502).json({ error: 'Não consegui gerar a voz agora.' });
    }

    const data = await geminiRes.json();
    const parts = ((data.candidates || [])[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const audioPart = parts.find((p) => p.inlineData || p.inline_data);
    const inline = audioPart && (audioPart.inlineData || audioPart.inline_data);
    if (!inline || !inline.data) return res.status(502).json({ error: 'Não consegui gerar a voz agora.' });

    const mime = inline.mimeType || inline.mime_type || 'audio/L16;rate=24000';
    const rateMatch = /rate=(\d+)/.exec(mime);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const wavBase64 = pcmToWavBase64(inline.data, sampleRate, 1, 16);

    res.json({ audio: wavBase64, mimeType: 'audio/wav' });
  } catch (err) {
    console.error('POST /voice/speak', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Não consegui gerar a voz agora.' });
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
  for (const chunk of splitWhatsAppText(body)) {
    await twilioClient.messages.create({ from: TWILIO_WHATSAPP_FROM, to: toWhatsAppAddress(phoneRaw), body: chunk });
  }
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
    const { reply } = await getAgentReply(history, undefined, SITE_ORIGIN);
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
app.get('/admin/acessos', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-acessos.html')));
app.get('/admin/diagnosticos', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-diagnosticos.html')));

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
  const head = ['Data', 'Nome', 'Email', 'WhatsApp', 'CPF/CNPJ', 'CEP', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Cidade', 'Estado', 'Empresa', 'Cargo', 'Status'];
  const lines = [head.map(esc).join(';')].concat(
    rows.map((l) =>
      [
        new Date(l.created_at).toISOString(), l.nome, l.email, l.whats, l.cpf_cnpj, l.cep, l.endereco, l.numero,
        l.complemento, l.bairro, l.cidade, l.estado, l.empresa, l.cargo, l.status,
      ].map(esc).join(';')
    )
  );
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="inscricoes-maquina-de-decisoes.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

app.get('/admin/api/diagnosticos', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM diagnostico_leads ORDER BY created_at DESC');
  res.json(rows);
});

app.delete('/admin/api/diagnosticos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Pedido inválido.' });
  const { rowCount } = await pool.query('DELETE FROM diagnostico_leads WHERE id=$1', [id]);
  res.status(rowCount ? 200 : 404).json({ ok: !!rowCount });
});

app.get('/admin/api/diagnosticos.csv', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM diagnostico_leads ORDER BY created_at DESC');
  const esc = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmula no Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['Data', 'Nome', 'WhatsApp', 'Email', 'Instagram', 'LinkedIn', 'Decisão', 'Tipo de negócio', 'Área', 'Porte do time', 'Faturamento'];
  const lines = [head.map(esc).join(';')].concat(
    rows.map((d) =>
      [
        new Date(d.created_at).toISOString(), d.nome, d.whats, d.email, d.instagram, d.linkedin,
        d.decisao, d.tipo_negocio, d.area, d.porte_time, d.faturamento,
      ].map(esc).join(';')
    )
  );
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="diagnosticos-maquina-de-decisoes.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

app.get('/admin/api/stats', async (req, res) => {
  try {
    const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
    const TZ = 'America/Sao_Paulo';
    const num = (v) => Number(v || 0);

    const [totals, range, today, series, sources] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM page_views) AS visits,
          (SELECT COUNT(DISTINCT visitor_id) FROM page_views) AS unique_visitors,
          (SELECT COUNT(*) FROM leads) AS leads,
          (SELECT COUNT(*) FROM leads WHERE status = 'pago') AS paid
      `),
      pool.query(
        `
        SELECT
          (SELECT COUNT(*) FROM page_views WHERE created_at >= now() - make_interval(days => $1)) AS visits,
          (SELECT COUNT(DISTINCT visitor_id) FROM page_views WHERE created_at >= now() - make_interval(days => $1)) AS unique_visitors,
          (SELECT COUNT(*) FROM leads WHERE created_at >= now() - make_interval(days => $1)) AS leads,
          (SELECT COUNT(*) FROM leads WHERE created_at >= now() - make_interval(days => $1) AND status = 'pago') AS paid
        `,
        [days]
      ),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM page_views WHERE created_at >= date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS visits,
          (SELECT COUNT(DISTINCT visitor_id) FROM page_views WHERE created_at >= date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS unique_visitors
      `),
      pool.query(
        `
        WITH days AS (
          SELECT generate_series(
            date_trunc('day', now() AT TIME ZONE '${TZ}') - make_interval(days => $1::int - 1),
            date_trunc('day', now() AT TIME ZONE '${TZ}'),
            interval '1 day'
          )::date AS day
        ),
        pv AS (
          SELECT date_trunc('day', created_at AT TIME ZONE '${TZ}')::date AS day,
                 COUNT(*) AS visits, COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM page_views
          WHERE created_at >= now() - make_interval(days => $1)
          GROUP BY 1
        ),
        ld AS (
          SELECT date_trunc('day', created_at AT TIME ZONE '${TZ}')::date AS day, COUNT(*) AS leads
          FROM leads
          WHERE created_at >= now() - make_interval(days => $1)
          GROUP BY 1
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
               COALESCE(pv.visits, 0) AS visits,
               COALESCE(pv.unique_visitors, 0) AS unique_visitors,
               COALESCE(ld.leads, 0) AS leads
        FROM days
        LEFT JOIN pv ON pv.day = days.day
        LEFT JOIN ld ON ld.day = days.day
        ORDER BY days.day
        `,
        [days]
      ),
      pool.query(
        `
        SELECT
          COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), '') AS source,
          COUNT(*) AS visits,
          COUNT(DISTINCT visitor_id) AS unique_visitors
        FROM page_views
        WHERE created_at >= now() - make_interval(days => $1)
        GROUP BY 1
        ORDER BY visits DESC
        LIMIT 12
        `,
        [days]
      ),
    ]);

    const t = totals.rows[0], r = range.rows[0], td = today.rows[0];

    res.json({
      days,
      today: { visits: num(td.visits), uniqueVisitors: num(td.unique_visitors) },
      allTime: { visits: num(t.visits), uniqueVisitors: num(t.unique_visitors), leads: num(t.leads), paid: num(t.paid) },
      range: { visits: num(r.visits), uniqueVisitors: num(r.unique_visitors), leads: num(r.leads), paid: num(r.paid) },
      daily: series.rows.map((row) => ({
        date: row.day, visits: num(row.visits), uniqueVisitors: num(row.unique_visitors), leads: num(row.leads),
      })),
      sources: sources.rows.map((row) => ({ source: row.source || '', visits: num(row.visits), uniqueVisitors: num(row.unique_visitors) })),
    });
  } catch (err) {
    console.error('GET /admin/api/stats', err);
    res.status(500).json({ error: 'Não foi possível carregar as estatísticas de acesso.' });
  }
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

// Conta o acesso (sem bloquear a resposta) antes de servir a página estática.
app.get(['/', '/index.html', '/inscricao', '/inscricao.html'], (req, res, next) => {
  trackPageView(req, res).catch(() => {});
  next();
});

// ---------- Site estático (landing + inscrição) ----------
// Registrado DEPOIS das rotas /admin (protegidas por basicAuth) de propósito:
// com { extensions: ['html'] } o Express resolveria /admin -> public/admin.html
// diretamente por aqui, pulando a autenticação, se este middleware viesse antes.
// Quem chega por diagnostico.finderlab.com.br cai numa página própria, focada só
// no diagnóstico (sem hero de venda, preço ou FAQ do curso) — não na landing page
// principal. Só a raiz muda; assets (logo, avatar, fontes) continuam compartilhados.
app.get('/', (req, res, next) => {
  if (/diagnostico/i.test(req.hostname || '')) {
    return res.sendFile(path.join(__dirname, 'public', 'diagnostico.html'));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((_req, res) => res.status(404).send('Not found'));

migrate()
  .then(() => app.listen(PORT, () => console.log('maquina-api na porta ' + PORT)))
  .catch((err) => {
    console.error('Falha ao preparar o banco', err);
    process.exit(1);
  });
