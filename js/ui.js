/* ============================================================
   ui.js — componentes de tela compartilhados
   (toast, modal, cabeçalho, relógios, som)
   ============================================================ */
(function (global) {
  'use strict';

  var doc = global.document;
  var pilhaModais = [];
  var ctxAudio = null;

  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function visivel(el) {
    return el && !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) ? el : null;
  }

  function criar(tag, classe, html) {
    var e = doc.createElement(tag);
    if (classe) e.className = classe;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var Ui = {
    esc: esc,
    $: function (s, raiz) { return (raiz || doc).querySelector(s); },
    $$: function (s, raiz) { return Array.prototype.slice.call((raiz || doc).querySelectorAll(s)); },
    moeda: function (c) { return Regras.moeda(c); },

    dataHora: function (ms) {
      if (!ms) return '—';
      var d = new Date(ms);
      return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    },
    data: function (ms) {
      if (!ms) return '—';
      var d = new Date(ms);
      return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
    },
    hora: function (ms) {
      if (!ms) return '—';
      var d = new Date(ms);
      return p2(d.getHours()) + ':' + p2(d.getMinutes());
    },
    cronometro: function (ms) {
      var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return (h ? h + ':' + p2(m) : p2(m)) + ':' + p2(s % 60);
    },

    /** Agrupa várias chamadas seguidas numa só (evita redesenhar 5x por evento). */
    agendar: function (fn) {
      if (fn._agendado) return;
      fn._agendado = true;
      global.setTimeout(function () { fn._agendado = false; fn(); }, 30);
    },

    // ---------- Toast ----------
    toast: function (msg, tipo, ms) {
      var c = doc.getElementById('toasts');
      if (!c) { c = criar('div'); c.id = 'toasts'; c.setAttribute('aria-live', 'polite'); doc.body.appendChild(c); }
      var t = criar('div', 'toast ' + (tipo || 'sucesso'));
      t.textContent = msg;
      c.appendChild(t);
      global.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || (tipo === 'erro' ? 5500 : 3200));
    },

    // ---------- Modal ----------
    /**
     * Ui.modal({ titulo, html, largura:'sm|md|lg|xl', semFechar, aoFechar,
     *            botoes:[{ id, rotulo, classe, padrao, desabilitado, aoClicar(modal) }] })
     * Retorna { el, corpo, fechar(), botao(id), titulo(txt) }.
     * ESC fecha; ENTER aciona o botão "padrao".
     */
    modal: function (o) {
      var fundo = criar('div', 'modal-fundo');
      var caixa = criar('div', 'modal modal-' + (o.largura || 'md'));
      caixa.setAttribute('role', 'dialog');
      caixa.setAttribute('aria-modal', 'true');
      caixa.setAttribute('aria-label', o.titulo || 'Janela');
      var topo = criar('div', 'modal-topo', '<h3></h3>');
      topo.firstChild.textContent = o.titulo || '';
      if (!o.semFechar) {
        var x = criar('button', 'modal-x', '&times;'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar');
        topo.appendChild(x);
        x.addEventListener('click', function () { api.fechar(); });
      }
      var corpo = criar('div', 'modal-corpo', o.html || '');
      caixa.appendChild(topo); caixa.appendChild(corpo);
      var rodape = null;
      if (o.botoes && o.botoes.length) {
        rodape = criar('div', 'modal-rodape');
        o.botoes.forEach(function (b) {
          var btn = criar('button', 'btn ' + (b.classe || ''));
          btn.type = 'button'; btn.textContent = b.rotulo;
          if (b.id) btn.setAttribute('data-id', b.id);
          if (b.padrao) btn.setAttribute('data-padrao', '1');
          if (b.desabilitado) btn.disabled = true;
          btn.addEventListener('click', function () { if (b.aoClicar) b.aoClicar(api); else api.fechar(); });
          rodape.appendChild(btn);
        });
        caixa.appendChild(rodape);
      }
      fundo.appendChild(caixa);
      var foco = doc.activeElement, fechado = false;

      var api = {
        el: fundo, corpo: corpo, rodape: rodape,
        botao: function (id) { return rodape ? rodape.querySelector('[data-id="' + id + '"]') : null; },
        titulo: function (t) { topo.firstChild.textContent = t; },
        fechar: function () {
          if (fechado) return; fechado = true;
          var i = pilhaModais.indexOf(api); if (i > -1) pilhaModais.splice(i, 1);
          if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
          if (foco && foco.focus && doc.body.contains(foco)) { try { foco.focus(); } catch (e) { /* ok */ } }
          if (o.aoFechar) o.aoFechar(api);
        },
        semEsc: !!o.semFechar
      };
      fundo.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' || !rodape) return;
        var t = ev.target, tag = t.tagName;
        var selecao = t.classList && (t.classList.contains('tile') || t.classList.contains('chip'));
        if (tag === 'TEXTAREA' || tag === 'A' || tag === 'SUMMARY' || (tag === 'BUTTON' && !selecao)) return;
        var pad = rodape.querySelector('[data-padrao]');
        if (pad && !pad.disabled) { ev.preventDefault(); pad.click(); }
      });
      doc.body.appendChild(fundo);
      pilhaModais.push(api);
      global.setTimeout(function () {
        if (fechado) return;
        // O foco SEMPRE vai para dentro da janela (senão Enter/teclas afetam a tela de fundo).
        var alvo = visivel(corpo.querySelector('[data-foco]')) ||
          Ui.$$('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,select', corpo).filter(visivel)[0] ||
          (rodape && visivel(rodape.querySelector('[data-padrao]:not(:disabled)')));
        if (alvo) { alvo.focus(); if (alvo.select && alvo.tagName === 'INPUT') { try { alvo.select(); } catch (e) { /* ok */ } } }
        else { caixa.setAttribute('tabindex', '-1'); caixa.focus(); } // nunca foca um botão "perigoso" (ex.: Cancelar)
      }, 40);
      return api;
    },

    fecharTodosModais: function () { pilhaModais.slice().forEach(function (m) { m.fechar(); }); },

    /** Confirmação simples. Promise<boolean>. */
    confirmar: function (o) {
      return new Promise(function (resolve) {
        var resolvido = false;
        function fim(v) { if (!resolvido) { resolvido = true; resolve(v); } }
        Ui.modal({
          titulo: o.titulo || 'Confirmar', largura: 'sm', html: '<p style="margin:0;font-size:1.05rem">' + (o.html || esc(o.mensagem || '')) + '</p>',
          aoFechar: function () { fim(false); },
          botoes: [
            { rotulo: o.cancelar || 'Cancelar', classe: 'btn-contorno', aoClicar: function (m) { m.fechar(); } },
            { rotulo: o.ok || 'Confirmar', classe: o.perigo ? 'btn-perigo' : 'btn-sucesso', padrao: true, aoClicar: function (m) { fim(true); m.fechar(); } }
          ]
        });
      });
    },

    /** Pergunta um texto. Promise<string|null>. */
    perguntar: function (o) {
      return new Promise(function (resolve) {
        var resolvido = false;
        function fim(v) { if (!resolvido) { resolvido = true; resolve(v); } }
        var m = Ui.modal({
          titulo: o.titulo, largura: 'sm',
          html: (o.mensagem ? '<p style="margin-top:0">' + esc(o.mensagem) + '</p>' : '') +
            '<label class="rotulo" for="perg-campo">' + esc(o.rotulo || '') + '</label>' +
            '<input type="text" id="perg-campo" data-foco maxlength="' + (o.max || 120) + '" placeholder="' + esc(o.dica || '') + '">' +
            '<div class="dica erro" id="perg-erro"></div>',
          aoFechar: function () { fim(null); },
          botoes: [
            { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: function (mm) { mm.fechar(); } },
            {
              rotulo: o.ok || 'Confirmar', classe: 'btn-primario', padrao: true, aoClicar: function (mm) {
                var v = Ui.$('#perg-campo', mm.corpo).value.trim();
                if (o.obrigatorio !== false && v.length < (o.minimo || 3)) { Ui.$('#perg-erro', mm.corpo).textContent = 'Preencha este campo (mínimo ' + (o.minimo || 3) + ' letras).'; return; }
                fim(v); mm.fechar();
              }
            }
          ]
        });
        return m;
      });
    },

    /** Pede a senha de um gerente. Promise<usuario gerente | null>. */
    pedirSenhaGerente: function (texto) {
      return new Promise(function (resolve) {
        var gerentes = Auth.usuariosAtivos().filter(function (g) { return g.perfil === 'gerente'; });
        if (!gerentes.length) { Ui.toast('Nenhum gerente cadastrado.', 'erro'); resolve(null); return; }
        var resolvido = false, escolhido = gerentes.length === 1 ? gerentes[0] : null;
        function fim(v) { if (!resolvido) { resolvido = true; resolve(v); } }
        var m = Ui.modal({
          titulo: '🔒 Autorização do gerente', largura: 'sm', html: '<div id="aut-corpo"></div>',
          aoFechar: function () { fim(null); },
          botoes: [{ rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: function (mm) { mm.fechar(); } }]
        });
        var corpo = Ui.$('#aut-corpo', m.corpo);

        function mostrarLista() {
          corpo.innerHTML = '<p class="centro" style="margin-top:0">' + esc(texto || 'Esta ação precisa da autorização de um gerente.') + '</p>' +
            '<div class="perfil-titulo centro">Quem está autorizando?</div><div class="grade-2">' +
            gerentes.map(function (g) { return '<button type="button" class="tile" data-g="' + esc(g.id) + '"><span class="emoji">📊</span>' + esc(g.nome) + '</button>'; }).join('') + '</div>';
          corpo.onclick = function (ev) {
            var b = ev.target.closest('[data-g]'); if (!b) return;
            escolhido = gerentes.filter(function (g) { return g.id === b.getAttribute('data-g'); })[0];
            mostrarSenha();
          };
        }
        function mostrarSenha() {
          corpo.onclick = null;
          corpo.innerHTML = '<p class="centro" style="margin-top:0">' + esc(texto || 'Esta ação precisa da autorização de um gerente.') + '</p>' +
            '<div class="centro negrito mb">' + esc(escolhido.nome) + (gerentes.length > 1 ? ' · <button type="button" class="btn btn-link" id="aut-trocar">trocar</button>' : '') + '</div>' +
            '<label class="rotulo" for="aut-senha">Senha do gerente</label><input id="aut-senha" type="password" autocomplete="off" data-foco>' +
            '<div class="dica erro" id="aut-erro" role="alert"></div>' +
            '<button type="button" class="btn btn-primario btn-bloco mt" id="aut-ok" data-padrao="1">Autorizar</button>';
          var campo = Ui.$('#aut-senha', corpo), erro = Ui.$('#aut-erro', corpo);
          function confirmar() {
            var r = Auth.validarSenha(escolhido.id, campo.value);
            if (!r.ok) { erro.textContent = r.erro; campo.value = ''; campo.focus(); return; }
            var g = escolhido; fim(g); m.fechar();
          }
          Ui.$('#aut-ok', corpo).onclick = confirmar;
          campo.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); } };
          var t = Ui.$('#aut-trocar', corpo); if (t) t.onclick = mostrarLista;
          campo.focus();
        }
        if (escolhido) mostrarSenha(); else mostrarLista();
      });
    },

    // ---------- Cabeçalho ----------
    /**
     * Ui.montarTopo({ pagina:'Caixa', ativo:'caixa', impressora:true })
     * Mostra usuário, botão Sair e (para gerente) atalhos entre telas.
     */
    montarTopo: function (o) {
      var u = Auth.atual(), topo = doc.getElementById('topo');
      if (!u || !topo) return;
      var links = '';
      var telas = [['gerencia', 'Gerência'], ['caixa', 'Caixa'], ['manobrista', 'Manobrista']].filter(function (l) { return Auth.pode('pagina.' + l[0]); });
      if (u.perfil === 'gerente' || telas.length > 1) {
        links = '<nav class="topo-links" aria-label="Telas">' +
          telas.map(function (l) {
            return '<a href="' + l[0] + '.html" class="' + (o.ativo === l[0] ? 'ativo' : '') + '">' + l[1] + '</a>';
          }).join('') + (u.perfil === 'gerente' ? '<a href="painel.html" target="_blank" rel="noopener">Painel ↗</a>' : '') + '</nav>';
      }
      topo.innerHTML =
        '<a class="marca" href="index.html"><span aria-hidden="true">🅿️</span><span>' + esc(Dados.config.estabelecimento) + '</span></a>' +
        (links ? '' : '<span class="topo-pagina">' + esc(o.pagina || '') + '</span>') + links +
        '<div class="topo-dir">' +
        (o.impressora === false ? '' : '<button type="button" class="btn-impressora" data-acao="impressora" title="Impressora Bluetooth"><span class="ponto" id="ponto-bt"></span><span class="rot">Impressora</span></button>') +
        '<span class="topo-usuario"><strong>' + esc(u.nome) + '</strong><small>' + esc(Auth.PERFIS[u.perfil].rotulo) + '</small></span>' +
        '<button type="button" class="btn btn-sm btn-contorno" data-acao="sair" style="color:#111">Sair</button></div>';
      topo.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-acao]'); if (!b) return;
        if (b.getAttribute('data-acao') === 'sair') Auth.sair();
        if (b.getAttribute('data-acao') === 'impressora' && global.Impressao) Impressao.abrirConfig();
      });
      if (global.Impressao) {
        var atualizar = function () { var p = doc.getElementById('ponto-bt'); if (p) p.classList.toggle('on', Impressao.conectada()); };
        Impressao.aoMudarStatus(atualizar); atualizar();
      }
    },

    // ---------- Tempo real ----------
    /**
     * Atualiza a cada segundo qualquer elemento com data-desde="<ms>":
     *   data-fmt="cron" (mm:ss) ou "min" (12 min) e data-alerta="5,10" (min p/ aviso e crítico).
     * E elementos com data-relogio (hora atual).
     */
    iniciarRelogios: function () {
      function tick() {
        var agora = Date.now();
        Ui.$$('[data-desde]').forEach(function (e) {
          var ms = agora - Number(e.getAttribute('data-desde'));
          e.textContent = e.getAttribute('data-fmt') === 'cron' ? Ui.cronometro(ms) : Regras.duracao(ms / 60000);
          var al = e.getAttribute('data-alerta');
          if (al) {
            var lim = al.split(',').map(Number), min = ms / 60000;
            e.classList.toggle('espera-critica', min >= lim[1]);
            e.classList.toggle('espera-aviso', min >= lim[0] && min < lim[1]);
            e.classList.toggle('espera-ok', min < lim[0]);
          }
        });
        Ui.$$('[data-relogio]').forEach(function (e) { var d = new Date(agora); e.textContent = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); });
      }
      tick();
      global.setInterval(tick, 1000);
    },

    // ---------- Som / vibração (avisa o manobrista de novo carro na fila) ----------
    bip: function () {
      try {
        var AC = global.AudioContext || global.webkitAudioContext; if (!AC) return;
        ctxAudio = ctxAudio || new AC();
        if (ctxAudio.state === 'suspended') ctxAudio.resume();
        [0, 0.18].forEach(function (atraso) {
          var osc = ctxAudio.createOscillator(), g = ctxAudio.createGain();
          osc.type = 'sine'; osc.frequency.value = 880; g.gain.value = 0.15;
          osc.connect(g); g.connect(ctxAudio.destination);
          osc.start(ctxAudio.currentTime + atraso); osc.stop(ctxAudio.currentTime + atraso + 0.12);
        });
      } catch (e) { /* som é opcional */ }
      try { if (global.navigator.vibrate) global.navigator.vibrate([120, 80, 120]); } catch (e) { /* ok */ }
    },

    // ---------- Utilidades ----------
    baixarArquivo: function (nome, conteudo, tipo) {
      var blob = new Blob([conteudo], { type: tipo || 'text/plain;charset=utf-8' });
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nome;
      doc.body.appendChild(a); a.click();
      global.setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },

    /** Reformata um campo de dinheiro para "0,00" ao sair dele. */
    campoMoeda: function (input) {
      input.setAttribute('inputmode', 'decimal');
      input.addEventListener('blur', function () {
        var c = Regras.parseMoeda(input.value);
        if (c !== null) input.value = (c / 100).toFixed(2).replace('.', ',');
      });
    },
    valorCampoMoeda: function (input) { return Regras.parseMoeda(input.value); },

    csv: function (linhas) {
      return '﻿' + linhas.map(function (l) {
        return l.map(function (c) {
          c = String(c == null ? '' : c);
          if (/^[=+@]/.test(c) || /^-[^\d]/.test(c)) c = "'" + c; // evita "injeção de fórmula" ao abrir no Excel
          return /[";\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
        }).join(';');
      }).join('\r\n');
    }
  };

  doc.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && pilhaModais.length) {
      var topo = pilhaModais[pilhaModais.length - 1];
      if (!topo.semEsc) topo.fechar();
    }
  });

  // Foco preso na janela do topo: nada por trás dela recebe teclado.
  doc.addEventListener('focusin', function (ev) {
    var topo = pilhaModais[pilhaModais.length - 1];
    if (!topo || topo.el.contains(ev.target)) return;
    var alvo = Ui.$$('[data-foco],input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,select', topo.el).filter(visivel)[0];
    if (alvo) alvo.focus();
    else { var caixa = topo.el.querySelector('.modal'); if (caixa) { caixa.setAttribute('tabindex', '-1'); caixa.focus(); } }
  });

  global.Ui = Ui;
})(window);
