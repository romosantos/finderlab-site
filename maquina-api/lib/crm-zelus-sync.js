'use strict';
// Registra no CRM do Zelus (finderlab.com.br/crmzelus, o mesmo que a Tatiana usa) o que acontece no WhatsApp
// do Drigo: cada mensagem de abertura enviada, a primeira resposta da clínica e o que ela decidiu.
// Vai para a API do Zelus (POST /v1/crm-zelus/integracao/whatsapp) com a chave ZELUS_CRM_INTEGRACAO_TOKEN.
// Nunca derruba o fluxo do WhatsApp: falha só vira log.

const URL_PADRAO = 'https://api.zelus-pet.ia.br/v1/crm-zelus/integracao/whatsapp';

// motivo do avisar_rodrigo -> evento do CRM
const EVENTO_DO_MOTIVO = {
  quer_demonstracao: 'demonstracao',
  quer_testar: 'teste',
  quer_contratar: 'contratar',
  falar_com_rodrigo: 'humano',
  decisor: 'humano',
  outro: 'humano',
};

function init({ url, token, fetchFn } = {}) {
  const destino = url || URL_PADRAO;
  const f = fetchFn || fetch;
  const ligado = !!token;
  if (!ligado) console.error('crm-zelus-sync: ZELUS_CRM_INTEGRACAO_TOKEN não definida; o CRM do Zelus não será atualizado.');

  async function registrar(telefone, evento, nota) {
    if (!ligado || !telefone || !evento) return false;
    try {
      const r = await f(destino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zelus-Integracao': token },
        body: JSON.stringify({ telefone: String(telefone), evento, ...(nota ? { nota: String(nota).slice(0, 3500) } : {}) }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) {
        console.error('crm-zelus-sync: %s para final %s respondeu %d', evento, String(telefone).slice(-4), r.status);
        return false;
      }
      const j = await r.json().catch(() => ({}));
      if (j && j.motivo === 'sem contato') console.log('crm-zelus-sync: final %s não está no CRM do Zelus', String(telefone).slice(-4));
      return true;
    } catch (err) {
      console.error('crm-zelus-sync: %s para final %s falhou: %s', evento, String(telefone).slice(-4), err && err.message ? err.message : err);
      return false;
    }
  }

  // Cada mensagem da conversa (a ficha da clínica mostra como chat). ref evita duplicar.
  const destinoMensagem = destino.replace(/\/?$/, '') + '/mensagem';
  async function mensagem(telefone, direcao, texto, ref, quando) {
    if (!ligado || !telefone || !texto) return false;
    try {
      const r = await f(destinoMensagem, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zelus-Integracao': token },
        body: JSON.stringify({
          telefone: String(telefone), direcao, texto: String(texto).slice(0, 8000),
          ...(ref ? { ref: String(ref) } : {}), ...(quando ? { enviada_em: new Date(quando).toISOString() } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) console.error('crm-zelus-sync: mensagem para final %s respondeu %d', String(telefone).slice(-4), r.status);
      return r.ok;
    } catch (err) {
      console.error('crm-zelus-sync: mensagem para final %s falhou: %s', String(telefone).slice(-4), err && err.message ? err.message : err);
      return false;
    }
  }

  return { registrar, mensagem, eventoDoMotivo: (m) => EVENTO_DO_MOTIVO[m] || 'humano' };
}

module.exports = { init, EVENTO_DO_MOTIVO };
