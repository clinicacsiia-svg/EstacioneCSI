/* ============================================================
   auth.js — usuários, senha, sessão, permissões e autorização
   ------------------------------------------------------------
   PERFIS:  admin · manobrista · caixa (atendente) · gerente
   O ADMIN (usuário "admin") é criado automaticamente. É ele quem
   cadastra os demais usuários (inclusive gerentes) e define o que
   manobrista e atendente podem fazer. Só acessa a tela admin.html.
   Cada ação do sistema tem uma permissão (tabela PERMISSOES); o
   admin pode ajustá-las por perfil (config.permissoes).
   Algumas ações do CAIXA exigem a senha de um gerente na hora
   ("autorização de supervisor") — configurável na Gerência.

   COMO É PROTEGIDO: o login é conferido pelo SERVIDOR (senha nunca
   sai de lá; sessão por token; bloqueio após tentativas erradas) e
   nenhum dado é entregue sem sessão válida. As regras por perfil
   abaixo separam telas e evitam erro operacional; o servidor só
   reforça o essencial (usuários e configurações, auditoria só cresce,
   nota fiscal). Quem tem uma sessão válida de caixa/manobrista
   conseguiria, com conhecimento técnico, gravar tickets por fora da tela.
   ============================================================ */
(function (global) {
  'use strict';

  var LOGIN_ADMIN = 'admin';

  var PERFIS = {
    admin:      { rotulo: 'Administrador', emoji: '🛡️', home: 'admin.html' },
    manobrista: { rotulo: 'Manobrista', emoji: '🚗', home: 'manobrista.html' },
    caixa:      { rotulo: 'Atendente / Caixa', emoji: '💵', home: 'caixa.html' },
    gerente:    { rotulo: 'Gerente', emoji: '📊', home: 'gerencia.html' }
  };
  var PERFIS_OPERACIONAIS = ['manobrista', 'caixa', 'gerente']; // os que o admin pode cadastrar

  var PERMISSOES = {
    // páginas
    'pagina.admin':      ['admin'],
    'pagina.manobrista': ['manobrista', 'gerente'],
    'pagina.caixa':      ['caixa', 'gerente'],
    'pagina.gerencia':   ['gerente'],
    // administração (só o admin)
    'admin.usuarios':    ['admin'],
    'admin.permissoes':  ['admin'],
    // operação do pátio
    'entrada.registrar': ['manobrista', 'gerente'],
    'entrada.corrigir':  ['manobrista', 'caixa', 'gerente'],
    'ticket.reimprimir': ['manobrista', 'caixa', 'gerente'],
    'valet.buscar':      ['manobrista', 'gerente'],
    'valet.entregar':    ['manobrista', 'gerente'],
    'valet.desfazer':    ['manobrista', 'gerente'],
    // dinheiro
    'pagamento.receber':      ['caixa', 'gerente'],
    'pagamento.desconto':     ['caixa', 'gerente'],
    'pagamento.ticketPerdido': ['caixa', 'gerente'],
    'pagamento.estornar':     ['gerente'],
    'nota.emitir':            ['caixa', 'gerente'],
    'entrada.cancelar':       ['caixa', 'gerente'],
    'caixa.operar':           ['caixa', 'gerente'],
    'caixa.sangria':          ['caixa', 'gerente'],
    // gestão
    'gerencia.ver':        ['gerente'],
    'gerencia.configurar': ['gerente'],
    'gerencia.backup':     ['gerente']
  };

  // Grupos que o admin liga/desliga para manobrista e atendente (o gerente sempre tem tudo).
  // fixo: true = só informativo (continua exclusivo do gerente).
  var GRUPOS_PERMISSAO = [
    { rotulo: 'Registrar entrada de veículos', acoes: ['entrada.registrar'] },
    { rotulo: 'Corrigir dados / reimprimir ticket', acoes: ['entrada.corrigir', 'ticket.reimprimir'] },
    { rotulo: 'Buscar e entregar veículos', acoes: ['valet.buscar', 'valet.entregar', 'valet.desfazer'] },
    { rotulo: 'Receber pagamentos', acoes: ['pagamento.receber'] },
    { rotulo: 'Dar desconto / cortesia', acoes: ['pagamento.desconto'] },
    { rotulo: 'Ticket perdido (entrega sem ticket)', acoes: ['pagamento.ticketPerdido'] },
    { rotulo: 'Emitir nota fiscal (NFS-e)', acoes: ['nota.emitir'] },
    { rotulo: 'Cancelar entrada feita por engano', acoes: ['entrada.cancelar'] },
    { rotulo: 'Retirar dinheiro do caixa (sangria)', acoes: ['caixa.sangria'] },
    { rotulo: 'Abrir e fechar o próprio caixa', acoes: ['caixa.operar'] },
    { rotulo: 'Estornar pagamento', acoes: ['pagamento.estornar'] },
    { rotulo: 'Relatórios, auditoria e backup', acoes: ['gerencia.ver'], fixo: true },
    { rotulo: 'Configurar preços e pátios', acoes: ['gerencia.configurar'], fixo: true }
  ];
  var PERFIS_AJUSTAVEIS = ['manobrista', 'caixa'];

  // Quem tem qualquer uma destas ações precisa poder abrir a tela correspondente.
  var PAGINA_POR_ACAO = {
    'pagina.manobrista': ['entrada.registrar', 'valet.buscar', 'valet.entregar', 'valet.desfazer'],
    'pagina.caixa': ['pagamento.receber', 'caixa.operar']
  };

  function acaoAjustavel(acao) {
    return GRUPOS_PERMISSAO.some(function (g) { return !g.fixo && g.acoes.indexOf(acao) !== -1; });
  }

  /** Perfis que podem executar a ação, já considerando os ajustes feitos pelo admin. */
  function perfisDe(acao) {
    var base = PERMISSOES[acao] || [];
    var aj = Dados.config && Dados.config.permissoes;
    if (!acaoAjustavel(acao) || !aj || !Array.isArray(aj[acao])) return base;
    var r = ['gerente'];
    aj[acao].forEach(function (p) { if (PERFIS_AJUSTAVEIS.indexOf(p) !== -1 && r.indexOf(p) === -1) r.push(p); });
    return r;
  }

  function perfilPode(perfil, acao) {
    if (perfisDe(acao).indexOf(perfil) !== -1) return true;
    var via = PAGINA_POR_ACAO[acao];
    return !!via && via.some(function (a) { return perfisDe(a).indexOf(perfil) !== -1; });
  }

  // ação → chave em config.autorizacao (o CAIXA precisa da senha do gerente quando true)
  var EXIGE_AUTORIZACAO = {
    'pagamento.desconto': 'desconto',
    'pagamento.ticketPerdido': 'ticketPerdido',
    'entrada.cancelar': 'cancelar',
    'caixa.sangria': 'sangria'
  };

  // ---------- SHA-256 (JS puro: funciona até fora de HTTPS) ----------
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var pow = Math.pow, max = pow(2, 32), i, j, result = '';
    var words = [], bitLen = ascii.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pc = k.length;
    var comp = {};
    for (var c = 2; pc < 64; c++) {
      if (!comp[c]) {
        for (i = 0; i < 313; i += c) comp[i] = c;
        hash[pc] = (pow(c, 0.5) * max) | 0;
        k[pc++] = (pow(c, 1 / 3) * max) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return null;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / max) | 0);
    words[words.length] = bitLen;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += (b < 16 ? 0 : '') + b.toString(16); }
    return result;
  }

  function novoSalt() {
    try {
      var a = new Uint8Array(12); global.crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    } catch (e) { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  }
  // A senha vai em UTF-8 para aceitar acentos (o sha256 acima só lê bytes).
  function hashSenha(senha, salt) { return sha256(unescape(encodeURIComponent(salt + ':' + senha))); }

  function normalizarLogin(s) { return String(s || '').trim().toLowerCase(); }
  function validarLogin(s) {
    return /^[a-z0-9._-]{3,20}$/.test(s) ? null : 'O usuário deve ter de 3 a 20 caracteres (letras sem acento, números, ponto, hífen ou _).';
  }

  var _aut = null; // autorização de gerente em memória (vale 60 s, uso único por ação)

  var Auth = {
    PERFIS: PERFIS, PERFIS_OPERACIONAIS: PERFIS_OPERACIONAIS, PERMISSOES: PERMISSOES, EXIGE_AUTORIZACAO: EXIGE_AUTORIZACAO,
    GRUPOS_PERMISSAO: GRUPOS_PERMISSAO, PERFIS_AJUSTAVEIS: PERFIS_AJUSTAVEIS, LOGIN_ADMIN: LOGIN_ADMIN, sha256: sha256,

    usuariosAtivos: function () {
      return Dados.usuarios.filter(function (u) { return u.ativo; });
    },

    /** (o servidor cria o administrador e os logins na primeira execução; mantido por compatibilidade) */
    preparar: function () {},

    /** Usuário logado (a sessão vem do servidor), ou null. */
    atual: function () {
      var s = Dados.sessao;
      if (!s) return null;
      return Dados.usuarios.filter(function (x) { return x.id === s.usuarioId && x.ativo; })[0] || null;
    },

    pode: function (acao) {
      var u = Auth.atual();
      return !!u && perfilPode(u.perfil, acao);
    },

    perfilPode: perfilPode,

    // ---------- Usuários (só o admin) ----------
    validarNovaSenha: function (senha) {
      senha = String(senha || '');
      return senha.length >= 6 && senha.length <= 40 ? null : 'A senha deve ter de 6 a 40 caracteres.';
    },

    criarUsuario: function (d) {
      if (!Auth.pode('admin.usuarios')) return { ok: false, erro: 'Só o administrador cadastra usuários.' };
      var nome = String(d.nome || '').trim().replace(/\s+/g, ' ');
      if (nome.length < 2 || nome.length > 30) return { ok: false, erro: 'Informe um nome de 2 a 30 letras.' };
      var login = normalizarLogin(d.login);
      var errLogin = validarLogin(login); if (errLogin) return { ok: false, erro: errLogin };
      if (Dados.usuarios.some(function (u) { return u.login === login; })) return { ok: false, erro: 'Já existe um usuário com esse login.' };
      if (PERFIS_OPERACIONAIS.indexOf(d.perfil) === -1) return { ok: false, erro: 'Escolha o perfil do usuário.' };
      var errSenha = Auth.validarNovaSenha(d.senha); if (errSenha) return { ok: false, erro: errSenha };
      var salt = novoSalt();
      var usuario = { id: Dados.novoId('u'), nome: nome, login: login, perfil: d.perfil, salt: salt, hash: hashSenha(d.senha, salt), ativo: true, criadoEm: Date.now(), ultimoLogin: null };
      Dados.mudar('usuarios', function (l) { l.push(usuario); });
      Auth.registrar('usuario_criado', nome + ' (' + login + ' · ' + PERFIS[d.perfil].rotulo + ')');
      return { ok: true, usuario: usuario };
    },

    atualizarUsuario: function (id, d) {
      if (!Auth.pode('admin.usuarios')) return { ok: false, erro: 'Só o administrador altera usuários.' };
      var alvo = Dados.usuarios.filter(function (u) { return u.id === id; })[0];
      if (!alvo) return { ok: false, erro: 'Usuário não encontrado.' };
      var ehAdmin = alvo.perfil === 'admin';
      // o admin só troca a própria senha: nome, login, perfil e situação ficam fixos
      var nome = !ehAdmin && d.nome !== undefined ? String(d.nome).trim().replace(/\s+/g, ' ') : alvo.nome;
      var login = !ehAdmin && d.login !== undefined ? normalizarLogin(d.login) : alvo.login;
      var perfil = !ehAdmin && d.perfil !== undefined ? d.perfil : alvo.perfil;
      var ativo = !ehAdmin && d.ativo !== undefined ? !!d.ativo : alvo.ativo;
      if (nome.length < 2 || nome.length > 30) return { ok: false, erro: 'Informe um nome de 2 a 30 letras.' };
      if (!ehAdmin) {
        var errLogin = validarLogin(login); if (errLogin) return { ok: false, erro: errLogin };
        if (Dados.usuarios.some(function (u) { return u.id !== id && u.login === login; })) return { ok: false, erro: 'Já existe um usuário com esse login.' };
        if (PERFIS_OPERACIONAIS.indexOf(perfil) === -1) return { ok: false, erro: 'Perfil inválido.' };
      }
      if (d.senha) { var e = Auth.validarNovaSenha(d.senha); if (e) return { ok: false, erro: e }; }
      var eraGerente = alvo.ativo && alvo.perfil === 'gerente';
      var seraGerente = ativo && perfil === 'gerente';
      if (eraGerente && !seraGerente) {
        var outros = Dados.usuarios.filter(function (u) { return u.id !== id && u.ativo && u.perfil === 'gerente'; }).length;
        if (!outros) return { ok: false, erro: 'Precisa existir pelo menos um gerente ativo. Cadastre outro antes.' };
      }
      Dados.mudar('usuarios', function (l) {
        var u = l.filter(function (x) { return x.id === id; })[0];
        u.nome = nome; u.login = login; u.perfil = perfil; u.ativo = ativo;
        if (d.senha) { u.salt = novoSalt(); u.hash = hashSenha(d.senha, u.salt); }
      });
      Auth.registrar('usuario_alterado', nome + ' (' + login + ')' + (d.senha ? ' (senha redefinida)' : '') + (ativo ? '' : ' (desativado)'));
      return { ok: true };
    },

    /** Exclui um usuário de vez. O histórico (tickets, caixas, auditoria) guarda o nome e continua intacto. */
    excluirUsuario: function (id) {
      if (!Auth.pode('admin.usuarios')) return { ok: false, erro: 'Só o administrador exclui usuários.' };
      var alvo = Dados.usuarios.filter(function (u) { return u.id === id; })[0];
      if (!alvo) return { ok: false, erro: 'Usuário não encontrado.' };
      if (alvo.perfil === 'admin') return { ok: false, erro: 'O administrador não pode ser excluído.' };
      var eu = Auth.atual();
      if (eu && eu.id === id) return { ok: false, erro: 'Você não pode excluir o próprio usuário.' };
      if (alvo.ativo && alvo.perfil === 'gerente') {
        var outros = Dados.usuarios.filter(function (u) { return u.id !== id && u.ativo && u.perfil === 'gerente'; }).length;
        if (!outros) return { ok: false, erro: 'Precisa existir pelo menos um gerente ativo. Cadastre outro antes.' };
      }
      if (Dados.caixas.some(function (c) { return c.operadorId === id && !c.fechadoEm; })) {
        return { ok: false, erro: 'Este usuário tem um caixa aberto. Feche o caixa antes de excluir.' };
      }
      try { Dados.mudar('usuarios', function (l) { var i = l.findIndex(function (x) { return x.id === id; }); if (i >= 0) l.splice(i, 1); }); }
      catch (e) { return { ok: false, erro: e.message }; }
      Auth.registrar('usuario_excluido', alvo.nome + ' (' + alvo.login + ' · ' + PERFIS[alvo.perfil].rotulo + ')');
      return { ok: true };
    },

    /** O admin liga/desliga permissões de manobrista e atendente. mapa: { 'acao': ['caixa', ...] } */
    salvarPermissoes: function (mapa) {
      if (!Auth.pode('admin.permissoes')) return { ok: false, erro: 'Só o administrador altera permissões.' };
      var novo = {};
      GRUPOS_PERMISSAO.forEach(function (g) {
        if (g.fixo) return;
        g.acoes.forEach(function (a) {
          novo[a] = (mapa[a] || []).filter(function (p) { return PERFIS_AJUSTAVEIS.indexOf(p) !== -1; });
        });
      });
      try { Dados.mudar('config', function (c) { c.permissoes = novo; }); } catch (e) { return { ok: false, erro: e.message }; }
      Auth.registrar('permissoes_alteradas', 'Permissões de manobrista e atendente atualizadas');
      return { ok: true };
    },

    // ---------- Login / sessão ----------
    /**
     * Confere no servidor a senha de um usuário (por id) — usado na autorização de gerente.
     * O servidor limita as tentativas (5 erros = bloqueio) e registra o erro na auditoria.
     */
    validarSenha: function (id, senha) {
      var r = Dados.requisitar('POST', '/api/senha/verificar', { id: id, senha: String(senha) });
      if (r.status === 401) { Auth.sair(true); return { ok: false, erro: 'Sessão expirada. Entre novamente.' }; }
      if (r.status === 0) return { ok: false, erro: 'Sem conexão com o servidor.' };
      if (!r.corpo || !r.corpo.ok) return { ok: false, bloqueado: !!(r.corpo && r.corpo.bloqueado), erro: (r.corpo && r.corpo.erro) || 'Não foi possível verificar a senha.' };
      var u = Dados.usuarios.filter(function (x) { return x.id === id; })[0];
      return u ? { ok: true, usuario: u } : { ok: false, erro: 'Usuário não encontrado.' };
    },

    /** Entrada pela tela de login: usuário (login) + senha, conferidos pelo servidor. */
    entrar: function (login, senha) {
      var r = Dados.requisitar('POST', '/api/login', { login: normalizarLogin(login), senha: String(senha) });
      if (r.status === 0) return { ok: false, erro: 'Não foi possível falar com o servidor. Confira a conexão.' };
      if (!r.corpo || !r.corpo.ok) return { ok: false, bloqueado: !!(r.corpo && r.corpo.bloqueado), erro: (r.corpo && r.corpo.erro) || 'Não foi possível entrar (erro ' + r.status + ').' };
      Dados.iniciar(); // agora com sessão: carrega os dados
      var u = Auth.atual();
      if (!u) return { ok: false, erro: 'O navegador não guardou o login. Libere o armazenamento deste site (não use aba anônima restrita) e tente de novo.' };
      return { ok: true, usuario: u };
    },

    sair: function (porInatividade, semAcesso) {
      var u = Auth.atual();
      if (u) Auth.registrar(porInatividade ? 'logout_inatividade' : 'logout', u.nome);
      Dados.requisitar('POST', '/api/logout', {});
      Dados.parar();
      _aut = null;
      global.location.href = 'index.html' + (porInatividade ? '?inativo=1' : (semAcesso ? '?semacesso=1' : ''));
    },

    /** Primeira tela que o usuário pode abrir (o admin: admin.html). null = não pode abrir nenhuma. */
    homeDe: function (u) {
      if (u.perfil === 'admin') return PERFIS.admin.home;
      var ordem = [PERFIS[u.perfil].home, 'caixa.html', 'manobrista.html', 'gerencia.html'];
      for (var i = 0; i < ordem.length; i++) {
        if (perfilPode(u.perfil, 'pagina.' + ordem[i].replace('.html', ''))) return ordem[i];
      }
      return null;
    },

    /** Proteção de página: manda para o login se não estiver logado ou sem permissão. */
    exigirPagina: function (pagina) {
      var u = Auth.atual();
      if (!u) {
        global.location.replace('index.html');
        return null;
      }
      if (!Auth.pode('pagina.' + pagina)) {
        var home = Auth.homeDe(u);
        if (home && home !== pagina + '.html') global.location.replace(home);
        else Auth.sair(false, true); // sem nenhuma tela liberada: volta ao login com aviso
        return null;
      }
      global.document.body.classList.remove('oculto');
      Auth.iniciarInatividade();
      return u;
    },

    iniciarInatividade: function () {
      var min = Number(Dados.config.inatividadeMin) || 0;
      if (!min) return;
      var ultimo = Date.now();
      function marca() { ultimo = Date.now(); }
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { global.document.addEventListener(ev, marca, { passive: true }); });
      global.setInterval(function () { if (Date.now() - ultimo > min * 60000) Auth.sair(true); }, 15000);
    },

    // ---------- Autorização de gerente ----------
    precisaAutorizacao: function (acao) {
      var u = Auth.atual();
      if (!u) return true;
      if (u.perfil === 'gerente') return false;
      var chave = EXIGE_AUTORIZACAO[acao];
      if (!chave) return false;
      return Dados.config.autorizacao[chave] !== false;
    },

    /** Pede a senha de um gerente (se necessário). Promise<boolean>. */
    autorizar: function (acoes, texto) {
      acoes = [].concat(acoes);
      var pendentes = acoes.filter(Auth.precisaAutorizacao);
      if (!pendentes.length) return Promise.resolve(true);
      return Ui.pedirSenhaGerente(texto).then(function (g) {
        if (!g) return false;
        _aut = { acoes: pendentes, gerente: { id: g.id, nome: g.nome }, ate: Date.now() + 60000 };
        return true;
      });
    },

    /** Usada pelas operações: gasta a autorização (uso único). */
    consumirAutorizacao: function (acao) {
      if (!Auth.precisaAutorizacao(acao)) return { ok: true, por: null };
      if (_aut && _aut.ate > Date.now() && _aut.acoes.indexOf(acao) !== -1) {
        var por = _aut.gerente;
        _aut.acoes = _aut.acoes.filter(function (a) { return a !== acao; });
        if (!_aut.acoes.length) _aut = null;
        return { ok: true, por: por };
      }
      return { ok: false };
    },
    temAutorizacao: function (acao) {
      return !Auth.precisaAutorizacao(acao) || !!(_aut && _aut.ate > Date.now() && _aut.acoes.indexOf(acao) !== -1);
    },
    limparAutorizacao: function () { _aut = null; },

    // ---------- Auditoria ----------
    registrar: function (acao, detalhe, extra) {
      extra = extra || {};
      var u = extra.usuario || (extra.sistema ? null : Auth.atual());
      var reg = { em: Date.now(), usuarioId: u ? u.id : null, usuario: u ? u.nome : 'sistema', perfil: u ? u.perfil : '', acao: acao, detalhe: detalhe || '' };
      if (extra.ticket) reg.ticket = extra.ticket;
      if (extra.autorizadoPor) reg.autorizadoPor = extra.autorizadoPor;
      try {
        Dados.mudar('log', function (l) {
          l.push(reg);
          if (l.length > Dados.LIMITE_LOG) l.splice(0, l.length - Dados.LIMITE_LOG);
        });
      } catch (e) { if (global.console) console.error('Falha ao registrar auditoria', e); }
    }
  };

  global.Auth = Auth;
})(window);
