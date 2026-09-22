# Publicação do site Finder Lab

Este repositório é um site estático. O ponto de entrada é `index.html` na raiz, com `CNAME` configurado para `finderlab.com.br` e `.nojekyll`. Não há etapa de build.

## Diagnóstico de 22/09/2026

- `https://finderlab.com.br/` e `https://romosantos.github.io/finderlab-site/` exibem a página 404 do próprio GitHub Pages.
- O último workflow de Pages visível foi concluído com sucesso em 13/07/2026. Não há publicação recente.
- O repositório `romosantos/finderlab-site` agora aparece como **público**.
- A API pública `GET /repos/romosantos/finderlab-site/pages` retorna `404 Not Found`, indicando que não há um site Pages configurado e acessível para este repositório.
- O histórico do GitHub Actions continua com apenas três deploys, todos de julho. Tornar o repositório público não iniciou uma nova publicação.
- A conta GitHub disponível para esta revisão continua sem acesso a `Settings → Pages` (a rota retorna 404). Por isso, não é possível habilitar a fonte de publicação nesta conta.

O problema está na configuração do GitHub Pages, antes da renderização dos arquivos do site. O repositório público atende ao requisito de visibilidade do plano Free, mas o Pages precisa ser habilitado novamente por alguém com permissão de administrador ou mantenedor.

## Ação necessária para quem tem acesso de administrador

1. Em `Settings → Pages`, definir **Source = Deploy from a branch**, **Branch = main** e **Folder = /(root)**; clicar em **Save**.
2. Confirmar `finderlab.com.br` em **Custom domain**, manter o arquivo `CNAME` e habilitar **Enforce HTTPS** quando disponível.
3. Aguardar um novo workflow `pages-build-deployment` com sucesso e testar `https://finderlab.com.br/` e `https://romosantos.github.io/finderlab-site/`.
4. Para publicar também o redesenho, integrar o pull request #1 em `main` e verificar outro deploy. A ativação do Pages pode ser testada primeiro com a versão atual de `main`.

Não altere o DNS apenas para encobrir o sintoma. As duas URLs do Pages retornam 404, indicando que a publicação do repositório precisa ser restabelecida.
