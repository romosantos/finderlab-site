# Publicação do site Finder Lab

Este repositório é um site estático. O ponto de entrada é `index.html` na raiz, com `CNAME` configurado para `finderlab.com.br` e `.nojekyll`. Não há etapa de build.

## Estado verificado em 22/09/2026

O GitHub Pages foi reativado pelo administrador após o repositório se tornar público. O workflow `pages-build-deployment` #4 terminou com sucesso, e `https://finderlab.com.br/`, `zelus-health.html` e `viva.html` responderam HTTP 200. **O erro 404 foi resolvido.**

A versão atualmente publicada é a de `main` e ainda usa o conteúdo antigo. O redesenho com Zelus Health, Zelus Pet e EDI VITA está no pull request #1; sua integração em `main` será uma etapa separada.

## Diagnóstico anterior

- Antes da reativação, `https://finderlab.com.br/` e `https://romosantos.github.io/finderlab-site/` exibiam a página 404 do próprio GitHub Pages.
- O último workflow de Pages anterior à reativação havia sido concluído em 13/07/2026.
- O repositório `romosantos/finderlab-site` agora aparece como **público**.
- A API pública `GET /repos/romosantos/finderlab-site/pages` retornava `404 Not Found` antes de o Pages ser habilitado novamente.
- Tornar o repositório público, por si só, não iniciou a publicação. O administrador reativou o Pages depois.
- A conta GitHub disponível para esta revisão continua sem acesso a `Settings → Pages` (a rota retorna 404). Por isso, não é possível habilitar a fonte de publicação nesta conta.

O problema estava na configuração do GitHub Pages, antes da renderização dos arquivos do site. A reativação foi feita por uma conta com permissão adequada.

## Para publicar o redesenho

1. Revisar e integrar o pull request #1 em `main`.
2. Aguardar outro workflow `pages-build-deployment` com sucesso.
3. Abrir `https://finderlab.com.br/` e conferir a página nova e seus links principais.
4. Em `Settings → Pages`, confirmar que **Enforce HTTPS** está ativo. A URL padrão do Pages ainda redirecionou para `http://finderlab.com.br/` no teste, embora o acesso direto por HTTPS tenha respondido 200.

Não há necessidade de alterar o DNS para publicar o redesenho; o domínio já resolve e responde.
