/* ============================================================
   dados.js — camada de dados do Estacionamento CSI (servidor)
   ------------------------------------------------------------
   Tudo que o sistema grava passa por aqui. Os dados ficam no
   servidor (planilha do Google, via Apps Script) e
   todos os dispositivos veem a mesma coisa. A API para o resto do
   sistema é a mesma de sempre (Dados.tickets, Dados.mudar, ...).

   REGRAS:
   - Dinheiro é SEMPRE inteiro em centavos (R$ 15,00 = 1500).
   - Para alterar dados use Dados.mudar('tickets', function (lista) { ... }).
     Ele aplica a função em cima da versão mais recente do servidor. Se
     outra pessoa gravou antes, refaz a função com os dados novos (por
     isso a função não deve ter efeitos fora da própria lista).
   - Depois de mudar(), objetos antigos ficam "velhos": sempre
     busque o registro de novo pelo id.

   COMO FUNCIONA:
   - O "servidor" é o Google Apps Script + Planilhas (apps-script/Codigo.gs;
     endereço em js/config.js, transporte em js/api.js).
   - Cada coleção tem uma versão no servidor. O navegador guarda uma
     cópia (cache) e a cada ~2,5 s (8 s no Google) pergunta quais versões mudaram e baixa
     só as diferenças (deltas). Mudanças de outras pessoas chegam por
     aqui e disparam Dados.aoMudar(fn) com externo = true.
   - Gravar é síncrono (XMLHttpRequest): o resto do sistema continua
     simples, sem async/await. Isso pede boa conexão com a internet.
   - Os deltas (aplicarDelta / calcularDelta) espelham aplicar_ em apps-script/Codigo.gs.
   ============================================================ */
