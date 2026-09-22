# Publicação do site Finder Lab

Este repositório é um site estático. O ponto de entrada é `index.html` na raiz, com `CNAME` configurado para `finderlab.com.br` e `.nojekyll`. Não há etapa de build.

## Diagnóstico de 22/09/2026

- `https://finderlab.com.br/` e `https://romosantos.github.io/finderlab-site/` exibem a página 404 do próprio GitHub Pages.
- O último workflow de Pages visível foi concluído com sucesso em 13/07/2026. Não há publicação recente.
- O repositório `romosantos/finderlab-site` aparece como **privado**.
- A conta GitHub disponível para esta revisão não tem acesso a `Settings → Pages`. Logo, não foi possível confirmar o plano do proprietário nem reativar a publicação.

O problema está na disponibilidade/configuração do GitHub Pages, antes da renderização dos arquivos do site. Segundo a documentação do GitHub, Pages de repositórios privados depende de GitHub Pro/Team/Enterprise. Em plano Free, tornar o repositório privado despublica o Pages.

## Ação necessária para quem tem acesso de administrador

1. Em `Settings → Pages`, confirmar se o site está habilitado e se a origem é `Deploy from a branch → main → /(root)`.
2. Confirmar se a conta proprietária tem plano compatível com Pages em repositório privado. Se não tiver, escolher entre ativar um plano compatível ou tornar o repositório público. **Tornar público expõe todo o código e histórico**; essa decisão deve ser consciente.
3. Confirmar `finderlab.com.br` em **Custom domain**, manter o arquivo `CNAME` e habilitar **Enforce HTTPS** quando disponível.
4. Após integrar as mudanças em `main`, verificar um novo workflow `pages-build-deployment` com sucesso.
5. Testar o domínio e a URL padrão. A correção só estará concluída quando o conteúdo abrir no endereço público, sem 404.

Não altere o DNS apenas para encobrir o sintoma. As duas URLs do Pages retornam 404, indicando que a publicação do repositório precisa ser restabelecida.
