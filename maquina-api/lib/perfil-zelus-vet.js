'use strict';
// Perfil "zelus-vet" do WhatsApp do Drigo (desde 26/11/2026).
//
// O número (11) 5039-9353 deixou de atender a Máquina de Decisões e passou a ser o WhatsApp comercial do
// Zelus Vet: o Drigo apresenta o sistema às clínicas veterinárias da prospecção e leva quem tem interesse ao
// teste grátis, à demonstração ou ao anual do Vet Friday. O chat do site (maquina.finderlab.com.br e a Home
// da Finder Lab) segue com o prompt da Máquina; só o WhatsApp usa este perfil.
//
// Tudo o que o modelo lê neste perfil sai daqui e de knowledge/zelus-vet.md: nada do prompt da Máquina
// (inscrição, pagamento, termos da imersão) entra nas conversas com as clínicas.

const fs = require('fs');
const path = require('path');

const PERFIL = 'zelus-vet';
const ORIGEM_CLINICAS = 'Clínicas Vet SP';
// O Vet Friday acaba em 31/12/2026; o lembrete de quem parou de responder vale até lá.
const ULTIMO_DIA_FOLLOWUP = '2026-12-31';

const PROMPT = fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'zelus-vet.md'), 'utf8');

// Texto igual ao do template aprovado pela Meta (zelus_vet_convite_clinica). É o que fica gravado na
// conversa para o Drigo saber o que a clínica recebeu. {{1}} = nome da clínica.
const TEXTO_CONVITE = [
  'Oi, pessoal da {{1}}! Aqui é o Drigo, assistente de IA do Zelus Vet.',
  '',
  'Criamos um sistema para clínica veterinária com escriba de IA: ele ouve a consulta e entrega o prontuário pronto para o veterinário só revisar e aprovar. No nosso piloto, foram de 8 a 10 minutos a menos por consulta.',
  '',
  'Até 31/12 tem o Vet Friday: no plano anual, a clínica leva 12 meses pagando 8, em até 6x sem juros. E dá para testar 14 dias grátis antes.',
  '',
  'Posso mostrar como funciona?',
  '',
  'Para não receber mais mensagens, responda PARAR.',
].join('\n');
const BOTOES_CONVITE = ['Quero ver', 'Agora não', 'Não tenho interesse'];

const MINUSCULAS = new Set(['a', 'as', 'o', 'os', 'e', 'de', 'da', 'das', 'do', 'dos', 'em', 'na', 'no', 'para', 'com']);
const SIGLAS = /^(vet|pet|sp|24h|hv|cv|ltda|me|eireli)$/i;

