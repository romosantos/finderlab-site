/* Mini CRM da prospecção do Zelus Vet · finderlab.com.br/crmzelus
 * A Tatiane registra cada ligação; o Rodrigo acompanha no Painel.
 * Dados na API do Zelus (/v1/crm-zelus), login próprio por usuário e senha. */
(function () {
  'use strict';

  var API = (function () {
    var q = new URLSearchParams(location.search).get('api');
    if (q) localStorage.setItem('crmzelus_api', q);
    return localStorage.getItem('crmzelus_api') || 'https://api.zelus-pet.ia.br/v1';
  })();

  var STATUS = [
    ['nao_contatado', 'Não contatado'],
    ['tentando', 'Tentando contato'],
    ['conversou', 'Conversou'],
    ['demo_marcada', 'Demonstração marcada'],
    ['em_teste', 'Em teste'],
    ['fechou', 'Fechou'],
    ['sem_interesse', 'Sem interesse'],
    ['descartado', 'Descartado'],
  ];
  var CANAIS = [['ligacao', 'Ligação'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['visita', 'Visita'], ['outro', 'Outro']];
  var RESULTADOS = [
    ['nao_atendeu', 'Não atendeu'],
    ['caixa_postal', 'Caixa postal / recado'],
    ['numero_errado', 'Número errado'],
    ['pediu_retorno', 'Pediu para retornar'],
    ['conversou', 'Conversou'],
    ['interessado', 'Interessado'],
    ['demo_marcada', 'Marcou demonstração'],
    ['em_teste', 'Começou o teste'],
    ['fechou', 'Fechou'],
    ['sem_interesse', 'Sem interesse'],
    ['enviado', 'Mensagem enviada'],
    ['voltou', 'E-mail voltou'],
    ['respondeu', 'Respondeu por e-mail'],
    ['outro', 'Outro'],
  ];
  var FAIXAS = [['300', 'Até 300 pets', 99], ['600', 'Até 600 pets', 120], ['1000', 'Até 1.000 pets', 150], ['2000', 'Até 2.000 pets', 220], ['ilimitado', 'Ilimitado', 498]];
  // Modelos de e-mail. {saudacao}, {clinica} e a assinatura entram sozinhos;
  // a pessoa pode editar tudo antes de enviar.
  var PRECOS = 'Depois do teste, o preço segue o número de pets cadastrados na clínica: até 300 pets R$ 99 por mês, até 600 R$ 120, até 1.000 R$ 150, até 2.000 R$ 220 e ilimitado R$ 498. No anual, são 12 meses pelo preço de 10, em até 6x sem juros no cartão.';
  // Vet Friday: anual por 8 mensalidades, só até 31/12/2026.
  var VET_FRIDAY_ATE = '2026-12-31';
  var MODELOS = [
    ['branco', 'Em branco', '', '{saudacao}\n\n\n\n{assinatura}'],
    ['vetfriday', 'Vet Friday (até 31/12)', 'Vet Friday: 12 meses de Zelus Vet pagando 8',
      '{saudacao}\n\nSou a {eu}, do Zelus Vet. Neste fim de ano estamos com o Vet Friday, e acho que vale a pena para a {clinica}.\n\n' +
      'O Zelus Vet é um sistema para clínicas veterinárias com prontuário, agenda, exames, receitas e financeiro, e com três diferenciais:\n' +
      '- Escriba de IA: ouve a consulta e entrega anamnese e prontuário prontos para o vet revisar e aprovar. No nosso piloto, foram 8 a 10 minutos a menos por consulta.\n' +
      '- App do tutor: resumo da consulta, receita e lembretes de remédio e vacina. As consultas só para tirar dúvida caíram 30%.\n' +
      '- Leitura de exames: os resultados viram uma linha do tempo de cada paciente.\n\n' +
      'A condição do Vet Friday: fechando o plano anual até 31 de dezembro, a clínica leva 12 meses pagando 8, à vista ou em até 6x sem juros no cartão. Por exemplo, para até 300 pets cadastrados, o ano sai R$ 792 (6x de R$ 132), em vez de R$ 990. O sistema é o mesmo em todas as faixas; muda só o número de pets. A implantação é guiada, com treinamento da equipe.\n\n' +
      'Antes de pagar qualquer coisa, dá para testar 14 dias grátis com tudo liberado: zelusvet.com.br. Se preferir, marco uma demonstração de 15 minutos no horário de vocês.\n\n' +
      'Se não fizer sentido para vocês, é só responder este e-mail que eu não envio mais nada.\n\n{assinatura}'],
    ['primeiro', 'Primeiro contato', 'Menos tempo no prontuário na {clinica}',
      '{saudacao}\n\nSou a {eu}, do Zelus Vet. Escrevo porque a {clinica} é bem avaliada, e acho que o que construímos pode ajudar o dia a dia de vocês.\n\n' +
      'O Zelus Vet é um sistema para clínicas veterinárias com três coisas principais:\n' +
      '- Escriba de IA: ouve a consulta, separa o que é clínico e monta anamnese e prontuário para o vet revisar e aprovar.\n' +
      '- App do tutor: o tutor recebe o resumo da consulta, a receita e os lembretes de medicação, e sobe exames que já aparecem para a clínica.\n' +
      '- Leitura de exames: cada marcador vira uma linha do tempo do paciente.\n\n' +
      'Na clínica onde rodamos o piloto, o escriba devolveu de 8 a 10 minutos por consulta e as mensagens dos tutores para a clínica caíram.\n\n' +
      'Dá para testar 14 dias de graça, com tudo liberado: zelusvet.com.br. Se preferir, marco uma demonstração de 15 minutos no horário de vocês.\n\n' +
      'Se não fizer sentido para vocês, é só responder este e-mail que eu não envio mais nada.\n\n{assinatura}'],
    ['ligacao', 'Depois da ligação', 'Zelus Vet: o que conversamos',
      '{saudacao}\n\nObrigada pela conversa de hoje. Como combinamos, mando um resumo do Zelus Vet.\n\n' +
      '- Escriba de IA: ouve a consulta e entrega anamnese e prontuário prontos para o vet revisar e aprovar. No nosso piloto, foram 8 a 10 minutos a menos por consulta.\n' +
      '- App do tutor: resumo da consulta, receita e lembretes de medicação, o que diminui as mensagens e ligações para a clínica.\n' +
      '- Leitura de exames: os resultados viram uma linha do tempo de cada paciente.\n\n' +
      'São 14 dias grátis com tudo liberado, sem compromisso: zelusvet.com.br. ' + PRECOS + '\n\n' +
      'Se quiser, marco uma demonstração de 15 minutos para mostrar funcionando. É só me dizer o melhor horário.\n\n{assinatura}'],
    ['retorno', 'Retorno (sem resposta)', 'Zelus Vet para a {clinica}',
      '{saudacao}\n\nPassando só para não deixar meu último e-mail perdido. Dá para testar o Zelus Vet 14 dias de graça, com tudo liberado e sem compromisso: zelusvet.com.br\n\n' +
      'Se preferir, faço uma demonstração de 15 minutos no horário que for melhor para vocês. E se não for o momento, tudo bem também.\n\n{assinatura}'],
    ['demo', 'Depois da demonstração', 'Obrigada pela demonstração',
      '{saudacao}\n\nObrigada pelo tempo na demonstração de hoje. Para começar os 14 dias grátis, é só criar a conta da clínica em zelusvet.com.br, com tudo liberado.\n\n' +
      PRECOS + '\n\nSe surgir qualquer dúvida no teste, é só responder este e-mail.\n\n{assinatura}'],
  ];

  var REGIOES = [['capital', 'São Paulo (capital)'], ['grande_sp', 'Grande SP e litoral'], ['outros', 'Pet shops e outros']];

  var st = {
    token: localStorage.getItem('crmzelus_token') || '',
    usuario: null,
    leads: [],
    aba: 'contatos',
    filtro: { q: '', status: '', prio: '', regiao: '', local: '', celular: false },
    limite: 100,
    aberto: null,
    painelDias: 30,
  };

  var app = document.getElementById('app');

  // ── utilidades ─────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rotulo(lista, v) {
    for (var i = 0; i < lista.length; i++) if (lista[i][0] === v) return lista[i][1];
    return v || '';
  }
  function opcoes(lista, sel, vazio) {
    return (vazio ? '<option value="">' + esc(vazio) + '</option>' : '') +
      lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === sel ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function hoje() {
    var d = new Date(Date.now() - 3 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  function dataBr(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1];
  }
  function quando(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function brl(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function digitos(s) { return String(s || '').replace(/\D/g, ''); }
  function zapLink(tel) {
    var d = digitos(tel);
    if (d.length < 10) return '';
    if (d.length <= 11) d = '55' + d;
    return 'https://wa.me/' + d;
  }
  function eu() { var u = st.usuario || {}; return String(u.email_nome || u.nome || '').split(/ [/-] /)[0].trim(); }
  function preencherModelo(chave, l) {
    var m = MODELOS.filter(function (x) { return x[0] === chave; })[0] || MODELOS[0];
    var primeiro = String(l.contato || '').trim().replace(/^((dra?|sra?|srta|prof|profa)\.?\s+)+/i, '').split(/[\s,(·-]+/)[0];
    var vars = {
      saudacao: primeiro ? 'Olá, ' + primeiro + ',' : 'Olá, pessoal da ' + l.nome + ',',
      clinica: l.nome,
      eu: eu().split(' ')[0],
      assinatura: 'Abraço,\n' + eu() + '\nZelus Vet · Finder Lab\nzelusvet.com.br',
    };
    var troca = function (t) { return t.replace(/\{(\w+)\}/g, function (a, k) { return vars[k] != null ? vars[k] : a; }); };
    return { assunto: troca(m[2]), texto: troca(m[3]) };
  }
  function chip(s) { return '<span class="chip st-' + esc(s) + '">' + esc(rotulo(STATUS, s)) + '</span>'; }
  function proximo(l) {
    if (!l.proximo_em) return '';
    var h = hoje();
    var cls = l.proximo_em < h ? 'atrasado' : l.proximo_em === h ? 'hoje' : '';
    return '<span class="' + cls + '">' + (l.proximo_em === h ? 'Hoje' : dataBr(l.proximo_em)) + '</span>';
  }
  function valorFaixa(faixa, ciclo) {
    for (var i = 0; i < FAIXAS.length; i++) if (FAIXAS[i][0] === faixa) return ciclo === 'anual' ? FAIXAS[i][2] * 10 : FAIXAS[i][2];
    return null;
  }

  function api(caminho, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    if (st.token) h.Authorization = 'Bearer ' + st.token;
    return fetch(API + caminho, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && caminho !== '/crm-zelus/login') { sair(true); throw new Error('Sessão terminou'); }
          if (!r.ok) {
            var m = j && j.message;
            throw new Error(Array.isArray(m) ? m.join(' ') : m || 'Não consegui salvar. Tente de novo.');
          }
          return j;
        });
      });
  }

  // ── login ──────────────────────────────────────────────────────────────
  function telaLogin(msg) {
    app.innerHTML =
      '<div class="login"><form id="fLogin">' +
      '<div class="marca">FINDER<span>LAB</span> · Zelus Vet</div>' +
      '<h1>Prospecção de clínicas</h1><p>Entre com o usuário e a senha que você recebeu.</p>' +
      '<label for="lUser">Usuário</label><input id="lUser" type="text" autocomplete="username" autocapitalize="none" required>' +
      '<label for="lSenha">Senha</label><input id="lSenha" type="password" autocomplete="current-password" required>' +
      '<button class="btn cheio" type="submit">Entrar</button>' +
      '<div class="erro" id="lErro">' + esc(msg || '') + '</div></form></div>';
    document.getElementById('fLogin').onsubmit = function (e) {
      e.preventDefault();
      var b = e.target.querySelector('button');
      b.disabled = true;
      api('/crm-zelus/login', { method: 'POST', body: { login: document.getElementById('lUser').value, senha: document.getElementById('lSenha').value } })
        .then(function (r) {
          st.token = r.token; st.usuario = r.usuario;
          localStorage.setItem('crmzelus_token', r.token);
          carregar();
        })
        .catch(function (err) { b.disabled = false; document.getElementById('lErro').textContent = err.message; });
    };
  }

  function sair(expirou) {
    if (st.token && !expirou) api('/crm-zelus/logout', { method: 'POST' }).catch(function () {});
    st.token = ''; st.usuario = null;
    localStorage.removeItem('crmzelus_token');
    telaLogin(expirou ? 'Sua sessão terminou. Entre de novo.' : '');
  }

  function carregar() {
    app.innerHTML = '<div class="carregando">Carregando contatos…</div>';
    Promise.all([api('/crm-zelus/me'), api('/crm-zelus/leads')])
      .then(function (r) { st.usuario = r[0]; st.leads = r[1]; render(); })
      .catch(function (err) { if (st.token) app.innerHTML = '<div class="carregando">' + esc(err.message) + '</div>'; });
  }

  // ── estrutura ──────────────────────────────────────────────────────────
  function retornosPendentes() {
    var h = hoje();
    return st.leads.filter(function (l) { return l.proximo_em && l.proximo_em <= h && l.status !== 'fechou' && l.status !== 'sem_interesse' && l.status !== 'descartado'; }).length;
  }

  function render() {
    var admin = st.usuario && st.usuario.papel === 'admin';
    var n = retornosPendentes();
    app.innerHTML =
      '<div class="topo"><div class="marca">FINDER<span>LAB</span><span class="longo"> · Zelus Vet</span></div>' +
      '<nav class="abas">' +
      '<button data-aba="contatos" class="' + (st.aba === 'contatos' ? 'on' : '') + '">Contatos</button>' +
      '<button data-aba="retornos" class="' + (st.aba === 'retornos' ? 'on' : '') + '">Retornos' + (n ? '<span class="badge">' + n + '</span>' : '') + '</button>' +
      (admin ? '<button data-aba="painel" class="' + (st.aba === 'painel' ? 'on' : '') + '">Painel</button>' : '') +
      '<button data-aba="materiais" class="' + (st.aba === 'materiais' ? 'on' : '') + '">Materiais</button>' +
      '<button data-aba="manual" class="' + (st.aba === 'manual' ? 'on' : '') + '">Manual</button>' +
      '</nav><div class="quem"><span class="nomeu">' + esc(st.usuario ? st.usuario.nome : '') + '</span><button id="bSair">Sair</button></div></div>' +
      '<main id="conteudo"></main><div id="camada"></div>';
    app.querySelectorAll('[data-aba]').forEach(function (b) { b.onclick = function () { st.aba = b.dataset.aba; st.limite = 100; render(); }; });
    document.getElementById('bSair').onclick = function () { sair(false); };
    if (st.aba === 'painel' && admin) painel();
    else if (st.aba === 'manual') manual();
    else if (st.aba === 'materiais') materiais();
    else if (st.aba === 'retornos') retornos();
    else contatos();
    if (st.aberto) abrirFicha(st.aberto);
  }

  // ── contatos ───────────────────────────────────────────────────────────
  function filtrados() {
    var f = st.filtro;
    var q = f.q.trim().toLowerCase();
    var qd = digitos(q);
    return st.leads.filter(function (l) {
      if (f.status && l.status !== f.status) return false;
      if (f.prio && l.prioridade !== f.prio) return false;
      if (f.regiao && l.regiao !== f.regiao) return false;
      if (f.local && (l.regiao === 'capital' ? l.zona : l.cidade) !== f.local) return false;
      if (f.celular && !l.celular) return false;
      if (q) {
        var alvo = (l.nome + ' ' + (l.bairro || '') + ' ' + (l.cidade || '') + ' ' + (l.contato || '')).toLowerCase();
        if (alvo.indexOf(q) < 0 && !(qd.length >= 4 && digitos(l.telefone).indexOf(qd) >= 0)) return false;
      }
      return true;
    });
  }

  function locais() {
    var f = st.filtro, s = {};
    st.leads.forEach(function (l) {
      if (f.regiao && l.regiao !== f.regiao) return;
      var v = l.regiao === 'capital' ? l.zona : l.cidade;
      if (v) s[v] = (s[v] || 0) + 1;
    });
    return Object.keys(s).sort().map(function (k) { return [k, k + ' (' + s[k] + ')']; });
  }

  function linhaHtml(l) {
    var tel = l.telefone
      ? '<a href="tel:' + esc(digitos(l.telefone)) + '" onclick="event.stopPropagation()">' + esc(l.telefone) + '</a>' +
        (l.celular && zapLink(l.telefone) ? '<a class="zap" target="_blank" rel="noopener" href="' + zapLink(l.telefone) + '" onclick="event.stopPropagation()">WhatsApp</a>' : '')
      : '<span class="sub">sem telefone</span>';
    return '<div class="linha" data-id="' + esc(l.id) + '">' +
      '<div><span class="prio ' + esc(l.prioridade || 'C') + '">' + esc(l.prioridade || '·') + '</span></div>' +
      '<div><div class="nome">' + esc(l.nome) + '</div><div class="sub">' + esc([l.bairro, l.regiao === 'capital' ? l.zona : l.cidade].filter(Boolean).join(' · ')) +
      (l.nota ? ' · ★ ' + esc(l.nota) + ' (' + esc(l.avaliacoes || 0) + ')' : '') + '</div></div>' +
      '<div class="tel">' + tel + '</div>' +
      '<div>' + chip(l.status) + '</div>' +
      '<div class="sub">' + (l.proximo_em ? proximo(l) + (l.proximo_passo ? ' · ' + esc(l.proximo_passo) : '') : (l.proximo_passo ? esc(l.proximo_passo) : '')) + '</div>' +
      '<div class="sub">' + (l.ultima_tentativa_em ? quando(l.ultima_tentativa_em) + ' · ' + l.tentativas + 'x' : '') + '</div>' +
      '</div>';
  }

  function contatos() {
    var f = st.filtro;
    var c = document.getElementById('conteudo');
    var lista = filtrados();
    var porStatus = {};
    st.leads.forEach(function (l) { porStatus[l.status] = (porStatus[l.status] || 0) + 1; });
    c.innerHTML =
      '<div class="filtros">' +
      '<input class="busca" type="search" id="fQ" placeholder="Buscar clínica, bairro, cidade ou telefone" value="' + esc(f.q) + '">' +
      '<select id="fPrio">' + opcoes([['A', 'Prioridade A'], ['B', 'Prioridade B'], ['C', 'Prioridade C']], f.prio, 'Todas as prioridades') + '</select>' +
      '<select id="fRegiao">' + opcoes(REGIOES, f.regiao, 'Todas as regiões') + '</select>' +
      '<select id="fLocal">' + opcoes(locais(), f.local, 'Zona ou cidade') + '</select>' +
      '<select id="fStatus">' + opcoes(STATUS, f.status, 'Todos os status') + '</select>' +
      '<label class="chk"><input type="checkbox" id="fCel"' + (f.celular ? ' checked' : '') + '> Com WhatsApp</label>' +
      '</div>' +
      '<div class="resumo">' + STATUS.map(function (s) {
        return porStatus[s[0]] ? '<button data-st="' + s[0] + '" class="' + (f.status === s[0] ? 'on' : '') + '">' + esc(s[1]) + ': ' + porStatus[s[0]] + '</button>' : '';
      }).join('') + '<button id="bNovo">+ Nova clínica</button></div>' +
      '<p class="contagem">' + lista.length + ' clínica(s)</p>' +
      '<div class="lista"><div class="linha cab"><div></div><div>Clínica</div><div>Telefone</div><div>Status</div><div>Próximo passo</div><div>Última tentativa</div></div>' +
      (lista.length ? lista.slice(0, st.limite).map(linhaHtml).join('') : '<div class="vazio">Nenhuma clínica com esses filtros.</div>') +
      '</div>' + (lista.length > st.limite ? '<button class="btn claro mais" id="bMais">Mostrar mais (' + (lista.length - st.limite) + ')</button>' : '');

    var q = document.getElementById('fQ');
    q.oninput = function () { f.q = q.value; st.limite = 100; atualizarLista(); };
    document.getElementById('fPrio').onchange = function (e) { f.prio = e.target.value; st.limite = 100; contatos(); };
    document.getElementById('fRegiao').onchange = function (e) { f.regiao = e.target.value; f.local = ''; st.limite = 100; contatos(); };
    document.getElementById('fLocal').onchange = function (e) { f.local = e.target.value; st.limite = 100; contatos(); };
    document.getElementById('fStatus').onchange = function (e) { f.status = e.target.value; st.limite = 100; contatos(); };
    document.getElementById('fCel').onchange = function (e) { f.celular = e.target.checked; st.limite = 100; contatos(); };
    c.querySelectorAll('[data-st]').forEach(function (b) { b.onclick = function () { f.status = f.status === b.dataset.st ? '' : b.dataset.st; contatos(); }; });
    document.getElementById('bNovo').onclick = novaClinica;
    var bm = document.getElementById('bMais');
    if (bm) bm.onclick = function () { st.limite += 200; contatos(); };
    ligarLinhas(c);
  }

  function atualizarLista() {
    var lista = filtrados();
    var c = document.getElementById('conteudo');
    c.querySelector('.contagem').textContent = lista.length + ' clínica(s)';
    var box = c.querySelector('.lista');
    box.innerHTML = '<div class="linha cab"><div></div><div>Clínica</div><div>Telefone</div><div>Status</div><div>Próximo passo</div><div>Última tentativa</div></div>' +
      (lista.length ? lista.slice(0, st.limite).map(linhaHtml).join('') : '<div class="vazio">Nenhuma clínica com esses filtros.</div>');
    var bm = document.getElementById('bMais');
    if (bm) bm.remove();
    ligarLinhas(c);
  }

  function ligarLinhas(c) {
    c.querySelectorAll('.linha[data-id]').forEach(function (r) { r.onclick = function () { abrirFicha(r.dataset.id); }; });
  }

  // ── retornos ───────────────────────────────────────────────────────────
  // Materiais para mandar às clínicas (arquivos em crmzelus/materiais).
  var MATERIAIS = [
    {
      titulo: 'Apresentação Vet Friday',
      desc: 'Zelus Vet com a oferta do Vet Friday na capa: 12 meses pelo preço de 8, faixas e preços, como aproveitar, escriba de IA, exames, app do tutor e a conta do tempo devolvido. 11 páginas em PDF.',
      quando: 'Mande depois da ligação ou da demonstração, junto com a mensagem de WhatsApp ou o e-mail.',
      arquivo: 'materiais/Zelus-Vet-Vet-Friday.pdf',
      capa: 'materiais/vet-friday-capa.png',
      ate: '2026-12-31',
    },
  ];
  function materiais() {
    var c = document.getElementById('conteudo');
    var lista = MATERIAIS.filter(function (m) { return !m.ate || hoje() <= m.ate; });
    c.innerHTML = '<div class="materiais"><h2>Materiais</h2><p class="sub">Para mandar às clínicas. "Copiar link" copia o endereço do PDF para colar no WhatsApp ou no e-mail.</p>' +
      (lista.length ? lista.map(function (m, i) {
        var url = new URL(m.arquivo, location.href).href;
        return '<div class="material"><a class="mat-capa" href="' + esc(m.arquivo) + '" target="_blank" rel="noopener"><img src="' + esc(m.capa) + '" alt=""></a>' +
          '<div class="mat-txt"><h3>' + esc(m.titulo) + '</h3><p>' + esc(m.desc) + '</p><p class="sub"><b>Quando usar:</b> ' + esc(m.quando) + '</p>' +
          '<div class="mat-acoes"><a class="btn" href="' + esc(m.arquivo) + '" target="_blank" rel="noopener">Abrir</a>' +
          '<a class="btn claro" href="' + esc(m.arquivo) + '" download>Baixar PDF</a>' +
          '<button type="button" class="btn cyan" data-link="' + esc(url) + '" data-i="' + i + '">Copiar link</button></div></div></div>';
      }).join('') : '<p class="sub">Nenhum material disponível no momento.</p>') + '</div>';
    c.querySelectorAll('[data-link]').forEach(function (b) {
      b.onclick = function () {
        (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.link) : Promise.reject())
          .then(function () { b.textContent = 'Link copiado!'; setTimeout(function () { b.textContent = 'Copiar link'; }, 1800); })
          .catch(function () { prompt('Copie o link:', b.dataset.link); });
      };
    });
  }

  // Manual da prospecção (manual.html): roteiro, objeções, mensagens e uso do CRM.
  function manual() {
    var c = document.getElementById('conteudo');
    c.innerHTML = '<div class="carregando">Abrindo o manual…</div>';
    fetch('manual.html?v=' + Date.now())
      .then(function (r) { if (!r.ok) throw new Error('Não foi possível abrir o manual.'); return r.text(); })
      .then(function (html) {
        if (st.aba !== 'manual') return;
        c.innerHTML = html;
        c.querySelectorAll('.m-indice a').forEach(function (a) {
          a.onclick = function (e) { e.preventDefault(); var alvo = c.querySelector(a.getAttribute('href')); if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        });
        var imp = c.querySelector('[data-imprimir]');
        if (imp) imp.onclick = function () { window.print(); };
        c.querySelectorAll('[data-copiar]').forEach(function (el) {
          var texto = el.innerText.trim();
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'm-copiar'; b.textContent = 'Copiar';
          b.onclick = function () {
            (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject())
              .then(function () { b.textContent = 'Copiado!'; setTimeout(function () { b.textContent = 'Copiar'; }, 1800); })
              .catch(function () { b.textContent = 'Selecione e copie'; });
          };
          el.appendChild(b);
        });
      })
      .catch(function (err) { c.innerHTML = '<div class="carregando">' + esc(err.message) + '</div>'; });
  }

  function retornos() {
    var h = hoje();
    var em7 = new Date(Date.now() - 3 * 3600000 + 7 * 86400000).toISOString().slice(0, 10);
    var ativos = st.leads.filter(function (l) { return l.proximo_em && l.status !== 'fechou' && l.status !== 'sem_interesse' && l.status !== 'descartado'; })
      .sort(function (a, b) { return a.proximo_em < b.proximo_em ? -1 : 1; });
    var grupos = [
      ['Atrasados', ativos.filter(function (l) { return l.proximo_em < h; })],
      ['Hoje', ativos.filter(function (l) { return l.proximo_em === h; })],
      ['Próximos 7 dias', ativos.filter(function (l) { return l.proximo_em > h && l.proximo_em <= em7; })],
    ];
    var c = document.getElementById('conteudo');
    c.innerHTML = grupos.map(function (g) {
      return '<h3 style="margin:18px 0 8px;color:var(--ink)">' + g[0] + ' <span class="sub">(' + g[1].length + ')</span></h3>' +
        '<div class="lista">' + (g[1].length ? g[1].map(linhaHtml).join('') : '<div class="vazio">Nada aqui.</div>') + '</div>';
    }).join('');
    ligarLinhas(c);
  }

  // ── ficha da clínica ───────────────────────────────────────────────────
  function abrirFicha(id) {
    st.aberto = id;
    var camada = document.getElementById('camada');
    camada.innerHTML = '<div class="fundo"></div><aside class="ficha"><header><h2>Carregando…</h2><button class="fechar" aria-label="Fechar">×</button></header></aside>';
    ligarFechar();
    api('/crm-zelus/leads/' + id).then(function (r) { if (st.aberto === id) desenharFicha(r.lead, r.interacoes); })
      .catch(function (err) { camada.querySelector('h2').textContent = err.message; });
  }

  function ligarFechar() {
    var camada = document.getElementById('camada');
    var fechar = function () { st.aberto = null; camada.innerHTML = ''; };
    camada.querySelector('.fundo').onclick = fechar;
    camada.querySelector('.fechar').onclick = fechar;
  }

  function atualizarLocal(lead) {
    for (var i = 0; i < st.leads.length; i++) {
      if (st.leads[i].id === lead.id) { for (var k in lead) if (k in st.leads[i]) st.leads[i][k] = lead[k]; return; }
    }
    st.leads.unshift(lead);
  }

  function desenharFicha(l, hist) {
    var camada = document.getElementById('camada');
    var zap = l.celular ? zapLink(l.telefone) : '';
    var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.endereco || (l.nome + ' ' + (l.bairro || '') + ' ' + (l.cidade || '')));
    var insta = l.instagram ? (l.instagram.indexOf('http') === 0 ? l.instagram : 'https://instagram.com/' + l.instagram.replace(/^@/, '')) : '';
    var site = l.site ? (l.site.indexOf('http') === 0 ? l.site : 'https://' + l.site) : '';
    var canal = 'ligacao';

    camada.innerHTML = '<div class="fundo"></div><aside class="ficha">' +
      '<header><h2>' + esc(l.nome) + '</h2><div class="sub">' + esc([l.tipo, l.bairro, l.cidade].filter(Boolean).join(' · ')) +
      (l.nota ? ' · ★ ' + esc(l.nota) + ' (' + esc(l.avaliacoes || 0) + ' avaliações)' : '') + '</div>' +
      '<div class="acoes">' +
      (l.telefone ? '<a class="btn" href="tel:' + esc(digitos(l.telefone)) + '">Ligar ' + esc(l.telefone) + '</a>' : '') +
      (zap ? '<a class="btn cyan" target="_blank" rel="noopener" href="' + zap + '">WhatsApp</a>' : '') +
      (insta ? '<a class="btn claro" target="_blank" rel="noopener" href="' + esc(insta) + '">Instagram</a>' : '') +
      (site ? '<a class="btn claro" target="_blank" rel="noopener" href="' + esc(site) + '">Site</a>' : '') +
      '<button type="button" class="btn cyan" id="bEmail">E-mail</button>' +
      '<a class="btn claro" target="_blank" rel="noopener" href="' + maps + '">Mapa</a>' +
      '</div><button class="fechar" aria-label="Fechar">×</button></header>' +

      '<section id="sEmail" hidden><h3>Enviar e-mail</h3>' +
      (st.usuario && st.usuario.email
        ? '<label for="mModelo">Modelo</label><select id="mModelo">' + opcoes(MODELOS.filter(function (m) { return m[0] !== 'vetfriday' || hoje() <= VET_FRIDAY_ATE; }).map(function (m) { return [m[0], m[1]]; }), l.tentativas ? 'retorno' : (hoje() <= VET_FRIDAY_ATE ? 'vetfriday' : 'primeiro')) + '</select>' +
          '<label for="mPara">Para</label><input type="text" id="mPara" inputmode="email" value="' + esc(l.email || '') + '" placeholder="email@clinica.com.br">' +
          '<label for="mAssunto">Assunto</label><input type="text" id="mAssunto">' +
          '<label for="mTexto">Mensagem</label><textarea id="mTexto" style="min-height:300px"></textarea>' +
          '<div class="duas"><div><label for="mPasso">Próximo passo</label><input type="text" id="mPasso" value="' + esc(l.proximo_passo || '') + '" placeholder="Ex.: ligar para ver se leu"></div>' +
          '<div><label for="mData">Quando</label><input type="date" id="mData" value="' + esc(l.proximo_em || '') + '"></div></div>' +
          '<p class="sub" style="margin:10px 0 0">Sai como ' + esc(st.usuario.email_nome) + ' &lt;' + esc(st.usuario.email) + '&gt;. As respostas da clínica chegam na caixa comercial.</p>' +
          '<button class="btn cheio" id="bEnviar">Enviar e-mail</button><div class="erro" id="mErro"></div>'
        : '<p class="sub">Seu usuário ainda não tem e-mail de envio. Peça para o Rodrigo cadastrar.</p>') +
      '</section>' +

      '<section><h3>Registrar tentativa</h3>' +
      '<div class="canais" id="canais">' + CANAIS.map(function (c) { return '<button type="button" data-c="' + c[0] + '" class="' + (c[0] === canal ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div>' +
      '<label for="iRes">Como foi</label><select id="iRes">' + opcoes(RESULTADOS, 'nao_atendeu') + '</select>' +
      '<label for="iNota">Anotação</label><textarea id="iNota" placeholder="Com quem falou, o que disseram, objeções…"></textarea>' +
      '<div class="duas"><div><label for="iPasso">Próximo passo</label><input type="text" id="iPasso" placeholder="Ex.: ligar de novo, mandar proposta" value="' + esc(l.proximo_passo || '') + '"></div>' +
      '<div><label for="iData">Quando</label><input type="date" id="iData" value="' + esc(l.proximo_em || '') + '"></div></div>' +
      '<label for="iStatus">Status depois da tentativa</label><select id="iStatus">' + opcoes(STATUS, '', 'Automático pelo resultado') + '</select>' +
      '<button class="btn cheio" id="bReg">Registrar</button><div class="erro" id="iErro"></div></section>' +

      '<section><h3>Situação</h3>' +
      '<div class="duas"><div><label for="eStatus">Status</label><select id="eStatus">' + opcoes(STATUS, l.status) + '</select></div>' +
      '<div><label for="eContato">Falou com</label><input type="text" id="eContato" value="' + esc(l.contato || '') + '" placeholder="Nome e cargo"></div></div>' +
      '<div class="duas"><div><label for="eFaixa">Faixa (se fechou)</label><select id="eFaixa">' + opcoes(FAIXAS.map(function (x) { return [x[0], x[1]]; }), l.faixa, 'Escolha') + '</select></div>' +
      '<div><label for="eCiclo">Plano</label><select id="eCiclo">' + opcoes([['mensal', 'Mensal'], ['anual', 'Anual']], l.ciclo, 'Escolha') + '</select></div></div>' +
      '<label for="eValor">Valor fechado (R$)</label><input type="number" step="0.01" min="0" id="eValor" value="' + (l.valor != null ? esc(l.valor) : '') + '">' +
      '<label for="eObs">Observação</label><textarea id="eObs">' + esc(l.observacao || '') + '</textarea>' +
      '<div class="duas"><div><label for="eTel">Telefone</label><input type="text" id="eTel" value="' + esc(l.telefone || '') + '"></div>' +
      '<div><label for="eEmail">E-mail</label><input type="text" id="eEmail" value="' + esc(l.email || '') + '"></div></div>' +
      '<label class="chk" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="eCel"' + (l.celular ? ' checked' : '') + '> O telefone é celular (tem WhatsApp)</label>' +
      '<button class="btn cheio claro" id="bSalvar">Salvar alterações</button><div class="erro" id="eErro"></div></section>' +

      '<section><h3>Histórico (' + hist.length + ')</h3>' +
      (hist.length ? '<ul class="hist">' + hist.map(function (h) {
        return '<li><div class="q">' + quando(h.created_at) + ' · ' + esc(rotulo(CANAIS, h.canal)) + ' · ' + esc(h.usuario ? h.usuario.nome : h.email_direcao === 'recebido' ? 'Resposta da clínica' : 'Importado da planilha') + '</div>' +
          '<div class="r">' + esc(rotulo(RESULTADOS, h.resultado)) + (h.status_depois ? ' → ' + esc(rotulo(STATUS, h.status_depois)) : '') + '</div>' +
          (h.email_assunto
            ? '<details class="mail"><summary>' + (h.email_direcao === 'recebido' ? 'Resposta de ' : 'Para ') + esc(h.email_para || '') + ' · ' + esc(h.email_assunto) + '</summary><div class="corpo">' + esc(h.nota || '') + '</div></details>'
            : (h.nota ? '<div>' + esc(h.nota) + '</div>' : '')) + '</li>';
      }).join('') + '</ul>' : '<p class="sub">Nenhuma tentativa ainda.</p>') + '</section>' +

      '<section><h3>Dados da clínica</h3><dl class="dados">' +
      '<dt>Prioridade</dt><dd>' + esc(l.prioridade || '') + '</dd>' +
      '<dt>Endereço</dt><dd>' + esc(l.endereco || '') + '</dd>' +
      '<dt>Rede</dt><dd>' + esc(l.rede || 'Independente') + '</dd>' +
      '<dt>Site</dt><dd>' + esc(l.site || '') + '</dd>' +
      '<dt>Instagram</dt><dd>' + esc(l.instagram || '') + '</dd>' +
      '</dl></section></aside>';
    ligarFechar();

    camada.querySelectorAll('#canais button').forEach(function (b) {
      b.onclick = function () {
        canal = b.dataset.c;
        camada.querySelectorAll('#canais button').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (canal === 'whatsapp' || canal === 'email') document.getElementById('iRes').value = 'enviado';
      };
    });

    var sEmail = document.getElementById('sEmail');
    document.getElementById('bEmail').onclick = function () {
      sEmail.hidden = !sEmail.hidden;
      if (!sEmail.hidden) sEmail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    var mModelo = document.getElementById('mModelo');
    if (mModelo) {
      var mAssunto = document.getElementById('mAssunto'), mTexto = document.getElementById('mTexto'), mexeu = false;
      var aplicar = function () { var p = preencherModelo(mModelo.value, l); mAssunto.value = p.assunto; mTexto.value = p.texto; mexeu = false; };
      aplicar();
      mTexto.oninput = mAssunto.oninput = function () { mexeu = true; };
      var anterior = mModelo.value;
      mModelo.onchange = function () {
        if (mexeu && !confirm('Trocar o modelo apaga o que você escreveu. Continuar?')) { mModelo.value = anterior; return; }
        anterior = mModelo.value; aplicar();
      };
      document.getElementById('bEnviar').onclick = function (e) {
        var b = e.target, erro = document.getElementById('mErro');
        var body = {
          para: document.getElementById('mPara').value.trim(),
          assunto: mAssunto.value.trim(),
          texto: mTexto.value.trim(),
          proximo_passo: document.getElementById('mPasso').value.trim() || null,
          proximo_em: document.getElementById('mData').value || null,
        };
        if (!body.para || !body.assunto || !body.texto) { erro.textContent = 'Preencha para quem, o assunto e a mensagem.'; return; }
        if (!confirm('Enviar este e-mail para ' + body.para + '?')) return;
        b.disabled = true; b.textContent = 'Enviando…'; erro.textContent = '';
        api('/crm-zelus/leads/' + l.id + '/email', { method: 'POST', body: body })
          .then(function (r) { atualizarLocal(r.lead); refrescarFundo(); desenharFicha(r.lead, r.interacoes); })
          .catch(function (err) { b.disabled = false; b.textContent = 'Enviar e-mail'; erro.textContent = err.message; });
      };
    }

    var faixa = document.getElementById('eFaixa'), ciclo = document.getElementById('eCiclo'), valor = document.getElementById('eValor');
    var sugerir = function () { var v = valorFaixa(faixa.value, ciclo.value); if (v != null) valor.value = v; };
    faixa.onchange = sugerir; ciclo.onchange = sugerir;

    document.getElementById('bReg').onclick = function (e) {
      var b = e.target; b.disabled = true;
      var body = {
        canal: canal,
        resultado: document.getElementById('iRes').value,
        nota: document.getElementById('iNota').value,
        proximo_passo: document.getElementById('iPasso').value.trim() || null,
        proximo_em: document.getElementById('iData').value || null,
      };
      var s = document.getElementById('iStatus').value;
      if (s) body.status = s;
      api('/crm-zelus/leads/' + l.id + '/interacoes', { method: 'POST', body: body })
        .then(function (r) { atualizarLocal(r.lead); refrescarFundo(); desenharFicha(r.lead, r.interacoes); })
        .catch(function (err) { b.disabled = false; document.getElementById('iErro').textContent = err.message; });
    };

    document.getElementById('bSalvar').onclick = function (e) {
      var b = e.target; b.disabled = true;
      var v = valor.value;
      var body = {
        status: document.getElementById('eStatus').value,
        contato: document.getElementById('eContato').value.trim() || null,
        faixa: faixa.value || null,
        ciclo: ciclo.value || null,
        valor: v === '' ? null : Number(v),
        observacao: document.getElementById('eObs').value.trim() || null,
        telefone: document.getElementById('eTel').value.trim() || null,
        email: document.getElementById('eEmail').value.trim() || null,
        celular: document.getElementById('eCel').checked,
      };
      api('/crm-zelus/leads/' + l.id, { method: 'PATCH', body: body })
        .then(function (lead) {
          atualizarLocal(lead); refrescarFundo();
          b.disabled = false; b.textContent = 'Salvo ✓';
          setTimeout(function () { b.textContent = 'Salvar alterações'; }, 1800);
        })
        .catch(function (err) { b.disabled = false; document.getElementById('eErro').textContent = err.message; });
    };
  }

  /** Atualiza a lista atrás da ficha sem fechar a ficha. */
  function refrescarFundo() {
    var ab = st.aberto;
    if (st.aba === 'retornos') retornos(); else if (st.aba === 'contatos') atualizarListaOuTudo();
    var b = app.querySelector('[data-aba="retornos"]');
    if (b) { var n = retornosPendentes(); b.innerHTML = 'Retornos' + (n ? '<span class="badge">' + n + '</span>' : ''); }
    st.aberto = ab;
  }
  function atualizarListaOuTudo() { if (document.querySelector('.lista')) atualizarLista(); }

  function novaClinica() {
    var camada = document.getElementById('camada');
    camada.innerHTML = '<div class="fundo"></div><aside class="ficha"><header><h2>Nova clínica</h2><button class="fechar" aria-label="Fechar">×</button></header>' +
      '<section><label for="nNome">Nome</label><input type="text" id="nNome">' +
      '<div class="duas"><div><label for="nTel">Telefone</label><input type="text" id="nTel"></div><div><label for="nEmail">E-mail</label><input type="text" id="nEmail"></div></div>' +
      '<label class="chk" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="nCel"> Celular (tem WhatsApp)</label>' +
      '<div class="duas"><div><label for="nBairro">Bairro</label><input type="text" id="nBairro"></div><div><label for="nCidade">Cidade</label><input type="text" id="nCidade" value="São Paulo"></div></div>' +
      '<label for="nInsta">Instagram</label><input type="text" id="nInsta">' +
      '<label for="nObs">Observação</label><textarea id="nObs" placeholder="Como chegou: indicação, evento…"></textarea>' +
      '<button class="btn cheio" id="bCriar">Incluir</button><div class="erro" id="nErro"></div></section></aside>';
    ligarFechar();
    document.getElementById('bCriar').onclick = function (e) {
      var b = e.target; b.disabled = true;
      var val = function (id) { return document.getElementById(id).value.trim() || undefined; };
      api('/crm-zelus/leads', { method: 'POST', body: { nome: val('nNome') || '', telefone: val('nTel'), email: val('nEmail'), celular: document.getElementById('nCel').checked, bairro: val('nBairro'), cidade: val('nCidade'), instagram: val('nInsta'), observacao: val('nObs') } })
        .then(function (lead) { atualizarLocal(lead); contatos(); abrirFicha(lead.id); })
        .catch(function (err) { b.disabled = false; document.getElementById('nErro').textContent = err.message; });
    };
  }

  // ── painel do administrador ────────────────────────────────────────────
  function painel() {
    var c = document.getElementById('conteudo');
    c.innerHTML = '<div class="carregando">Montando o painel…</div>';
    api('/crm-zelus/painel').then(function (r) {
      st.leads = r.leads;
      var dias = st.painelDias;
      var desde = Date.now() - dias * 86400000;
      var todas = r.interacoes.filter(function (i) { return new Date(i.created_at).getTime() >= desde; });
      var ints = todas.filter(function (i) { return i.usuario; });
      var respostas = todas.filter(function (i) { return i.resultado === 'respondeu'; }).length;
      var clinicas = {};
      ints.forEach(function (i) { if (i.lead) clinicas[i.lead.id] = 1; });
      var conta = function (st_) { return st.leads.filter(function (l) { return l.status === st_; }).length; };
      var fechados = st.leads.filter(function (l) { return l.status === 'fechou'; });
      var mrr = fechados.reduce(function (s, l) { var v = Number(l.valor || 0); return s + (l.ciclo === 'anual' ? v / 12 : v); }, 0);
      var conversas = ints.filter(function (i) { return ['conversou', 'interessado', 'pediu_retorno', 'demo_marcada', 'em_teste', 'fechou', 'sem_interesse'].indexOf(i.resultado) >= 0; }).length;

      // tentativas por dia (14 dias)
      var porDia = [];
      for (var d = 13; d >= 0; d--) {
        var dia = new Date(Date.now() - 3 * 3600000 - d * 86400000).toISOString().slice(0, 10);
        porDia.push([dia, 0]);
      }
      ints.forEach(function (i) {
        var dia = new Date(new Date(i.created_at).getTime() - 3 * 3600000).toISOString().slice(0, 10);
        porDia.forEach(function (p) { if (p[0] === dia) p[1]++; });
      });
      var max = Math.max.apply(null, porDia.map(function (p) { return p[1]; }).concat([1]));

      // por pessoa
      var pessoas = {};
      ints.forEach(function (i) {
        var n = i.usuario.nome;
        var p = pessoas[n] = pessoas[n] || { t: 0, conv: 0, demo: 0, fech: 0, ult: '' };
        p.t++;
        if (['conversou', 'interessado', 'pediu_retorno'].indexOf(i.resultado) >= 0) p.conv++;
        if (i.resultado === 'demo_marcada') p.demo++;
        if (i.resultado === 'fechou') p.fech++;
        if (!p.ult || i.created_at > p.ult) p.ult = i.created_at;
      });

      // resultados
      var res = {};
      ints.forEach(function (i) { res[i.resultado] = (res[i.resultado] || 0) + 1; });

      var funil = STATUS.map(function (s) { return [s[1], conta(s[0])]; });
      var maxF = Math.max.apply(null, funil.map(function (f) { return f[1]; }).concat([1]));

      c.innerHTML =
        '<div class="resumo">' + [7, 30, 90].map(function (n) { return '<button data-d="' + n + '" class="' + (n === dias ? 'on' : '') + '">Últimos ' + n + ' dias</button>'; }).join('') + '</div>' +
        '<div class="kpis">' +
        kpi(ints.length, 'tentativas no período') +
        kpi(Object.keys(clinicas).length, 'clínicas trabalhadas') +
        kpi(conversas, 'conversas') +
        kpi(respostas, 'respostas por e-mail') +
        kpi(conta('demo_marcada'), 'demonstrações marcadas') +
        kpi(conta('em_teste'), 'em teste') +
        kpi(fechados.length, 'fecharam') +
        kpi(brl(mrr), 'receita mensal fechada') +
        '</div>' +
        '<div class="cards"><div>' +
        '<div class="card"><h3>Tentativas por dia (14 dias)</h3><div class="barras">' + porDia.map(function (p) {
          return '<div><em>' + (p[1] || '') + '</em><i style="height:' + Math.round(p[1] / max * 100) + '%"></i><small>' + dataBr(p[0]) + '</small></div>';
        }).join('') + '</div></div>' +
        '<div class="card"><h3>Por pessoa</h3><table class="tab"><thead><tr><th>Quem</th><th>Tentativas</th><th>Conversas</th><th>Demos</th><th>Fechou</th><th>Última</th></tr></thead><tbody>' +
        (Object.keys(pessoas).length ? Object.keys(pessoas).map(function (n) {
          var p = pessoas[n];
          return '<tr><td>' + esc(n) + '</td><td>' + p.t + '</td><td>' + p.conv + '</td><td>' + p.demo + '</td><td>' + p.fech + '</td><td>' + quando(p.ult) + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="sub">Nenhuma tentativa no período.</td></tr>') + '</tbody></table></div>' +
        '<div class="card"><h3>Como foram as tentativas</h3><table class="tab"><tbody>' +
        (Object.keys(res).length ? Object.keys(res).sort(function (a, b) { return res[b] - res[a]; }).map(function (k) { return '<tr><td>' + esc(rotulo(RESULTADOS, k)) + '</td><td>' + res[k] + '</td></tr>'; }).join('') : '<tr><td class="sub">Nada ainda.</td></tr>') +
        '</tbody></table></div>' +
        '<div class="card"><h3>Funil (todas as clínicas)</h3><div class="funil">' + funil.map(function (f) {
          return '<div><span>' + esc(f[0]) + '</span><i style="width:' + Math.max(2, Math.round(f[1] / maxF * 100)) + '%"></i><b>' + f[1] + '</b></div>';
        }).join('') + '</div></div>' +
        '</div><div>' +
        '<div class="card"><h3>Últimas atividades</h3><ul class="feed">' + (todas.length ? todas.slice(0, 80).map(function (i) {
          return '<li><div class="sub">' + quando(i.created_at) + ' · ' + esc(i.usuario ? i.usuario.nome : 'Clínica') + ' · ' + esc(rotulo(CANAIS, i.canal)) + '</div>' +
            (i.lead ? '<a data-id="' + esc(i.lead.id) + '">' + esc(i.lead.nome) + '</a> ' : '') + '<span>' + esc(rotulo(RESULTADOS, i.resultado)) + '</span>' +
            (i.email_assunto ? '<div>E-mail: ' + esc(i.email_assunto) + '</div>' : (i.nota ? '<div>' + esc(i.nota) + '</div>' : '')) + '</li>';
        }).join('') : '<li class="sub">Nenhuma atividade no período.</li>') + '</ul></div>' +
        (fechados.length ? '<div class="card"><h3>Fechamentos</h3><table class="tab"><tbody>' + fechados.map(function (l) {
          return '<tr><td><a data-id="' + esc(l.id) + '" style="cursor:pointer;font-weight:700">' + esc(l.nome) + '</a></td><td>' + esc(rotulo(FAIXAS.map(function (x) { return [x[0], x[1]]; }), l.faixa)) + ' · ' + esc(l.ciclo || '') + '</td><td>' + (l.valor != null ? brl(l.valor) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '') +
        '</div></div>';
      c.querySelectorAll('[data-d]').forEach(function (b) { b.onclick = function () { st.painelDias = Number(b.dataset.d); painel(); }; });
      c.querySelectorAll('a[data-id]').forEach(function (a) { a.onclick = function () { abrirFicha(a.dataset.id); }; });
    }).catch(function (err) { c.innerHTML = '<div class="carregando">' + esc(err.message) + '</div>'; });
  }
  function kpi(v, t) { return '<div class="kpi"><b>' + esc(v) + '</b><span>' + esc(t) + '</span></div>'; }

  // ── início ─────────────────────────────────────────────────────────────
  if (st.token) carregar(); else telaLogin();
})();