(function (global) {
  'use strict';

  var COLECOES = ['config', 'usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'meta'];
  var LISTAS = ['usuarios', 'tickets', 'caixas', 'mensalistas', 'log'];
  var LIMITE_LOG = 3000;
  var TENTATIVAS = 6;
  var PREFIXO_LEGADO = 'estacionamais.'; // dados antigos, de quando tudo ficava no navegador

  var cache = {};        // nome -> { v: versão no servidor, dados: cópia exata do servidor }
  var ouvintes = [];
  var sondando = false;
  var timer = null;
  var saindo = false;

  function configPadrao() {
    return {
      estabelecimento: 'Estacionamento CSI',
      patios: [              // capacidade 0 = não informada: o painel mostra só a contagem de carros
        { id: '1', nome: 'Pátio CSI 1', capacidade: 0, ativo: true },
        { id: '2', nome: 'Pátio CSI 2', capacidade: 0, ativo: true }
      ],
      valorFixo: 1500,       // tarifa única (centavos): vale para qualquer veículo e qualquer tempo
      tolerancia: 10,        // (sem uso com tarifa única — mantido por compatibilidade com backups)
      toleranciaSaida: 30,   // (sem efeito na prática: com tarifa única nunca há valor excedente)
      fracaoMin: 15,         // (sem uso com tarifa única — mantido por compatibilidade com backups)
      tabela: {              // só os tipos de veículo; o preço é o mesmo para todos (valorFixo)
        carro:  { rotulo: 'Carro' },
        moto:   { rotulo: 'Moto' },
        grande: { rotulo: 'SUV / Van' }
      },
      // Ações que o CAIXA só faz com a senha de um gerente:
      autorizacao: { desconto: true, ticketPerdido: true, cancelar: true, sangria: true },
      permissoes: {},        // ajustes do administrador: { 'acao': ['caixa', ...] } (vazio = padrão do sistema)
      inatividadeMin: 30,    // desloga sozinho após X min parado (0 = nunca)
      larguraPapel: 32,      // colunas da impressora: 32 (58 mm) ou 48 (80 mm)
      rodapeTicket: 'Guarde este ticket. Em caso de perda, será exigido documento de identificação. Não deixe objetos de valor no veículo.',
      mensagemPainel: 'Aguarde no ponto de retirada com o ticket em mãos.'
    };
  }

  function padrao(nome) {
    switch (nome) {
      case 'config': return configPadrao();
      case 'meta': return { seqTicket: 1000, seqCaixa: 0, instaladoEm: Date.now(), ultimoBackup: null, ultimoPatio: null };
      default: return [];
    }
  }

  function ehObjeto(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function copia(v) { return JSON.parse(JSON.stringify(v)); }

  // Junta o que foi salvo com os padrões (novos campos aparecem após atualizações).
  function mesclar(base, salvo) {
    if (!ehObjeto(base) || !ehObjeto(salvo)) return salvo === undefined ? base : salvo;
    var r = {};
    Object.keys(base).forEach(function (k) { r[k] = base[k]; });
    Object.keys(salvo).forEach(function (k) {
      r[k] = ehObjeto(base[k]) && ehObjeto(salvo[k]) ? mesclar(base[k], salvo[k]) : salvo[k];
    });
    return r;
  }

  // Instalações antigas guardaram os nomes/capacidades de fábrica antigos; troca só o que ainda está no valor de fábrica.
  function migrarConfig(c) {
    if (c.estabelecimento === 'EstacionaMais') c.estabelecimento = 'Estacionamento CSI';
    (c.patios || []).forEach(function (p) {
      if (p.nome === 'Pátio ' + p.id || p.nome === 'Patio CSI ' + p.id) p.nome = 'Pátio CSI ' + p.id;
      if (p.capacidade === 40) p.capacidade = 0;
    });
    return c;
  }

  /** Cópia de trabalho de uma coleção do cache, já com os padrões aplicados. */
  function trabalho(nome, dados) {
    var v = copia(dados);
    if (nome === 'config') return migrarConfig(mesclar(padrao(nome), v));
    if (nome === 'meta') return mesclar(padrao(nome), v);
    return Array.isArray(v) ? v : padrao(nome);
  }

  // ---------- Deltas (espelham aplicar_ em apps-script/Codigo.gs) ----------
  function chave(x) {
    return x && (typeof x.id === 'string' || typeof x.id === 'number') ? String(x.id) : null;
  }

  function aplicarDelta(dados, d) {
    if (d.t === 't') return d.dados;
    var lista = dados.slice();
    if (d.t === 'm') {
      var pos = Object.create(null);
      lista.forEach(function (x, i) { var k = chave(x); if (k !== null) pos[k] = i; });
      d.up.forEach(function (x) {
        var k = String(x.id);
        if (k in pos) lista[pos[k]] = x; else { pos[k] = lista.length; lista.push(x); }
      });
      if (d.rm.length) {
        var rm = Object.create(null);
        d.rm.forEach(function (id) { rm[String(id)] = true; });
        lista = lista.filter(function (x) { var k = chave(x); return k === null || !(k in rm); });
      }
      return lista;
    }
    if (d.t === 'a') return lista.slice(d.n).concat(d.add);
    return dados;
  }

  function mapaPorId(lista) {
    var m = Object.create(null);
    for (var i = 0; i < lista.length; i++) {
      var k = chave(lista[i]);
      if (k === null || k in m) return null;
      m[k] = JSON.stringify(lista[i]);
    }
    return m;
  }

  /** O que mudou entre `antes` e `depois` (null = nada). */
  function calcularDelta(antes, depois) {
    if (!Array.isArray(antes) || !Array.isArray(depois)) {
      return JSON.stringify(antes) === JSON.stringify(depois) ? null : { t: 't', dados: depois };
    }
    var i, mAntes = mapaPorId(antes), mDepois = mapaPorId(depois);
    if (mAntes && mDepois) { // registros com id: só os que mudaram
      var up = depois.filter(function (x) { var k = String(x.id); return !(k in mAntes) || mAntes[k] !== JSON.stringify(x); });
      var rm = antes.filter(function (x) { return !(String(x.id) in mDepois); }).map(function (x) { return x.id; });
      return up.length || rm.length ? { t: 'm', up: up, rm: rm } : null;
    }
    // sem id (auditoria): só acrescenta no fim, descartando os mais antigos se passar do limite
    var sa = antes.map(function (x) { return JSON.stringify(x); }), sd = depois.map(function (x) { return JSON.stringify(x); });
    for (var k = 0; k <= Math.min(antes.length, 400); k++) {
      var restam = antes.length - k, igual = restam <= depois.length;
      for (i = 0; igual && i < restam; i++) if (sa[k + i] !== sd[i]) igual = false;
      if (igual) {
        var add = depois.slice(restam);
        return k === 0 && !add.length ? null : { t: 'a', n: k, add: add };
      }
    }
    return { t: 't', dados: depois };
  }

  // ---------- Rede ----------
  /** Chamada síncrona ao servidor (Google Apps Script: veja js/api.js). Devolve { status, corpo } (status 0 = sem conexão). */
  var requisitar = global.Api.requisitar;

  function sessaoExpirada() {
    if (Dados.deslogado || saindo) return;
    saindo = true;
    Dados.parar();
    global.location.replace('index.html?inativo=1');
  }

  function erroDe(r, padrao_) {
    if (r.status === 0) return 'Sem conexão com o servidor. Confira a internet/Wi-Fi e tente de novo.';
    return (r.corpo && r.corpo.erro) || padrao_;
  }

  /** Atualiza o cache com uma resposta do servidor (deltas ou coleção inteira). true = mudou. */
  function aplicarResposta(nome, j) {
    if (!j || typeof j.v !== 'number' || j.igual || j.v === cache[nome].v) return false;
    var dados;
    if (j.deltas) {
      dados = cache[nome].dados;
      j.deltas.forEach(function (d) { dados = aplicarDelta(dados, d); });
    } else if (j.dados !== undefined) dados = j.dados;
    else return false;
    cache[nome] = { v: j.v, dados: dados };
    Dados[nome] = trabalho(nome, dados);
    return true;
  }

  function notificar(nome, externo) {
    ouvintes.slice().forEach(function (fn) {
      try { fn(nome, !!externo); } catch (e) { if (global.console) console.error(e); }
    });
  }

  /** fetch com limite de tempo: numa rede que trava sem dar erro, a sondagem não pode ficar presa para sempre. */
  function buscarComLimite(url) {
    var ctl = new global.AbortController(), t = global.setTimeout(function () { ctl.abort(); }, global.Api.limiteBuscaMs);
    return global.Api.buscar(url, { signal: ctl.signal })
      .then(function (r) { global.clearTimeout(t); return r; }, function (e) { global.clearTimeout(t); throw e; });
  }

  function buscar(nome) {
    var desde = cache[nome].v;
    return buscarComLimite('/api/dados/' + nome + '?desde=' + desde)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (cache[nome].v !== desde) return; // gravamos aqui enquanto isso: a próxima sondagem acerta
        if (aplicarResposta(nome, j)) notificar(nome, true);
      });
  }

  function sondar() {
    if (sondando || saindo || Dados.deslogado || Dados.semServidor || global.document.hidden) return;
    sondando = true;
    buscarComLimite('/api/versoes')
      .then(function (r) {
        if (r.status === 401) { sessaoExpirada(); return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!j || !j.versoes) return;
        return Promise.all(COLECOES.filter(function (c) { return j.versoes[c] !== undefined && j.versoes[c] !== cache[c].v; }).map(buscar));
      })
      .catch(function () { /* sem rede agora: tenta na próxima */ })
      .then(function () { sondando = false; });
  }

  function iniciarSondagem() {
    if (timer) return;
    timer = global.setInterval(sondar, global.Api.intervaloMs);
    global.document.addEventListener('visibilitychange', sondar);
  }

  // ---------- Dados antigos (quando tudo ficava só no navegador) ----------
  function lerLegado(nome) {
    try {
      var bruto = global.localStorage.getItem(PREFIXO_LEGADO + nome);
      return bruto == null ? null : JSON.parse(bruto);
    } catch (e) { return null; }
  }

  var Dados = {
    avisos: [],
    semServidor: false,   // não conseguiu falar com o servidor
    semArmazenamento: false, // (nome antigo de semServidor)
    deslogado: false,     // servidor respondeu "faça login"
    sessao: null,         // { usuarioId } do usuário logado
    requisitar: requisitar,

    /** Carrega tudo do servidor. Chame uma vez no início de cada página. */
    iniciar: function () {
      var r = requisitar('GET', '/api/dados');
      Dados.semServidor = Dados.semArmazenamento = false;
      Dados.deslogado = false;
      Dados.sessao = null;
      var cols = {};
      if (r.status === 200 && r.corpo && r.corpo.colecoes) {
        cols = r.corpo.colecoes;
        Dados.sessao = r.corpo.sessao || null;
      } else if (r.status === 401) {
        Dados.deslogado = true;
      } else {
        Dados.semServidor = Dados.semArmazenamento = true;
      }
      COLECOES.forEach(function (c) {
        cache[c] = cols[c] ? { v: cols[c].v, dados: cols[c].dados } : { v: 0, dados: LISTAS.indexOf(c) !== -1 ? [] : {} };
        Dados[c] = trabalho(c, cache[c].dados);
      });
      if (Dados.deslogado && r.corpo && r.corpo.estabelecimento) Dados.config.estabelecimento = r.corpo.estabelecimento;
      if (!Dados.deslogado && !Dados.semServidor) iniciarSondagem();
      return Dados;
    },

    /** Para de sincronizar (usado ao sair). */
    parar: function () {
      if (timer) { global.clearInterval(timer); timer = null; }
      saindo = true;
    },

    /** Busca do servidor agora (síncrono) a versão mais recente de uma coleção. */
    recarregar: function (nome) {
      var r = requisitar('GET', '/api/dados/' + nome + '?desde=' + cache[nome].v);
      if (r.status === 401) sessaoExpirada();
      else if (r.status === 200) aplicarResposta(nome, r.corpo);
      return Dados[nome];
    },

    /** Aplica a função sobre a versão mais recente, grava no servidor e avisa os ouvintes. Devolve o retorno da função. */
    mudar: function (nome, fn) {
      for (var tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
        var base = cache[nome], trab = trabalho(nome, base.dados), r;
        try { r = fn(trab); } catch (e) { Dados[nome] = trabalho(nome, cache[nome].dados); throw e; }
        var delta = calcularDelta(base.dados, trab);
        if (!delta) { Dados[nome] = trab; notificar(nome, false); return r; }

        var resp = requisitar('PUT', '/api/dados/' + nome, { v: base.v, delta: delta });
        if (resp.status === 200 && resp.corpo && resp.corpo.ok) {
          // O estado local vem do MESMO delta que o servidor aplicou (ex.: ticket novo entra no fim,
          // como em todos os outros aparelhos), e não da cópia de trabalho.
          var novo = copia(aplicarDelta(base.dados, delta));
          cache[nome] = { v: resp.corpo.v, dados: novo };
          Dados[nome] = trabalho(nome, novo);
          notificar(nome, false);
          return r;
        }
        if (resp.status === 409 && resp.corpo) { // alguém gravou antes: pega o que mudou e refaz
          aplicarResposta(nome, resp.corpo);
          continue;
        }
        Dados[nome] = trabalho(nome, cache[nome].dados);
        if (resp.status === 401) { sessaoExpirada(); throw new Error('Sessão expirada. Entre novamente.'); }
        throw new Error(erroDe(resp, 'Não foi possível salvar (erro ' + resp.status + ').'));
      }
      Dados[nome] = trabalho(nome, cache[nome].dados);
      throw new Error('Muita gente alterando ao mesmo tempo. Tente de novo.');
    },

    /** Registra uma função chamada quando qualquer coleção muda (nesta aba ou em outro aparelho). */
    aoMudar: function (fn) { ouvintes.push(fn); },

    novoId: function (pref) {
      return (pref || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },

    proximoTicket: function () {
      return String(Dados.mudar('meta', function (m) { m.seqTicket = (m.seqTicket || 1000) + 1; return m.seqTicket; }));
    },

    proximoCaixa: function () {
      return Dados.mudar('meta', function (m) { m.seqCaixa = (m.seqCaixa || 0) + 1; return m.seqCaixa; });
    },

    /** O primeiro acesso já foi feito? (existe ao menos um gerente ativo) */
    configurado: function () {
      return Dados.usuarios.some(function (u) { return u.perfil === 'gerente' && u.ativo; });
    },

    patio: function (id) {
      return Dados.config.patios.filter(function (p) { return p.id === String(id); })[0] || null;
    },

    // ---------- Backup ----------
    /** Backup completo, montado pelo servidor (inclui as senhas em hash). */
    exportar: function () {
      Dados.mudar('meta', function (m) { m.ultimoBackup = Date.now(); });
      var r = requisitar('GET', '/api/backup');
      if (r.status === 401) sessaoExpirada();
      if (r.status !== 200 || !r.corpo) throw new Error(erroDe(r, 'Não foi possível gerar o backup.'));
      return r.corpo;
    },

    importar: function (obj) {
      if (!obj || obj.sistema !== 'EstacionaMais' || !ehObjeto(obj.dados)) {
        throw new Error('Arquivo inválido: não é um backup do Estacionamento CSI.');
      }
      var d = obj.dados;
      ['usuarios', 'tickets', 'caixas', 'mensalistas', 'log'].forEach(function (c) {
        if (!Array.isArray(d[c])) throw new Error('Backup incompleto (falta "' + c + '").');
      });
      if (!ehObjeto(d.config) || !ehObjeto(d.meta)) throw new Error('Backup incompleto (config/meta).');
      var r = requisitar('POST', '/api/restaurar', { dados: d });
      if (!r.corpo || !r.corpo.ok) throw new Error(erroDe(r, 'O servidor recusou o backup.'));
      Dados.iniciar();
      notificar('*', false);
    },

    /** Apaga TUDO no servidor (usado para limpar dados de teste). O administrador volta à senha inicial. */
    zerar: function () {
      var r = requisitar('POST', '/api/zerar', {});
      if (!r.corpo || !r.corpo.ok) throw new Error(erroDe(r, 'Não foi possível apagar os dados.'));
      Dados.parar();
      Dados.iniciar();
      notificar('*', false);
    },

    /** Tamanho aproximado dos dados no servidor. */
    uso: function () {
      var bytes = 0;
      COLECOES.forEach(function (c) { bytes += JSON.stringify(cache[c].dados).length; });
      return { bytes: bytes, percentual: 0 };
    },

    // ---------- Migração dos dados antigos deste navegador ----------
    /** Se este navegador ainda guarda dados da versão antiga (sem servidor), devolve um backup deles. */
    legado: function () {
      var tem = LISTAS.some(function (c) { var l = lerLegado(c); return Array.isArray(l) && l.length; });
      if (!tem) return null;
      var dados = {};
      COLECOES.forEach(function (c) {
        var v = lerLegado(c);
        dados[c] = c === 'config' ? mesclar(padrao(c), v || {}) : c === 'meta' ? mesclar(padrao(c), v || {}) : (Array.isArray(v) ? v : []);
      });
      return { sistema: 'EstacionaMais', versao: 2, exportadoEm: Date.now(), dados: dados };
    },

    apagarLegado: function () {
      try {
        var chaves = [];
        for (var i = 0; i < global.localStorage.length; i++) {
          var k = global.localStorage.key(i);
          if (k && k.indexOf(PREFIXO_LEGADO) === 0 && k !== PREFIXO_LEGADO + 'sessao') chaves.push(k);
        }
        chaves.forEach(function (k) { global.localStorage.removeItem(k); });
      } catch (e) { /* ignora */ }
    },

    LIMITE_LOG: LIMITE_LOG
  };

  global.Dados = Dados;
})(window);
