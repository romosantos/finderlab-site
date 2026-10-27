#!/usr/bin/env python3
"""Gera SEO estático do site Finder Lab (idempotente).
Uso: python3 build_seo.py <pasta-do-site>
Faz: corrige links placeholder, adiciona dimensões/lazy às imagens, pré-renderiza o conteúdo de cada
página (Playwright) dentro do HTML, escreve metadados + JSON-LD, e gera sitemap.xml, robots.txt,
llms.txt, 404.html e a chave IndexNow."""
import re, os, sys, json, html as H, asyncio, subprocess, time, datetime, hashlib
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pages import *
from playwright.async_api import async_playwright

ROOT = os.path.abspath(sys.argv[1]); PORT = 8799
TODAY = datetime.date.today().isoformat()
esc = lambda s: H.escape(s, quote=True)

def clean(s):
    for k in ('head', 'static', 'script'):
        s = re.sub(r'<!--seo:%s-->[\s\S]*?<!--/seo:%s-->\n?' % (k, k), '', s)
    # remove title/description/canonical/og/robots antigos do <head> (antes do <body>)
    i = s.index('<body'); head, rest = s[:i], s[i:]
    head = re.sub(r'<title>[\s\S]*?</title>\s*', '', head)
    head = re.sub(r'<meta\s+(?:name="(?:description|robots)"|property="og:[^"]*")[^>]*>\s*', '', head)
    head = re.sub(r'<link\s+rel="canonical"[^>]*>\s*', '', head)
    return head + rest

def fix_links(s):
    s = s.replace('href="[INSTAGRAM]"', 'href="%s"' % INSTAGRAM).replace('href="[LINKEDIN]"', 'href="%s"' % LINKEDIN)
    s = s.replace('rel="noopener" style="width:44px', 'rel="noopener me" style="width:44px') if False else s
    return s

def fix_imgs(s):
    n = [0]
    def f(m):
        tag = m.group(0); n[0] += 1
        src = re.search(r'\ssrc="(/assets/site/[^"{}]+)"', tag)
        if not src: return tag
        add = ''
        style = re.search(r'\sstyle="([^"]*)"', tag)
        if not re.search(r'\swidth="', tag) and style and 'height' in style.group(1):
            try:
                w, h = Image.open(ROOT + src.group(1)).size; add += ' width="%d" height="%d"' % (w, h)
            except Exception: pass
        if 'decoding=' not in tag: add += ' decoding="async"'
        if 'loading=' not in tag and n[0] > 2: add += ' loading="lazy"'
        return tag[:-1].rstrip('/').rstrip() + add + '>' if add else tag
    # só dentro de <body> e fora de <script>
    i = s.index('<body'); body = s[i:]
    parts = re.split(r'(<script[\s\S]*?</script>)', body)
    for k in range(0, len(parts), 2): parts[k] = re.sub(r'<img\b[^>]*>', f, parts[k])
    return s[:i] + ''.join(parts)

def helmet_assets(s):
    h = re.search(r'<helmet>([\s\S]*?)</helmet>', s)
    if not h: return ''
    h = h.group(1); out = []
    for m in re.finditer(r'<link\b[^>]*>|<style\b[\s\S]*?</style>', h):
        t = m.group(0)
        if 'rel="icon"' in t or 'data:image' in t: continue
        out.append(t)
    return '\n'.join(out)

def jsonld(p, faq):
    org = {"@type": "Organization", "@id": SITE + "/#organization", "name": "Finder Lab",
           "legalName": "Finder Consultoria em TI Ltda", "taxID": "53.291.349/0001-96", "url": SITE + "/",
           "logo": {"@type": "ImageObject", "url": SITE + "/assets/seo/logo-512.png", "width": 512, "height": 512},
           "description": "Applied Intelligence Lab: pesquisa que vira sistema, para decisões e operações que não podem esperar. A Finder Lab constrói agentes de IA e sistemas para a operação de empresas.",
           "sameAs": [LINKEDIN, INSTAGRAM], "email": EMAIL,
           "founder": {"@type": "Person", "name": "Rodrigo Moraes"},
           "contactPoint": [{"@type": "ContactPoint", "contactType": "sales", "telephone": PHONE, "email": EMAIL,
                             "areaServed": "BR", "availableLanguage": "pt-BR"}]}
    site = {"@type": "WebSite", "@id": SITE + "/#website", "url": SITE + "/", "name": "Finder Lab",
            "inLanguage": "pt-BR", "publisher": {"@id": SITE + "/#organization"}}
    page = {"@type": "WebPage", "@id": p['url'] + "#webpage", "url": p['url'], "name": p['title'],
            "description": p['desc'], "inLanguage": "pt-BR", "isPartOf": {"@id": SITE + "/#website"},
            "about": {"@id": SITE + "/#organization"}, "dateModified": TODAY,
            "primaryImageOfPage": {"@type": "ImageObject", "url": SITE + p['og'], "width": 1200, "height": 630},
            "breadcrumb": {"@id": p['url'] + "#breadcrumb"}}
    crumbs = [{"@type": "ListItem", "position": 1, "name": "Finder Lab", "item": SITE + "/"}]
    if p['type'] == 'product':
        crumbs.append({"@type": "ListItem", "position": 2, "name": p['name'], "item": p['url']})
    bc = {"@type": "BreadcrumbList", "@id": p['url'] + "#breadcrumb", "itemListElement": crumbs}
    g = [org, site, page, bc]
    if p['type'] == 'product':
        g.append({"@type": "SoftwareApplication", "@id": p['url'] + "#software", "name": p['name'],
                  "description": p['desc'], "url": p['url'], "applicationCategory": p['cat'],
                  "operatingSystem": "Web", "inLanguage": "pt-BR", "image": SITE + p['og'],
                  "provider": {"@id": SITE + "/#organization"}})
        page["mainEntity"] = {"@id": p['url'] + "#software"}
    if faq:
        g.append({"@type": "FAQPage", "@id": p['url'] + "#faq", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]})
    return json.dumps({"@context": "https://schema.org", "@graph": g}, ensure_ascii=False, indent=1)

