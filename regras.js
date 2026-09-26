/* ============================================================
   regras.js — regras de negócio PURAS do Estacionamento CSI
   ------------------------------------------------------------
   Aqui não há tela nem gravação: só cálculo e validação.
   (Por isso é fácil de testar e de ajustar a política de preços.)

   Ciclo de vida de um ticket:
     ESTACIONADO ──pagar──▶ PAGO ──buscar──▶ A_CAMINHO ──entregar──▶ ENTREGUE
          │                                      │
          └──cancelar──▶ CANCELADO               └──desfazer──▶ PAGO
   ============================================================ */
(function (global) {
  'use strict';

  var STATUS = { ESTACIONADO: 'ESTACIONADO', PAGO: 'PAGO', A_CAMINHO: 'A_CAMINHO', ENTREGUE: 'ENTREGUE', CANCELADO: 'CANCELADO' };
  var ROTULO_STATUS = {
    ESTACIONADO: 'No pátio (a pagar)', PAGO: 'Pago · na fila', A_CAMINHO: 'A caminho',
    ENTREGUE: 'Entregue', CANCELADO: 'Cancelado'
  };
  var METODOS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', isento: 'Sem cobrança' };
  var CORES = [
    ['Branco', '#ffffff'], ['Preto', '#111111'], ['Prata', '#c0c0c0'], ['Cinza', '#808080'],
    ['Vermelho', '#dc2626'], ['Azul', '#2563eb'], ['Verde', '#16a34a'], ['Amarelo', '#facc15'],
    ['Marrom', '#7c4a25'], ['Outra', 'linear-gradient(135deg,#f472b6,#60a5fa)']
  ];
  var AVARIAS = ['Arranhão', 'Amassado', 'Vidro / farol', 'Pneu / roda', 'Retrovisor', 'Objeto de valor no carro'];
  var MOTIVOS_DESCONTO = ['Convênio / lojista', 'Cortesia da gerência', 'Cliente frequente / VIP', 'Erro operacional', 'Outro'];
  var ATIVOS = ['ESTACIONADO', 'PAGO', 'A_CAMINHO'];

  // ---------- Formatação ----------
  function moeda(c) {
    c = Math.round(c || 0);
    var neg = c < 0; c = Math.abs(c);
    var reais = Math.floor(c / 100), cent = c % 100;
    return (neg ? '-' : '') + 'R$ ' + String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + (cent < 10 ? '0' : '') + cent;
  }

  /** "15", "15,5", "15,50", "1.500,00" → centavos. Inválido → null. */
  function parseMoeda(txt) {
    var s = String(txt == null ? '' : txt).replace(/[R$\s]/g, '');
    if (!s) return null;
    if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  function duracao(min) {
    min = Math.max(0, Math.round(min || 0));
    var d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + (m < 10 ? '0' : '') + m + 'min';
    return m + ' min';
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function hojeISO(ms) { var d = new Date(ms || Date.now()); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function isoParaMs(iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); }
  function inicioDoDia(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function fimDoDia(ms) { var d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); }

  // ---------- Placa ----------
  function chavePlaca(p) { return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  /**
   * Valida placa brasileira (antiga ABC-1234 ou Mercosul ABC1D23).
   * Com livre=true aceita também outros formatos (placa estrangeira etc.).
   */
  function validarPlaca(texto, livre) {
    var k = chavePlaca(texto);
    if (/^[A-Z]{3}\d{4}$/.test(k)) return { ok: true, placa: k.slice(0, 3) + '-' + k.slice(3), formato: 'Padrão antigo' };
    if (/^[A-Z]{3}\d[A-Z]\d{2}$/.test(k)) return { ok: true, placa: k, formato: 'Mercosul' };
    if (livre && k.length >= 3 && k.length <= 10) return { ok: true, placa: k, formato: 'Outro formato' };
    return { ok: false, erro: 'Placa inválida. Use ABC-1234 (antiga) ou ABC1D23 (Mercosul).' };
  }

  // ---------- Mensalista ----------
  function mensalistaVigente(chave, mensalistas, agora) {
    var hoje = hojeISO(agora);
    return (mensalistas || []).filter(function (m) {
      return m.ativo && m.validade >= hoje && (m.placas || []).some(function (p) { return chavePlaca(p) === chave; });
    })[0] || null;
  }

  // ---------- Tarifa ----------
  /**
   * Tarifa única: cfg.valorFixo para qualquer veículo e qualquer tempo (só mensalista não paga).
   * Retorna { minutos, bruto (centavos), linhas:[{d,v}], isento:texto|null }.
   */
  function calcularTarifa(ticket, agora, cfg, mensalista) {
    var minutos = Math.max(0, Math.ceil((agora - ticket.entradaEm) / 60000));
    var r = { minutos: minutos, bruto: 0, linhas: [], isento: null };
    if (mensalista) {
      r.isento = 'Mensalista: ' + mensalista.nome;
      r.linhas.push({ d: r.isento, v: 0 });
      return r;
    }
    r.bruto = cfg.valorFixo;
    r.linhas.push({ d: 'Tarifa única', v: cfg.valorFixo });
    return r;
  }

  function calcularDesconto(bruto, d) {
    if (!d) return 0;
    var v = 0;
    if (d.tipo === 'cortesia') v = bruto;
    else if (d.tipo === 'percentual') v = Math.round(bruto * Math.min(100, Math.max(0, d.valor || 0)) / 100);
    else if (d.tipo === 'valor') v = d.valor || 0;
    return Math.max(0, Math.min(bruto, v));
  }

  // ---------- Pagamentos de um ticket ----------
  function pagamentosValidos(t) { return (t.pagamentos || []).filter(function (p) { return !p.estornado; }); }
  function totalQuitado(t) { return pagamentosValidos(t).reduce(function (s, p) { return s + (p.bruto || 0); }, 0); }
  function totalRecebido(t) { return pagamentosValidos(t).reduce(function (s, p) { return s + (p.valor || 0); }, 0); }
  function ultimoPagamento(t) { var v = pagamentosValidos(t); return v[v.length - 1] || null; }

  /** O que ainda falta cobrar agora (descontando o que já foi quitado). */
  function calcularDevido(t, agora, cfg, mensalista) {
    var tar = calcularTarifa(t, agora, cfg, mensalista);
    var quitado = totalQuitado(t);
    return { tarifa: tar, quitado: quitado, aCobrar: Math.max(0, tar.bruto - quitado) };
  }

  /**
   * O pagamento "venceu"? Vale quando o cliente demorou mais que a tolerância de saída
   * depois de pagar E já existe valor excedente a cobrar.
   */
  function pagamentoVencido(t, agora, cfg, mensalista) {
    var up = ultimoPagamento(t);
    if (!up) return false;
    if (agora - up.em <= cfg.toleranciaSaida * 60000) return false;
    return calcularDevido(t, agora, cfg, mensalista).aCobrar > 0;
  }

  // ---------- Estado ----------
  function estaAtivo(t) { return ATIVOS.indexOf(t.status) !== -1; }
  function ativos(tickets) { return tickets.filter(estaAtivo); }

  function ocupacao(tickets, cfg) {
    var m = {};
    cfg.patios.forEach(function (p) { m[p.id] = { patio: p, usados: 0 }; });
    ativos(tickets).forEach(function (t) {
      if (!m[t.patio]) m[t.patio] = { patio: { id: t.patio, nome: 'Pátio ' + t.patio, capacidade: 0, ativo: false }, usados: 0 };
      m[t.patio].usados++;
    });
    return m;
  }

  function nomePatio(cfg, id) {
    var p = cfg.patios.filter(function (x) { return x.id === String(id); })[0];
    return p ? p.nome : 'Pátio ' + id;
  }
  function nomeCategoria(cfg, cat) { return (cfg.tabela[cat] || {}).rotulo || cat || ''; }
  function descricaoVeiculo(t, cfg) {
    var partes = [];
    if (t.modelo) partes.push(t.modelo);
    if (t.cor) partes.push(t.cor);
    if (!partes.length && cfg) partes.push(nomeCategoria(cfg, t.categoria));
    return partes.join(' · ');
  }
  function localVeiculo(t, cfg) { return nomePatio(cfg, t.patio) + (t.vaga ? ' · Vaga ' + t.vaga : ''); }

  // ---------- Busca (ticket, placa ou pedaço) ----------
  function limparCodigo(txt) { return String(txt || '').trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase(); }

  function buscar(lista, texto) {
    var q = limparCodigo(texto);
    if (!q) return lista.slice();
    var exatos = [], demais = [];
    lista.forEach(function (t) {
      if (t.id === q) exatos.push(t);
      else if (chavePlaca(t.placa).indexOf(q) !== -1 || t.id.indexOf(q) !== -1 ||
               String(t.modelo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').indexOf(q) !== -1) demais.push(t);
    });
    return exatos.concat(demais);
  }

  // ---------- Caixa ----------
  function resumoCaixa(caixa, tickets) {
    var r = { porMetodo: {}, qtd: 0, total: 0, descontos: 0, dinheiro: 0, sangrias: 0, esperadoDinheiro: 0, pagamentos: [] };
    Object.keys(METODOS).forEach(function (k) { r.porMetodo[k] = { qtd: 0, valor: 0 }; });
    tickets.forEach(function (t) {
      (t.pagamentos || []).forEach(function (p) {
        if (p.caixaId !== caixa.id || p.estornado) return;
        r.qtd++; r.total += p.valor; r.descontos += p.desconto || 0;
        var pm = r.porMetodo[p.metodo] || (r.porMetodo[p.metodo] = { qtd: 0, valor: 0 });
        pm.qtd++; pm.valor += p.valor;
        r.pagamentos.push({ ticket: t, pagamento: p });
      });
    });
    r.pagamentos.sort(function (a, b) { return b.pagamento.em - a.pagamento.em; });
    r.dinheiro = r.porMetodo.dinheiro ? r.porMetodo.dinheiro.valor : 0;
    r.sangrias = (caixa.sangrias || []).reduce(function (s, x) { return s + x.valor; }, 0);
    r.esperadoDinheiro = (caixa.fundo || 0) + r.dinheiro - r.sangrias;
    return r;
  }

  // ---------- Relatório por período ----------
  function resumoPeriodo(tickets, ini, fim) {
    var r = {
      faturamento: 0, qtdPagamentos: 0, qtdPagos: 0, descontos: 0, porMetodo: {}, porOperador: {},
      entradas: 0, entregues: 0, perdidos: 0, cancelados: 0, estornos: 0,
      porHora: [], ticketMedio: 0, permMediaMin: 0, esperaMediaMin: 0
    };
    for (var h = 0; h < 24; h++) r.porHora.push(0);
    var permTot = 0, permQtd = 0, espTot = 0, espQtd = 0;
    function dentro(ms) { return ms >= ini && ms <= fim; }

    tickets.forEach(function (t) {
      if (dentro(t.entradaEm)) { r.entradas++; r.porHora[new Date(t.entradaEm).getHours()]++; }
      (t.pagamentos || []).forEach(function (p) {
        if (!dentro(p.em)) return;
        if (p.estornado) { r.estornos++; return; }
        r.faturamento += p.valor; r.descontos += p.desconto || 0; r.qtdPagamentos++;
        if (p.valor > 0) r.qtdPagos++;
        var pm = r.porMetodo[p.metodo] || (r.porMetodo[p.metodo] = { qtd: 0, valor: 0 });
        pm.qtd++; pm.valor += p.valor;
        var op = p.porNome || '—';
        var po = r.porOperador[op] || (r.porOperador[op] = { qtd: 0, valor: 0 });
        po.qtd++; po.valor += p.valor;
      });
      if (t.entregueEm && dentro(t.entregueEm)) {
        r.entregues++;
        permTot += (t.entregueEm - t.entradaEm) / 60000; permQtd++;
        if (t.pagoEm && t.entregueEm >= t.pagoEm) { espTot += (t.entregueEm - t.pagoEm) / 60000; espQtd++; }
      }
      if (t.ticketPerdido && dentro(t.ticketPerdido.em)) r.perdidos++;
      if (t.cancelado && dentro(t.cancelado.em)) r.cancelados++;
    });
    r.ticketMedio = r.qtdPagos ? Math.round(r.faturamento / r.qtdPagos) : 0;
    r.permMediaMin = permQtd ? permTot / permQtd : 0;
    r.esperaMediaMin = espQtd ? espTot / espQtd : 0;
    return r;
  }

  global.Regras = {
    STATUS: STATUS, ROTULO_STATUS: ROTULO_STATUS, METODOS: METODOS, CORES: CORES, AVARIAS: AVARIAS,
    MOTIVOS_DESCONTO: MOTIVOS_DESCONTO, ATIVOS: ATIVOS,
    moeda: moeda, parseMoeda: parseMoeda, duracao: duracao,
    hojeISO: hojeISO, isoParaMs: isoParaMs, inicioDoDia: inicioDoDia, fimDoDia: fimDoDia,
    chavePlaca: chavePlaca, validarPlaca: validarPlaca, mensalistaVigente: mensalistaVigente,
    calcularTarifa: calcularTarifa, calcularDesconto: calcularDesconto, calcularDevido: calcularDevido,
    pagamentosValidos: pagamentosValidos, totalQuitado: totalQuitado, totalRecebido: totalRecebido,
    ultimoPagamento: ultimoPagamento, pagamentoVencido: pagamentoVencido,
    estaAtivo: estaAtivo, ativos: ativos, ocupacao: ocupacao,
    nomePatio: nomePatio, nomeCategoria: nomeCategoria, descricaoVeiculo: descricaoVeiculo, localVeiculo: localVeiculo,
    limparCodigo: limparCodigo, buscar: buscar, resumoCaixa: resumoCaixa, resumoPeriodo: resumoPeriodo
  };
})(window);