// Nome da clínica para o cumprimento: sem o sufixo de unidade ou endereço que o Google Maps traz
// ("Clínica X - Unidade Y", "Clínica X | Banho e Tosa"), em caixa normal quando veio todo em maiúsculas,
// e curto o bastante para a frase ficar natural. '' se não sobrar nada útil.
function nomeClinica(nome) {
  let n = String(nome || '').replace(/\s+/g, ' ').trim();
  n = n.split(/\s+[-|–—]\s+|\s*\|\s*/)[0].trim();
  n = n.replace(/[.,;:!]+$/, '').trim();
  if (!/\p{L}/u.test(n)) return '';
  if (n === n.toUpperCase()) {
    n = n.toLowerCase().split(' ').map((p, i) => {
      if (SIGLAS.test(p) && p.length <= 4 && !/^(vet|pet)$/i.test(p)) return p.toUpperCase();
      if (i > 0 && MINUSCULAS.has(p)) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
  }
  if (n.length > 48) {
    const corte = n.slice(0, 48);
    n = corte.slice(0, corte.lastIndexOf(' ') > 20 ? corte.lastIndexOf(' ') : 48).trim();
  }
  return n.length >= 3 ? n : '';
}

// Bloco extra de sistema para a conversa que o Drigo puxou pelo convite: quem é a clínica (dados do Google
// que vieram com a lista) e como a conversa começou.
function contextoConvite({ nome, empresa, observacoes } = {}) {
  const clinica = nomeClinica(empresa || nome);
  const linhas = [
    '# CONTEXTO DESTA CONVERSA',
    '',
    '- O Zelus Vet mandou a mensagem de apresentação com o Vet Friday para esta clínica, e ela está respondendo. A mensagem está no histórico.',
    '- O número é o telefone comercial da clínica, público no perfil dela no Google Maps. Ela não se cadastrou nem pediu contato.',
    clinica ? '- Clínica: ' + clinica + '.' : '- Você não sabe o nome da clínica.',
  ];
  const obs = String(observacoes || '').replace(/\s+/g, ' ').trim();
  if (obs) linhas.push('- Dados públicos da lista (bairro, nota, avaliações): ' + obs.slice(0, 400) + '. Use no máximo um detalhe, com naturalidade, e só se ajudar.');
  linhas.push('- Você ainda não sabe quem está respondendo (pode ser a recepção, um veterinário ou o dono).');
  return linhas.join('\n');
}

// Conversa que a pessoa começou no WhatsApp (sem convite).
function contextoWhatsApp() {
  return [
    '# CONTEXTO DESTA CONVERSA',
    '',
    '- A pessoa chamou o WhatsApp do Zelus Vet por conta própria. Siga "Quando a pessoa chegou sozinha no WhatsApp".',
  ].join('\n');
}

// Instrução para o modelo escrever o lembrete de quem respondeu e parou de responder.
function pedidoFollowup(nome) {
  return [
    '[INSTRUÇÃO INTERNA, não é mensagem da pessoa] A clínica parou de responder há algumas horas. Escreva UMA mensagem curta de WhatsApp para retomar a conversa.',
    nome ? `A pessoa se chama ${nome}: comece com "Oi, ${nome},".` : 'Comece com "Oi,".',
    'Retome o ponto exato em que a conversa parou (a dúvida, o horário da demonstração, o teste grátis) e ofereça um próximo passo simples. Não repita o que já foi dito.',
    'Se ela ainda não recebeu o link do teste grátis e mostrou interesse, pode mandar https://app.zelusvet.com.br/assinar. Pode lembrar que o Vet Friday vale até 31/12 só se o preço já apareceu na conversa.',
    'Nada de "passando só para lembrar" nem cobrança. No máximo 3 linhas, no máximo uma pergunta, sem emoji, sem travessão, sem lista, sem markdown. Responda só com o texto da mensagem.',
  ].join(' ');
}

const MOTIVOS_VET = ['quer_demonstracao', 'quer_testar', 'quer_contratar', 'falar_com_rodrigo', 'decisor', 'outro'];

const TOOLS = [
  {
    name: 'atualizar_status_crm',
    description:
      'Anota internamente, no CRM, em que pé está esta clínica. Use só quando ela deixar claro, com as palavras dela: (a) "interessado": quer testar, ver a demonstração, contratar ou pergunta preço para valer (um "sim" a "posso mostrar?", "obrigado", "bom dia" ou curiosidade não contam); (b) "sem_interesse": diz que não tem interesse; (c) "nao_quer_receber": pede para não receber mais mensagens. Nunca mencione essa anotação. Pode ser chamada de novo se ela mudar de ideia.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['interessado', 'sem_interesse', 'nao_quer_receber'], description: 'O que a clínica deixou claro.' },
      },
      required: ['status'],
    },
  },
  {
    name: 'registrar_dados_contato',
    description:
      'Guarda no CRM o nome da pessoa, o cargo (veterinária, dona, sócio, recepção) e o nome da clínica que ela DISSE nesta conversa, com as palavras dela. Só preenche o que está vazio e nunca sobrescreve. Chame assim que ela disser um desses dados, sem pedir confirmação e sem avisar. Não deduza.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome da pessoa, como ela disse. Omita se ela não disse.' },
        empresa: { type: 'string', description: 'Nome da clínica, como ela disse. Omita se ela não disse.' },
        cargo: { type: 'string', description: 'Cargo ou função (ex.: veterinária responsável, dono, recepção). Omita se ela não disse.' },
      },
    },
  },
  {
    name: 'avisar_rodrigo',
    description:
      'Avisa a equipe do Zelus Vet na hora, por e-mail, que esta clínica precisa de uma pessoa. Use quando a clínica: quiser uma demonstração (quer_demonstracao, com o dia e horário pedidos no resumo); disser que vai testar ou pedir o link do teste (quer_testar); quiser contratar o anual do Vet Friday (quer_contratar); pedir para falar ou ligar com alguém da equipe (falar_com_rodrigo); disser que vai levar ao sócio ou ao dono (decisor); ou trouxer dúvida ou pedido que você não resolve com a base, como condição especial (outro). Não use para curiosidade solta, recusa ou resposta automática. O número da clínica o sistema já tem. Não mencione e-mail nem detalhes do aviso: diga que a equipe vai chamar, sem prometer prazo.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', enum: MOTIVOS_VET, description: 'Por que a equipe precisa entrar.' },
        resumo: { type: 'string', description: 'Duas ou três frases para a equipe: quem respondeu (cargo), o que a clínica quer, a faixa de pets se souber, o dia e horário pedidos para a demonstração e qualquer objeção.' },
        nome: { type: 'string', description: 'Nome que a pessoa disse. Omita se ela não disse.' },
        empresa: { type: 'string', description: 'Nome da clínica.' },
      },
      required: ['motivo', 'resumo'],
    },
    cache_control: { type: 'ephemeral' },
  },
];

const INSTRUCAO_AVISO_OK = 'Equipe avisada. Diga em uma frase que a equipe do Zelus Vet vai chamar por aqui (ou ligar) para seguir, sem prometer prazo e sem citar e-mail. Se for demonstração, diga que a equipe confirma o horário. Não diga que está marcada.';

module.exports = {
  PERFIL, ORIGEM_CLINICAS, ULTIMO_DIA_FOLLOWUP, PROMPT, TEXTO_CONVITE, BOTOES_CONVITE, TOOLS, MOTIVOS_VET, INSTRUCAO_AVISO_OK,
  nomeClinica, contextoConvite, contextoWhatsApp, pedidoFollowup,
};
