/* ============================================================
   ficha.js — ficha do veículo (editar/mover) e histórico completo
   Compartilhado por Manobrista, Caixa e Gerência.
   ============================================================ */
(function (global) {
  'use strict';

  var R = global.Regras, esc = Ui.esc, $ = Ui.$;

  var MODELOS = ['Onix', 'HB20', 'Gol', 'Uno', 'Argo', 'Mobi', 'Kwid', 'Polo', 'T-Cross', 'Nivus', 'Virtus', 'Creta', 'Corolla',
    'Civic', 'HR-V', 'City', 'Compass', 'Renegade', 'Strada', 'Toro', 'Hilux', 'S10', 'Ranger', 'Tracker', 'Fiesta', 'Ka', 'EcoSport',
    'Palio', 'Siena', 'Celta', 'Prisma', 'Cruze', 'Fox', 'Saveiro', 'Golf', 'Jetta', 'Yaris', 'Sandero', 'Logan', 'Duster', 'Kicks',
    'Versa', 'Frontier', 'CG 160', 'Biz', 'PCX', 'XRE 300', 'Fazer', 'Bros'];

  var ROTULO_ACAO = {
    entrada: 'Entrada registrada', pagamento: 'Pagamento recebido', busca: 'Busca iniciada', busca_desfeita: 'Busca desfeita',
    entrega: 'Veículo entregue', correcao: 'Dados corrigidos', reimpressao: 'Reimpressão', cancelamento: 'Ticket cancelado',
    estorno: 'Pagamento estornado', nota_emitida: 'Nota fiscal emitida', pagamento_vencido: 'Pagamento vencido (voltou ao caixa)',
    login: 'Entrou no sistema', logout: 'Saiu do sistema', logout_inatividade: 'Saiu por inatividade', pin_incorreto: 'PIN incorreto', senha_incorreta: 'Senha incorreta',
    permissoes_alteradas: 'Permissões alteradas',
    caixa_aberto: 'Caixa aberto', caixa_fechado: 'Caixa fechado', sangria: 'Retirada do caixa (sangria)',
    usuario_criado: 'Usuário criado', usuario_alterado: 'Usuário alterado', usuario_excluido: 'Usuário excluído', mensalista: 'Mensalista salvo',
    config_alterada: 'Configurações alteradas', backup_exportado: 'Backup exportado', backup_importado: 'Backup restaurado',
    dados_apagados: 'Todos os dados apagados'
  };

  function reimprimir(id) {
    var t = Op.achar(id);
    if (!t) return;
    Op.registrarReimpressao(id, 'ticket');
    Impressao.imprimirTicket(t);
  }

  /** Janela de edição/movimentação (só para veículos ainda no pátio). */
  function editar(id) {
    var t = Op.achar(id);
    if (!t || !R.estaAtivo(t)) { Ui.toast('Este veículo não está mais no pátio.', 'aviso'); return; }
    var cfg = Dados.config;
    var avarias = (t.avarias || []).slice();
    var livre = !R.validarPlaca(t.placa, false).ok;
    var opt = function (v, rot, sel) { return '<option value="' + esc(v) + '" ' + (sel ? 'selected' : '') + '>' + esc(rot) + '</option>'; };
    var podeCat = t.status === 'ESTACIONADO' || Auth.pode('gerencia.configurar');
    var badge = t.status === 'PAGO' ? 'azul' : t.status === 'A_CAMINHO' ? 'verde' : '';

    var m = Ui.modal({
      titulo: 'Ficha · #' + t.id, largura: 'md',
      html: '<div class="mb"><span class="badge ' + badge + '">' + esc(R.ROTULO_STATUS[t.status]) + '</span> ' +
        '<span class="mudo pequeno">Entrada ' + Ui.dataHora(t.entradaEm) + ' por ' + esc(t.entradaPorNome || '—') + '</span></div>' +
        (t.ticketPerdido ? '<div class="card perigo mb pequeno"><b>Ticket perdido</b> — ' + esc(t.ticketPerdido.nome) + ' · doc. ' + esc(t.ticketPerdido.documento) + '</div>' : '') +
        '<div class="linha-campos">' +
        '<div class="campo"><label class="rotulo" for="e-placa">Placa</label><input id="e-placa" type="text" maxlength="10" value="' + esc(t.placa) + '" style="text-transform:uppercase"></div>' +
        '<div class="campo"><label class="rotulo" for="e-cat">Tipo</label><select id="e-cat" ' + (podeCat ? '' : 'disabled') + '>' +
        Object.keys(cfg.tabela).map(function (k) { return opt(k, cfg.tabela[k].rotulo, k === t.categoria); }).join('') + '</select></div>' +
        '<div class="campo"><label class="rotulo" for="e-modelo">Modelo</label><input id="e-modelo" type="text" maxlength="30" value="' + esc(t.modelo) + '" list="ficha-modelos"></div>' +
        '<div class="campo"><label class="rotulo" for="e-cor">Cor</label><select id="e-cor">' + opt('', '—', !t.cor) +
        R.CORES.map(function (c) { return opt(c[0], c[0], c[0] === t.cor); }).join('') + '</select></div>' +
        '<div class="campo"><label class="rotulo" for="e-patio">Pátio</label><select id="e-patio">' +
        cfg.patios.filter(function (p) { return p.ativo !== false || p.id === t.patio; }).map(function (p) { return opt(p.id, p.nome, p.id === t.patio); }).join('') + '</select></div>' +
        '<div class="campo"><label class="rotulo" for="e-vaga">Vaga</label><input id="e-vaga" type="text" maxlength="10" value="' + esc(t.vaga) + '"></div>' +
        '<div class="campo"><label class="rotulo" for="e-tel">Telefone</label><input id="e-tel" type="tel" maxlength="15" value="' + esc(t.telefone) + '"></div></div>' +
        '<datalist id="ficha-modelos">' + MODELOS.map(function (x) { return '<option value="' + x + '">'; }).join('') + '</datalist>' +
        '<div class="rotulo mt">Avarias já existentes</div><div class="chips" id="e-avarias"></div>' +
        '<label class="rotulo mt" for="e-obs">Observação</label><textarea id="e-obs" maxlength="200">' + esc(t.obs) + '</textarea>' +
        '<div class="dica erro" id="e-erro" role="alert"></div>',
      botoes: [
        { rotulo: 'Fechar', classe: 'btn-contorno', aoClicar: function (mm) { mm.fechar(); } },
        { rotulo: '🖨️ Ticket', classe: 'btn-contorno', aoClicar: function () { reimprimir(id); } },
        {
          rotulo: 'Salvar', classe: 'btn-primario', padrao: true, aoClicar: function (mm) {
            var c = mm.corpo;
            var r = Op.corrigirDados(id, {
              placa: $('#e-placa', c).value, placaLivre: livre, categoria: $('#e-cat', c).value, modelo: $('#e-modelo', c).value,
              cor: $('#e-cor', c).value, patio: $('#e-patio', c).value, vaga: $('#e-vaga', c).value, telefone: $('#e-tel', c).value,
              avarias: avarias, obs: $('#e-obs', c).value
            });
            if (!r.ok) { $('#e-erro', c).textContent = r.erro; return; }
            mm.fechar();
            Ui.toast(r.semMudanca ? 'Nada mudou.' : 'Ficha atualizada.', r.semMudanca ? 'info' : 'sucesso');
          }
        }
      ]
    });

    function desenharAvarias() {
      $('#e-avarias', m.corpo).innerHTML = R.AVARIAS.map(function (a) {
        return '<button type="button" class="chip ' + (avarias.indexOf(a) > -1 ? 'sel' : '') + '" data-av="' + esc(a) + '">' + esc(a) + '</button>';
      }).join('');
    }
    desenharAvarias();
    $('#e-avarias', m.corpo).addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-av]'); if (!b) return;
      var a = b.getAttribute('data-av');
      avarias = avarias.indexOf(a) > -1 ? avarias.filter(function (x) { return x !== a; }) : avarias.concat(a);
      desenharAvarias();
    });
    $('#e-placa', m.corpo).addEventListener('input', function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });
  }

  /** Histórico completo (para o gerente resolver contestações). */
  function historico(id) {
    var t = Op.achar(id);
    if (!t) { Ui.toast('Ticket não encontrado.', 'erro'); return; }
    var cfg = Dados.config;
    var l = function (rot, val) { return '<div><div class="mudo pequeno">' + esc(rot) + '</div><div class="negrito">' + (val || '—') + '</div></div>'; };
    var fim = t.entregueEm || (t.status === 'CANCELADO' && t.cancelado ? t.cancelado.em : Date.now());
    var eventos = Dados.log.filter(function (x) { return x.ticket === String(id); }).sort(function (a, b) { return a.em - b.em; });

    var pags = (t.pagamentos || []).map(function (p) {
      return '<tr><td>' + Ui.dataHora(p.em) + '</td><td>' + esc(p.porNome) + '</td><td class="num">' + R.moeda(p.bruto) + '</td>' +
        '<td class="num">' + (p.desconto ? R.moeda(p.desconto) + '<br><span class="mudo pequeno">' + esc(p.motivoDesconto) + '</span>' : '—') + '</td>' +
        '<td class="num negrito">' + R.moeda(p.valor) + '</td><td>' + esc(R.METODOS[p.metodo] || p.metodo) + '</td>' +
        '<td>' + (p.estornado ? '<span class="badge verm">Estornado</span><br><span class="mudo pequeno">' + esc(p.estornado.motivo) + '</span>' : '<span class="badge verde">Válido</span>') +
        (p.nota ? '<br><span class="mudo pequeno">NFS-e nº ' + esc(p.nota.numero) + (p.nota.homologacao ? ' (teste)' : '') + '</span>' : '') + '</td></tr>';
    }).join('');

    Ui.modal({
      titulo: 'Histórico · #' + t.id + ' · ' + t.placa, largura: 'xl',
      html: '<div class="grade-kpi mb" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">' +
        l('Situação', '<span class="badge ' + (t.status === 'ENTREGUE' ? 'verde' : t.status === 'CANCELADO' ? 'verm' : 'azul') + '">' + esc(R.ROTULO_STATUS[t.status]) + '</span>') +
        l('Veículo', esc(R.descricaoVeiculo(t, cfg)) + ' (' + esc(R.nomeCategoria(cfg, t.categoria)) + ')') +
        l('Local', esc(R.localVeiculo(t, cfg))) +
        l('Entrada', Ui.dataHora(t.entradaEm) + '<br><span class="mudo pequeno">por ' + esc(t.entradaPorNome || '—') + '</span>') +
        l('Saída', t.entregueEm ? Ui.dataHora(t.entregueEm) + '<br><span class="mudo pequeno">por ' + esc(t.entreguePorNome || '—') + '</span>' : '') +
        l('Permanência', R.duracao((fim - t.entradaEm) / 60000)) +
        l('Buscado por', t.buscaPorNome ? esc(t.buscaPorNome) : '') +
        l('Telefone', t.telefone ? esc(t.telefone) : '') + '</div>' +
        ((t.avarias && t.avarias.length) || t.obs ? '<div class="card alerta mb pequeno"><b>Avarias/obs. na entrada:</b> ' + esc((t.avarias || []).join(', ')) + (t.obs ? ' — ' + esc(t.obs) : '') + '</div>' : '') +
        (t.ticketPerdido ? '<div class="card perigo mb pequeno"><b>Ticket perdido:</b> retirado por ' + esc(t.ticketPerdido.nome) + ' · doc. ' + esc(t.ticketPerdido.documento) +
          (t.ticketPerdido.telefone ? ' · tel. ' + esc(t.ticketPerdido.telefone) : '') + ' · autorizado por ' + esc(t.ticketPerdido.autorizadoPor || '—') + '</div>' : '') +
        (t.cancelado ? '<div class="card perigo mb pequeno"><b>Cancelado</b> por ' + esc(t.cancelado.porNome) + ' em ' + Ui.dataHora(t.cancelado.em) + ' — ' + esc(t.cancelado.motivo) +
          (t.cancelado.autorizadoPor ? ' (autorizado por ' + esc(t.cancelado.autorizadoPor) + ')' : '') + '</div>' : '') +
        '<h4 style="margin:14px 0 6px">Pagamentos</h4>' +
        (pags ? '<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Operador</th><th class="num">Tarifa</th><th class="num">Desconto</th><th class="num">Recebido</th><th>Forma</th><th>Situação</th></tr></thead><tbody>' + pags + '</tbody></table></div>' : '<div class="mudo">Nenhum pagamento.</div>') +
        '<h4 style="margin:14px 0 6px">Linha do tempo</h4>' +
        (eventos.length ? '<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead><tbody>' +
          eventos.map(function (e) {
            return '<tr><td class="nowrap">' + Ui.dataHora(e.em) + '</td><td>' + esc(e.usuario) + '</td><td>' + esc(ROTULO_ACAO[e.acao] || e.acao) + '</td><td>' + esc(e.detalhe) +
              (e.autorizadoPor ? ' <span class="badge amar">autorizado: ' + esc(e.autorizadoPor) + '</span>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="mudo">Sem registros na auditoria.</div>'),
      botoes: [{ rotulo: 'Fechar', classe: 'btn-primario', padrao: true, aoClicar: function (m) { m.fechar(); } }]
    });
  }

  global.Ficha = { MODELOS: MODELOS, ROTULO_ACAO: ROTULO_ACAO, editar: editar, reimprimir: reimprimir, historico: historico };
})(window);
