'use strict';

// The registration page is the source of truth for the text shown in chat.
function extractRegistrationTerms(html) {
  const modalStart = html.indexOf('id="terms-ov"');
  const body = modalStart >= 0
    ? html.slice(modalStart).match(/<div class="m-body">([\s\S]*?)<\/div>/)
    : null;
  if (!body) throw new Error('Termos de inscrição não encontrados na página.');

  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const text = body[1]
    .replace(/<\/(?:p|h3|li)>/gi, '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1].toLowerCase() === 'x';
        return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      return entities[entity.toLowerCase()];
    })
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();

  if (!text.includes('8. Base legal') || !text.includes('Última atualização:')) {
    throw new Error('Texto dos termos de inscrição está incompleto.');
  }
  return 'Termos de uso e privacidade dos dados\n\n' + text;
}

function registrationTermsReply(terms, requestConsent) {
  return 'Claro, seguem os termos completos publicados na página de inscrição:\n\n' + terms +
    (requestConsent === true
      ? '\n\nVocê concorda com esses termos e autoriza a Finder Lab a entrar em contato sobre esta inscrição e sobre o curso, conforme a LGPD?'
      : '\n\nSe tiver alguma dúvida sobre esse texto, pode perguntar por aqui.');
}

function registrationConsentReply() {
  return 'Antes de continuar, preciso da sua concordância com os termos de uso e privacidade dos dados (LGPD).\n\n' +
    'Ao se inscrever, você autoriza a Finder Lab a usar seus dados para registrar a inscrição, entrar em contato sobre o curso (pagamento, logística, data e local) e enviar informações sobre próximas turmas da Máquina de Decisões. O pagamento é processado pelo Asaas; os dados de cartão não são digitados nem guardados no chat.\n\n' +
    'Se quiser ler os termos completos antes, pode pedir aqui na conversa ou acessar https://www.maquina.finderlab.com.br/inscricao.\n\n' +
    'Você concorda com os termos de uso e privacidade e autoriza esse contato?';
}

module.exports = { extractRegistrationTerms, registrationTermsReply, registrationConsentReply };
