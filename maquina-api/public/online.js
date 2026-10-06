// Avisa o servidor, a cada 30 s, que esta página está aberta e visível (alimenta o
// "Online agora" do admin). Não envia nenhum dado pessoal: só o nome da página.
(function () {
  var tag = document.currentScript;
  var page = tag && tag.getAttribute('data-page');
  if (!page) return;
  function ping() {
    if (document.visibilityState !== 'visible') return;
    try {
      fetch('/t/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: page }),
        credentials: 'same-origin',
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }
  ping();
  setInterval(ping, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') ping();
  });
})();
