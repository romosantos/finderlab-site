# SEO do site Finder Lab

Gera, de forma repetível, tudo o que faz o site ser encontrado por buscadores e por IAs.

## O que o script faz
- **Pré-renderiza** o conteúdo de cada página dentro do HTML (`#seo-static`). Quem não executa JavaScript (robôs de IA, previews) lê o texto completo; no navegador, o React assume e remove a cópia estática sem mudar o visual.
- Escreve `title`, `description`, canonical, Open Graph, Twitter Card e **JSON-LD** (Organization, WebSite, WebPage, BreadcrumbList, SoftwareApplication e FAQPage na Home).
- Corrige links placeholder do rodapé, adiciona largura/altura e `loading="lazy"` às imagens.
- Gera `sitemap.xml`, `robots.txt` e a chave IndexNow.

## Como rodar (depois de exportar páginas novas do canvas para a raiz do site)
1. Requisitos: Python 3, `pip install playwright pillow`, `playwright install chromium`, e `npm i @fontsource/sora` (só para as imagens sociais).
2. Se criou uma página nova, adicione-a em `pages.py` (título, descrição, nome, categoria).
3. `cd scripts/seo && python3 og.py ../..` (gera as imagens sociais em `assets/seo/`)
4. `python3 build_seo.py ../..` (reescreve as páginas; é idempotente, pode rodar de novo)
5. Conferir no navegador e `git add` das páginas, `sitemap.xml`, `robots.txt`, `assets/seo/`.

`llms.txt` e `404.html` ficam na raiz do site; edite-os quando mudar o catálogo de produtos.
