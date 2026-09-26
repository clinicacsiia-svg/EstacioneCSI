/* ============================================================
   manobrista.js — tela de quem trabalha na ponta (celular)
   Três abas: ENTRADA · BUSCAR (fila) · PÁTIO
   Regra de ouro: só a placa é obrigatória; o resto é toque.
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  const usuario = Auth.exigirPagina('manobrista');
  if (!usuario) return;

  const R = Regras, $ = Ui.$, esc = Ui.esc;
  Ui.montarTopo({ pagina: 'Manobrista', ativo: 'manobrista' });
  Ui.iniciarRelogios();

  $('#lista-modelos').innerHTML = Ficha.MODELOS.map(m => `<option value="${m}">`).join('');

  const est = { categoria: 'carro', cor: '', patio: null, avarias: [], filtroPatio: 'todos' };
  let vistos = null; // tickets pagos já conhecidos (para avisar quando entra um novo)

  // ============================================================
  //  ABAS
  // ============================================================
  function mostrarAba(nome) {
    Ui.$$('.aba').forEach(a => { a.hidden = a.id !== 'aba-' + nome; });
    Ui.$$('.tabbar button').forEach(b => b.classList.toggle('ativo', b.dataset.aba === nome));
    try { sessionStorage.setItem('estacionamais.abaManobrista', nome); } catch (e) { /* ok */ }
    if (nome === 'entrada') $('#placa').focus();
    if (nome === 'patio') renderPatio();
  }
  Ui.$$('.tabbar button').forEach(b => b.addEventListener('click', () => mostrarAba(b.dataset.aba)));

  // ============================================================
  //  FORMULÁRIO DE ENTRADA
  // ============================================================
  function renderCategorias() {
    const cfg = Dados.config, emoji = { carro: '🚗', moto: '🏍️', grande: '🚙' };
    if (!cfg.tabela[est.categoria]) est.categoria = 'carro';
    $('#grupo-categoria').innerHTML = Object.keys(cfg.tabela).map(k =>
      `<button type="button" class="tile ${est.categoria === k ? 'sel' : ''}" data-cat="${k}"><span class="emoji" aria-hidden="true">${emoji[k] || '🚘'}</span>${esc(cfg.tabela[k].rotulo)}</button>`).join('');
  }

  function renderPatios() {
    const cfg = Dados.config, oc = R.ocupacao(Dados.tickets, cfg);
    const ativos = cfg.patios.filter(p => p.ativo !== false);
    if (!est.patio || !ativos.some(p => p.id === est.patio)) {
      const ult = Dados.meta.ultimoPatio;
      est.patio = ativos.some(p => p.id === ult) ? ult : ativos[0].id;
    }
    $('#grupo-patio').innerHTML = ativos.map(p => {
      const usados = oc[p.id] ? oc[p.id].usados : 0, cheio = p.capacidade > 0 && usados >= p.capacidade;
      return `<button type="button" class="tile ${est.patio === p.id ? 'sel' : ''} ${cheio ? 'cheio' : ''}" data-patio="${esc(p.id)}">${esc(p.nome)}<small>${usados}${p.capacidade ? ' / ' + p.capacidade : ''} ${usados === 1 && !p.capacidade ? 'carro' : 'carros'}${cheio ? ' · LOTADO' : ''}</small></button>`;
    }).join('');
  }

  function renderCores() {
    $('#grupo-cor').innerHTML = R.CORES.map(([nome, css]) =>
      `<button type="button" class="chip ${est.cor === nome ? 'sel' : ''}" data-cor="${nome}"><span class="amostra" style="background:${css}"></span>${nome}</button>`).join('');
  }

  function renderAvarias() {
    $('#grupo-avarias').innerHTML = R.AVARIAS.map(a =>
      `<button type="button" class="chip ${est.avarias.includes(a) ? 'sel' : ''}" data-avaria="${esc(a)}">${esc(a)}</button>`).join('');
    $('#resumo-extras').textContent = est.avarias.length ? '· ' + est.avarias.length + ' marcada(s)' : '· nenhuma marcada';
  }

  $('#grupo-categoria').addEventListener('click', ev => { const b = ev.target.closest('[data-cat]'); if (b) { est.categoria = b.dataset.cat; renderCategorias(); } });
  $('#grupo-patio').addEventListener('click', ev => { const b = ev.target.closest('[data-patio]'); if (b) { est.patio = b.dataset.patio; renderPatios(); } });
  $('#grupo-cor').addEventListener('click', ev => { const b = ev.target.closest('[data-cor]'); if (b) { est.cor = est.cor === b.dataset.cor ? '' : b.dataset.cor; renderCores(); } });
  $('#grupo-avarias').addEventListener('click', ev => {
    const b = ev.target.closest('[data-avaria]'); if (!b) return;
    const a = b.dataset.avaria;
    est.avarias = est.avarias.includes(a) ? est.avarias.filter(x => x !== a) : est.avarias.concat(a);
    renderAvarias();
  });

  // ----- placa -----
  const inPlaca = $('#placa'), chkLivre = $('#placa-livre');

  function atualizarInfoPlaca() {
    const v = inPlaca.value, info = $('#placa-info'), livre = chkLivre.checked;
    $('#linha-livre').hidden = !(v.length >= 6 || livre);
    if (!v) { info.className = 'dica'; info.textContent = ''; return; }
    const res = R.validarPlaca(v, livre);
    if (!res.ok) {
      info.className = v.length < 7 ? 'dica' : 'dica erro';
      info.textContent = v.length < 7 ? 'Digite os 7 caracteres da placa.' : res.erro;
      return;
    }
    const chave = R.chavePlaca(res.placa);
    const dentro = Dados.tickets.find(t => R.estaAtivo(t) && R.chavePlaca(t.placa) === chave);
    if (dentro) {
      info.className = 'dica erro';
      info.textContent = `⚠ Este veículo já está no pátio: ticket #${dentro.id} (${R.nomePatio(Dados.config, dentro.patio)}).`;
      return;
    }
    const mens = R.mensalistaVigente(chave, Dados.mensalistas, Date.now());
    info.className = 'dica ok';
    info.textContent = `✔ ${res.formato} · ${res.placa}` + (mens ? ` · MENSALISTA (${mens.nome}) — sem cobrança` : '');
  }

  inPlaca.addEventListener('input', () => {
    inPlaca.value = inPlaca.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, chkLivre.checked ? 10 : 7);
    atualizarInfoPlaca();
  });
  chkLivre.addEventListener('change', atualizarInfoPlaca);

  // ----- envio -----
  const form = $('#form-entrada');
  form.addEventListener('keydown', ev => {
    // Enter só envia a partir da placa; nos outros campos apenas "confirma" o campo.
    if (ev.key === 'Enter' && ev.target.id !== 'placa' && ev.target.tagName !== 'TEXTAREA' && ev.target.type !== 'submit') ev.preventDefault();
  });
  form.addEventListener('submit', ev => { ev.preventDefault(); enviarEntrada(); });

  function enviarEntrada() {
    const r = Op.registrarEntrada({
      placa: inPlaca.value, placaLivre: chkLivre.checked, categoria: est.categoria,
      modelo: $('#modelo').value, cor: est.cor, patio: est.patio, vaga: $('#vaga').value,
      telefone: $('#telefone').value, avarias: est.avarias, obs: $('#obs').value
    });
    if (!r.ok) {
      Ui.toast(r.erro, 'erro');
      inPlaca.focus();
      return;
    }
    if (r.aviso) Ui.toast(r.aviso, 'aviso', 6500);
    mostrarUltimo(r.ticket, r.mensalista);
    limparFormulario();
    Impressao.imprimirTicket(r.ticket);
  }

  function limparFormulario() {
    inPlaca.value = ''; chkLivre.checked = false;
    $('#modelo').value = ''; $('#vaga').value = ''; $('#telefone').value = ''; $('#obs').value = '';
    est.cor = ''; est.avarias = []; est.categoria = 'carro';
    $('#det-extras').open = false;
    renderCategorias(); renderCores(); renderAvarias(); renderPatios(); atualizarInfoPlaca();
    inPlaca.focus();
  }

  function mostrarUltimo(t, mens) {
    const box = $('#ultimo-ticket');
    box.hidden = false;
    box.innerHTML = `<div class="gap"><div class="espaco"><b>✔ Ticket #${esc(t.id)}</b> · <span class="mono negrito">${esc(t.placa)}</span><br>
      <span class="mudo pequeno">${esc(R.localVeiculo(t, Dados.config))}${mens ? ' · MENSALISTA (sem cobrança)' : ''}</span></div>
      <button type="button" class="btn btn-sm btn-contorno" data-reimp="${esc(t.id)}">🖨️ Reimprimir</button></div>`;
  }
  $('#ultimo-ticket').addEventListener('click', ev => {
    const b = ev.target.closest('[data-reimp]'); if (b) reimprimir(b.dataset.reimp);
  });

  const reimprimir = Ficha.reimprimir;

  // ============================================================
  //  FILA (para buscar / a caminho)
  // ============================================================
  function cartaoFila(t) {
    const cfg = Dados.config, perdido = t.ticketPerdido;
    return `<div class="item ${perdido ? 'verm' : 'azul'}">
      <div class="item-corpo" data-ficha="${esc(t.id)}" style="cursor:pointer">
        <div><span class="item-ticket">#${esc(t.id)}</span> ${perdido ? '<span class="badge verm pisca">TICKET PERDIDO</span>' : ''}</div>
        <div class="item-placa">${esc(t.placa)}</div>
        <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
        <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · esperando <b data-desde="${t.pagoEm}" data-fmt="cron" data-alerta="3,6">00:00</b></div>
      </div>
      <div class="item-acoes"><button type="button" class="btn btn-primario btn-grande" data-acao="buscar" data-id="${esc(t.id)}">🔑 BUSCAR</button></div>
    </div>`;
  }

  function cartaoCaminho(t) {
    const cfg = Dados.config, perdido = t.ticketPerdido;
    const zap = t.telefone && t.telefone.length >= 10
      ? `<a class="btn btn-sm btn-contorno" target="_blank" rel="noopener" href="https://wa.me/${t.telefone.length <= 11 ? '55' : ''}${t.telefone}?text=${encodeURIComponent('Olá! Seu veículo ' + t.placa + ' está a caminho da retirada.')}">📱 Avisar</a>` : '';
    return `<div class="item ${perdido ? 'verm' : 'verde'}">
      <div class="item-corpo" data-ficha="${esc(t.id)}" style="cursor:pointer">
        <div><span class="item-ticket">#${esc(t.id)}</span> ${perdido ? '<span class="badge verm pisca">SEM TICKET · CONFERIR DOCUMENTO</span>' : ''}</div>
        <div class="item-placa">${esc(t.placa)}</div>
        <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
        <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · a caminho há <b data-desde="${t.buscaEm}" data-fmt="cron">00:00</b></div>
      </div>
      <div class="item-acoes">
        <button type="button" class="btn btn-sucesso btn-grande" data-acao="entregar" data-id="${esc(t.id)}">${perdido ? '✅ ENTREGAR (sem ticket)' : '✅ ENTREGAR'}</button>
        ${zap}<button type="button" class="btn btn-link" data-acao="desfazer" data-id="${esc(t.id)}">desfazer</button>
      </div>
    </div>`;
  }

  function renderFila() {
    const pagos = Dados.tickets.filter(t => t.status === 'PAGO').sort((a, b) => a.pagoEm - b.pagoEm);
    const caminho = Dados.tickets.filter(t => t.status === 'A_CAMINHO').sort((a, b) => a.buscaEm - b.buscaEm);
    $('#lista-fila').innerHTML = pagos.length ? pagos.map(cartaoFila).join('') : '<div class="vazio">Nenhum carro esperando. 👍</div>';
    $('#lista-caminho').innerHTML = caminho.length ? caminho.map(cartaoCaminho).join('') : '<div class="vazio">Nenhum carro a caminho.</div>';
    const cf = $('#cont-fila'), cc = $('#cont-caminho');
    cf.textContent = pagos.length; cf.classList.toggle('zero', !pagos.length);
    cc.textContent = caminho.length; cc.classList.toggle('zero', !caminho.length);
    const mf = $('#marca-fila'); mf.textContent = pagos.length; mf.classList.toggle('zero', !pagos.length);
  }

  function verificarNovos() {
    const ids = Dados.tickets.filter(t => t.status === 'PAGO').map(t => t.id);
    if (vistos === null) { vistos = new Set(ids); return; }
    const novos = ids.filter(id => !vistos.has(id));
    vistos = new Set(ids);
    if (novos.length) {
      const t = Op.achar(novos[0]);
      Ui.bip();
      Ui.toast(`🔔 Buscar: ${t.placa}${novos.length > 1 ? ' (+' + (novos.length - 1) + ')' : ''}`, 'info', 6000);
    }
  }

  function tratarResultado(r, ok) {
    if (r.ok) { if (ok) Ui.toast(ok, 'sucesso'); return true; }
    Ui.toast(r.erro, 'erro'); return false;
  }

  ['#lista-fila', '#lista-caminho'].forEach(sel => $(sel).addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]');
    if (b) {
      const id = b.dataset.id, a = b.dataset.acao;
      if (a === 'buscar') { const r = Op.buscar(id); if (tratarResultado(r)) Ui.toast(`Buscando ${r.ticket.placa} — ${R.localVeiculo(r.ticket, Dados.config)}`, 'info'); }
      else if (a === 'entregar') abrirEntrega(id);
      else if (a === 'desfazer') Ui.confirmar({ titulo: 'Desfazer busca?', mensagem: 'O veículo volta para a fila "Para buscar".', ok: 'Desfazer' }).then(sim => { if (sim) tratarResultado(Op.desfazerBusca(id), 'Voltou para a fila.'); });
      return;
    }
    const f = ev.target.closest('[data-ficha]');
    if (f) Ficha.editar(f.dataset.ficha);
  }));

  // ============================================================
  //  ENTREGA (bipar o ticket)
  // ============================================================
  function abrirEntrega(id) {
    const t = Op.achar(id);
    if (!t || t.status !== 'A_CAMINHO') { Ui.toast('Este veículo não está mais "a caminho".', 'aviso'); return; }
    const cfg = Dados.config, p = t.ticketPerdido;
    const podeCamera = 'BarcodeDetector' in window && !!navigator.mediaDevices;
    const cab = `<div class="centro mb"><div class="item-ticket">Ticket #${esc(t.id)}</div><div class="item-placa">${esc(t.placa)}</div>
      <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div><div class="item-meta">${esc(R.localVeiculo(t, cfg))}</div></div>`;
    const corpo = p
      ? `<div class="card perigo mb"><b>⚠ TICKET PERDIDO</b><br>Quem retira: <b>${esc(p.nome)}</b><br>Documento: <b class="mono">${esc(p.documento)}</b>` +
        `${p.autorizadoPor ? '<br>Autorizado por: ' + esc(p.autorizadoPor) : ''}</div>
         <label class="check"><input type="checkbox" id="ent-doc" data-foco> Conferi o documento e o cliente descreveu o veículo corretamente.</label>
         <div class="dica erro" id="ent-erro"></div>`
      : `<label class="rotulo" for="ent-cod">Bipe o ticket ou digite o número</label>
         <input id="ent-cod" class="input-busca" type="text" inputmode="numeric" autocomplete="off" data-foco placeholder="#${esc(t.id)}">
         ${podeCamera ? '<button type="button" class="btn btn-contorno btn-bloco mt" id="ent-cam">📷 Ler com a câmera</button>' : ''}
         <div class="dica erro" id="ent-erro" role="alert"></div>`;

    const m = Ui.modal({
      titulo: 'Entregar veículo', html: cab + corpo,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
        {
          id: 'ok', rotulo: '✅ Confirmar entrega', classe: 'btn-sucesso', padrao: true, desabilitado: !!p,
          aoClicar: mm => {
            const r = Op.entregar(id, p ? { confirmouDocumento: $('#ent-doc', mm.corpo).checked } : { codigo: $('#ent-cod', mm.corpo).value });
            if (r.ok) { mm.fechar(); Ui.toast(`Veículo ${r.ticket.placa} entregue. Bom trabalho!`, 'sucesso'); return; }
            if (r.codigo === 'VENCIDO') {
              mm.fechar();
              Ui.modal({
                titulo: '⚠ Pagamento vencido', largura: 'sm', semFechar: true,
                html: `<p style="margin-top:0;font-size:1.1rem">${esc(r.erro)}</p><p class="mudo">Não entregue o veículo. Peça ao cliente que volte ao caixa.</p>`,
                botoes: [{ rotulo: 'Entendi', classe: 'btn-primario', padrao: true, aoClicar: x => x.fechar() }]
              });
              return;
            }
            if (r.codigo === 'CONFLITO') { mm.fechar(); Ui.toast(r.erro, 'aviso'); return; }
            $('#ent-erro', mm.corpo).textContent = r.erro;
            const c = $('#ent-cod', mm.corpo); if (c) { c.value = ''; c.focus(); }
            if (navigator.vibrate) navigator.vibrate(200);
          }
        }
      ]
    });
    if (p) $('#ent-doc', m.corpo).addEventListener('change', e => { m.botao('ok').disabled = !e.target.checked; });
    const cam = $('#ent-cam', m.corpo);
    if (cam) cam.addEventListener('click', () => lerCamera(codigo => { $('#ent-cod', m.corpo).value = codigo; m.botao('ok').click(); }));
  }

  async function lerCamera(aoLer) {
    let stream = null, ativo = true;
    const m = Ui.modal({
      titulo: 'Aponte para o código de barras', largura: 'sm',
      html: '<video id="cam-video" playsinline muted style="width:100%;border-radius:12px;background:#000;min-height:180px"></video><div class="dica" id="cam-msg">Procurando código...</div>',
      aoFechar: () => { ativo = false; if (stream) stream.getTracks().forEach(t => t.stop()); },
      botoes: [{ rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() }]
    });
    try {
      const det = new BarcodeDetector({ formats: ['code_39', 'code_128', 'qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('#cam-video', m.corpo); v.srcObject = stream; await v.play();
      const laco = async () => {
        if (!ativo) return;
        try { const r = await det.detect(v); if (r.length) { ativo = false; m.fechar(); aoLer(r[0].rawValue); return; } } catch (e) { /* tenta de novo */ }
        setTimeout(laco, 250);
      };
      laco();
    } catch (e) {
      m.fechar();
      Ui.toast('Não consegui usar a câmera (' + (e.message || e.name) + '). Use o leitor ou digite o número.', 'erro', 6000);
    }
  }

  // ============================================================
  //  PÁTIO (todos os veículos + correção)
  // ============================================================
  function renderPatio() {
    const cfg = Dados.config;
    const chips = [['todos', 'Todos']].concat(cfg.patios.filter(p => p.ativo !== false).map(p => [p.id, p.nome]));
    $('#filtro-patio').innerHTML = chips.map(([id, nome]) => `<button type="button" class="chip ${est.filtroPatio === id ? 'sel' : ''}" data-fp="${esc(id)}">${esc(nome)}</button>`).join('');
    let lista = R.ativos(Dados.tickets);
    if (est.filtroPatio !== 'todos') lista = lista.filter(t => t.patio === est.filtroPatio);
    lista = R.buscar(lista, $('#busca-patio').value);
    lista.sort((a, b) => b.entradaEm - a.entradaEm);
    const cls = { ESTACIONADO: ['', 'No pátio'], PAGO: ['azul', 'Pago · na fila'], A_CAMINHO: ['verde', 'A caminho'] };
    $('#lista-patio').innerHTML = lista.length ? lista.slice(0, 80).map(t => `
      <div class="item ${t.ticketPerdido ? 'verm' : (t.status === 'ESTACIONADO' ? '' : cls[t.status][0])}">
        <div class="item-corpo" data-ficha="${esc(t.id)}" style="cursor:pointer">
          <div><span class="item-ticket">#${esc(t.id)}</span> <span class="badge ${cls[t.status][0]}">${cls[t.status][1]}</span>
            ${t.mensalistaId ? '<span class="badge amar">Mensalista</span>' : ''}</div>
          <div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · há <b data-desde="${t.entradaEm}" data-fmt="min">—</b></div>
        </div>
        <div class="item-acoes"><button type="button" class="btn btn-sm btn-contorno" data-ficha="${esc(t.id)}">✏️ Ficha</button>
          <button type="button" class="btn btn-sm btn-contorno" data-reimp="${esc(t.id)}">🖨️ Ticket</button></div>
      </div>`).join('') + (lista.length > 80 ? '<div class="vazio">Mostrando 80 de ' + lista.length + '. Refine a busca.</div>' : '')
      : '<div class="vazio">Nenhum veículo encontrado.</div>';
    const mp = $('#marca-patio'), total = R.ativos(Dados.tickets).length;
    mp.textContent = total; mp.classList.toggle('zero', !total);
  }

  $('#filtro-patio').addEventListener('click', ev => { const b = ev.target.closest('[data-fp]'); if (b) { est.filtroPatio = b.dataset.fp; renderPatio(); } });
  $('#busca-patio').addEventListener('input', () => renderPatio());
  $('#lista-patio').addEventListener('click', ev => {
    const r = ev.target.closest('[data-reimp]'); if (r) { reimprimir(r.dataset.reimp); return; }
    const f = ev.target.closest('[data-ficha]'); if (f) Ficha.editar(f.dataset.ficha);
  });

  // ============================================================
  //  DESENHO GERAL + TEMPO REAL
  // ============================================================
  function renderTudo() {
    renderCategorias(); renderPatios(); renderCores(); renderAvarias(); renderFila();
    if (!$('#aba-patio').hidden) renderPatio(); else {
      const mp = $('#marca-patio'), total = R.ativos(Dados.tickets).length; mp.textContent = total; mp.classList.toggle('zero', !total);
    }
    atualizarInfoPlaca();
  }

  Dados.aoMudar((nome) => {
    if (nome === 'log' || nome === 'meta') return;
    if (!Auth.atual()) { window.location.replace('index.html'); return; }
    Ui.agendar(() => { verificarNovos(); renderTudo(); });
  });

  verificarNovos();
  renderTudo();
  let abaInicial = 'entrada';
  try { abaInicial = sessionStorage.getItem('estacionamais.abaManobrista') || 'entrada'; } catch (e) { /* ok */ }
  mostrarAba(['entrada', 'fila', 'patio'].includes(abaInicial) ? abaInicial : 'entrada');
})();
