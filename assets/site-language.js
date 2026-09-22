(function () {
  var root = document.documentElement;
  var button = document.getElementById('lang');

  function setLanguage(language) {
    var selected = language === 'en' ? 'en' : 'pt';
    root.dataset.lang = selected;
    root.lang = selected === 'en' ? 'en' : 'pt-BR';
    if (button) button.textContent = selected === 'en' ? 'PT' : 'EN';
    try { localStorage.setItem('fl_lang', selected); } catch (error) { /* Storage can be unavailable. */ }
  }

  var saved = 'pt';
  try { saved = localStorage.getItem('fl_lang') || 'pt'; } catch (error) { /* Keep the page default. */ }
  setLanguage(saved);

  if (button) button.addEventListener('click', function () {
    setLanguage(root.dataset.lang === 'pt' ? 'en' : 'pt');
  });

  document.querySelectorAll('.site-nav a').forEach(function (link) {
    link.addEventListener('click', function () {
      var menu = document.getElementById('menu');
      if (menu) menu.checked = false;
    });
  });
})();
