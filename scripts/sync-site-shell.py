"""Keep the static site's header and footer identical across public pages."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
CSS_VERSION = "20260923b"
PAGES = {
    "index.html": (None, "contato.html"),
    "zelus.html": ("zelus.html", "contato.html?interesse=Zelus"),
    "zelus-health.html": ("zelus-section", "contato.html?interesse=Zelus%20Health"),
    "zelus-pet.html": ("zelus-section", "contato.html?interesse=Zelus%20Pet"),
    "edi-vita.html": ("edi-vita.html", "contato.html?interesse=EDI%20VITA"),
    "sistemas.html": ("sistemas.html", "contato.html"),
    "anchora.html": ("products-section", "contato.html?interesse=Anchora"),
    "themis.html": ("products-section", "contato.html?interesse=Themis"),
    "famulus.html": ("products-section", "contato.html?interesse=Famulus"),
    "sobre.html": ("sobre.html", "contato.html"),
    "research.html": (None, "contato.html"),
    "servicos.html": (None, "contato.html"),
    "contato.html": ("contato.html", "contato.html"),
}

LOGO = ('FIND<span class="finder-e" aria-hidden="true">'
        '<i></i><i></i><i></i></span>R<span class="finder-lab">LAB</span>')


def bilingual(pt, en):
    return f'<span class="t-pt">{pt}</span><span class="t-en">{en}</span>'


def nav_link(href, label, current):
    marker = (' aria-current="page"' if current == href else
              ' data-section-current="true"' if
              (current == "zelus-section" and href == "zelus.html") or
              (current == "products-section" and href == "sistemas.html") else '')
    return f'<a href="{href}"{marker}>{label}</a>'


def header(current, contact_href, editorial):
    links = [
        nav_link("zelus.html", "Zelus", current),
        nav_link("edi-vita.html", "EDI VITA", current),
        nav_link("sistemas.html", bilingual("Produtos", "Products"), current),
        nav_link("sobre.html", bilingual("A Finder", "About Finder"), current),
    ]
    language_action = '' if editorial else ' onclick="toggleLang()"'
    contact_current = ' aria-current="page"' if current == "contato.html" else ''
    return f'''<header class="site-head site-shell-head">
  <div class="site-shell-wrap site-shell-row">
    <a class="logo" translate="no" href="index.html" aria-label="Finder Lab, início">{LOGO}</a>
    <input class="site-shell-toggle" id="menu" type="checkbox" aria-label="Abrir menu de navegação">
    <label class="site-shell-menu-button" for="menu"><span class="site-shell-visually-hidden">Menu</span></label>
    <nav class="site-shell-nav site-nav" aria-label="Principal" id="primary-navigation">
      {''.join(links)}
      <button class="lang-button" id="lang" type="button"{language_action} aria-label="Alternar idioma / Switch language"><span class="langlabel">EN</span></button>
      <a class="site-shell-contact-button" href="{contact_href}"{contact_current}>{bilingual("Contato", "Contact")}</a>
    </nav>
  </div>
</header>'''


def footer():
    return f'''<footer class="site-shell-footer">
  <div class="site-shell-wrap">
    <div class="site-shell-footer-grid">
      <div class="site-shell-footer-brand">
        <a class="logo" translate="no" href="index.html" aria-label="Finder Lab, início">{LOGO}</a>
        <p class="site-shell-overline">Agentic Architecture Product House</p>
        <p>{bilingual("Tecnologia aplicada a problemas reais. Pesquisa, arquitetura e produtos feitos para funcionar no dia a dia.", "Technology applied to real problems. Research, architecture and products built for everyday use.")}</p>
      </div>
      <nav aria-label="Navegação do rodapé">
        <h2>{bilingual("Navegação", "Navigation")}</h2>
        <a href="sobre.html">{bilingual("A Finder", "About Finder")}</a>
        <a href="research.html">Research</a>
        <a href="servicos.html">{bilingual("Capacidades", "Capabilities")}</a>
        <a href="sistemas.html">{bilingual("Todos os produtos", "All products")}</a>
      </nav>
      <nav aria-label="Produtos Finder Lab">
        <h2>{bilingual("Produtos", "Products")}</h2>
        <a href="zelus-health.html">Zelus Health</a>
        <a href="zelus-pet.html">Zelus Pet</a>
        <a href="zelus.html">{bilingual("Ecossistema Zelus", "Zelus ecosystem")}</a>
        <a href="edi-vita.html">EDI VITA</a>
        <a href="anchora.html">Anchora</a>
        <a href="themis.html">Themis</a>
        <a href="famulus.html">Famulus</a>
      </nav>
      <div class="site-shell-footer-contact">
        <h2>{bilingual("Contato", "Contact")}</h2>
        <address>
          <a href="mailto:contato@finderlab.com.br">contato@finderlab.com.br</a>
          <a href="https://wa.me/551131643783" target="_blank" rel="noopener noreferrer">WhatsApp · +55 11 3164-3783 ↗</a>
          <a href="https://www.linkedin.com/company/finderlab/" target="_blank" rel="noopener noreferrer">LinkedIn · Finder Lab ↗</a>
        </address>
        <a class="site-shell-footer-cta" href="contato.html">{bilingual("Falar com a Finder", "Talk to Finder")} ↗</a>
      </div>
    </div>
    <div class="site-shell-footer-bottom">
      <span>© 2026 Finder Lab · Agentic Architecture Product House</span>
      <a href="index.html">{bilingual("Voltar ao início", "Back to home")} ↑</a>
    </div>
  </div>
</footer>'''


for name, (current, contact_href) in PAGES.items():
    path = ROOT / name
    source = path.read_text()
    editorial = 'class="editorial' in source
    source, header_count = re.subn(r'<header\b[^>]*>.*?</header>', header(current, contact_href, editorial), source, count=1, flags=re.S)
    source, footer_count = re.subn(r'<footer\b[^>]*>.*?</footer>', footer(), source, count=1, flags=re.S)
    if header_count != 1 or footer_count != 1:
        raise RuntimeError(f'{name}: expected one header and footer')
    stylesheet = f'assets/site-shell.css?v={CSS_VERSION}'
    if 'assets/site-shell.css' not in source:
        source = source.replace('</head>', f'<link rel="stylesheet" href="{stylesheet}">\n</head>', 1)
    else:
        source = re.sub(r'assets/site-shell\.css(?:\?v=[^"\']+)?', stylesheet, source)
    path.write_text(source)
    print(name)
