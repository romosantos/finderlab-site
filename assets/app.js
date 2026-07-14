
(function(){
  var saved = localStorage.getItem('fl_lang') || 'pt';
  document.documentElement.setAttribute('data-lang', saved);
  function apply(){
    var lang = document.documentElement.getAttribute('data-lang');
    document.querySelectorAll('.langtoggle').forEach(function(b){ b.textContent = (lang==='pt'?'EN':'PT'); });
    document.documentElement.setAttribute('lang', lang==='pt'?'pt-BR':'en');
  }
  document.addEventListener('click', function(e){
    if(e.target.classList && e.target.classList.contains('langtoggle')){
      var cur=document.documentElement.getAttribute('data-lang');
      var nl=cur==='pt'?'en':'pt';
      document.documentElement.setAttribute('data-lang',nl);
      localStorage.setItem('fl_lang',nl); apply();
    }
    if(e.target.classList && e.target.classList.contains('burger')){
      document.querySelector('.menu').classList.toggle('open');
    }
  });
  apply();
  var CW={pt:['sistema','método','evidência','resultado'],en:['systems','method','evidence','results']};
  var cwel=document.getElementById('changing-word'), cwi=0;
  function cwLang(){return document.documentElement.getAttribute('data-lang')||'pt';}
  if(cwel){ cwel.textContent=CW[cwLang()][0];
    setInterval(function(){ var arr=CW[cwLang()]||CW.pt; cwi=(cwi+1)%arr.length; cwel.style.opacity=0;
      setTimeout(function(){ cwel.textContent=arr[cwi]; cwel.style.opacity=1; },230); },2600); }
  var form=document.getElementById('contact-form');
  if(form){form.addEventListener('submit',function(e){
    e.preventDefault();
    if(!form.reportValidity()) return;
    var data=new FormData(form), lang=document.documentElement.getAttribute('data-lang')||'pt';
    var subject=lang==='pt'?'Nova conversa — Finder Lab':'New conversation — Finder Lab';
    var body=(lang==='pt'?'Nome: ':'Name: ')+data.get('nome')+'\n'+(lang==='pt'?'E-mail: ':'Email: ')+data.get('email')+'\n'+(lang==='pt'?'Empresa: ':'Company: ')+(data.get('empresa')||'—')+'\n\n'+(lang==='pt'?'Contexto: ':'Context: ')+'\n'+data.get('mensagem');
    window.location.href='mailto:contato@finderlab.com.br?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
  });}
})();

/* scroll reveal (conceito) */
(function(){
  if(!('IntersectionObserver' in window))return;
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.08,rootMargin:'0px 0px -6% 0px'});
  document.querySelectorAll('section .wrap, .gains .wrap').forEach(function(el){
    var r=el.getBoundingClientRect();
    if(r.top >= (window.innerHeight||800)*0.82){ el.classList.add('reveal'); io.observe(el); }
  });
})();
