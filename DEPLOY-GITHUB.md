# Publicar no ar de graça (GitHub Pages) — finderlab.com.br

O site é 100% estático, então **GitHub Pages** hospeda sem custo, com HTTPS grátis e domínio próprio. Você publica a pasta `site/`. Já deixei prontos aqui dentro: `CNAME` (com finderlab.com.br), `.nojekyll` e `.gitignore`.

## Passo 1 — Criar o repositório e subir a pasta `site/`

No GitHub, crie um repositório **público** (Pages é grátis em repo público), ex.: `finderlab-site`. Depois, no seu computador, dentro da pasta `site/`:

```bash
cd "/Users/rodrigomoraes/Pessoal/Projetos/Finder Lab/site"
git init
git add .
git commit -m "Site Finder Lab"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/finderlab-site.git
git push -u origin main
```

> Importante: use o caminho COMPLETO acima (a pasta fica em `~/Pessoal/Projetos/Finder Lab/site`, não direto na home). Rode os comandos **dentro de `site/`** para o conteúdo do site virar a raiz do repositório. O `.gitignore` já evita subir `Sistemas-prints/`, `.DS_Store` e os arquivos do gerador. Troque `SEU-USUARIO` pelo seu usuário real do GitHub e crie o repositório lá antes do push.

> **Se você já rodou os comandos e deu erro:** provavelmente o `git init` rodou na sua home por engano. Rode `rm -rf ~/.git` (isso remove só o repositório criado errado, NÃO apaga nenhum arquivo seu) e recomece com o caminho completo acima.

> **Login no push:** o GitHub não aceita mais senha no terminal. Na hora do `git push` ele vai pedir usuário e senha, use um **Personal Access Token** como senha (GitHub → Settings → Developer settings → Personal access tokens), ou instale o **GitHub CLI** (`gh auth login`), ou use o **GitHub Desktop** (interface gráfica, faz o login sozinho).

## Passo 2 — Ligar o GitHub Pages

No repositório: **Settings → Pages**. Em "Build and deployment", Source = **Deploy from a branch**, Branch = **main**, pasta **/(root)** → Save. Em ~1 minuto sai no ar num endereço tipo `https://SEU-USUARIO.github.io/finderlab-site/`.

Em **Settings → Pages → Custom domain**, digite `finderlab.com.br` e Save (ele já reconhece o arquivo `CNAME`).

## Passo 3 — Apontar o domínio (DNS no seu provedor)

No painel onde você gerencia o DNS de finderlab.com.br, crie:

**Domínio raiz (finderlab.com.br) — 4 registros A:**
```
A   @   185.199.108.153
A   @   185.199.109.153
A   @   185.199.110.153
A   @   185.199.111.153
```
(Opcional, IPv6 — 4 registros AAAA:)
```
AAAA @ 2606:50c0:8000::153
AAAA @ 2606:50c0:8001::153
AAAA @ 2606:50c0:8002::153
AAAA @ 2606:50c0:8003::153
```

**Subdomínio www — 1 registro CNAME:**
```
CNAME  www  SEU-USUARIO.github.io
```

## Passo 4 — HTTPS

O DNS leva de minutos a algumas horas pra propagar. Quando propagar, volte em **Settings → Pages** e marque **Enforce HTTPS** (o certificado Let's Encrypt é emitido automaticamente, grátis).

---

## Alternativa sem git (arrastar e soltar), também grátis

Se preferir não usar git: **Netlify** ou **Cloudflare Pages**. Em `app.netlify.com` (Add new site → Deploy manually) você **arrasta a pasta `site/`** e sobe na hora; depois adiciona o domínio em Domain settings e aponta o DNS conforme o painel indicar. Ambos têm domínio próprio e HTTPS grátis. Cloudflare Pages é interessante se você também quiser mover o DNS pra Cloudflare.

## Depois de publicar
- O formulário de contato abre o e-mail do visitante (mailto). Para receber mensagens direto na caixa, dá pra ligar um Formspree grátis (me passa o ID).
- Para atualizar o site: edite os arquivos e `git push` de novo (GitHub Pages republica sozinho).
