(function () {
  var choices = document.querySelectorAll('.site-shell-language [data-set-lang]');
  if (!choices.length) return;
  var pageRoot = document.querySelector('body.legacy > [data-lang]') || document.documentElement;
  var html = document.documentElement;

  function setLanguage(language) {
    var selected = ['pt', 'en', 'es'].indexOf(language) >= 0 ? language : 'pt';
    pageRoot.dataset.lang = selected;
    html.dataset.lang = selected;
    html.lang = selected === 'pt' ? 'pt-BR' : selected;
    choices.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.setLang === selected));
    });
    document.querySelectorAll('[data-label-pt]').forEach(function (element) {
      element.textContent = element.getAttribute('data-label-' + selected) || element.getAttribute('data-label-pt');
    });
    try { localStorage.setItem('fl_lang', selected); } catch (error) { /* Storage may be unavailable. */ }
    var interest = document.getElementById('f_interesse');
    if (interest) interest.dispatchEvent(new Event('change'));
  }

  var initial = pageRoot.dataset.lang || 'pt';
  try { initial = localStorage.getItem('fl_lang') || initial; } catch (error) { /* Use page default. */ }
  setLanguage(initial);
  choices.forEach(function (button) {
    button.addEventListener('click', function () { setLanguage(button.dataset.setLang); });
  });
})();
