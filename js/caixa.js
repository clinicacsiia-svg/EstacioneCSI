/* ============================================================
   caixa.js — tela do atendente (recepção / caixa)
   Fluxo do dia a dia:
     1) bipar o ticket (ou digitar placa/número) + ENTER
     2) conferir o valor → escolher a forma de pagamento
     3) confirmar → o carro vai para a fila do manobrista
   Desconto, ticket perdido, cancelamento e retirada de dinheiro
   pedem a senha de um gerente (configurável).
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  const usuario = Auth.exigirPagina('caixa');
  if (!usuario) return;

  const R = Regras, $ = Ui.$, esc = Ui.esc, moeda = R.moeda;
  Ui.montarTopo({ pagina: 'Caixa / Recepção', ativo: 'caixa' });
  Ui.iniciarRelogios();

  const METODOS = [['dinheiro', '💵', 'Dinheiro'], ['pix', '📱', 'PIX'], ['debito', '💳', 'Débito'], ['credito', '💳', 'Crédito']];
  const busca = $('#busca');

  // ============================================================
  //  ABAS
  // ============================================================
  function mostrarAba(nome) {
    Ui.$$('.aba').forEach(a => { a.hidden = a.id !== 'aba-' + nome; });
    Ui.$$('.abas-topo button').forEach(b => b.classList.toggle('ativo', b.dataset.aba === nome));
    if (nome === 'receber') focarBusca();
    if (nome === 'caixa') renderCaixa();
    if (nome === 'atendimento') renderAtendimento();
  }
  Ui.$$('.abas-topo button').forEach(b => b.addEventListener('click', () => mostrarAba(b.dataset.aba)));
  function focarBusca() { if (!$('#aba-receber').hidden) setTimeout(() => busca.focus(), 60); }

  // ============================================================
  //  RECEBER: busca + lista
  // ============================================================
  function statusTexto(t) {
    const cfg = Dados.config;
    switch (t.status) {
      case 'PAGO': return `Ticket #${t.id} (${t.placa}) já está PAGO e na fila do manobrista.`;
      case 'A_CAMINHO': return `Ticket #${t.id} (${t.placa}): o manobrista já está trazendo o veículo.`;
      case 'ENTREGUE': return `Ticket #${t.id} (${t.placa}) já foi ENTREGUE em ${Ui.dataHora(t.entregueEm)}.`;
      case 'CANCELADO': return `Ticket #${t.id} (${t.placa}) foi CANCELADO.`;
      default: return `Ticket #${t.id} — ${R.descricaoVeiculo(t, cfg)}`;
    }
  }

  function limparBusca() { busca.value = ''; renderReceber(); }

  function resolverBusca() {
    const q = R.limparCodigo(busca.value), dica = $('#busca-dica');
    if (!q) return;
    const porId = Dados.tickets.find(t => t.id === q);
    if (porId) { tratar(porId); return; }
    const aPagar = R.buscar(Dados.tickets.filter(t => t.status === 'ESTACIONADO'), q);
    if (aPagar.length === 1) { tratar(aPagar[0]); return; }
    if (aPagar.length > 1) { dica.className = 'dica'; dica.textContent = `${aPagar.length} veículos combinam. Toque em "Receber" no correto.`; return; }
    const outro = R.buscar(Dados.tickets, q)[0];
    if (outro) { Ui.toast(statusTexto(outro), 'info', 6000); limparBusca(); return; }
    dica.className = 'dica erro'; dica.textContent = 'Nenhum ticket ou placa encontrado. Confira o número.';
  }

  function tratar(t) {
    if (t.status === 'ESTACIONADO') { limparBusca(); abrirPagamento(t.id); }
    else { Ui.toast(statusTexto(t), 'info', 6000); limparBusca(); }
  }

  busca.addEventListener('input', () => { $('#busca-dica').className = 'dica'; $('#busca-dica').textContent = 'Pressione ENTER para abrir o pagamento.'; renderReceber(); });
  busca.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); resolverBusca(); } });

  function renderReceber() {
    const agora = Date.now(), cfg = Dados.config;
    let lista = Dados.tickets.filter(t => t.status === 'ESTACIONADO').sort((a, b) => b.entradaEm - a.entradaEm);
    const total = lista.length;
    if (busca.value.trim()) lista = R.buscar(lista, busca.value);
    $('#lista-receber').innerHTML = lista.length ? lista.slice(0, 100).map(t => {
      const dev = R.calcularDevido(t, agora, cfg, Op.mensalistaDe(t, agora));
      const excedente = dev.quitado > 0;
      const mens = Op.mensalistaDe(t, agora);
      return `<div class="item ${excedente ? 'amar' : ''}">
        <div class="item-corpo">
          <div><span class="item-ticket">#${esc(t.id)}</span>
            ${mens ? '<span class="badge amar">Mensalista</span>' : ''}${excedente ? `<span class="badge verm">EXCEDENTE · já pago ${moeda(dev.quitado)}</span>` : ''}
            ${(t.avarias && t.avarias.length) || t.obs ? '<span class="badge">com observações</span>' : ''}</div>
          <div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · entrada ${Ui.hora(t.entradaEm)} · há <b data-desde="${t.entradaEm}" data-fmt="min">—</b></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <div class="item-valor">${dev.aCobrar === 0 ? '<span class="mudo" style="font-size:1rem">sem cobrança</span>' : moeda(dev.aCobrar)}</div>
          <button type="button" class="btn btn-sucesso btn-grande" data-acao="receber" data-id="${esc(t.id)}">Receber</button>
          <span><button type="button" class="btn btn-link" data-acao="ficha" data-id="${esc(t.id)}">✏️ corrigir</button>
          <button type="button" class="btn btn-link" data-acao="cancelar" data-id="${esc(t.id)}" style="color:var(--verm-700)">cancelar</button></span>
        </div>
      </div>`;
    }).join('') + (lista.length > 100 ? '<div class="vazio">Mostrando 100. Use a busca.</div>' : '')
      : `<div class="vazio">${total ? 'Nenhum veículo combina com a busca.' : 'Nenhum veículo aguardando pagamento. 🎉'}</div>`;
    const c = $('#c-receber'); c.textContent = total; c.classList.toggle('zero', !total);
  }

  $('#lista-receber').addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]'); if (!b) return;
    const id = b.dataset.id, a = b.dataset.acao;
    if (a === 'receber') abrirPagamento(id);
    else if (a === 'ficha') Ficha.editar(id);
    else if (a === 'cancelar') cancelarTicket(id);
  });

  async function cancelarTicket(id) {
    const t = Op.achar(id); if (!t) return;
    const motivo = await Ui.perguntar({ titulo: `Cancelar ticket #${id}`, mensagem: `${t.placa} — use apenas para entrada registrada por engano.`, rotulo: 'Motivo do cancelamento', dica: 'Ex.: placa digitada errada, carro não ficou' });
    if (!motivo) return;
    if (!(await Auth.autorizar('entrada.cancelar', `Cancelar o ticket #${id} (${t.placa}): ${motivo}`))) { Ui.toast('Cancelamento não autorizado.', 'aviso'); return; }
    const r = Op.cancelarEntrada(id, motivo);
    Ui.toast(r.ok ? 'Ticket cancelado.' : r.erro, r.ok ? 'sucesso' : 'erro');
  }

  // ============================================================
  //  PAGAMENTO
  // ============================================================
  function abrirPagamento(id) {
    if (!Op.caixaAberto(usuario.id)) { Ui.toast('Abra o seu caixa antes de receber.', 'aviso'); mostrarAba('caixa'); return; }
    const t = Op.achar(id);
    if (!t) return;
    if (t.status !== 'ESTACIONADO') { Ui.toast(statusTexto(t), 'info', 6000); return; }

    const cfg = Dados.config, quando = Date.now();
    const dev = R.calcularDevido(t, quando, cfg, Op.mensalistaDe(t, quando));
    const bruto = dev.aCobrar;
    const pg = { desconto: null, metodo: null, recebido: null, perdido: false };

    const m = Ui.modal({
      titulo: 'Receber pagamento', largura: 'md',
      html: `<div class="centro mb">
          <div class="item-ticket">Ticket #${esc(t.id)}</div><div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · entrada ${Ui.hora(t.entradaEm)} · permanência ${R.duracao(dev.tarifa.minutos)}</div>
          ${dev.quitado > 0 ? `<div class="badge amar mt">Excedente — já pago ${moeda(dev.quitado)}</div>` : ''}
        </div>
        <div class="card ok centro mb" style="padding:12px">
          <div class="rotulo" style="margin:0">VALOR A PAGAR</div>
          <div id="pg-total" style="font-size:2.7rem;font-weight:700;color:var(--verde-700);line-height:1.15"></div>
          <div id="pg-desc" class="pequeno amar negrito"></div>
          <details class="pequeno mt"><summary style="cursor:pointer">Ver cálculo</summary><div id="pg-linhas" style="text-align:left;margin-top:6px"></div></details>
        </div>
        <div class="gap mb" id="pg-extras">
          <button type="button" class="btn btn-sm btn-contorno" id="pg-b-desc">🏷️ Desconto / cortesia</button>
          <button type="button" class="btn btn-sm btn-contorno" id="pg-b-perdido">🎫 Cliente perdeu o ticket</button>
        </div>
        <div class="card perigo mb" id="pg-perdido" hidden>
          <b>🎫 Ticket perdido</b>
          <div class="pequeno mb">Confira o documento. Não se cobra multa por perda de ticket — apenas a tarifa normal (o valor acima).</div>
          <div class="linha-campos">
            <div class="campo"><label class="rotulo" for="pd-nome">Nome completo</label><input id="pd-nome" type="text" maxlength="60" autocomplete="off"></div>
            <div class="campo"><label class="rotulo" for="pd-doc">CPF ou RG</label><input id="pd-doc" type="text" maxlength="20" autocomplete="off"></div>
            <div class="campo"><label class="rotulo" for="pd-tel">Telefone</label><input id="pd-tel" type="tel" maxlength="15" autocomplete="off"></div>
          </div>
        </div>
        <div id="pg-metodos-box"><div class="rotulo">Forma de pagamento</div>
          <div class="grade-4" id="pg-metodos">${METODOS.map(([k, e, n]) => `<button type="button" class="tile" data-metodo="${k}"><span class="emoji" aria-hidden="true">${e}</span>${n}</button>`).join('')}</div></div>
        <div id="pg-dinheiro" class="mt" hidden>
          <div class="rotulo">Valor recebido do cliente</div>
          <div class="chips" id="pg-notas"></div>
          <input id="pg-recebido" type="text" inputmode="decimal" placeholder="0,00" class="input-busca mt" autocomplete="off">
          <div id="pg-troco" class="centro mt" style="font-size:1.6rem;font-weight:700"></div>
        </div>
        <div class="dica erro" id="pg-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
        { id: 'ok', rotulo: 'Confirmar', classe: 'btn-sucesso', padrao: true, desabilitado: true, aoClicar: confirmar }
      ]
    });
    const c = m.corpo;

    const totalAtual = () => bruto - R.calcularDesconto(bruto, pg.desconto);

    function atualizar() {
      const desc = R.calcularDesconto(bruto, pg.desconto), tot = bruto - desc;
      $('#pg-total', c).textContent = moeda(tot);
      $('#pg-desc', c).textContent = desc ? `Desconto de ${moeda(desc)} — ${pg.desconto.motivo}` : '';
      const l = (a, b, neg) => `<div style="display:flex;justify-content:space-between;gap:10px"><span>${esc(a)}</span><span class="${neg ? 'verm' : ''}">${esc(b)}</span></div>`;
      $('#pg-linhas', c).innerHTML = dev.tarifa.linhas.map(x => l(x.d, moeda(x.v))).join('') +
        (dev.quitado ? l('Já pago antes', '-' + moeda(dev.quitado), true) : '') + (desc ? l('Desconto', '-' + moeda(desc), true) : '') +
        `<div class="negrito">${l('A pagar', moeda(tot))}</div>`;
      $('#pg-b-desc', c).hidden = bruto === 0;
      $('#pg-b-desc', c).textContent = pg.desconto ? '🏷️ Alterar desconto' : '🏷️ Desconto / cortesia';
      $('#pg-b-perdido', c).textContent = pg.perdido ? '✖ Não perdeu o ticket' : '🎫 Cliente perdeu o ticket';
      $('#pg-perdido', c).hidden = !pg.perdido;
      $('#pg-metodos-box', c).hidden = tot === 0;
      Ui.$$('[data-metodo]', c).forEach(b => b.classList.toggle('sel', b.dataset.metodo === pg.metodo));
      const din = tot > 0 && pg.metodo === 'dinheiro';
      $('#pg-dinheiro', c).hidden = !din;
      if (din) {
        const notas = [2000, 5000, 10000, 20000].filter(n => n > tot).slice(0, 3);
        $('#pg-notas', c).innerHTML = [tot].concat(notas).map((n, i) =>
          `<button type="button" class="chip ${pg.recebido === n ? 'sel' : ''}" data-nota="${n}">${i === 0 ? 'Exato' : moeda(n)}</button>`).join('');
        const tr = $('#pg-troco', c);
        if (pg.recebido == null) tr.textContent = '';
        else if (pg.recebido >= tot) { tr.textContent = 'Troco: ' + moeda(pg.recebido - tot); tr.style.color = 'var(--verde-700)'; }
        else { tr.textContent = 'Faltam ' + moeda(tot - pg.recebido); tr.style.color = 'var(--verm-700)'; }
      }
      let ok = tot === 0 || (!!pg.metodo && (pg.metodo !== 'dinheiro' || (pg.recebido != null && pg.recebido >= tot)));
      if (pg.perdido) ok = ok && $('#pd-nome', c).value.trim().length >= 3 && $('#pd-doc', c).value.trim().length >= 5;
      const btn = m.botao('ok');
      btn.disabled = !ok || processando;
      btn.textContent = tot === 0 ? '✅ Liberar (sem cobrança)' : `✅ Confirmar ${moeda(tot)}`;
    }

    c.addEventListener('click', ev => {
      const mt = ev.target.closest('[data-metodo]');
      if (mt) { pg.metodo = mt.dataset.metodo; if (pg.metodo !== 'dinheiro') pg.recebido = null; atualizar(); if (pg.metodo === 'dinheiro') $('#pg-recebido', c).focus(); return; }
      const nt = ev.target.closest('[data-nota]');
      if (nt) { pg.recebido = Number(nt.dataset.nota); $('#pg-recebido', c).value = (pg.recebido / 100).toFixed(2).replace('.', ','); atualizar(); return; }
      if (ev.target.closest('#pg-b-perdido')) { pg.perdido = !pg.perdido; atualizar(); if (pg.perdido) $('#pd-nome', c).focus(); return; }
      if (ev.target.closest('#pg-b-desc')) abrirDesconto();
    });
    $('#pg-recebido', c).addEventListener('input', e => { pg.recebido = R.parseMoeda(e.target.value); atualizar(); });
    Ui.$$('#pd-nome,#pd-doc,#pd-tel', c).forEach(i => i.addEventListener('input', atualizar));

    function abrirDesconto() {
      let tipo = pg.desconto ? pg.desconto.tipo : 'percentual';
      const md = Ui.modal({
        titulo: 'Desconto / cortesia', largura: 'sm',
        html: `<div class="grade-3 mb" id="d-tipos"></div>
          <div id="d-valor-box" class="mb"><label class="rotulo" id="d-valor-rot" for="d-valor"></label><input id="d-valor" type="text" inputmode="decimal" autocomplete="off" data-foco></div>
          <div class="campo mb"><label class="rotulo" for="d-motivo">Motivo (obrigatório)</label>
            <select id="d-motivo">${R.MOTIVOS_DESCONTO.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
          <div class="campo mb" id="d-outro-box" hidden><input id="d-outro" type="text" maxlength="60" placeholder="Descreva o motivo"></div>
          <div class="dica erro" id="d-erro" role="alert"></div>`,
        botoes: [
          { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
          pg.desconto ? { rotulo: 'Remover', classe: 'btn-perigo', aoClicar: mm => { pg.desconto = null; mm.fechar(); atualizar(); } } : null,
          { rotulo: 'Aplicar', classe: 'btn-primario', padrao: true, aoClicar: aplicar }
        ].filter(Boolean)
      });
      const d = md.corpo;
      const desenhar = () => {
        $('#d-tipos', d).innerHTML = [['cortesia', 'Cortesia', '100%'], ['percentual', 'Percentual', '%'], ['valor', 'Valor', 'R$']]
          .map(([k, n, s]) => `<button type="button" class="tile ${tipo === k ? 'sel' : ''}" data-tipo="${k}">${n}<small>${s}</small></button>`).join('');
        $('#d-valor-box', d).hidden = tipo === 'cortesia';
        $('#d-valor-rot', d).textContent = tipo === 'percentual' ? 'Percentual de desconto (1 a 100)' : 'Valor do desconto (R$)';
      };
      desenhar();
      if (pg.desconto) {
        if (pg.desconto.tipo === 'percentual') $('#d-valor', d).value = String(pg.desconto.valor);
        else if (pg.desconto.tipo === 'valor') $('#d-valor', d).value = (pg.desconto.valor / 100).toFixed(2).replace('.', ',');
        const opt = R.MOTIVOS_DESCONTO.indexOf(pg.desconto.motivo);
        if (opt > -1) $('#d-motivo', d).selectedIndex = opt; else { $('#d-motivo', d).value = 'Outro'; $('#d-outro-box', d).hidden = false; $('#d-outro', d).value = pg.desconto.motivo; }
      }
      d.addEventListener('click', ev => { const b = ev.target.closest('[data-tipo]'); if (b) { tipo = b.dataset.tipo; desenhar(); } });
      $('#d-motivo', d).addEventListener('change', e => { $('#d-outro-box', d).hidden = e.target.value !== 'Outro'; });
      function aplicar(mm) {
        const er = $('#d-erro', d); er.textContent = '';
        let valor = 0;
        if (tipo === 'percentual') {
          valor = Number(String($('#d-valor', d).value).replace(',', '.'));
          if (!(valor > 0 && valor <= 100)) { er.textContent = 'Informe um percentual entre 1 e 100.'; return; }
        } else if (tipo === 'valor') {
          valor = R.parseMoeda($('#d-valor', d).value);
          if (!(valor > 0)) { er.textContent = 'Informe o valor do desconto.'; return; }
          if (valor > bruto) { er.textContent = 'O desconto não pode ser maior que o valor a pagar.'; return; }
        }
        let motivo = $('#d-motivo', d).value;
        if (motivo === 'Outro') { motivo = $('#d-outro', d).value.trim(); if (motivo.length < 3) { er.textContent = 'Descreva o motivo.'; return; } }
        pg.desconto = { tipo: tipo, valor: valor, motivo: motivo };
        mm.fechar(); atualizar();
      }
    }

    let processando = false;
    async function confirmar(mm) {
      if (processando) return; // impede duplo envio (clique duplo, Enter repetido)
      processando = true;
      const btn = mm.botao('ok');
      btn.disabled = true;
      const erroEl = $('#pg-erro', c); erroEl.textContent = '';
      const acoes = [];
      if (pg.desconto) acoes.push('pagamento.desconto');
      if (pg.perdido) acoes.push('pagamento.ticketPerdido');
      const desc = R.calcularDesconto(bruto, pg.desconto);
      const texto = `${t.placa}: ` + [pg.desconto ? `desconto de ${moeda(desc)} (${pg.desconto.motivo})` : '', pg.perdido ? 'entrega sem ticket (perdido)' : ''].filter(Boolean).join(' e ');
      if (acoes.length && !(await Auth.autorizar(acoes, texto))) {
        erroEl.textContent = 'Autorização do gerente não concedida.'; processando = false; atualizar(); return;
      }
      const r = Op.pagar(id, {
        metodo: pg.metodo, recebido: pg.recebido, calculadoEm: quando, desconto: pg.desconto,
        perdido: pg.perdido ? { nome: $('#pd-nome', c).value, documento: $('#pd-doc', c).value, telefone: $('#pd-tel', c).value } : null
      });
      if (!r.ok) {
        if (r.codigo === 'VALOR_MUDOU' || r.codigo === 'CONFLITO' || r.codigo === 'SEM_CAIXA') {
          mm.fechar(); Ui.toast(r.erro, 'aviso', 6000);
          if (r.codigo === 'VALOR_MUDOU') abrirPagamento(id);
          return;
        }
        erroEl.textContent = r.erro; processando = false; atualizar(); return;
      }
      mm.fechar();
      sucessoPagamento(r.ticket, r.pagamento);
    }

    atualizar();
  }

  function sucessoPagamento(t, p) {
    const troco = p.metodo === 'dinheiro' && p.troco > 0;
    Ui.modal({
      titulo: 'Pagamento confirmado', largura: 'sm', semFechar: true, aoFechar: focarBusca,
      html: `<div class="centro"><div style="font-size:3rem" aria-hidden="true">✅</div>
        <div class="item-placa">${esc(t.placa)}</div>
        <div class="negrito" style="font-size:1.4rem">${moeda(p.valor)} <span class="mudo" style="font-size:1rem">${esc(R.METODOS[p.metodo])}</span></div>
        ${troco ? `<div class="card alerta mt"><div class="rotulo" style="margin:0">DEVOLVER TROCO</div><div style="font-size:2.7rem;font-weight:700">${moeda(p.troco)}</div></div>` : ''}
        <p class="mudo mt" style="margin-bottom:0">${t.ticketPerdido ? '⚠ Ticket perdido: o manobrista vai conferir o documento.' : 'Veículo enviado para a fila do manobrista.'}</p></div>`,
      botoes: [
        { rotulo: '🧾 Recibo', classe: 'btn-contorno', aoClicar: () => Impressao.imprimirRecibo(t, p) },
        p.valor > 0 ? { rotulo: '📄 Nota fiscal', classe: 'btn-contorno', aoClicar: () => Nota.emitir(t.id, p.id) } : null,
        { rotulo: 'Concluir', classe: 'btn-primario', padrao: true, aoClicar: mm => mm.fechar() }
      ].filter(Boolean)
    });
  }

  // ============================================================
  //  NA FILA (já pagos)
  // ============================================================
  function renderAtendimento() {
    const cfg = Dados.config;
    const lista = Dados.tickets.filter(t => t.status === 'PAGO' || t.status === 'A_CAMINHO').sort((a, b) => a.pagoEm - b.pagoEm);
    const c = $('#c-atend'); c.textContent = lista.length; c.classList.toggle('zero', !lista.length);
    $('#lista-atend').innerHTML = lista.length ? lista.map(t => {
      const up = R.ultimoPagamento(t);
      const nafila = t.status === 'PAGO';
      return `<div class="item ${t.ticketPerdido ? 'verm' : (nafila ? 'azul' : 'verde')}">
        <div class="item-corpo">
          <div><span class="item-ticket">#${esc(t.id)}</span> <span class="badge ${nafila ? 'azul' : 'verde'}">${nafila ? 'Na fila do manobrista' : 'A caminho'}</span>
            ${t.ticketPerdido ? '<span class="badge verm">Ticket perdido</span>' : ''}</div>
          <div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · ${nafila ? 'esperando' : 'a caminho há'} <b data-desde="${nafila ? t.pagoEm : t.buscaEm}" data-fmt="cron" ${nafila ? 'data-alerta="3,6"' : ''}>00:00</b>
            · pago ${up ? moeda(up.valor) + ' (' + esc(R.METODOS[up.metodo]) + ') às ' + Ui.hora(up.em) : '—'}</div>
        </div>
        <div class="item-acoes">
          ${up ? `<button type="button" class="btn btn-sm btn-contorno" data-acao="recibo" data-id="${esc(t.id)}">🧾 Recibo</button>` : ''}
          ${nafila && Auth.pode('pagamento.estornar') ? `<button type="button" class="btn btn-sm btn-perigo" data-acao="estornar" data-id="${esc(t.id)}">↩ Estornar</button>` : ''}
        </div></div>`;
    }).join('') : '<div class="vazio">Nenhum veículo pago aguardando o manobrista.</div>';
  }

  $('#lista-atend').addEventListener('click', async ev => {
    const b = ev.target.closest('[data-acao]'); if (!b) return;
    const id = b.dataset.id, t = Op.achar(id); if (!t) return;
    if (b.dataset.acao === 'recibo') { Impressao.imprimirRecibo(t, R.ultimoPagamento(t)); }
    if (b.dataset.acao === 'estornar') {
      const motivo = await Ui.perguntar({ titulo: `Estornar pagamento #${id}`, mensagem: `${t.placa} volta para "aguardando pagamento".`, rotulo: 'Motivo do estorno', dica: 'Ex.: forma de pagamento errada' });
      if (!motivo) return;
      const r = Op.estornar(id, motivo);
      Ui.toast(r.ok ? 'Pagamento estornado. Devolva o valor ao cliente.' : r.erro, r.ok ? 'sucesso' : 'erro', 6000);
    }
  });

  // ============================================================
  //  MEU CAIXA (turno)
  // ============================================================
  function renderCaixa() {
    const cx = Op.caixaAberto(usuario.id);
    $('#ponto-caixa').classList.toggle('on', !!cx);
    const box = $('#conteudo-caixa');
    if ($('#aba-caixa').hidden) return;
    if (!cx) {
      if (document.activeElement && document.activeElement.id === 'fundo') return;
      const meus = Dados.caixas.filter(x => x.operadorId === usuario.id && x.fechadoEm).sort((a, b) => b.fechadoEm - a.fechadoEm).slice(0, 5);
      box.innerHTML = `<div class="card"><h2 class="titulo-pagina">Abrir caixa</h2>
        <p class="mudo" style="margin-top:0">Conte o dinheiro de troco que está na gaveta e informe abaixo. Sem caixa aberto não é possível receber pagamentos.</p>
        <label class="rotulo" for="fundo">Fundo de troco (R$)</label>
        <input id="fundo" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" data-foco>
        <button type="button" class="btn btn-sucesso btn-grande btn-bloco mt" data-acao="abrir">🔓 Abrir caixa</button></div>` +
        (meus.length ? `<div class="card mt"><h3 class="mb">Seus últimos fechamentos</h3><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Caixa</th><th>Fechado</th><th class="num">Total</th><th class="num">Diferença</th></tr></thead><tbody>` +
          meus.map(x => `<tr><td>nº ${x.numero}</td><td>${Ui.dataHora(x.fechadoEm)}</td><td class="num">${moeda(x.resumo ? x.resumo.total : 0)}</td><td class="num ${x.diferenca ? (x.diferenca < 0 ? 'verm' : 'amar') : 'verde'}">${moeda(x.diferenca)}</td></tr>`).join('') + '</tbody></table></div></div>' : '');
      Ui.campoMoeda($('#fundo'));
      return;
    }
    const res = R.resumoCaixa(cx, Dados.tickets);
    const antigo = R.inicioDoDia(cx.abertoEm) < R.inicioDoDia(Date.now());
    box.innerHTML = `${antigo ? '<div class="card alerta mb"><b>⚠ Este caixa está aberto desde ' + Ui.dataHora(cx.abertoEm) + '.</b> Feche-o ao final do turno.</div>' : ''}
      <div class="card ok mb"><b>Caixa nº ${cx.numero} aberto</b> <span class="mudo pequeno">desde ${Ui.dataHora(cx.abertoEm)} · fundo ${moeda(cx.fundo)}</span></div>
      <div class="grade-kpi mb">
        <div class="kpi verde"><div class="kpi-rot">Total recebido</div><div class="kpi-val">${moeda(res.total)}</div><div class="kpi-sub">${res.qtd} pagamento(s)</div></div>
        <div class="kpi"><div class="kpi-rot">Dinheiro esperado na gaveta</div><div class="kpi-val">${moeda(res.esperadoDinheiro)}</div><div class="kpi-sub">fundo ${moeda(cx.fundo)} + dinheiro ${moeda(res.dinheiro)} − retiradas ${moeda(res.sangrias)}</div></div>
        <div class="kpi amar"><div class="kpi-rot">Descontos dados</div><div class="kpi-val">${moeda(res.descontos)}</div><div class="kpi-sub">${(cx.sangrias || []).length} retirada(s) no caixa</div></div>
      </div>
      <div class="card mb"><h3 class="mb">Por forma de pagamento</h3><div class="tabela-wrap"><table class="tabela"><tbody>` +
      Object.keys(R.METODOS).filter(k => res.porMetodo[k] && res.porMetodo[k].qtd).map(k => `<tr><td>${esc(R.METODOS[k])}</td><td class="num">${res.porMetodo[k].qtd}×</td><td class="num negrito">${moeda(res.porMetodo[k].valor)}</td></tr>`).join('') +
      (res.qtd ? '' : '<tr><td class="mudo">Nenhum pagamento ainda.</td></tr>') + `</tbody></table></div></div>
      <div class="gap mb"><button type="button" class="btn btn-contorno btn-grande" data-acao="sangria">💸 Retirada (sangria)</button>
        <button type="button" class="btn btn-perigo btn-grande" data-acao="fechar">🔒 Fechar caixa</button></div>
      <div class="card"><h3 class="mb">Pagamentos deste caixa</h3><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Hora</th><th>Ticket</th><th>Placa</th><th>Forma</th><th class="num">Valor</th><th></th></tr></thead><tbody>` +
      (res.pagamentos.length ? res.pagamentos.slice(0, 60).map(({ ticket: t, pagamento: p }) =>
        `<tr><td>${Ui.hora(p.em)}</td><td>#${esc(t.id)}</td><td class="mono">${esc(t.placa)}</td><td>${esc(R.METODOS[p.metodo])}${p.desconto ? ' <span class="badge amar">desc.</span>' : ''}</td><td class="num">${moeda(p.valor)}</td>` +
        `<td class="direita"><button type="button" class="btn btn-sm btn-link" data-recibo="${esc(t.id)}" data-pid="${esc(p.id)}">recibo</button>` +
        (p.nota ? ` <span class="badge verde" title="Nota fiscal de serviço">NFS-e ${esc(p.nota.numero)}</span>`
          : (Nota.podeEmitir(p) ? ` <button type="button" class="btn btn-sm btn-link" data-emitir-nota="${esc(t.id)}" data-pid="${esc(p.id)}">nota fiscal</button>` : '')) +
        `</td></tr>`).join('')
        : '<tr><td colspan="6" class="vazio">Nada por aqui ainda.</td></tr>') + '</tbody></table></div></div>';
  }

  $('#conteudo-caixa').addEventListener('click', ev => {
    const rb = ev.target.closest('[data-recibo]');
    if (rb) {
      const t = Op.achar(rb.dataset.recibo), p = t && t.pagamentos.find(x => x.id === rb.dataset.pid);
      if (t && p) Impressao.imprimirRecibo(t, p);
      return;
    }
    const nf = ev.target.closest('[data-emitir-nota]');
    if (nf) { Nota.emitir(nf.dataset.emitirNota, nf.dataset.pid); return; }
    const b = ev.target.closest('[data-acao]'); if (!b) return;
    const a = b.dataset.acao;
    if (a === 'abrir') {
      const v = $('#fundo').value.trim() === '' ? 0 : Ui.valorCampoMoeda($('#fundo'));
      if (v === null) { Ui.toast('Valor inválido.', 'erro'); return; }
      const r = Op.abrirCaixa(v);
      Ui.toast(r.ok ? 'Caixa aberto. Bom trabalho!' : r.erro, r.ok ? 'sucesso' : 'erro');
      if (r.ok) mostrarAba('receber');
    } else if (a === 'sangria') abrirSangria();
    else if (a === 'fechar') abrirFechamento();
  });

  function abrirSangria() {
    const cx = Op.caixaAberto(usuario.id); if (!cx) return;
    const disp = R.resumoCaixa(cx, Dados.tickets).esperadoDinheiro;
    Ui.modal({
      titulo: 'Retirada de dinheiro (sangria)', largura: 'sm',
      html: `<p class="mudo" style="margin-top:0">Dinheiro disponível no caixa: <b>${moeda(disp)}</b></p>
        <label class="rotulo" for="s-valor">Valor retirado (R$)</label><input id="s-valor" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" data-foco autocomplete="off">
        <label class="rotulo mt" for="s-motivo">Motivo</label><input id="s-motivo" type="text" maxlength="60" placeholder="Ex.: levado ao cofre" autocomplete="off">
        <div class="dica erro" id="s-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: m => m.fechar() },
        {
          rotulo: 'Registrar retirada', classe: 'btn-primario', padrao: true, aoClicar: async m => {
            const v = Ui.valorCampoMoeda($('#s-valor', m.corpo)), mot = $('#s-motivo', m.corpo).value.trim(), er = $('#s-erro', m.corpo);
            if (!(v > 0)) { er.textContent = 'Informe o valor.'; return; }
            if (mot.length < 3) { er.textContent = 'Informe o motivo.'; return; }
            if (v > disp) { er.textContent = 'Não há tanto dinheiro no caixa.'; return; }
            if (!(await Auth.autorizar('caixa.sangria', `Retirada de ${moeda(v)} do caixa: ${mot}`))) { er.textContent = 'Autorização do gerente não concedida.'; return; }
            const r = Op.sangria(cx.id, v, mot);
            if (!r.ok) { er.textContent = r.erro; return; }
            m.fechar(); Ui.toast('Retirada registrada.');
          }
        }
      ]
    });
  }

  function abrirFechamento() {
    const cx = Op.caixaAberto(usuario.id); if (!cx) return;
    const res = R.resumoCaixa(cx, Dados.tickets);
    const l = (a, b, forte) => `<div style="display:flex;justify-content:space-between;gap:10px;${forte ? 'font-weight:700' : ''}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
    const m = Ui.modal({
      titulo: `Fechar caixa nº ${cx.numero}`, largura: 'md',
      html: `<div class="card mb" style="background:var(--cinza-50);box-shadow:none">` +
        Object.keys(R.METODOS).filter(k => res.porMetodo[k] && res.porMetodo[k].qtd).map(k => l(`${R.METODOS[k]} (${res.porMetodo[k].qtd})`, moeda(res.porMetodo[k].valor))).join('') +
        l('TOTAL RECEBIDO', moeda(res.total), true) + '<hr style="border:0;border-top:1px solid var(--cinza-300)">' +
        l('Fundo de troco', moeda(cx.fundo)) + l('+ Dinheiro recebido', moeda(res.dinheiro)) + l('− Retiradas', moeda(res.sangrias)) +
        l('Dinheiro esperado na gaveta', moeda(res.esperadoDinheiro), true) + `</div>
        <label class="rotulo" for="f-contado">Dinheiro contado na gaveta (R$)</label>
        <input id="f-contado" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" data-foco autocomplete="off">
        <div id="f-dif" class="centro negrito mt" style="font-size:1.3rem;min-height:1.6em"></div>
        <label class="rotulo mt" for="f-obs">Observação <span class="mudo" id="f-obs-obrig"></span></label>
        <textarea id="f-obs" maxlength="200"></textarea>
        <div class="dica erro" id="f-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
        { rotulo: '🔒 Fechar caixa', classe: 'btn-perigo', padrao: true, aoClicar: fechar }
      ]
    });
    const d = m.corpo;
    Ui.campoMoeda($('#f-contado', d));
    $('#f-contado', d).addEventListener('input', () => {
      const v = Ui.valorCampoMoeda($('#f-contado', d)), el = $('#f-dif', d);
      if (v === null) { el.textContent = ''; $('#f-obs-obrig', d).textContent = ''; return; }
      const dif = v - res.esperadoDinheiro;
      el.textContent = dif === 0 ? '✅ Caixa confere' : (dif > 0 ? `Sobra de ${moeda(dif)}` : `Falta de ${moeda(-dif)}`);
      el.style.color = dif === 0 ? 'var(--verde-700)' : (dif > 0 ? 'var(--amar-700)' : 'var(--verm-700)');
      $('#f-obs-obrig', d).textContent = dif === 0 ? '' : '(obrigatória: explique a diferença)';
    });
    function fechar(mm) {
      const v = Ui.valorCampoMoeda($('#f-contado', d)), er = $('#f-erro', d);
      if (v === null) { er.textContent = 'Informe o dinheiro contado (pode ser 0,00).'; return; }
      const r = Op.fecharCaixa(cx.id, v, $('#f-obs', d).value);
      if (!r.ok) { er.textContent = r.erro; return; }
      mm.fechar();
      const fechado = r.caixa, rs = R.resumoCaixa(fechado, Dados.tickets);
      Ui.modal({
        titulo: 'Caixa fechado', largura: 'sm', semFechar: true,
        html: `<div class="centro"><div style="font-size:3rem" aria-hidden="true">🔒</div>
          <div class="negrito" style="font-size:1.3rem">Total ${moeda(rs.total)}</div>
          <p class="${r.diferenca === 0 ? 'verde' : (r.diferenca < 0 ? 'verm' : 'amar')} negrito">${r.diferenca === 0 ? 'Caixa conferido, sem diferença ✅' : (r.diferenca > 0 ? 'Sobra de ' : 'Falta de ') + moeda(Math.abs(r.diferenca))}</p></div>`,
        botoes: [
          { rotulo: '🖨️ Imprimir resumo', classe: 'btn-contorno', aoClicar: () => Impressao.imprimirFechamento(fechado, rs) },
          { rotulo: 'Concluir', classe: 'btn-primario', padrao: true, aoClicar: x => x.fechar() }
        ]
      });
    }
  }

  // ============================================================
  //  AVISO DE CAIXA FECHADO + DESENHO GERAL
  // ============================================================
  function renderAviso() {
    const cx = Op.caixaAberto(usuario.id);
    $('#ponto-caixa').classList.toggle('on', !!cx);
    $('#aviso-caixa').innerHTML = cx ? '' :
      `<div class="card alerta"><div class="gap"><div class="espaco"><b>Seu caixa está fechado.</b><br><span class="mudo">Abra o caixa para começar a receber pagamentos.</span></div>
       <button type="button" class="btn btn-primario" data-acao="ir-caixa">Abrir caixa</button></div></div>`;
  }
  $('#aviso-caixa').addEventListener('click', ev => { if (ev.target.closest('[data-acao="ir-caixa"]')) mostrarAba('caixa'); });

  function renderTudo() {
    renderAviso(); renderReceber(); renderAtendimento(); renderCaixa();
  }

  Dados.aoMudar(nome => {
    if (nome === 'log' || nome === 'meta') return;
    if (!Auth.atual()) { window.location.replace('index.html'); return; }
    Ui.agendar(renderTudo);
  });
  window.setInterval(() => { renderReceber(); }, 20000); // mantém os valores em dia

  renderTudo();
  focarBusca();
  if (!Op.caixaAberto(usuario.id)) Ui.toast('Abra o seu caixa para começar.', 'info', 4500);
})();