def head_block(p, s, faq):
    ld = jsonld(p, faq); json.loads(ld)
    t = esc(p['title']); d = esc(p['desc']); u = p['url']; img = SITE + p['og']
    return f'''<!--seo:head-->
<title>{t}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{u}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<meta name="author" content="Finder Lab">
<meta name="theme-color" content="#0D0A1A">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:site_name" content="Finder Lab">
<meta property="og:locale" content="pt_BR">
<meta property="og:type" content="website">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{u}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(p['og_title'])} · Finder Lab">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<meta name="twitter:image" content="{img}">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<script type="application/ld+json">
{ld}
</script>
{helmet_assets(s)}
<style>html,body{{margin:0}}.sc-host{{position:relative}}</style>
<!--/seo:head-->
'''

SWAP = ("<!--seo:script--><script>(function(){function d(){var r=document.getElementById('dc-root');"
        "if(r&&r.firstElementChild){var s=document.getElementById('seo-static');if(s)s.remove();return true}return false}"
        "if(d())return;var o=new MutationObserver(function(){if(d())o.disconnect()});"
        "o.observe(document.documentElement,{childList:true,subtree:true})})();</script><!--/seo:script-->\n")

async def render(pages):
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1); res = {}
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch()
            for p in pages:
                pg = await b.new_page(viewport={'width': 1440, 'height': 900})
                await pg.goto(f'http://localhost:{PORT}/{p["file"]}.html'); await pg.wait_for_selector('#dc-root .sc-host', timeout=20000)
                await pg.wait_for_timeout(2500)
                res[p['file']] = await pg.evaluate("""()=>({html:document.getElementById('dc-root').innerHTML,
                  faq:[...document.querySelectorAll('.faq-i')].map(e=>{const q=e.querySelector('summary');const qt=q?q.innerText.trim():'';
                       const c=e.cloneNode(true);const cs=c.querySelector('summary');if(cs)cs.remove();return [qt,c.innerText.trim()]}).filter(x=>x[0]&&x[1])})""")
                await pg.close()
            await b.close()
    finally: srv.kill()
    return res

def main():
    # 1) preparar fontes (limpar, links, imagens, x-dc oculto)
    srcs = {}
    for p in PAGES:
        fn = f"{ROOT}/{p['file']}.html"; s = open(fn, encoding='utf-8').read()
        s = clean(s); s = fix_links(s); s = fix_imgs(s)
        s = re.sub(r'<x-dc(?![\w-])(?![^>]*\bhidden\b)', '<x-dc hidden', s, 1)
        srcs[p['file']] = s; open(fn, 'w', encoding='utf-8').write(s)
    # 2) renderizar
    rend = asyncio.run(render(PAGES))
    # 3) montar
    for p in PAGES:
        s = srcs[p['file']]; r = rend[p['file']]
        faq = r['faq'] if p['type'] == 'home' else []
        s = s.replace('<script src="./support.js"></script>', head_block(p, s, faq) + '<script src="./support.js"></script>', 1)
        assert '<!--seo:head-->' in s
        static = '<!--seo:static-->\n<div id="seo-static">' + r['html'] + '</div>\n<!--/seo:static-->\n' + SWAP
        s = re.sub(r'(<body[^>]*>\n?)', lambda m: m.group(1) + static, s, 1)
        open(f"{ROOT}/{p['file']}.html", 'w', encoding='utf-8').write(s)
        print(p['file'], 'static', len(r['html']), 'faq', len(faq))
    # 4) arquivos de descoberta
    open(f'{ROOT}/sitemap.xml', 'w', encoding='utf-8').write(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        ''.join(f'  <url>\n    <loc>{p["url"]}</loc>\n    <lastmod>{TODAY}</lastmod>\n  </url>\n' for p in PAGES) + '</urlset>\n')
    open(f'{ROOT}/robots.txt', 'w', encoding='utf-8').write(
        "# Finder Lab: todos os buscadores e rastreadores de IA (Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User,\n"
        "# ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Applebot etc.) podem acessar o conteúdo público.\n"
        "User-agent: *\nAllow: /\nDisallow: /maquina-api/\nDisallow: /scripts/\nDisallow: /Sistemas-prints/\n\n"
        f"Sitemap: {SITE}/sitemap.xml\n")
    key = hashlib.sha256(b'finderlab.com.br-indexnow').hexdigest()[:32]
    open(f'{ROOT}/{key}.txt', 'w').write(key)
    print('indexnow key', key)

if __name__ == '__main__': main()
