/* ============================================================
   operacoes.js — tudo que ALTERA dados (entrada, pagamento,
   busca, entrega, cancelamento, caixa...).
   ------------------------------------------------------------
   Cada operação: confere permissão → valida a regra → grava →
   registra na auditoria. Sempre devolve { ok:true, ... } ou
   { ok:false, erro:'texto pronto para mostrar' }.
   ============================================================ */
(function (global) {
  'use strict';

  var R = global.Regras;

  function erro(msg, extra) {
    var r = { ok: false, erro: msg };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }
  function exigir(acao) { return Auth.pode(acao) ? null : erro('Você não tem permissão para esta ação.'); }
  function texto(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' '); }
  function digitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function achar(id) { return Dados.tickets.filter(function (t) { return t.id === String(id); })[0] || null; }
  function mensalistaDe(t, agora) { return R.mensalistaVigente(R.chavePlaca(t.placa), Dados.mensalistas, agora); }

  /** Altera um ticket conferindo o status ATUAL (relido do armazenamento). */
  function alterar(id, permitidos, fn) {
    try {
      return Dados.mudar('tickets', function (l) {
        var x = l.filter(function (t) { return t.id === String(id); })[0];
        if (!x) return erro('Ticket não encontrado.');
        if (permitidos && permitidos.indexOf(x.status) === -1) {
          return erro('A situação deste ticket mudou (' + R.ROTULO_STATUS[x.status] + '). A tela foi atualizada.', { codigo: 'CONFLITO' });
        }
        var r = fn(x);
        if (r && r.ok === false) return r;
        return { ok: true, ticket: x };
      });
    } catch (e) { return erro(e.message); }
  }

  var Op = {
    achar: achar,
    mensalistaDe: mensalistaDe,

    // =========================================================
    //  ENTRADA
    // =========================================================
    registrarEntrada: function (d) {
      var p = exigir('entrada.registrar'); if (p) return p;
      var v = R.validarPlaca(d.placa, d.placaLivre);
      if (!v.ok) return erro(v.erro);
      var chave = R.chavePlaca(v.placa);
      var dentro = Dados.tickets.filter(function (t) { return R.estaAtivo(t) && R.chavePlaca(t.placa) === chave; })[0];
      if (dentro) return erro('Este veículo já está no pátio (ticket #' + dentro.id + ').', { ticketExistente: dentro.id });
      var patio = Dados.patio(d.patio);
      if (!patio || patio.ativo === false) return erro('Escolha o pátio onde o veículo vai ficar.');
      var cat = Dados.config.tabela[d.categoria] ? d.categoria : 'carro';
      var u = Auth.atual(), agora = Date.now();
      var mens = R.mensalistaVigente(chave, Dados.mensalistas, agora);
      var id;
      try { id = Dados.proximoTicket(); } catch (e) { return erro(e.message); }

      var t = {
        id: id, placa: v.placa, categoria: cat, modelo: texto(d.modelo), cor: texto(d.cor),
        patio: patio.id, vaga: texto(d.vaga).toUpperCase(), telefone: digitos(d.telefone),
        avarias: Array.isArray(d.avarias) ? d.avarias.slice() : [], obs: texto(d.obs),
        entradaEm: agora, entradaPor: u.id, entradaPorNome: u.nome,
        status: 'ESTACIONADO', mensalistaId: mens ? mens.id : null,
        pagamentos: [], pagoEm: null, ticketPerdido: null,
        buscaEm: null, buscaPor: null, buscaPorNome: null,
        entregueEm: null, entreguePor: null, entreguePorNome: null, entregueSemTicket: false,
        cancelado: null
      };
      try {
        Dados.mudar('tickets', function (l) { l.unshift(t); });
        Dados.mudar('meta', function (m) { m.ultimoPatio = patio.id; });
      } catch (e) { return erro(e.message); }
      Auth.registrar('entrada', t.placa + ' · ' + R.localVeiculo(t, Dados.config) + (mens ? ' · MENSALISTA' : ''), { ticket: id });

      var oc = R.ocupacao(Dados.tickets, Dados.config)[patio.id];
      var aviso = (patio.capacidade > 0 && oc && oc.usados > patio.capacidade) ? patio.nome + ' está acima da capacidade (' + oc.usados + '/' + patio.capacidade + ').' : null;
      return { ok: true, ticket: t, aviso: aviso, mensalista: mens };
    },

    corrigirDados: function (id, c) {
      var p = exigir('entrada.corrigir'); if (p) return p;
      var t = achar(id);
      if (!t) return erro('Ticket não encontrado.');
      if (!R.estaAtivo(t)) return erro('Só veículos que ainda estão no pátio podem ser corrigidos.');
      var mud = [], novo = {};

      if (c.placa !== undefined) {
        var v = R.validarPlaca(c.placa, c.placaLivre);
        if (!v.ok) return erro(v.erro);
        var chave = R.chavePlaca(v.placa);
        var dup = Dados.tickets.filter(function (x) { return x.id !== t.id && R.estaAtivo(x) && R.chavePlaca(x.placa) === chave; })[0];
        if (dup) return erro('Já existe outro veículo com essa placa no pátio (ticket #' + dup.id + ').');
        if (v.placa !== t.placa) { mud.push('placa ' + t.placa + ' → ' + v.placa); novo.placa = v.placa; }
      }
      if (c.categoria !== undefined && c.categoria !== t.categoria) {
        if (!Dados.config.tabela[c.categoria]) return erro('Tipo de veículo inválido.');
        if (t.status !== 'ESTACIONADO' && !Auth.pode('gerencia.configurar')) return erro('O tipo só pode ser alterado antes do pagamento.');
        mud.push('tipo ' + R.nomeCategoria(Dados.config, t.categoria) + ' → ' + R.nomeCategoria(Dados.config, c.categoria));
        novo.categoria = c.categoria;
      }
      if (c.patio !== undefined && String(c.patio) !== t.patio) {
        var pt = Dados.patio(c.patio);
        if (!pt || pt.ativo === false) return erro('Pátio inválido.');
        mud.push('pátio ' + R.nomePatio(Dados.config, t.patio) + ' → ' + pt.nome); novo.patio = pt.id;
      }
      ['modelo', 'cor', 'obs'].forEach(function (k) {
        if (c[k] !== undefined && texto(c[k]) !== t[k]) { mud.push(k + ' alterado'); novo[k] = texto(c[k]); }
      });
      if (c.vaga !== undefined && texto(c.vaga).toUpperCase() !== t.vaga) { mud.push('vaga ' + (t.vaga || '—') + ' → ' + (texto(c.vaga).toUpperCase() || '—')); novo.vaga = texto(c.vaga).toUpperCase(); }
      if (c.telefone !== undefined && digitos(c.telefone) !== t.telefone) { mud.push('telefone alterado'); novo.telefone = digitos(c.telefone); }
      if (Array.isArray(c.avarias) && c.avarias.join('|') !== (t.avarias || []).join('|')) { mud.push('avarias alteradas'); novo.avarias = c.avarias.slice(); }
      if (!mud.length) return { ok: true, ticket: t, semMudanca: true };

      var r = alterar(id, R.ATIVOS, function (x) {
        Object.keys(novo).forEach(function (k) { x[k] = novo[k]; });
        if (novo.placa) { var m = R.mensalistaVigente(R.chavePlaca(x.placa), Dados.mensalistas, Date.now()); x.mensalistaId = m ? m.id : null; }
      });
      if (r.ok) Auth.registrar('correcao', mud.join('; '), { ticket: String(id) });
      return r;
    },

    registrarReimpressao: function (id, tipo) {
      var p = exigir('ticket.reimprimir'); if (p) return p;
      Auth.registrar('reimpressao', tipo || 'ticket', { ticket: String(id) });
      return { ok: true };
    },

    // =========================================================
    //  PAGAMENTO (caixa)
    // =========================================================
    /**
     * d = { metodo, recebido(centavos), calculadoEm, desconto:{tipo,valor,motivo}, perdido:{nome,documento,telefone} }
     * Desconto e ticket perdido exigem senha de gerente quando quem opera é o caixa
     * (a tela chama Auth.autorizar antes).
     */
    pagar: function (id, d) {
      var p = exigir('pagamento.receber'); if (p) return p;
      var u = Auth.atual(), cfg = Dados.config;
      var caixa = Op.caixaAberto(u.id);
      if (!caixa) return erro('Abra o seu caixa antes de receber pagamentos.', { codigo: 'SEM_CAIXA' });
      var t = achar(id);
      if (!t) return erro('Ticket não encontrado.');
      if (t.status !== 'ESTACIONADO') return erro('Este ticket não está aguardando pagamento (' + R.ROTULO_STATUS[t.status] + ').', { codigo: 'CONFLITO' });

      var agora = Date.now();
      if (d.calculadoEm && agora - d.calculadoEm > 10 * 60000) return erro('O valor foi recalculado porque a tela ficou aberta. Confira o novo valor.', { codigo: 'VALOR_MUDOU' });
      var quando = d.calculadoEm || agora;
      var dev = R.calcularDevido(t, quando, cfg, mensalistaDe(t, quando));
      var bruto = dev.aCobrar;

      var desc = 0, motivoDesc = '';
      if (d.desconto) {
        p = exigir('pagamento.desconto'); if (p) return p;
        motivoDesc = texto(d.desconto.motivo);
        if (motivoDesc.length < 3) return erro('Informe o motivo do desconto.');
        desc = R.calcularDesconto(bruto, d.desconto);
        if (desc <= 0) return erro('O desconto informado não altera o valor.');
      }
      var valor = bruto - desc;

      var metodo = d.metodo, recebido = 0, troco = 0;
      if (valor > 0) {
        if (!R.METODOS[metodo] || metodo === 'isento') return erro('Escolha a forma de pagamento.');
        if (metodo === 'dinheiro') {
          recebido = Math.round(d.recebido || 0);
          if (recebido < valor) return erro('O valor recebido é menor que o total a pagar.');
          troco = recebido - valor;
        } else { recebido = valor; }
      } else { metodo = 'isento'; }

      var perdido = null;
      if (d.perdido) {
        p = exigir('pagamento.ticketPerdido'); if (p) return p;
        var nome = texto(d.perdido.nome), doc = texto(d.perdido.documento);
        if (nome.length < 3) return erro('Informe o nome completo de quem retira o veículo.');
        if (doc.length < 5) return erro('Informe o documento (CPF ou RG) de quem retira o veículo.');
        perdido = { nome: nome, documento: doc, telefone: digitos(d.perdido.telefone), em: agora, por: u.id, porNome: u.nome };
      }

      if (d.desconto && !Auth.temAutorizacao('pagamento.desconto')) return erro('É necessária a autorização de um gerente para dar desconto.', { codigo: 'AUTORIZAR' });
      if (perdido && !Auth.temAutorizacao('pagamento.ticketPerdido')) return erro('É necessária a autorização de um gerente para ticket perdido.', { codigo: 'AUTORIZAR' });
      var autores = [];
      if (d.desconto) { var a1 = Auth.consumirAutorizacao('pagamento.desconto'); if (a1.por) autores.push(a1.por.nome); }
      if (perdido) { var a2 = Auth.consumirAutorizacao('pagamento.ticketPerdido'); if (a2.por) { perdido.autorizadoPor = a2.por.nome; if (autores.indexOf(a2.por.nome) === -1) autores.push(a2.por.nome); } }

      var pag = {
        id: Dados.novoId('p'), em: agora, bruto: bruto, desconto: desc, motivoDesconto: motivoDesc, valor: valor,
        metodo: metodo, recebido: recebido, troco: troco, por: u.id, porNome: u.nome, caixaId: caixa.id,
        autorizadoPor: autores.join(', ') || null, minutos: dev.tarifa.minutos, quitadoAntes: dev.quitado, linhas: dev.tarifa.linhas
      };
      var r = alterar(id, ['ESTACIONADO'], function (x) {
        x.pagamentos.push(pag); x.status = 'PAGO'; x.pagoEm = agora;
        if (perdido) x.ticketPerdido = perdido;
      });
      if (!r.ok) return r;
      Auth.registrar('pagamento',
        '#' + id + ' ' + t.placa + ' · ' + R.moeda(valor) + ' · ' + R.METODOS[metodo] +
        (desc ? ' · desconto ' + R.moeda(desc) + ' (' + motivoDesc + ')' : '') + (perdido ? ' · TICKET PERDIDO (' + perdido.nome + ')' : ''),
        { ticket: String(id), autorizadoPor: autores.join(', ') || undefined });
      return { ok: true, ticket: r.ticket, pagamento: pag };
    },

    estornar: function (id, motivo) {
      var p = exigir('pagamento.estornar'); if (p) return p;
      motivo = texto(motivo);
      if (motivo.length < 3) return erro('Informe o motivo do estorno.');
      var t = achar(id);
      if (!t) return erro('Ticket não encontrado.');
      if (t.status !== 'PAGO') return erro('Só é possível estornar enquanto o veículo ainda está na fila (não foi buscado).');
      var up = R.ultimoPagamento(t);
      if (!up) return erro('Não há pagamento para estornar.');
      if (up.nota && !up.nota.homologacao) return erro('Este pagamento já tem a nota fiscal nº ' + up.nota.numero + '. Cancele a nota na prefeitura antes de estornar.');
      var cx = Dados.caixas.filter(function (c) { return c.id === up.caixaId; })[0];
      if (!cx || cx.fechadoEm) return erro('O caixa deste pagamento já foi fechado. Registre o ajuste com o gerente.');
      var u = Auth.atual(), agora = Date.now();
      var r = alterar(id, ['PAGO'], function (x) {
        var alvo = R.ultimoPagamento(x);
        alvo.estornado = { em: agora, por: u.id, porNome: u.nome, motivo: motivo };
        x.status = 'ESTACIONADO';
        var restante = R.ultimoPagamento(x);
        x.pagoEm = restante ? restante.em : null;
        if (x.ticketPerdido && x.ticketPerdido.em === alvo.em) x.ticketPerdido = null;
      });
      if (r.ok) Auth.registrar('estorno', '#' + id + ' ' + t.placa + ' · ' + R.moeda(up.valor) + ' · ' + motivo, { ticket: String(id) });
      return r;
    },

    /** Grava no pagamento a nota fiscal que o servidor de notas já emitiu. */
    registrarNota: function (id, pagId, nota) {
      var p = exigir('nota.emitir'); if (p) return p;
      var r = alterar(id, null, function (x) {
        var pg = (x.pagamentos || []).filter(function (q) { return q.id === pagId; })[0];
        if (!pg) return erro('Pagamento não encontrado.');
        if (pg.estornado) return erro('Este pagamento foi estornado.');
        if (pg.nota) return erro('Já existe nota emitida para este pagamento (nº ' + pg.nota.numero + ').');
        pg.nota = nota;
      });
      if (r.ok) Auth.registrar('nota_emitida', '#' + id + ' ' + r.ticket.placa + ' · NFS-e nº ' + nota.numero + (nota.homologacao ? ' (TESTE)' : '') + ' · ' + nota.tomadorNome, { ticket: String(id) });
      return r;
    },

    cancelarEntrada: function (id, motivo) {
      var p = exigir('entrada.cancelar'); if (p) return p;
      motivo = texto(motivo);
      if (motivo.length < 3) return erro('Informe o motivo do cancelamento.');
      var t = achar(id);
      if (!t) return erro('Ticket não encontrado.');
      if (t.status !== 'ESTACIONADO') return erro('Só é possível cancelar um ticket que ainda não foi pago.');
      if (R.pagamentosValidos(t).length) return erro('Este ticket tem pagamento registrado. Peça o estorno ao gerente.');
      if (!Auth.temAutorizacao('entrada.cancelar')) return erro('É necessária a autorização de um gerente para cancelar.', { codigo: 'AUTORIZAR' });
      var aut = Auth.consumirAutorizacao('entrada.cancelar');
      var u = Auth.atual(), agora = Date.now();
      var r = alterar(id, ['ESTACIONADO'], function (x) {
        x.status = 'CANCELADO';
        x.cancelado = { em: agora, por: u.id, porNome: u.nome, motivo: motivo, autorizadoPor: aut.por ? aut.por.nome : null };
      });
      if (r.ok) Auth.registrar('cancelamento', '#' + id + ' ' + t.placa + ' · ' + motivo, { ticket: String(id), autorizadoPor: aut.por ? aut.por.nome : undefined });
      return r;
    },

    // =========================================================
    //  MANOBRISTA
    // =========================================================
    buscar: function (id) {
      var p = exigir('valet.buscar'); if (p) return p;
      var u = Auth.atual(), agora = Date.now();
      var r = alterar(id, ['PAGO'], function (x) { x.status = 'A_CAMINHO'; x.buscaEm = agora; x.buscaPor = u.id; x.buscaPorNome = u.nome; });
      if (r.ok) Auth.registrar('busca', '#' + id + ' ' + r.ticket.placa, { ticket: String(id) });
      return r;
    },

    desfazerBusca: function (id) {
      var p = exigir('valet.desfazer'); if (p) return p;
      var r = alterar(id, ['A_CAMINHO'], function (x) { x.status = 'PAGO'; x.buscaEm = null; x.buscaPor = null; x.buscaPorNome = null; });
      if (r.ok) Auth.registrar('busca_desfeita', '#' + id + ' ' + r.ticket.placa, { ticket: String(id) });
      return r;
    },

    /**
     * d = { codigo }  → código lido do ticket (leitor, câmera ou digitado)
     *     { confirmouDocumento:true } → quando o ticket foi perdido
     */
    entregar: function (id, d) {
      var p = exigir('valet.entregar'); if (p) return p;
      d = d || {};
      var t = achar(id);
      if (!t) return erro('Ticket não encontrado.');
      if (t.status !== 'A_CAMINHO') return erro('Este veículo não está "a caminho" (' + R.ROTULO_STATUS[t.status] + ').', { codigo: 'CONFLITO' });
      var semTicket = !!t.ticketPerdido;
      if (semTicket) {
        if (!d.confirmouDocumento) return erro('Confirme que conferiu o documento do cliente.');
      } else {
        var cod = R.limparCodigo(d.codigo);
        if (!cod) return erro('Bipe o ticket ou digite o número.');
        if (cod !== t.id) {
          var outro = achar(cod);
          return erro('Ticket NÃO confere com este veículo.' + (outro ? ' Esse ticket é do #' + outro.id + ' (' + outro.placa + ').' : ' Número não encontrado.'), { codigo: 'TICKET_NAO_CONFERE' });
        }
      }
      var agora = Date.now(), cfg = Dados.config, mens = mensalistaDe(t, agora);
      if (R.pagamentoVencido(t, agora, cfg, mens)) {
        var dev = R.calcularDevido(t, agora, cfg, mens);
        var rv = alterar(id, ['A_CAMINHO'], function (x) { x.status = 'ESTACIONADO'; x.buscaEm = null; x.buscaPor = null; x.buscaPorNome = null; });
        if (rv.ok) Auth.registrar('pagamento_vencido', '#' + id + ' ' + t.placa + ' · excedente ' + R.moeda(dev.aCobrar), { ticket: String(id) });
        return erro('O pagamento venceu (passou de ' + cfg.toleranciaSaida + ' min). O cliente precisa voltar ao caixa para pagar mais ' + R.moeda(dev.aCobrar) + '.', { codigo: 'VENCIDO', aCobrar: dev.aCobrar });
      }
      var u = Auth.atual();
      var r = alterar(id, ['A_CAMINHO'], function (x) {
        x.status = 'ENTREGUE'; x.entregueEm = agora; x.entreguePor = u.id; x.entreguePorNome = u.nome; x.entregueSemTicket = semTicket;
      });
      if (r.ok) Auth.registrar('entrega', '#' + id + ' ' + t.placa + (semTicket ? ' · SEM TICKET (doc. conferido)' : ''), { ticket: String(id) });
      return r;
    },

    // =========================================================
    //  CAIXA (turno)
    // =========================================================
    caixaAberto: function (usuarioId) {
      return Dados.caixas.filter(function (c) { return c.operadorId === usuarioId && !c.fechadoEm; })[0] || null;
    },

    abrirCaixa: function (fundo) {
      var p = exigir('caixa.operar'); if (p) return p;
      var u = Auth.atual();
      if (Op.caixaAberto(u.id)) return erro('Você já tem um caixa aberto.');
      fundo = Math.round(fundo || 0);
      if (fundo < 0) return erro('Valor inicial inválido.');
      var numero;
      try { numero = Dados.proximoCaixa(); } catch (e) { return erro(e.message); }
      var cx = { id: Dados.novoId('cx'), numero: numero, operadorId: u.id, operadorNome: u.nome, abertoEm: Date.now(), fundo: fundo, sangrias: [], fechadoEm: null };
      try { Dados.mudar('caixas', function (l) { l.push(cx); }); } catch (e) { return erro(e.message); }
      Auth.registrar('caixa_aberto', 'Caixa ' + numero + ' · fundo ' + R.moeda(fundo));
      return { ok: true, caixa: cx };
    },

    sangria: function (caixaId, valor, motivo) {
      var p = exigir('caixa.sangria'); if (p) return p;
      motivo = texto(motivo);
      valor = Math.round(valor || 0);
      if (valor <= 0) return erro('Informe o valor da retirada.');
      if (motivo.length < 3) return erro('Informe o motivo da retirada.');
      var cx = Dados.caixas.filter(function (c) { return c.id === caixaId; })[0];
      if (!cx || cx.fechadoEm) return erro('Caixa não está aberto.');
      var disp = R.resumoCaixa(cx, Dados.tickets).esperadoDinheiro;
      if (valor > disp) return erro('Não há tanto dinheiro no caixa (disponível ' + R.moeda(disp) + ').');
      if (!Auth.temAutorizacao('caixa.sangria')) return erro('É necessária a autorização de um gerente para a retirada.', { codigo: 'AUTORIZAR' });
      var aut = Auth.consumirAutorizacao('caixa.sangria');
      var u = Auth.atual();
      try {
        Dados.mudar('caixas', function (l) {
          l.filter(function (c) { return c.id === caixaId; })[0].sangrias.push({ id: Dados.novoId('s'), valor: valor, motivo: motivo, em: Date.now(), porNome: u.nome, autorizadoPor: aut.por ? aut.por.nome : null });
        });
      } catch (e) { return erro(e.message); }
      Auth.registrar('sangria', R.moeda(valor) + ' · ' + motivo, { autorizadoPor: aut.por ? aut.por.nome : undefined });
      return { ok: true };
    },

    fecharCaixa: function (caixaId, contado, obs) {
      var p = exigir('caixa.operar'); if (p) return p;
      var u = Auth.atual();
      var cx = Dados.caixas.filter(function (c) { return c.id === caixaId; })[0];
      if (!cx || cx.fechadoEm) return erro('Este caixa já está fechado.');
      if (cx.operadorId !== u.id && u.perfil !== 'gerente') return erro('Só o próprio operador ou um gerente fecha este caixa.');
      contado = Math.round(contado);
      if (!(contado >= 0)) return erro('Informe o dinheiro contado na gaveta.');
      var res = R.resumoCaixa(cx, Dados.tickets);
      var dif = contado - res.esperadoDinheiro;
      obs = texto(obs);
      if (dif !== 0 && obs.length < 3) return erro('Há diferença no caixa. Explique o motivo no campo de observação.');
      try {
        Dados.mudar('caixas', function (l) {
          var x = l.filter(function (c) { return c.id === caixaId; })[0];
          x.fechadoEm = Date.now(); x.fechadoPor = u.nome; x.contado = contado; x.esperado = res.esperadoDinheiro; x.diferenca = dif; x.obsFechamento = obs;
          x.resumo = { total: res.total, qtd: res.qtd, descontos: res.descontos, dinheiro: res.dinheiro, sangrias: res.sangrias, porMetodo: res.porMetodo };
        });
      } catch (e) { return erro(e.message); }
      Auth.registrar('caixa_fechado', 'Caixa ' + cx.numero + ' de ' + cx.operadorNome + ' · total ' + R.moeda(res.total) + ' · diferença ' + R.moeda(dif));
      return { ok: true, caixa: Dados.caixas.filter(function (c) { return c.id === caixaId; })[0], diferenca: dif };
    },

    // =========================================================
    //  MENSALISTAS
    // =========================================================
    salvarMensalista: function (d) {
      var p = exigir('gerencia.configurar'); if (p) return p;
      var nome = texto(d.nome);
      if (nome.length < 2) return erro('Informe o nome do mensalista.');
      var placas = [], invalida = null;
      (d.placas || []).forEach(function (pl) {
        if (!texto(pl)) return;
        var v = R.validarPlaca(pl, true);
        if (!v.ok) invalida = pl; else placas.push(v.placa);
      });
      if (invalida) return erro('Placa inválida: ' + invalida);
      if (!placas.length) return erro('Informe ao menos uma placa.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.validade || '')) return erro('Informe a data de validade do plano.');
      var valor = Math.round(d.valor || 0);
      var conflito = null;
      Dados.mensalistas.forEach(function (m) {
        if (m.id === d.id || !m.ativo) return;
        placas.forEach(function (pl) { if ((m.placas || []).some(function (x) { return R.chavePlaca(x) === R.chavePlaca(pl); })) conflito = pl + ' (já é de ' + m.nome + ')'; });
      });
      if (conflito && d.ativo !== false) return erro('Placa já cadastrada em outro mensalista: ' + conflito);
      var reg = { id: d.id || Dados.novoId('m'), nome: nome, placas: placas, telefone: digitos(d.telefone), validade: d.validade, valor: valor, ativo: d.ativo !== false, obs: texto(d.obs) };
      try {
        Dados.mudar('mensalistas', function (l) {
          var i = l.map(function (m) { return m.id; }).indexOf(reg.id);
          if (i === -1) l.push(reg); else l[i] = reg;
        });
      } catch (e) { return erro(e.message); }
      Auth.registrar('mensalista', nome + ' · ' + placas.join(', ') + ' · até ' + d.validade);
      return { ok: true, mensalista: reg };
    },

    // =========================================================
    //  CONFIGURAÇÃO
    // =========================================================
    /** Retorna texto de erro ou null. */
    validarConfig: function (c) {
      function inteiro(v, min, max) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min && v <= max; }
      if (!texto(c.estabelecimento)) return 'Informe o nome do estabelecimento.';
      if (!inteiro(c.valorFixo, 0, 10000000)) return 'Valor da tarifa inválido.';
      if (!inteiro(c.inatividadeMin, 0, 480)) return 'Tempo de inatividade deve estar entre 0 e 480 minutos.';
      if (c.larguraPapel !== 32 && c.larguraPapel !== 48) return 'Largura do papel inválida.';
      if (!Object.keys(c.tabela || {}).length) return 'A lista de tipos de veículo está vazia.';
      if (!Array.isArray(c.patios) || !c.patios.length) return 'Cadastre ao menos um pátio.';
      var ids = {};
      for (var j = 0; j < c.patios.length; j++) {
        var pt = c.patios[j];
        if (!texto(pt.nome)) return 'Todo pátio precisa de um nome.';
        if (!inteiro(pt.capacidade, 0, 100000)) return 'Capacidade inválida em "' + pt.nome + '".';
        if (ids[pt.id]) return 'Pátios com identificador repetido.';
        ids[pt.id] = 1;
        if (pt.ativo === false) {
          var uso = R.ativos(Dados.tickets).filter(function (t) { return t.patio === pt.id; }).length;
          if (uso) return '"' + pt.nome + '" tem ' + uso + ' veículo(s) e não pode ser desativado agora.';
        }
      }
      if (!c.patios.some(function (x) { return x.ativo !== false; })) return 'Mantenha ao menos um pátio ativo.';
      return null;
    },

    salvarConfig: function (nova) {
      var p = exigir('gerencia.configurar'); if (p) return p;
      var e = Op.validarConfig(nova);
      if (e) return erro(e);
      try {
        Dados.mudar('config', function (c) {
          // as permissões são do administrador: a tela de configuração da gerência não as sobrescreve
          Object.keys(nova).forEach(function (k) { if (k !== 'permissoes') c[k] = nova[k]; });
        });
      } catch (err) { return erro(err.message); }
      Auth.registrar('config_alterada', 'Configurações salvas');
      return { ok: true };
    }
  };

  global.Op = Op;
})(window);
