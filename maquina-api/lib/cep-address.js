'use strict';

async function lookupCep(rawCep, fetchImpl = fetch) {
  const cep = String(rawCep || '').trim().replace(/[\s-]/g, '');
  if (!/^\d{8}$/.test(cep)) {
    return { sucesso: false, motivo: 'formato_invalido', erro: 'Peça um CEP com 8 dígitos.' };
  }
  try {
    const response = await fetchImpl(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error('Falha na consulta');
    const data = await response.json();
    if (data.erro) {
      return { sucesso: false, motivo: 'nao_encontrado', erro: 'CEP não encontrado. Peça que a pessoa confira o CEP.' };
    }
    const address = {
      cep,
      endereco: String(data.logradouro || '').trim(),
      bairro: String(data.bairro || '').trim(),
      cidade: String(data.localidade || '').trim(),
      estado: String(data.uf || '').trim(),
    };
    if (!address.cidade || !/^[A-Z]{2}$/.test(address.estado)) throw new Error('Resposta incompleta');
    return {
      sucesso: true,
      ...address,
      campos_pendentes: ['endereco', 'bairro'].filter((key) => !address[key]),
      orientacao: 'Mostre o endereço encontrado e peça apenas número e complemento (opcional), além dos campos_pendentes se houver. Não use o complemento do ViaCEP como complemento da residência. Inclua o endereço no resumo final para confirmação.',
    };
  } catch (_) {
    return { sucesso: false, motivo: 'indisponivel', erro: 'Consulta de CEP indisponível. Ofereça tentar novamente ou peça o endereço manualmente, sem inventar dados.' };
  }
}

module.exports = { lookupCep };
