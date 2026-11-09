-- Funil do chat nos últimos N dias (troque o intervalo). Exclui o navegador do Rodrigo
-- (cookie mdi) e as sessões de teste.
-- Rodar: railway connect Postgres  (e colar), ou psql "$DATABASE_PUBLIC_URL" -f scripts/funil-chat.sql

WITH periodo AS (SELECT now() - interval '7 days' AS desde),
visitas AS (
  SELECT path, count(DISTINCT visitor_id) AS visitantes
  FROM page_views, periodo WHERE created_at >= desde GROUP BY path
),
tent AS (
  SELECT * FROM chat_tentativas, periodo
  WHERE created_at >= desde AND NOT interno AND session_id NOT LIKE 'teste-%'
)
SELECT 'visitantes por página' AS etapa, path AS detalhe, visitantes::text AS valor FROM visitas
UNION ALL
SELECT 'conversas iniciadas', modo, count(DISTINCT session_id)::text FROM tent WHERE primeira GROUP BY modo
UNION ALL
SELECT 'mensagens por desfecho', resultado, count(*)::text FROM tent GROUP BY resultado
UNION ALL
SELECT 'conversas com alguma falha', '', count(DISTINCT session_id)::text FROM tent
  WHERE resultado IN ('erro', 'sem_resposta', 'falha_cliente', 'limite')
UNION ALL
SELECT 'erros mais comuns', left(erro, 120), count(*)::text FROM tent
  WHERE erro <> '' GROUP BY left(erro, 120)
ORDER BY 1, 3 DESC;
