/* ============================================================
   api.js — como o site fala com o servidor (Google Apps Script)
   ------------------------------------------------------------
   O "servidor" é o Apps Script ligado à planilha do Google
   (apps-script/Codigo.gs). O endereço dele fica em js/config.js.
   O Google não devolve códigos HTTP nem cookies, então cada pedido é um
   POST com { m: método, r: rota, t: token, b: corpo } e a resposta volta
   { s: status, c: corpo }. O token do login fica no sessionStorage
   (fechar a aba encerra o login).
   O resto do sistema usa só Api.requisitar (síncrona) e Api.buscar (Promise).
   ============================================================ */
(function (global) {
  'use strict';

  var ENDERECO = String(global.ESTACIONA_API || '').replace(/\s+/g, '');
  var CONFIGURADO = /^https:\/\//i.test(ENDERECO);
  var CHAVE_TOKEN = 'estacionamais.token';
  var MSG_RESPOSTA = 'O servidor do Google não respondeu como esperado. Confira se a implantação do Apps Script está como "Qualquer pessoa" e se o endereço em js/config.js está certo.';
  var MSG_SEM_CONFIG = 'Servidor não configurado. Cole o endereço /exec do Apps Script em js/config.js (veja apps-script/LEIA-ME.md).';

  function lerToken() { try { return global.sessionStorage.getItem(CHAVE_TOKEN) || ''; } catch (e) { return ''; } }
  function guardarToken(t) {
    try { if (t) global.sessionStorage.setItem(CHAVE_TOKEN, t); else global.sessionStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* ok */ }
  }

  function pedido(metodo, url, corpo) {
    return JSON.stringify({ m: metodo, r: url, t: lerToken(), b: corpo === undefined ? {} : corpo });
  }

  /** Confere o envelope { s, c } e cuida do token. Devolve { status, corpo }. */
  function abrirEnvelope(url, texto) {
    var env = null;
    try { env = JSON.parse(texto); } catch (e) { /* não é JSON: página de erro do Google */ }
    if (!env || typeof env.s !== 'number') return { status: 502, corpo: { ok: false, erro: MSG_RESPOSTA } };
    var c = env.c;
    if (c && typeof c.token === 'string') guardarToken(c.token);
    if (env.s === 401 || url === '/api/logout') guardarToken('');
    return { status: env.s, corpo: c === undefined ? null : c };
  }

  /** Chamada síncrona. Devolve { status, corpo } (status 0 = sem conexão). */
  function requisitar(metodo, url, corpo) {
    if (!CONFIGURADO) return { status: 503, corpo: { ok: false, erro: MSG_SEM_CONFIG } };
    var x = new XMLHttpRequest();
    try {
      x.open('POST', ENDERECO, false);
      x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8'); // "simples": o navegador não faz pré-verificação (o Google não responderia)
      x.send(pedido(metodo, url, corpo));
    } catch (e) { return { status: 0, corpo: null }; }
    if (!x.status) return { status: 0, corpo: null };
    return abrirEnvelope(url, x.responseText);
  }

  /**
   * Chamada assíncrona (sondagem, painel, nota fiscal). Devolve uma Promise de
   * { ok, status, json() }. opc: { metodo, corpo, signal }.
   */
  function buscar(url, opc) {
    opc = opc || {};
    if (!CONFIGURADO) {
      return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({ ok: false, erro: MSG_SEM_CONFIG }); } });
    }
    return global.fetch(ENDERECO, {
      method: 'POST', cache: 'no-store', redirect: 'follow', signal: opc.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: pedido(opc.metodo || 'GET', url, opc.corpo)
    }).then(function (r) { return r.text(); }).then(function (texto) {
      var a = abrirEnvelope(url, texto);
      return { ok: a.status >= 200 && a.status < 300, status: a.status, json: function () { return Promise.resolve(a.corpo); } };
    });
  }

  global.Api = {
    configurado: CONFIGURADO,
    endereco: ENDERECO,
    intervaloMs: 8000,          // o Google limita chamadas simultâneas: não sondar a cada 2 s
    intervaloPainelMs: 10000,
    limiteBuscaMs: 30000,       // o Google pode demorar alguns segundos na primeira chamada
    requisitar: requisitar,
    buscar: buscar
  };
})(window);
