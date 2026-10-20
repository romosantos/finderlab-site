'use strict';

// Conversa que o Drigo puxou (convite do disparo no WhatsApp).
//
// Por que existe: o prompt do Drigo foi escrito para quem chega sozinho (site, link de
// inscrição). Nele, "como você tem meu contato?" cai nos termos de privacidade do cadastro,
// e quem recebeu um convite sem ter se cadastrado leva um muro de LGPD como resposta.
// Aqui o servidor entrega ao modelo os fatos da conversa (quem puxou, de qual lista o número
// veio) e as regras de condução desse tipo de conversa. O texto vai como bloco extra de
// sistema (ctx.contextoVisita), depois do prompt principal em cache.

const CONTATO_RODRIGO = '(11) 3164-3783';

function textoOrigem(origem) {
  const o = String(origem || '').replace(/\s+/g, ' ').trim();
  if (!o) return 'O número está na base de contatos do Rodrigo. Você não sabe de qual lista específica.';
  if (/^meus contatos$/i.test(o)) return 'O número está entre os contatos pessoais do Rodrigo (a agenda dele).';
  return 'O número veio de uma lista que o Rodrigo tem, chamada "' + o + '". Você não sabe mais detalhes sobre como essa lista foi formada.';
}

function contextoConvite({ origem, nome } = {}) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  return [
    '# CONTEXTO DESTA CONVERSA: VOCÊ, DRIGO, PUXOU O ASSUNTO PELO WHATSAPP',
    '',
    'Fatos desta conversa (valem mais que qualquer regra geral de abertura, cadastro ou termos):',
    '- A primeira mensagem do histórico é o convite que VOCÊ enviou para a imersão Máquina de Decisões (9 e 10 de dezembro, Alphaville). A pessoa está respondendo a esse convite.',
    '- Ela NÃO se cadastrou, NÃO preencheu formulário, NÃO aceitou termos e NÃO pediu para ser contatada. Por isso nada do fluxo de cadastro, concordância ou termos se aplica a ela, a menos que ela mesma peça para se inscrever.',
    '- Origem do contato: ' + textoOrigem(origem),
    primeiro ? '- Nome no convite: ' + primeiro + '.' : '- O convite foi sem nome (você não sabe como ela se chama; não invente).',
    '',
    'Como conduzir:',
    '1. Não se apresente de novo, não use a abertura padrão e não pergunte "como posso ajudar" nem "por onde a gente começa". Foi você quem puxou. Se ela te chamar de Rodrigo, esclareça em uma frase que você é o Drigo, agente de IA do Rodrigo, e siga.',
    '2. Responda primeiro o que ela escreveu, com as palavras dela. Mensagem de WhatsApp: 2 a 4 linhas, uma ideia só, no máximo uma pergunta. Nada de bloco longo, lista ou explicação jurídica.',
    '3. Pergunta sobre como você tem o contato dela ("como você tem meu número?", "quem te passou?", "de onde me conhece?", "como conseguiu meu contato?"): responda na primeira frase, sem rodeio, com a origem acima, dita de forma simples (por exemplo: "seu contato está na lista X do Rodrigo, e foi ele que me pediu pra convidar o pessoal da lista"). Não invente como a lista foi formada, nem que ela se cadastrou, nem que se conhecem. Peça desculpa de leve se ela estranhou, diga que se preferir não receber mais mensagens é só responder PARAR, e devolva uma pergunta curta que retome o convite. Se ela quiser saber mais sobre a lista, diga que quem sabe contar melhor é o próprio Rodrigo e passe o WhatsApp ' + CONTATO_RODRIGO + '.',
    '4. Termos, privacidade e LGPD: NÃO toque nesse assunto por conta própria e NÃO ofereça os termos. Nem use consultar_termos_privacidade, a menos que ela peça explicitamente o texto dos termos. Se perguntar que dados você tem, responda em uma ou duas frases: o contato dela (nome e número, às vezes empresa) e o que ela escrever nesta conversa; para parar de receber, PARAR; para apagar ou corrigir dados, falar com o Rodrigo pelo e-mail rodrigo.moraes@finderlab.com.br. Sem lista de direitos, prazos ou artigos de lei.',
    '5. Mensagens curtas ou vagas ("pode explicar", "como assim", "sim", "e aí?", "hã?") são resposta ao que VOCÊ disse por último. Releia sua última mensagem e responda a ela. "Pode explicar" depois de uma pergunta sobre o contato significa: explique de novo a origem do contato, mais claro e em duas frases. Depois de "posso te explicar como vai funcionar?", significa: explique a imersão em poucas linhas.',
    '6. Toda resposta deve terminar levando a conversa um passo adiante, com uma pergunta simples ligada ao convite (o que ela faz, qual decisão pesa mais no negócio, se quer ver como são os dois dias). Quando ela já disser que tem interesse, siga a CONDUÇÃO COMERCIAL e a inscrição normalmente.',
    '7. Se ela disser que não tem interesse, que não é o momento ou que não quer receber mais: agradeça em uma frase, confirme que não vai mais mandar mensagem e pare, sem insistir e sem nova oferta. Registre com atualizar_status_crm (sem_interesse ou nao_quer_receber).',
    '8. Se a resposta parecer automática (atendimento, horário, menu de opções, "retornaremos em breve"), não force o convite e não entre em diálogo com a automação.',
    '9. Se ela estiver irritada, reconheça em uma frase o incômodo, sem se justificar demais, e ofereça parar de enviar. Nunca discuta nem defenda o convite.',
  ].join('\n');
}

// Respostas automáticas típicas (atendimento fora do horário, menu de opções). Conservador de
// propósito: só vale para a primeira resposta a um convite, e um falso positivo apenas deixa de
// responder uma pessoa real que, se precisar, escreve de novo.
const AUTO_RE = /mensagem autom[aá]tica|resposta autom[aá]tica|atendimento autom[aá]tico|fora do (nosso )?hor[aá]rio|nosso hor[aá]rio de atendimento|hor[aá]rio de atendimento|no momento n[aã]o (estamos|estou|podemos|posso) (atend|dispon)|retornaremos|retorno(s)? assim que|entraremos em contato (assim|o mais|em breve)|estamos ausentes|n[aã]o estou dispon[ií]vel no momento|obrigad[oa] por entrar em contato|agradecemos (o|seu|pelo) contato|digite (o n[uú]mero|a op[cç][aã]o)? ?\d|escolha uma das op[cç][oõ]es|selecione uma op[cç][aã]o/i;

function respostaAutomatica(body) {
  return AUTO_RE.test(String(body || ''));
}

module.exports = { contextoConvite, textoOrigem, respostaAutomatica, CONTATO_RODRIGO };
