/* ============================================================
   gerencia.js — painel do gerente
   Visão geral · Pátio agora · Histórico · Caixas · Mensalistas
   Configurações · Auditoria · Backup
   (usuários e permissões ficam com o administrador: admin.html)
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  const usuario = Auth.exigirPagina('gerencia');
  if (!usuario) return;

  const R = Regras, $ = Ui.$, esc = Ui.esc, moeda = R.moeda;
  Ui.montarTopo({ pagina: 'Gerência', ativo: 'gerencia' });
  Ui.iniciarRelogios();

  const secao = $('#secao');
  const hojeISO = () => R.hojeISO(Date.now());
  const diasAtras = n => { const d = new Date(R.inicioDoDia(Date.now())); d.setDate(d.getDate() - n); return d.getTime(); };

  const estado = {
    sec: 'visao', periodo: 'hoje', de: hojeISO(), ate: hojeISO(),
    hist: { de: R.hojeISO(diasAtras(6)), ate: hojeISO(), status: '', q: '' },
    patio: { filtro: 'todos', status: '', q: '' },
    audit: { q: '', usuario: '', acao: '' },
    cfgPatios: null
  };

  const pct = (v, total) => total > 0 ? Math.min(100, Math.round(v / total * 100)) : 0;
  const kpi = (rot, val, sub, cor) => `<div class="kpi ${cor || ''}"><div class="kpi-rot">${esc(rot)}</div><div class="kpi-val">${val}</div><div class="kpi-sub">${sub || ''}</div></div>`;
  const badgeStatus = s => `<span class="badge ${{ ESTACIONADO: '', PAGO: 'azul', A_CAMINHO: 'verde', ENTREGUE: 'verde', CANCELADO: 'verm' }[s] || ''}">${esc(R.ROTULO_STATUS[s] || s)}</span>`;

  function confirmarDigitando(palavra, titulo, html) {
    return new Promise(resolve => {
      let feito = false;
      const fim = v => { if (!feito) { feito = true; resolve(v); } };
      Ui.modal({
        titulo, largura: 'sm', aoFechar: () => fim(false),
        html: `<div>${html}</div><label class="rotulo mt" for="cd-txt">Para confirmar, digite <b>${esc(palavra)}</b></label><input id="cd-txt" type="text" autocomplete="off" data-foco>`,
        botoes: [
          { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: m => m.fechar() },
          { rotulo: 'Confirmar', classe: 'btn-perigo', padrao: true, aoClicar: m => { if ($('#cd-txt', m.corpo).value.trim().toUpperCase() === palavra) { fim(true); m.fechar(); } else Ui.toast('Texto de confirmação não confere.', 'erro'); } }
        ]
      });
    });
  }

  // ============================================================
  //  VISÃO GERAL
  // ============================================================
  function intervalo() {
    const agora = Date.now(), h0 = R.inicioDoDia(agora);
    switch (estado.periodo) {
      case 'ontem': return [diasAtras(1), h0 - 1];
      case '7d': return [diasAtras(6), R.fimDoDia(agora)];
      case '30d': return [diasAtras(29), R.fimDoDia(agora)];
      case 'mes': { const d = new Date(agora); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), R.fimDoDia(agora)]; }
      case 'custom': {
        const a = estado.de ? R.isoParaMs(estado.de) : h0, b = estado.ate ? R.fimDoDia(R.isoParaMs(estado.ate)) : R.fimDoDia(agora);
        return [Math.min(a, b), Math.max(a, b)];
      }
      default: return [h0, R.fimDoDia(agora)];
    }
  }

  function alertas() {
    const a = [], agora = Date.now();
    Dados.caixas.filter(c => !c.fechadoEm && agora - c.abertoEm > 12 * 3600000)
      .forEach(c => a.push(['verm', `Caixa nº ${c.numero} de ${esc(c.operadorNome)} aberto desde ${Ui.dataHora(c.abertoEm)}.`]));
    const fila = Dados.tickets.filter(t => t.status === 'PAGO' && agora - t.pagoEm > 10 * 60000);
    if (fila.length) a.push(['amar', `${fila.length} veículo(s) pago(s) esperando o manobrista há mais de 10 minutos.`]);
    const noite = R.ativos(Dados.tickets).filter(t => agora - t.entradaEm > 24 * 3600000);
    if (noite.length) a.push(['amar', `${noite.length} veículo(s) há mais de 24 h no pátio (pernoite).`]);
    const oc = R.ocupacao(Dados.tickets, Dados.config);
    Object.keys(oc).forEach(k => { const o = oc[k]; if (o.patio.capacidade > 0 && o.usados >= o.patio.capacidade) a.push(['verm', `${esc(o.patio.nome)} está lotado (${o.usados}/${o.patio.capacidade}).`]); });
    const ub = Dados.meta.ultimoBackup;
    if (Dados.tickets.length && (!ub || agora - ub > 2 * 86400000)) a.push(['amar', ub ? `Último backup há ${R.duracao((agora - ub) / 60000)}.` : 'Nenhum backup foi feito ainda.'] );
    return a;
  }

  function renderVisao() {
    const op = ['hoje', 'ontem', '7d', '30d', 'mes', 'custom'], rot = { hoje: 'Hoje', ontem: 'Ontem', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', mes: 'Este mês', custom: 'Escolher datas…' };
    secao.innerHTML = `<div class="gap"><h2 class="titulo-pagina espaco">Visão geral</h2>
      <div class="filtros">
        <div class="campo"><label class="rotulo" for="f-periodo">Período</label><select id="f-periodo">${op.map(k => `<option value="${k}" ${estado.periodo === k ? 'selected' : ''}>${rot[k]}</option>`).join('')}</select></div>
        <div class="campo" id="f-custom" ${estado.periodo === 'custom' ? '' : 'hidden'}><label class="rotulo" for="f-de">De / até</label>
          <div class="gap"><input type="date" id="f-de" value="${estado.de}" style="width:auto"><input type="date" id="f-ate" value="${estado.ate}" style="width:auto"></div></div>
      </div></div><div id="visao-dados" class="col-total"></div>`;
    $('#f-periodo').onchange = e => { estado.periodo = e.target.value; $('#f-custom').hidden = estado.periodo !== 'custom'; atualizarVisao(); };
    $('#f-de').onchange = e => { estado.de = e.target.value; atualizarVisao(); };
    $('#f-ate').onchange = e => { estado.ate = e.target.value; atualizarVisao(); };
    atualizarVisao();
  }

  function barras(mapa, formato) {
    const chaves = Object.keys(mapa);
    if (!chaves.length) return '<div class="vazio">Sem dados no período.</div>';
    const max = Math.max.apply(null, chaves.map(k => mapa[k].valor)) || 1;
    return chaves.sort((a, b) => mapa[b].valor - mapa[a].valor).map(k =>
      `<div style="margin-bottom:10px"><div class="gap"><span class="espaco">${esc(formato ? formato(k) : k)} <span class="mudo pequeno">(${mapa[k].qtd}×)</span></span><b>${moeda(mapa[k].valor)}</b></div>
       <div class="barra"><i style="width:${pct(mapa[k].valor, max)}%"></i></div></div>`).join('');
  }

  function atualizarVisao() {
    const alvo = $('#visao-dados'); if (!alvo) return;
    const [ini, fim] = intervalo();
    const r = R.resumoPeriodo(Dados.tickets, ini, fim);
    const dentro = Dados.caixas.filter(c => c.fechadoEm && c.fechadoEm >= ini && c.fechadoEm <= fim);
    const dif = dentro.reduce((s, c) => s + (c.diferenca || 0), 0);
    const ativos = R.ativos(Dados.tickets).length;
    const cap = Dados.config.patios.filter(p => p.ativo !== false).reduce((s, p) => s + p.capacidade, 0);
    const al = alertas();
    const oc = R.ocupacao(Dados.tickets, Dados.config);
    const maxH = Math.max.apply(null, r.porHora.concat(1));

    alvo.innerHTML =
      (al.length ? `<div class="card ${al.some(x => x[0] === 'verm') ? 'perigo' : 'alerta'}"><b>Atenção</b><ul style="margin:6px 0 0;padding-left:20px">${al.map(x => `<li>${x[1]}</li>`).join('')}</ul></div>` : '') +
      `<div class="grade-kpi">
        ${kpi('Faturamento', moeda(r.faturamento), `${r.qtdPagamentos} pagamento(s) recebidos`, 'verde')}
        ${kpi('Ticket médio', moeda(r.ticketMedio), 'só pagamentos com valor', '')}
        ${kpi('No pátio agora', String(ativos), cap ? `de ${cap} vagas (${pct(ativos, cap)}%)` : 'veículos em todos os pátios', 'roxo')}
        ${kpi('Entradas', String(r.entradas), `${r.entregues} entregues no período`, '')}
        ${kpi('Permanência média', r.entregues ? R.duracao(r.permMediaMin) : '—', 'dos veículos entregues', '')}
        ${kpi('Espera na fila', r.esperaMediaMin ? R.duracao(r.esperaMediaMin) : '—', 'do pagamento até a entrega', r.esperaMediaMin > 10 ? 'amar' : '')}
        ${kpi('Descontos / cortesias', moeda(r.descontos), 'concedidos no período', 'amar')}
        ${kpi('Ticket perdido', String(r.perdidos), 'entregas sem ticket', r.perdidos ? 'verm' : '')}
        ${kpi('Cancelamentos / estornos', `${r.cancelados} / ${r.estornos}`, 'no período', r.cancelados + r.estornos ? 'verm' : '')}
        ${kpi('Diferença de caixa', moeda(dif), `${dentro.length} caixa(s) fechado(s)`, dif < 0 ? 'verm' : (dif > 0 ? 'amar' : 'verde'))}
      </div>
      <div class="grade-2col">
        <div class="card"><h3 class="mb">Por forma de pagamento</h3>${barras(r.porMetodo, k => R.METODOS[k] || k)}</div>
        <div class="card"><h3 class="mb">Por operador do caixa</h3>${barras(r.porOperador)}</div>
      </div>
      <div class="grade-2col">
        <div class="card"><h3 class="mb">Ocupação por pátio</h3>` +
      Object.keys(oc).map(k => {
        const o = oc[k], p = pct(o.usados, o.patio.capacidade);
        return `<div style="margin-bottom:10px"><div class="gap"><span class="espaco">${esc(o.patio.nome)}${o.patio.ativo === false ? ' <span class="badge">inativo</span>' : ''}</span><b>${o.usados}${o.patio.capacidade ? ' / ' + o.patio.capacidade : (o.usados === 1 ? ' carro' : ' carros')}</b></div>
          ${o.patio.capacidade ? `<div class="barra ${p >= 100 ? 'cheia' : (p >= 80 ? 'quase' : '')}"><i style="width:${p}%"></i></div>` : ''}</div>`;
      }).join('') + `</div>
        <div class="card"><h3 class="mb">Entradas por hora do dia</h3>
          <div class="hist-barras">${r.porHora.map((v, h) => `<div style="height:${Math.max(2, pct(v, maxH))}%" title="${h}h: ${v} entrada(s)"></div>`).join('')}</div>
          <div class="hist-eixo">${r.porHora.map((v, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('')}</div></div>
      </div>`;
  }

  // ============================================================
  //  PÁTIO AGORA
  // ============================================================
  function renderPatio() {
    secao.innerHTML = `<h2 class="titulo-pagina">Pátio agora</h2>
      <div class="card"><div class="filtros">
        <div class="campo" style="flex:1"><label class="rotulo" for="p-q">Buscar (placa, ticket, modelo)</label><input id="p-q" type="search" value="${esc(estado.patio.q)}" autocomplete="off"></div>
        <div class="campo"><label class="rotulo" for="p-pat">Pátio</label><select id="p-pat"><option value="todos">Todos</option>${Dados.config.patios.map(p => `<option value="${esc(p.id)}" ${estado.patio.filtro === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label class="rotulo" for="p-st">Situação</label><select id="p-st"><option value="">Todas</option>${['ESTACIONADO', 'PAGO', 'A_CAMINHO'].map(s => `<option value="${s}" ${estado.patio.status === s ? 'selected' : ''}>${esc(R.ROTULO_STATUS[s])}</option>`).join('')}</select></div>
      </div></div><div class="card"><div id="p-lista"></div></div>`;
    $('#p-q').oninput = e => { estado.patio.q = e.target.value; atualizarPatio(); };
    $('#p-pat').onchange = e => { estado.patio.filtro = e.target.value; atualizarPatio(); };
    $('#p-st').onchange = e => { estado.patio.status = e.target.value; atualizarPatio(); };
    $('#p-lista').onclick = ev => {
      const b = ev.target.closest('[data-ficha]'); if (b) { Ficha.editar(b.dataset.ficha); return; }
      const tr = ev.target.closest('[data-h]'); if (tr) Ficha.historico(tr.dataset.h);
    };
    atualizarPatio();
  }

  function atualizarPatio() {
    const alvo = $('#p-lista'); if (!alvo) return;
    const agora = Date.now(), cfg = Dados.config;
    let l = R.ativos(Dados.tickets);
    if (estado.patio.filtro !== 'todos') l = l.filter(t => t.patio === estado.patio.filtro);
    if (estado.patio.status) l = l.filter(t => t.status === estado.patio.status);
    l.sort((a, b) => a.entradaEm - b.entradaEm);
    if (estado.patio.q.trim()) l = R.buscar(l, estado.patio.q);
    let potencial = 0;
    const linhas = l.slice(0, 300).map(t => {
      const dev = t.status === 'ESTACIONADO' ? R.calcularDevido(t, agora, cfg, Op.mensalistaDe(t, agora)).aCobrar : 0;
      potencial += dev;
      const noite = agora - t.entradaEm > 24 * 3600000;
      return `<tr class="clicavel" data-h="${esc(t.id)}"><td class="negrito">#${esc(t.id)}</td><td class="mono negrito">${esc(t.placa)}</td><td>${esc(R.descricaoVeiculo(t, cfg))}</td>
        <td>${esc(R.localVeiculo(t, cfg))}</td><td class="nowrap">${Ui.dataHora(t.entradaEm)}</td>
        <td class="nowrap ${noite ? 'verm negrito' : ''}">${R.duracao((agora - t.entradaEm) / 60000)}</td><td>${badgeStatus(t.status)}${t.ticketPerdido ? ' <span class="badge verm">perdido</span>' : ''}</td>
        <td class="num">${dev ? moeda(dev) : '—'}</td><td><button type="button" class="btn btn-sm btn-contorno" data-ficha="${esc(t.id)}">✏️</button></td></tr>`;
    }).join('');
    alvo.innerHTML = `<div class="mb"><b>${l.length}</b> veículo(s)${potencial ? ` · a receber se saíssem agora: <b>${moeda(potencial)}</b>` : ''}</div>` +
      (l.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Ticket</th><th>Placa</th><th>Veículo</th><th>Local</th><th>Entrada</th><th>Permanência</th><th>Situação</th><th class="num">A cobrar</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="vazio">Nenhum veículo encontrado.</div>');
  }

  // ============================================================
  //  HISTÓRICO
  // ============================================================
  function filtrarHistorico() {
    const h = estado.hist, de = h.de ? R.isoParaMs(h.de) : 0, ate = h.ate ? R.fimDoDia(R.isoParaMs(h.ate)) : Infinity;
    let l = Dados.tickets.filter(t => t.entradaEm >= de && t.entradaEm <= ate);
    if (h.status) l = l.filter(t => t.status === h.status);
    l = l.slice().sort((a, b) => b.entradaEm - a.entradaEm);
    if (h.q.trim()) l = R.buscar(l, h.q);
    return l;
  }
  const formas = t => Array.from(new Set(R.pagamentosValidos(t).map(p => R.METODOS[p.metodo] || p.metodo))).join(', ');

  function renderHistorico() {
    const h = estado.hist;
    secao.innerHTML = `<div class="gap"><h2 class="titulo-pagina espaco">Histórico de tickets</h2><button type="button" class="btn btn-contorno" id="h-csv">⬇ Exportar CSV</button></div>
      <div class="card"><div class="filtros">
        <div class="campo"><label class="rotulo" for="h-de">De</label><input type="date" id="h-de" value="${h.de}"></div>
        <div class="campo"><label class="rotulo" for="h-ate">Até</label><input type="date" id="h-ate" value="${h.ate}"></div>
        <div class="campo"><label class="rotulo" for="h-st">Situação</label><select id="h-st"><option value="">Todas</option>${Object.keys(R.ROTULO_STATUS).map(s => `<option value="${s}" ${h.status === s ? 'selected' : ''}>${esc(R.ROTULO_STATUS[s])}</option>`).join('')}</select></div>
        <div class="campo" style="flex:1"><label class="rotulo" for="h-q">Buscar (placa, ticket, modelo)</label><input type="search" id="h-q" value="${esc(h.q)}" autocomplete="off"></div>
      </div></div><div class="card"><div id="h-lista"></div></div>`;
    $('#h-de').onchange = e => { h.de = e.target.value; atualizarHistorico(); };
    $('#h-ate').onchange = e => { h.ate = e.target.value; atualizarHistorico(); };
    $('#h-st').onchange = e => { h.status = e.target.value; atualizarHistorico(); };
    $('#h-q').oninput = e => { h.q = e.target.value; atualizarHistorico(); };
    $('#h-lista').onclick = ev => { const tr = ev.target.closest('[data-h]'); if (tr) Ficha.historico(tr.dataset.h); };
    $('#h-csv').onclick = exportarCSV;
    atualizarHistorico();
  }

  function atualizarHistorico() {
    const alvo = $('#h-lista'); if (!alvo) return;
    const l = filtrarHistorico(), cfg = Dados.config;
    const soma = l.reduce((s, t) => s + R.totalRecebido(t), 0);
    alvo.innerHTML = `<div class="mb"><b>${l.length}</b> ticket(s) · recebido: <b>${moeda(soma)}</b></div>` +
      (l.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Ticket</th><th>Placa</th><th>Tipo</th><th>Entrada</th><th>Saída</th><th>Permanência</th><th class="num">Recebido</th><th>Forma</th><th>Situação</th></tr></thead><tbody>` +
        l.slice(0, 200).map(t => {
          const fim = t.entregueEm || (t.cancelado ? t.cancelado.em : Date.now());
          const desc = R.pagamentosValidos(t).some(p => p.desconto);
          return `<tr class="clicavel" data-h="${esc(t.id)}"><td class="negrito">#${esc(t.id)}</td><td class="mono negrito">${esc(t.placa)}</td><td>${esc(R.nomeCategoria(cfg, t.categoria))}</td>
            <td class="nowrap">${Ui.dataHora(t.entradaEm)}</td><td class="nowrap">${Ui.dataHora(t.entregueEm)}</td><td class="nowrap">${R.duracao((fim - t.entradaEm) / 60000)}</td>
            <td class="num">${moeda(R.totalRecebido(t))}</td><td>${esc(formas(t)) || '—'}</td>
            <td>${badgeStatus(t.status)}${t.ticketPerdido ? ' <span class="badge verm">perdido</span>' : ''}${desc ? ' <span class="badge amar">desconto</span>' : ''}</td></tr>`;
        }).join('') + '</tbody></table></div>' + (l.length > 200 ? `<div class="vazio">Mostrando 200 de ${l.length}. Use o CSV para ver tudo.</div>` : '')
        : '<div class="vazio">Nenhum ticket neste filtro.</div>');
  }

  function exportarCSV() {
    const cfg = Dados.config, v = c => (c / 100).toFixed(2).replace('.', ',');
    const linhas = [['Ticket', 'Placa', 'Tipo', 'Modelo', 'Cor', 'Local', 'Entrada', 'Saída', 'Permanência (min)', 'Recebido (R$)', 'Descontos (R$)', 'Forma', 'Situação', 'Ticket perdido', 'Entrada por', 'Recebido por', 'Entregue por', 'NFS-e']];
    filtrarHistorico().forEach(t => {
      const fim = t.entregueEm || Date.now(), pv = R.pagamentosValidos(t);
      linhas.push([t.id, t.placa, R.nomeCategoria(cfg, t.categoria), t.modelo, t.cor, R.localVeiculo(t, cfg), Ui.dataHora(t.entradaEm), t.entregueEm ? Ui.dataHora(t.entregueEm) : '',
        Math.round((fim - t.entradaEm) / 60000), v(R.totalRecebido(t)), v(pv.reduce((s, p) => s + (p.desconto || 0), 0)), formas(t), R.ROTULO_STATUS[t.status],
        t.ticketPerdido ? 'sim' : '', t.entradaPorNome, pv.map(p => p.porNome).join(', '), t.entreguePorNome || '',
        pv.filter(p => p.nota).map(p => p.nota.numero + (p.nota.homologacao ? ' (teste)' : '')).join(', ')]);
    });
    Ui.baixarArquivo(`historico-estacionamento-${hojeISO()}.csv`, Ui.csv(linhas), 'text/csv;charset=utf-8');
  }

  // ============================================================
  //  CAIXAS
  // ============================================================
  function renderCaixas() {
    secao.innerHTML = `<h2 class="titulo-pagina">Caixas (turnos)</h2><div class="card"><div id="cx-lista"></div></div>`;
    $('#cx-lista').onclick = ev => {
      const f = ev.target.closest('[data-fechar]'); if (f) { fecharComoGerente(f.dataset.fechar); return; }
      const tr = ev.target.closest('[data-cx]'); if (tr) detalheCaixa(tr.dataset.cx);
    };
    atualizarCaixas();
  }

  function atualizarCaixas() {
    const alvo = $('#cx-lista'); if (!alvo) return;
    const l = Dados.caixas.slice().sort((a, b) => b.abertoEm - a.abertoEm).slice(0, 100);
    alvo.innerHTML = l.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Caixa</th><th>Operador</th><th>Abertura</th><th>Fechamento</th><th class="num">Fundo</th><th class="num">Recebido</th><th class="num">Esperado (dinheiro)</th><th class="num">Contado</th><th class="num">Diferença</th><th></th></tr></thead><tbody>` +
      l.map(c => {
        const res = R.resumoCaixa(c, Dados.tickets), aberto = !c.fechadoEm;
        return `<tr class="clicavel" data-cx="${esc(c.id)}"><td class="negrito">nº ${c.numero}</td><td>${esc(c.operadorNome)}</td><td class="nowrap">${Ui.dataHora(c.abertoEm)}</td>
          <td class="nowrap">${aberto ? '<span class="badge verde">ABERTO</span>' : Ui.dataHora(c.fechadoEm)}</td><td class="num">${moeda(c.fundo)}</td><td class="num">${moeda(res.total)}</td>
          <td class="num">${moeda(aberto ? res.esperadoDinheiro : c.esperado)}</td><td class="num">${aberto ? '—' : moeda(c.contado)}</td>
          <td class="num ${aberto ? '' : (c.diferenca < 0 ? 'verm negrito' : (c.diferenca > 0 ? 'amar negrito' : 'verde'))}">${aberto ? '—' : moeda(c.diferenca)}</td>
          <td>${aberto ? `<button type="button" class="btn btn-sm btn-perigo" data-fechar="${esc(c.id)}">Fechar</button>` : ''}</td></tr>`;
      }).join('') + '</tbody></table></div>' : '<div class="vazio">Nenhum caixa foi aberto ainda.</div>';
  }

  function detalheCaixa(id) {
    const c = Dados.caixas.find(x => x.id === id); if (!c) return;
    const res = R.resumoCaixa(c, Dados.tickets);
    const l = (a, b, forte) => `<div style="display:flex;justify-content:space-between;gap:10px;${forte ? 'font-weight:700' : ''}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
    Ui.modal({
      titulo: `Caixa nº ${c.numero} · ${c.operadorNome}`, largura: 'md',
      html: l('Abertura', Ui.dataHora(c.abertoEm)) + l('Fechamento', c.fechadoEm ? Ui.dataHora(c.fechadoEm) + ' por ' + (c.fechadoPor || '') : 'ainda aberto') + '<hr>' +
        Object.keys(R.METODOS).filter(k => res.porMetodo[k] && res.porMetodo[k].qtd).map(k => l(`${R.METODOS[k]} (${res.porMetodo[k].qtd})`, moeda(res.porMetodo[k].valor))).join('') +
        l('TOTAL', moeda(res.total), true) + (res.descontos ? l('Descontos concedidos', moeda(res.descontos)) : '') + '<hr>' +
        l('Fundo', moeda(c.fundo)) + l('+ Dinheiro', moeda(res.dinheiro)) + l('− Retiradas', moeda(res.sangrias)) + l('Esperado na gaveta', moeda(res.esperadoDinheiro), true) +
        (c.fechadoEm ? l('Contado', moeda(c.contado)) + l('Diferença', moeda(c.diferenca), true) : '') +
        (c.obsFechamento ? `<div class="card alerta mt pequeno"><b>Observação:</b> ${esc(c.obsFechamento)}</div>` : '') +
        ((c.sangrias || []).length ? '<h4 style="margin:14px 0 6px">Retiradas</h4>' + c.sangrias.map(s => l(`${Ui.hora(s.em)} · ${s.motivo}${s.autorizadoPor ? ' (aut. ' + s.autorizadoPor + ')' : ''}`, moeda(s.valor))).join('') : ''),
      botoes: [
        { rotulo: 'Fechar', classe: 'btn-contorno', aoClicar: m => m.fechar() },
        c.fechadoEm ? { rotulo: '🖨️ Imprimir', classe: 'btn-primario', aoClicar: () => Impressao.imprimirFechamento(c, res) } : null
      ].filter(Boolean)
    });
  }

  function fecharComoGerente(id) {
    const c = Dados.caixas.find(x => x.id === id); if (!c || c.fechadoEm) return;
    const res = R.resumoCaixa(c, Dados.tickets);
    Ui.modal({
      titulo: `Fechar caixa nº ${c.numero} (${c.operadorNome})`, largura: 'sm',
      html: `<p class="mudo" style="margin-top:0">Dinheiro esperado na gaveta: <b>${moeda(res.esperadoDinheiro)}</b></p>
        <label class="rotulo" for="g-contado">Dinheiro contado (R$)</label><input id="g-contado" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" data-foco autocomplete="off">
        <label class="rotulo mt" for="g-obs">Observação (obrigatória se houver diferença)</label><textarea id="g-obs" maxlength="200"></textarea><div class="dica erro" id="g-erro"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: m => m.fechar() },
        {
          rotulo: 'Fechar caixa', classe: 'btn-perigo', padrao: true, aoClicar: m => {
            const v = Ui.valorCampoMoeda($('#g-contado', m.corpo));
            if (v === null) { $('#g-erro', m.corpo).textContent = 'Informe o dinheiro contado.'; return; }
            const r = Op.fecharCaixa(id, v, $('#g-obs', m.corpo).value);
            if (!r.ok) { $('#g-erro', m.corpo).textContent = r.erro; return; }
            m.fechar(); Ui.toast('Caixa fechado.');
          }
        }
      ]
    });
  }

  // ============================================================
  //  MENSALISTAS
  // ============================================================
  function renderMensalistas() {
    secao.innerHTML = `<div class="gap"><h2 class="titulo-pagina espaco">Mensalistas</h2><button type="button" class="btn btn-primario" id="m-novo">+ Novo mensalista</button></div>
      <div class="card"><p class="mudo" style="margin-top:0">Veículos com plano vigente entram <b>sem cobrança</b>: o caixa apenas libera. O sistema não controla o pagamento da mensalidade — acompanhe a validade aqui.</p><div id="m-lista"></div></div>`;
    $('#m-novo').onclick = () => editarMensalista(null);
    $('#m-lista').onclick = ev => { const b = ev.target.closest('[data-m]'); if (b) editarMensalista(b.dataset.m); };
    atualizarMensalistas();
  }

  function atualizarMensalistas() {
    const alvo = $('#m-lista'); if (!alvo) return;
    const hoje = hojeISO();
    const l = Dados.mensalistas.slice().sort((a, b) => a.nome.localeCompare(b.nome));
    alvo.innerHTML = l.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th><th>Placas</th><th>Telefone</th><th class="num">Mensalidade</th><th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>` +
      l.map(m => {
        const vig = m.ativo && m.validade >= hoje;
        return `<tr><td class="negrito">${esc(m.nome)}</td><td class="mono">${esc((m.placas || []).join(', '))}</td><td>${esc(m.telefone || '—')}</td><td class="num">${moeda(m.valor)}</td>
          <td>${Ui.data(R.isoParaMs(m.validade))}</td><td>${!m.ativo ? '<span class="badge">Inativo</span>' : (vig ? '<span class="badge verde">Vigente</span>' : '<span class="badge verm">Vencido</span>')}</td>
          <td><button type="button" class="btn btn-sm btn-contorno" data-m="${esc(m.id)}">Editar</button></td></tr>`;
      }).join('') + '</tbody></table></div>' : '<div class="vazio">Nenhum mensalista cadastrado.</div>';
  }

  function editarMensalista(id) {
    const m0 = id ? Dados.mensalistas.find(x => x.id === id) : null;
    const m = Ui.modal({
      titulo: m0 ? 'Editar mensalista' : 'Novo mensalista', largura: 'md',
      html: `<div class="linha-campos">
        <div class="campo"><label class="rotulo" for="mm-nome">Nome</label><input id="mm-nome" type="text" maxlength="40" value="${esc(m0 ? m0.nome : '')}" data-foco></div>
        <div class="campo"><label class="rotulo" for="mm-tel">Telefone</label><input id="mm-tel" type="tel" maxlength="15" value="${esc(m0 ? m0.telefone : '')}"></div>
        <div class="campo"><label class="rotulo" for="mm-placas">Placa(s) — separe por vírgula</label><input id="mm-placas" type="text" maxlength="40" value="${esc(m0 ? m0.placas.join(', ') : '')}" style="text-transform:uppercase"></div>
        <div class="campo"><label class="rotulo" for="mm-valor">Mensalidade (R$)</label><input id="mm-valor" type="text" inputmode="decimal" value="${m0 ? (m0.valor / 100).toFixed(2).replace('.', ',') : ''}"></div>
        <div class="campo"><label class="rotulo" for="mm-val">Válido até</label><input id="mm-val" type="date" value="${m0 ? m0.validade : ''}"></div>
        <div class="campo"><label class="rotulo">Atalho</label><div class="gap"><button type="button" class="btn btn-sm btn-contorno" data-mais="30">+30 dias</button><button type="button" class="btn btn-sm btn-contorno" data-mais="365">+1 ano</button></div></div></div>
        <label class="check mt"><input type="checkbox" id="mm-ativo" ${!m0 || m0.ativo ? 'checked' : ''}> Cadastro ativo</label>
        <label class="rotulo mt" for="mm-obs">Observação</label><textarea id="mm-obs" maxlength="200">${esc(m0 ? m0.obs : '')}</textarea>
        <div class="dica erro" id="mm-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: x => x.fechar() },
        {
          rotulo: 'Salvar', classe: 'btn-primario', padrao: true, aoClicar: x => {
            const c = x.corpo;
            const r = Op.salvarMensalista({
              id: id || undefined, nome: $('#mm-nome', c).value, telefone: $('#mm-tel', c).value,
              placas: $('#mm-placas', c).value.split(/[,;\s]+/), valor: R.parseMoeda($('#mm-valor', c).value) || 0,
              validade: $('#mm-val', c).value, ativo: $('#mm-ativo', c).checked, obs: $('#mm-obs', c).value
            });
            if (!r.ok) { $('#mm-erro', c).textContent = r.erro; return; }
            x.fechar(); Ui.toast('Mensalista salvo.'); atualizarMensalistas();
          }
        }
      ]
    });
    m.corpo.addEventListener('click', ev => {
      const b = ev.target.closest('[data-mais]'); if (!b) return;
      const campo = $('#mm-val', m.corpo);
      const base = campo.value && campo.value > hojeISO() ? R.isoParaMs(campo.value) : R.inicioDoDia(Date.now());
      const d = new Date(base); d.setDate(d.getDate() + Number(b.dataset.mais));
      campo.value = R.hojeISO(d.getTime());
    });
  }

  // ============================================================
  //  CONFIGURAÇÕES
  // ============================================================
  const centavos = c => (c / 100).toFixed(2).replace('.', ',');

  function renderConfig() {
    const c = Dados.config;
    estado.cfgPatios = JSON.parse(JSON.stringify(c.patios));
    secao.innerHTML = `<h2 class="titulo-pagina">Configurações</h2>
      <div class="card"><h3 class="mb">Estabelecimento e ticket</h3><div class="linha-campos">
        <div class="campo"><label class="rotulo" for="c-nome">Nome do estacionamento</label><input id="c-nome" type="text" maxlength="40" value="${esc(c.estabelecimento)}"></div>
        <div class="campo"><label class="rotulo" for="c-larg">Papel da impressora</label><select id="c-larg"><option value="32" ${c.larguraPapel === 32 ? 'selected' : ''}>58 mm</option><option value="48" ${c.larguraPapel === 48 ? 'selected' : ''}>80 mm</option></select></div></div>
        <label class="rotulo mt" for="c-rodape">Texto no rodapé do ticket</label><textarea id="c-rodape" maxlength="220">${esc(c.rodapeTicket)}</textarea>
        <label class="rotulo mt" for="c-painel">Mensagem no painel do cliente (TV)</label><input id="c-painel" type="text" maxlength="100" value="${esc(c.mensagemPainel)}"></div>

      <div class="card"><h3 class="mb">Tarifa</h3>
        <p class="mudo" style="margin-top:0">Valor <b>único</b>: o mesmo para qualquer veículo e qualquer tempo de permanência (mensalistas não pagam).</p>
        <div class="campo" style="max-width:220px"><label class="rotulo" for="c-valor">Valor cobrado (R$)</label><input id="c-valor" type="text" inputmode="decimal" value="${centavos(c.valorFixo)}"></div></div>

      <div class="card"><h3 class="mb">Pátios</h3><div id="c-patios"></div>
        <button type="button" class="btn btn-contorno mt" id="c-add-patio">+ Adicionar pátio</button></div>

      <div class="card"><h3 class="mb">Autorizações e segurança</h3>
        <p class="mudo" style="margin-top:0">Marque o que o atendente <b>só pode fazer com a senha de um gerente</b>:</p>
        <label class="check"><input type="checkbox" id="a-desc" ${c.autorizacao.desconto !== false ? 'checked' : ''}> Dar desconto ou cortesia</label>
        <label class="check"><input type="checkbox" id="a-perd" ${c.autorizacao.ticketPerdido !== false ? 'checked' : ''}> Liberar veículo com ticket perdido</label>
        <label class="check"><input type="checkbox" id="a-canc" ${c.autorizacao.cancelar !== false ? 'checked' : ''}> Cancelar uma entrada</label>
        <label class="check"><input type="checkbox" id="a-sang" ${c.autorizacao.sangria !== false ? 'checked' : ''}> Retirar dinheiro do caixa (sangria)</label>
        <div class="campo mt" style="max-width:300px"><label class="rotulo" for="c-inat">Sair sozinho após inatividade (min, 0 = nunca)</label><input id="c-inat" type="number" min="0" max="480" value="${c.inatividadeMin}"></div></div>

      <div class="dica erro" id="c-erro" role="alert"></div>
      <div class="barra-acao"><button type="button" class="btn btn-sucesso btn-grande" id="c-salvar">💾 Salvar configurações</button></div>`;

    desenharPatiosCfg();
    Ui.campoMoeda($('#c-valor'));
    $('#c-add-patio').onclick = () => {
      if (estado.cfgPatios.length >= 8) { Ui.toast('Máximo de 8 pátios.', 'aviso'); return; }
      const prox = String(Math.max.apply(null, estado.cfgPatios.map(p => Number(p.id) || 0).concat(0)) + 1);
      estado.cfgPatios.push({ id: prox, nome: 'Pátio CSI ' + prox, capacidade: 0, ativo: true });
      desenharPatiosCfg();
    };
    secao.oninput = ev => {
      const l = ev.target.closest('[data-pt]');
      if (l) {
        const p = estado.cfgPatios[Number(l.dataset.i)];
        if (l.dataset.pt === 'nome') p.nome = l.value; else if (l.dataset.pt === 'cap') p.capacidade = Number(l.value); else if (l.dataset.pt === 'ativo') p.ativo = l.checked;
      }
    };
    secao.onchange = secao.oninput;
    $('#c-salvar').onclick = salvarConfig;
  }

  function desenharPatiosCfg() {
    $('#c-patios').innerHTML = estado.cfgPatios.map((p, i) => `<div class="linha-campos mb" style="align-items:end">
      <div class="campo"><label class="rotulo">Nome</label><input type="text" maxlength="30" data-pt="nome" data-i="${i}" value="${esc(p.nome)}"></div>
      <div class="campo"><label class="rotulo">Capacidade (opcional, 0 = não informar)</label><input type="number" min="0" data-pt="cap" data-i="${i}" value="${p.capacidade}"></div>
      <label class="check"><input type="checkbox" data-pt="ativo" data-i="${i}" ${p.ativo !== false ? 'checked' : ''}> Ativo</label></div>`).join('');
  }

  /** Lê o formulário e devolve { cfg } ou { erro }. */
  function lerConfig() {
    const nova = JSON.parse(JSON.stringify(Dados.config));
    nova.estabelecimento = $('#c-nome').value.trim();
    nova.larguraPapel = Number($('#c-larg').value);
    nova.rodapeTicket = $('#c-rodape').value.trim();
    nova.mensagemPainel = $('#c-painel').value.trim();
    nova.inatividadeMin = Number($('#c-inat').value);
    nova.autorizacao = { desconto: $('#a-desc').checked, ticketPerdido: $('#a-perd').checked, cancelar: $('#a-canc').checked, sangria: $('#a-sang').checked };
    const valor = R.parseMoeda($('#c-valor').value);
    if (valor === null) return { erro: 'Valor da tarifa inválido.' };
    nova.valorFixo = valor;
    nova.patios = estado.cfgPatios.map(p => ({ id: p.id, nome: String(p.nome).trim(), capacidade: Number(p.capacidade), ativo: p.ativo !== false }));
    const e = Op.validarConfig(nova);
    return e ? { erro: e, cfg: nova } : { cfg: nova };
  }

  function salvarConfig() {
    const lido = lerConfig(), er = $('#c-erro');
    if (lido.erro) { er.textContent = lido.erro; return; }
    er.textContent = '';
    const r = Op.salvarConfig(lido.cfg);
    if (!r.ok) { er.textContent = r.erro; return; }
    Ui.toast('Configurações salvas.');
    Ui.montarTopo({ pagina: 'Gerência', ativo: 'gerencia' });
  }

  // ============================================================
  //  AUDITORIA
  // ============================================================
  function renderAuditoria() {
    const nomes = Array.from(new Set(Dados.log.map(l => l.usuario))).sort();
    const acoes = Array.from(new Set(Dados.log.map(l => l.acao))).sort();
    secao.innerHTML = `<h2 class="titulo-pagina">Auditoria</h2>
      <div class="card"><div class="filtros">
        <div class="campo" style="flex:1"><label class="rotulo" for="a-q">Buscar no detalhe</label><input id="a-q" type="search" value="${esc(estado.audit.q)}" autocomplete="off"></div>
        <div class="campo"><label class="rotulo" for="a-u">Usuário</label><select id="a-u"><option value="">Todos</option>${nomes.map(n => `<option ${estado.audit.usuario === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="campo"><label class="rotulo" for="a-a">Ação</label><select id="a-a"><option value="">Todas</option>${acoes.map(a => `<option value="${esc(a)}" ${estado.audit.acao === a ? 'selected' : ''}>${esc(Ficha.ROTULO_ACAO[a] || a)}</option>`).join('')}</select></div>
      </div></div><div class="card"><div id="a-lista"></div></div>`;
    $('#a-q').oninput = e => { estado.audit.q = e.target.value; atualizarAuditoria(); };
    $('#a-u').onchange = e => { estado.audit.usuario = e.target.value; atualizarAuditoria(); };
    $('#a-a').onchange = e => { estado.audit.acao = e.target.value; atualizarAuditoria(); };
    $('#a-lista').onclick = ev => { const b = ev.target.closest('[data-h]'); if (b) Ficha.historico(b.dataset.h); };
    atualizarAuditoria();
  }

  function atualizarAuditoria() {
    const alvo = $('#a-lista'); if (!alvo) return;
    const f = estado.audit, q = f.q.trim().toLowerCase();
    const l = Dados.log.filter(x => (!f.usuario || x.usuario === f.usuario) && (!f.acao || x.acao === f.acao) &&
      (!q || (x.detalhe || '').toLowerCase().indexOf(q) !== -1 || (x.ticket || '') === q.replace('#', ''))).slice().reverse();
    alvo.innerHTML = `<div class="mb"><b>${l.length}</b> registro(s) (guarda os últimos ${Dados.LIMITE_LOG})</div>` + (l.length ?
      `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th><th>Ticket</th></tr></thead><tbody>` +
      l.slice(0, 300).map(x => `<tr><td class="nowrap">${Ui.dataHora(x.em)}</td><td>${esc(x.usuario)}${x.perfil ? ` <span class="mudo pequeno">(${esc(Auth.PERFIS[x.perfil] ? Auth.PERFIS[x.perfil].rotulo : x.perfil)})</span>` : ''}</td>
        <td>${esc(Ficha.ROTULO_ACAO[x.acao] || x.acao)}</td><td>${esc(x.detalhe)}${x.autorizadoPor ? ` <span class="badge amar">autorizado: ${esc(x.autorizadoPor)}</span>` : ''}</td>
        <td>${x.ticket ? `<button type="button" class="btn btn-sm btn-link" data-h="${esc(x.ticket)}">#${esc(x.ticket)}</button>` : ''}</td></tr>`).join('') + '</tbody></table></div>'
      : '<div class="vazio">Nada registrado neste filtro.</div>');
  }

  // ============================================================
  //  BACKUP
  // ============================================================
  function renderBackup() {
    const uso = Dados.uso(), ub = Dados.meta.ultimoBackup, legado = Dados.legado();
    secao.innerHTML = `<h2 class="titulo-pagina">Backup e dados</h2>
      <div class="card"><h3 class="mb">Cópia de segurança</h3>
        <p class="mudo" style="margin-top:0">Os dados ficam guardados <b>na planilha do Google</b>, que também faz uma cópia automática por dia na pasta <code>EstacionaMais - backups</code> do Drive (guarda as últimas 30). Mesmo assim, baixe um backup com frequência e guarde em outro lugar (pendrive, outro e-mail): se a conta do Google tiver problema, as cópias que estão nela ficam indisponíveis junto.</p>
        <p>Último backup baixado: <b>${ub ? Ui.dataHora(ub) : 'nunca'}</b></p>
        <div class="gap"><button type="button" class="btn btn-primario btn-grande" id="b-exp">⬇ Baixar backup agora</button>
          <label class="btn btn-contorno btn-grande" style="cursor:pointer">⬆ Restaurar de um arquivo<input type="file" id="b-imp" accept=".json,application/json" hidden></label></div>
        <p class="dica">O arquivo contém tickets, caixas e usuários (as senhas ficam guardadas só como hash). Guarde-o em local seguro.</p></div>
      ${legado ? `<div class="card alerta"><h3 class="mb">Dados antigos encontrados neste navegador</h3>
        <p style="margin-top:0">Este navegador ainda tem dados da versão antiga do sistema (quando tudo ficava no navegador): <b>${legado.dados.tickets.length}</b> ticket(s), <b>${legado.dados.usuarios.length}</b> usuário(s). Você pode enviá-los para o servidor. <b>Isso substitui os dados que já estão no servidor.</b></p>
        <button type="button" class="btn btn-contorno" id="b-legado">⬆ Enviar dados antigos para o servidor</button></div>` : ''}
      <div class="card"><h3 class="mb">Dados no servidor</h3>
        <p style="margin-top:0"><b>${Dados.tickets.length}</b> ticket(s), <b>${Dados.log.length}</b> registro(s) de auditoria, cerca de <b>${uso.bytes >= 1048576 ? (uso.bytes / 1048576).toFixed(1) + ' MB' : Math.round(uso.bytes / 1024) + ' KB'}</b>.</p></div>
      <div class="card perigo"><h3 class="mb">Zona de perigo</h3>
        <p style="margin-top:0">Apaga <b>todos</b> os dados do servidor (tickets, caixas, usuários, configurações) para todos os aparelhos. O administrador volta ao usuário <b>admin</b> com a senha inicial (na planilha: menu <b>Estacionamento CSI → Mostrar senha inicial do admin</b>) e os demais usuários precisam ser cadastrados de novo. Antes de apagar, o servidor guarda uma cópia na pasta <code>EstacionaMais - backups</code> do Drive. Útil para limpar dados de teste antes de começar a valer.</p>
        <button type="button" class="btn btn-perigo" id="b-zerar">🗑️ Apagar tudo e recomeçar</button></div>`;

    const btLegado = $('#b-legado');
    if (btLegado) btLegado.onclick = async () => {
      const ok = await confirmarDigitando('ENVIAR', 'Enviar dados antigos?',
        `Os <b>${legado.dados.tickets.length}</b> ticket(s) e <b>${legado.dados.usuarios.length}</b> usuário(s) deste navegador <b>substituirão</b> tudo o que está no servidor. Você precisará entrar de novo.`);
      if (!ok) return;
      try { Dados.importar(legado); Dados.apagarLegado(); Ui.toast('Dados enviados para o servidor.'); setTimeout(() => window.location.href = 'index.html', 900); }
      catch (e) { Ui.toast(e.message, 'erro', 7000); }
    };

    $('#b-exp').onclick = () => {
      try {
        const obj = Dados.exportar();
        Ui.baixarArquivo(`estacionamento-csi-backup-${hojeISO()}.json`, JSON.stringify(obj), 'application/json');
        Auth.registrar('backup_exportado', `${Dados.tickets.length} ticket(s)`);
        Ui.toast('Backup baixado. Guarde o arquivo em local seguro.');
        renderBackup();
      } catch (e) { Ui.toast(e.message, 'erro'); }
    };
    $('#b-imp').onchange = ev => {
      const arq = ev.target.files[0]; if (!arq) return;
      const leitor = new FileReader();
      leitor.onload = async () => {
        let obj;
        try { obj = JSON.parse(leitor.result); } catch (e) { Ui.toast('Arquivo inválido (não é JSON).', 'erro'); return; }
        if (!obj || obj.sistema !== 'EstacionaMais' || !obj.dados) { Ui.toast('Este arquivo não é um backup do Estacionamento CSI.', 'erro'); return; }
        const ok = await confirmarDigitando('RESTAURAR', 'Restaurar backup?',
          `Backup de <b>${Ui.dataHora(obj.exportadoEm)}</b> com <b>${(obj.dados.tickets || []).length}</b> ticket(s).<br><b>Todos os dados atuais serão substituídos.</b>`);
        if (!ok) return;
        try { Dados.importar(obj); Auth.registrar('backup_importado', 'Backup de ' + Ui.dataHora(obj.exportadoEm)); Ui.toast('Backup restaurado.'); setTimeout(() => window.location.reload(), 900); }
        catch (e) { Ui.toast(e.message, 'erro', 7000); }
      };
      leitor.readAsText(arq);
      ev.target.value = '';
    };
    $('#b-zerar').onclick = async () => {
      const ok = await confirmarDigitando('APAGAR', 'Apagar todos os dados?', 'Isso <b>não pode ser desfeito</b>. Se tiver dúvida, baixe um backup antes.');
      if (!ok) return;
      try { Dados.zerar(); } catch (e) { Ui.toast(e.message, 'erro', 7000); return; }
      window.location.href = 'index.html';
    };
  }

  // ============================================================
  //  NAVEGAÇÃO + TEMPO REAL
  // ============================================================
  const secoes = {
    visao: { render: renderVisao, atualizar: atualizarVisao },
    patio: { render: renderPatio, atualizar: atualizarPatio },
    historico: { render: renderHistorico, atualizar: atualizarHistorico },
    caixas: { render: renderCaixas, atualizar: atualizarCaixas },
    mensalistas: { render: renderMensalistas, atualizar: atualizarMensalistas },
    config: { render: renderConfig },
    auditoria: { render: renderAuditoria, atualizar: atualizarAuditoria },
    backup: { render: renderBackup }
  };

  function ir(nome) {
    if (!secoes[nome]) nome = 'visao';
    estado.sec = nome;
    Ui.$$('#menu button').forEach(b => b.classList.toggle('ativo', b.dataset.sec === nome));
    secoes[nome].render();
    $('.conteudo').scrollTop = 0;
    try { sessionStorage.setItem('estacionamais.secGerencia', nome); } catch (e) { /* ok */ }
  }
  $('#menu').addEventListener('click', ev => { const b = ev.target.closest('[data-sec]'); if (b) ir(b.dataset.sec); });

  Dados.aoMudar(nome => {
    if (!Auth.atual()) { window.location.replace('index.html'); return; }
    if ((nome === 'log' || nome === 'meta') && estado.sec !== 'auditoria') return;
    const s = secoes[estado.sec];
    if (s && s.atualizar) Ui.agendar(s.atualizar);
  });
  window.setInterval(() => { const s = secoes[estado.sec]; if (s && s.atualizar && ['visao', 'patio'].indexOf(estado.sec) > -1) s.atualizar(); }, 30000);

  let inicial = 'visao';
  try { inicial = sessionStorage.getItem('estacionamais.secGerencia') || 'visao'; } catch (e) { /* ok */ }
  ir(inicial);
})();
