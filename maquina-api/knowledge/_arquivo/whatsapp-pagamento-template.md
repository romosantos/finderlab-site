# Modelo de WhatsApp: pagamento pendente

Nome sugerido na Twilio: `maquina_pagamento_pendente`
Idioma: português do Brasil (`pt_BR`). Categoria sugerida: Utility.
Tipo: texto (`twilio/text`).

## Texto

Oi {{1}}, aqui é da Máquina de Decisões. Que bom ter você com a gente, valeu pelo interesse! Recebemos seus dados. Para concluir sua inscrição, faça o pagamento pelo link: {{2}}. Sua inscrição só será efetivada após a confirmação do pagamento. Qualquer dúvida, é só responder por aqui.

## Variáveis e ativação

- `1`: nome da pessoa.
- `2`: URL real do checkout retornada pelo Asaas, a mesma enviada no chat.
- Criar e submeter o modelo para aprovação do WhatsApp na Twilio.
- Após aprovação, configurar seu Content SID na variável `TWILIO_PAYMENT_TEMPLATE_SID` no Railway.
- O modelo antigo `TWILIO_CONFIRM_TEMPLATE_SID` não é utilizado pelo código atualizado.

## Fluxo

Salvar os dados não dispara mensagem para a pessoa. O lembrete é enviado somente após o checkout ser criado ou reaproveitado, uma vez por checkout. Falha no envio não bloqueia o link no chat e permite nova tentativa ao solicitar o checkout novamente. Não enviar lembrete de pendência para pagamentos já confirmados.
