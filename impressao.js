/* ============================================================
   impressao.js — ticket, recibo e fechamento de caixa
   ------------------------------------------------------------
   1) Tenta a impressora térmica Bluetooth (ESC/POS via Web Bluetooth).
   2) Se não estiver conectada ou falhar, usa a impressão nativa do
      navegador (janela de impressão do sistema).
   O ticket tem CÓDIGO DE BARRAS REAL (Code 39) com o número do
   ticket, para o leitor conferir na entrega.

   Observação: Web Bluetooth só fala com impressoras Bluetooth LE.
   Modelos que só têm Bluetooth "clássico" (SPP) não conectam por
   aqui — nesse caso a impressão nativa continua funcionando.
   ============================================================ */
(function (global) {
  'use strict';

  var R = global.Regras;

  // ---------- Code 39 ----------
  var C39 = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
    '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
    'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
    'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
    'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
    'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
    'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn'
  };

  /** SVG do código de barras (Code 39). altura em px, modulo = largura da barra fina. */
  function barcodeSVG(codigo, altura, modulo) {
    altura = altura || 46; modulo = modulo || 2;
    var txt = '*' + String(codigo).toUpperCase().replace(/[^0-9A-Z\-. ]/g, '') + '*';
    var x = 0, barras = '';
    for (var i = 0; i < txt.length; i++) {
      var pad = C39[txt.charAt(i)];
      for (var j = 0; j < 9; j++) {
        var w = (pad.charAt(j) === 'w' ? 3 : 1) * modulo;
        if (j % 2 === 0) barras += '<rect x="' + x + '" y="0" width="' + w + '" height="' + altura + '" fill="#000"/>';
        x += w;
      }
      x += modulo; // espaço entre caracteres
    }
    var larg = x - modulo;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + larg + ' ' + altura + '" width="' + larg + '" height="' + altura + '" role="img" aria-label="Código de barras ' + String(codigo) + '">' + barras + '</svg>';
  }

  // ---------- Texto do ticket (usado por nativa e ESC/POS) ----------
  function dataHoraCurta(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function linhaTabela(t) {
    return ['Valor único: ' + R.moeda(Dados.config.valorFixo)];
  }

  // ---------- Impressão nativa ----------
  function areaImpressao() {
    var a = document.getElementById('area-impressao');
    if (!a) { a = document.createElement('div'); a.id = 'area-impressao'; document.body.appendChild(a); }
    return a;
  }
  function imprimirHTML(html) {
    var mm = Dados.config.larguraPapel === 48 ? 80 : 58;
    var st = document.getElementById('css-pagina');
    if (!st) { st = document.createElement('style'); st.id = 'css-pagina'; document.head.appendChild(st); }
    st.textContent = '@page{size:' + mm + 'mm auto;margin:2mm}';
    var a = areaImpressao();
    a.innerHTML = '<div class="imp" style="width:' + (mm - 6) + 'mm">' + html + '</div>';
    return new Promise(function (resolve) {
      var fim = function () { global.removeEventListener('afterprint', fim); a.innerHTML = ''; resolve(); };
      global.addEventListener('afterprint', fim);
      global.setTimeout(function () { global.print(); }, 60);
    });
  }

  function htmlTicket(t) {
    var cfg = Dados.config, esc = Ui.esc;
    var veic = R.descricaoVeiculo(t, cfg);
    var corpo =
      '<h1>' + esc(cfg.estabelecimento.toUpperCase()) + '</h1>' +
      '<div class="c">Comprovante de estacionamento</div><hr>' +
      '<div class="c">TICKET</div><div class="c enorme">#' + esc(t.id) + '</div>' +
      '<div class="c grande">' + esc(t.placa) + '</div><hr>' +
      (veic ? '<div>' + esc(veic) + '</div>' : '') +
      '<div>' + esc(R.localVeiculo(t, cfg)) + '</div>' +
      '<div>Entrada: ' + dataHoraCurta(t.entradaEm) + '</div>' +
      '<div>Atendente: ' + esc(t.entradaPorNome || '') + '</div>' +
      barcodeSVG(t.id, 46, 2) +
      '<div class="c">' + esc(t.id) + '</div><hr>' +
      linhaTabela(t).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') +
      '<hr><div style="font-size:11px">' + esc(cfg.rodapeTicket) + '</div>' +
      '<div class="corte">✂ - - - - - via da chave - - - - - ✂</div>' +
      '<div class="c enorme">#' + esc(t.id) + '</div>' +
      '<div class="c grande">' + esc(t.placa) + '</div>' +
      (veic ? '<div class="c">' + esc(veic) + '</div>' : '') +
      '<div class="c">' + esc(R.localVeiculo(t, cfg)) + '</div>' +
      barcodeSVG(t.id, 34, 2) + '<br>';
    return corpo;
  }

  function htmlRecibo(t, pag) {
    var cfg = Dados.config, esc = Ui.esc;
    var l = function (a, b) { return '<div class="lin"><span>' + esc(a) + '</span><span>' + esc(b) + '</span></div>'; };
    return '<h1>' + esc(cfg.estabelecimento.toUpperCase()) + '</h1><div class="c">Recibo de pagamento</div><hr>' +
      l('Ticket', '#' + t.id) + l('Placa', t.placa) +
      l('Entrada', dataHoraCurta(t.entradaEm)) + l('Pagamento', dataHoraCurta(pag.em)) +
      l('Permanência', R.duracao(pag.minutos)) + '<hr>' +
      pag.linhas.map(function (x) { return l(x.d, R.moeda(x.v)); }).join('') +
      (pag.quitadoAntes ? l('Já pago antes', '-' + R.moeda(pag.quitadoAntes)) : '') +
      (pag.desconto ? l('Desconto', '-' + R.moeda(pag.desconto)) : '') + '<hr>' +
      '<div class="lin negrito"><span>TOTAL</span><span>' + esc(R.moeda(pag.valor)) + '</span></div>' +
      l('Forma', R.METODOS[pag.metodo]) +
      (pag.metodo === 'dinheiro' ? l('Recebido', R.moeda(pag.recebido)) + l('Troco', R.moeda(pag.troco)) : '') +
      '<hr><div class="c" style="font-size:11px">Operador: ' + esc(pag.porNome) + '</div><br>';
  }

  function htmlFechamento(cx, res) {
    var cfg = Dados.config, esc = Ui.esc;
    var l = function (a, b) { return '<div class="lin"><span>' + esc(a) + '</span><span>' + esc(b) + '</span></div>'; };
    return '<h1>' + esc(cfg.estabelecimento.toUpperCase()) + '</h1><div class="c">Fechamento de caixa #' + cx.numero + '</div><hr>' +
      l('Operador', cx.operadorNome) + l('Abertura', dataHoraCurta(cx.abertoEm)) + l('Fechamento', dataHoraCurta(cx.fechadoEm)) + '<hr>' +
      Object.keys(R.METODOS).filter(function (k) { return res.porMetodo[k] && res.porMetodo[k].qtd; }).map(function (k) {
        return l(R.METODOS[k] + ' (' + res.porMetodo[k].qtd + ')', R.moeda(res.porMetodo[k].valor));
      }).join('') +
      '<div class="lin negrito"><span>TOTAL</span><span>' + esc(R.moeda(res.total)) + '</span></div>' +
      (res.descontos ? l('Descontos dados', R.moeda(res.descontos)) : '') + '<hr>' +
      l('Fundo inicial', R.moeda(cx.fundo)) + l('+ Dinheiro', R.moeda(res.dinheiro)) + l('- Retiradas', R.moeda(res.sangrias)) +
      l('Esperado na gaveta', R.moeda(cx.esperado)) + l('Contado', R.moeda(cx.contado)) +
      '<div class="lin negrito"><span>Diferença</span><span>' + esc(R.moeda(cx.diferenca)) + '</span></div>' +
      (cx.obsFechamento ? '<div>Obs: ' + esc(cx.obsFechamento) + '</div>' : '') + '<br><br><div class="c">______________________<br>Assinatura</div><br>';
  }

  // ---------- ESC/POS ----------
  var ESC = 0x1B, GS = 0x1D, LF = 0x0A;

  function ascii(s) {
    return String(s)
      .replace(/[·•]/g, '-').replace(/×/g, 'x').replace(/[ºª]/g, 'o').replace(/[✂→]/g, '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7E\n]/g, '?');
  }

  function EscPos() {
    this.b = [ESC, 0x40]; // init
    this.cols = Dados.config.larguraPapel === 48 ? 48 : 32;
  }
  EscPos.prototype.raw = function (arr) { for (var i = 0; i < arr.length; i++) this.b.push(arr[i]); return this; };
  EscPos.prototype.txt = function (s) {
    var a = ascii(s);
    for (var i = 0; i < a.length; i++) this.b.push(a.charCodeAt(i));
    return this;
  };
  EscPos.prototype.ln = function (s) { return this.txt((s || '') + '\n'); };
  EscPos.prototype.centro = function () { return this.raw([ESC, 0x61, 1]); };
  EscPos.prototype.esquerda = function () { return this.raw([ESC, 0x61, 0]); };
  EscPos.prototype.grande = function (on) { return this.raw([GS, 0x21, on ? 0x11 : 0x00]); };
  EscPos.prototype.negrito = function (on) { return this.raw([ESC, 0x45, on ? 1 : 0]); };
  EscPos.prototype.linha = function (c) { return this.ln(new Array(this.cols + 1).join(c || '-')); };
  EscPos.prototype.par = function (a, b) {
    a = ascii(a); b = ascii(b);
    var esp = Math.max(1, this.cols - a.length - b.length);
    return this.ln(a + new Array(esp + 1).join(' ') + b);
  };
  EscPos.prototype.barras = function (codigo) {
    // GS h (altura) · GS w (largura) · GS H (texto abaixo: 0) · GS k 4 (Code 39, terminado em NUL)
    var c = ascii(String(codigo).toUpperCase()).replace(/[^0-9A-Z\-. ]/g, '');
    this.raw([GS, 0x68, 60, GS, 0x77, 2, GS, 0x48, 0, GS, 0x6B, 4]);
    for (var i = 0; i < c.length; i++) this.b.push(c.charCodeAt(i));
    this.b.push(0x00, LF);
    return this;
  };
  EscPos.prototype.fim = function () { return this.raw([LF, LF, LF, LF]); };
  EscPos.prototype.bytes = function () { return new Uint8Array(this.b); };

  function escTicket(t) {
    var cfg = Dados.config, e = new EscPos(), veic = R.descricaoVeiculo(t, cfg);
    e.centro().grande(true).negrito(true).ln(cfg.estabelecimento.toUpperCase()).grande(false).negrito(false)
      .ln('Comprovante de estacionamento').linha()
      .ln('TICKET').grande(true).negrito(true).ln('#' + t.id).ln(t.placa).grande(false).negrito(false).linha()
      .esquerda();
    if (veic) e.ln(veic);
    e.ln(R.localVeiculo(t, cfg)).ln('Entrada: ' + dataHoraCurta(t.entradaEm)).ln('Atendente: ' + (t.entradaPorNome || ''))
      .centro().ln('').barras(t.id).ln(t.id).esquerda().linha();
    linhaTabela(t).forEach(function (l) { e.ln(l); });
    e.linha().ln(cfg.rodapeTicket).linha()
      .centro().ln('--- VIA DA CHAVE ---').grande(true).negrito(true).ln('#' + t.id).ln(t.placa).grande(false).negrito(false);
    if (veic) e.ln(veic);
    e.ln(R.localVeiculo(t, cfg)).barras(t.id).fim();
    return e.bytes();
  }

  function escRecibo(t, pag) {
    var cfg = Dados.config, e = new EscPos();
    e.centro().grande(true).negrito(true).ln(cfg.estabelecimento.toUpperCase()).grande(false).negrito(false)
      .ln('Recibo de pagamento').linha().esquerda()
      .par('Ticket', '#' + t.id).par('Placa', t.placa).par('Entrada', dataHoraCurta(t.entradaEm))
      .par('Pagamento', dataHoraCurta(pag.em)).par('Permanência', R.duracao(pag.minutos)).linha();
    pag.linhas.forEach(function (x) { e.par(x.d, R.moeda(x.v)); });
    if (pag.quitadoAntes) e.par('Já pago antes', '-' + R.moeda(pag.quitadoAntes));
    if (pag.desconto) e.par('Desconto', '-' + R.moeda(pag.desconto));
    e.linha().negrito(true).par('TOTAL', R.moeda(pag.valor)).negrito(false).par('Forma', R.METODOS[pag.metodo]);
    if (pag.metodo === 'dinheiro') e.par('Recebido', R.moeda(pag.recebido)).par('Troco', R.moeda(pag.troco));
    e.linha().centro().ln('Operador: ' + pag.porNome).fim();
    return e.bytes();
  }

  function escFechamento(cx, res) {
    var cfg = Dados.config, e = new EscPos();
    e.centro().negrito(true).ln(cfg.estabelecimento.toUpperCase()).negrito(false).ln('Fechamento de caixa #' + cx.numero).linha().esquerda()
      .par('Operador', cx.operadorNome).par('Abertura', dataHoraCurta(cx.abertoEm)).par('Fechamento', dataHoraCurta(cx.fechadoEm)).linha();
    Object.keys(R.METODOS).forEach(function (k) {
      if (res.porMetodo[k] && res.porMetodo[k].qtd) e.par(R.METODOS[k] + ' (' + res.porMetodo[k].qtd + ')', R.moeda(res.porMetodo[k].valor));
    });
    e.negrito(true).par('TOTAL', R.moeda(res.total)).negrito(false);
    if (res.descontos) e.par('Descontos dados', R.moeda(res.descontos));
    e.linha().par('Fundo inicial', R.moeda(cx.fundo)).par('+ Dinheiro', R.moeda(res.dinheiro)).par('- Retiradas', R.moeda(res.sangrias))
      .par('Esperado gaveta', R.moeda(cx.esperado)).par('Contado', R.moeda(cx.contado)).negrito(true).par('Diferença', R.moeda(cx.diferenca)).negrito(false);
    if (cx.obsFechamento) e.ln('Obs: ' + cx.obsFechamento);
    e.ln('').ln('').centro().ln('______________________').ln('Assinatura').fim();
    return e.bytes();
  }

  // ---------- Bluetooth (Web Bluetooth) ----------
  var bt = { dispositivo: null, carac: null, ouvintes: [] };
  // Serviços comuns de mini-impressoras térmicas BLE
  var SERVICOS_IMPRESSORA = [
    '000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000180a-0000-1000-8000-00805f9b34fb'
  ];

  function avisarStatus() { bt.ouvintes.forEach(function (fn) { try { fn(); } catch (e) { /* ok */ } }); }
  function pausa(ms) { return new Promise(function (r) { global.setTimeout(r, ms); }); }

  function aoDesconectar() {
    bt.carac = null;
    avisarStatus();
    Ui.toast('Impressora Bluetooth desconectada.', 'aviso');
  }

  function escreverBT(bytes) {
    if (!bt.dispositivo || !bt.dispositivo.gatt.connected || !bt.carac) return Promise.reject(new Error('Bluetooth não conectado'));
    var TAM = 100, sem = bt.carac.properties.writeWithoutResponse && bt.carac.writeValueWithoutResponse;
    var p = Promise.resolve();
    for (var i = 0; i < bytes.length; i += TAM) {
      (function (parte) {
        p = p.then(function () { return sem ? bt.carac.writeValueWithoutResponse(parte) : bt.carac.writeValue(parte); }).then(function () { return pausa(40); });
      })(bytes.slice(i, i + TAM));
    }
    return p;
  }

  var Impressao = {
    barcodeSVG: barcodeSVG,

    suportaBT: function () { return !!(global.navigator && global.navigator.bluetooth); },
    conectada: function () { return !!(bt.dispositivo && bt.dispositivo.gatt && bt.dispositivo.gatt.connected && bt.carac); },
    nomeDispositivo: function () { return bt.dispositivo ? bt.dispositivo.name : ''; },
    aoMudarStatus: function (fn) { bt.ouvintes.push(fn); },

    conectarBT: function () {
      if (!Impressao.suportaBT()) return Promise.reject(new Error('Este navegador não suporta Bluetooth. Use Chrome ou Edge (PC/Android).'));
      return global.navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICOS_IMPRESSORA })
        .then(function (disp) {
          bt.dispositivo = disp;
          disp.addEventListener('gattserverdisconnected', aoDesconectar);
          return disp.gatt.connect();
        })
        .then(function (server) { return server.getPrimaryServices(); })
        .then(function (servicos) {
          var seq = Promise.resolve(null);
          servicos.forEach(function (s) {
            seq = seq.then(function (achou) {
              if (achou) return achou;
              return s.getCharacteristics().then(function (cs) {
                return cs.filter(function (c) { return c.properties.write || c.properties.writeWithoutResponse; })[0] || null;
              }).catch(function () { return null; });
            });
          });
          return seq;
        })
        .then(function (carac) {
          if (!carac) {
            if (bt.dispositivo && bt.dispositivo.gatt.connected) bt.dispositivo.gatt.disconnect();
            throw new Error('Não encontrei como imprimir nesse dispositivo (talvez seja Bluetooth clássico). Use a impressão do sistema.');
          }
          bt.carac = carac;
          avisarStatus();
          return bt.dispositivo.name;
        });
    },

    desconectarBT: function () {
      if (bt.dispositivo && bt.dispositivo.gatt.connected) bt.dispositivo.gatt.disconnect();
      bt.carac = null; avisarStatus();
    },

    /** Janela de configuração da impressora. */
    abrirConfig: function () {
      var m = Ui.modal({
        titulo: 'Impressora', largura: 'sm',
        html: '<div id="imp-corpo"></div>',
        botoes: [{ rotulo: 'Fechar', classe: 'btn-contorno', aoClicar: function (mm) { mm.fechar(); } }]
      });
      var corpo = Ui.$('#imp-corpo', m.corpo);
      function desenhar() {
        var on = Impressao.conectada();
        corpo.innerHTML =
          '<p class="centro" style="margin-top:0"><span class="ponto ' + (on ? 'on' : '') + '"></span> ' +
          (on ? 'Conectada: <b>' + Ui.esc(Impressao.nomeDispositivo()) + '</b>' : 'Nenhuma impressora Bluetooth conectada.') + '</p>' +
          '<div class="gap" style="justify-content:center">' +
          (on ? '<button type="button" class="btn btn-perigo" data-a="desc">Desconectar</button>'
              : '<button type="button" class="btn btn-primario" data-a="conectar">Conectar via Bluetooth</button>') +
          '<button type="button" class="btn btn-contorno" data-a="teste">Imprimir teste</button></div>' +
          '<p class="dica mt">Sem Bluetooth conectado, o sistema usa a impressão normal do navegador/Windows. ' +
          (Impressao.suportaBT() ? '' : '<b>Este navegador não tem Bluetooth Web — use Chrome ou Edge.</b> ') +
          'Impressoras com Bluetooth "clássico" (sem BLE) não conectam por aqui.</p>' +
          '<label class="rotulo mt" for="imp-larg">Largura do papel</label>' +
          '<select id="imp-larg"><option value="32"' + (Dados.config.larguraPapel === 32 ? ' selected' : '') + '>58 mm (32 colunas)</option>' +
          '<option value="48"' + (Dados.config.larguraPapel === 48 ? ' selected' : '') + '>80 mm (48 colunas)</option></select>' +
          '<div class="dica erro" id="imp-erro"></div>';
        Ui.$('#imp-larg', corpo).onchange = function () {
          if (!Auth.pode('gerencia.configurar')) { Ui.toast('Só o gerente altera a largura do papel.', 'aviso'); this.value = Dados.config.larguraPapel; return; }
          var nova = JSON.parse(JSON.stringify(Dados.config)); nova.larguraPapel = Number(this.value);
          var r = Op.salvarConfig(nova); Ui.toast(r.ok ? 'Largura do papel salva.' : r.erro, r.ok ? 'sucesso' : 'erro');
        };
      }
      corpo.onclick = function (ev) {
        var b = ev.target.closest('[data-a]'); if (!b) return;
        var a = b.getAttribute('data-a'), err = Ui.$('#imp-erro', corpo);
        err.textContent = '';
        if (a === 'conectar') {
          b.disabled = true; b.textContent = 'Procurando...';
          Impressao.conectarBT().then(function () { Ui.toast('Impressora conectada!'); desenhar(); })
            .catch(function (e) { if (e && e.name === 'NotFoundError') { desenhar(); return; } desenhar(); Ui.$('#imp-erro', corpo).textContent = e.message; });
        } else if (a === 'desc') { Impressao.desconectarBT(); desenhar(); }
        else if (a === 'teste') {
          Impressao.imprimirTicket({
            id: '0000', placa: 'TESTE-00', categoria: 'carro', modelo: 'Teste de impressão', cor: '', patio: (Dados.config.patios[0] || {}).id || '1', vaga: 'A1',
            entradaEm: Date.now(), entradaPorNome: (Auth.atual() || {}).nome || ''
          }, true);
        }
      };
      Impressao.aoMudarStatus(desenhar);
      desenhar();
    },

    /** Tenta Bluetooth; se não der, imprime pelo navegador. Devolve Promise<'bluetooth'|'sistema'>. */
    _imprimir: function (bytes, html) {
      return escreverBT(bytes).then(function () { return 'bluetooth'; }).catch(function () {
        return imprimirHTML(html).then(function () { return 'sistema'; });
      });
    },

    imprimirTicket: function (t, teste) {
      return Impressao._imprimir(escTicket(t), htmlTicket(t)).then(function (via) {
        if (via === 'bluetooth') Ui.toast('Ticket enviado para a impressora.', 'info');
        return via;
      });
    },
    imprimirRecibo: function (t, pag) { return Impressao._imprimir(escRecibo(t, pag), htmlRecibo(t, pag)); },
    imprimirFechamento: function (cx, res) { return Impressao._imprimir(escFechamento(cx, res), htmlFechamento(cx, res)); }
  };

  global.Impressao = Impressao;
})(window);
