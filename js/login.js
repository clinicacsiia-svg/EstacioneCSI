/* ============================================================
   login.js — entrada do sistema: usuário + senha.
   Os usuários (inclusive gerentes) são cadastrados pelo
   administrador em admin.html.
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  var raiz = Ui.$('#login-raiz');
  var VERSAO = '1.0';

  function irParaHome(u) {
    var home = Auth.homeDe(u);
    if (home) window.location.replace(home);
    else Auth.sair(false, true);
  }

  /** Pontinho verde/vermelho + versão, mostrado sempre no rodapé da tela de login. */
  function rodapeStatus() {
    var conectado = !Dados.semServidor;
    return '<div class="login-status">' +
      '<span class="ponto' + (conectado ? ' on' : '') + '" aria-hidden="true"></span> ' +
      (conectado ? 'Conectado à planilha' : 'Sem conexão com a planilha') +
      ' · v' + VERSAO + '</div>';
  }

  if (Dados.semServidor) {
    raiz.innerHTML = (Api.configurado
      ? '<div class="card perigo"><b>Não foi possível falar com o servidor (Google).</b><br>' +
        'Confira se você está com internet. Se o problema continuar, o administrador do sistema deve conferir a implantação do Apps Script ' +
        'e o endereço em <code>js/config.js</code>.<br><br>' +
        '<button type="button" class="btn btn-primario" onclick="location.reload()">Tentar de novo</button></div>'
      : '<div class="card perigo"><b>Servidor ainda não configurado.</b><br>' +
        'Cole o endereço <code>/exec</code> do Google Apps Script em <code>js/config.js</code> e publique de novo ' +
        '(passo a passo em <code>apps-script/LEIA-ME.md</code>).</div>') + rodapeStatus();
    return;
  }

  var jaLogado = Auth.atual();
  if (jaLogado) { irParaHome(jaLogado); return; }

  var busca = window.location.search;
  var aviso = /inativo=1/.test(busca) ? '<div class="card alerta mb pequeno">Sessão encerrada por inatividade. Entre novamente.</div>'
    : (/semacesso=1/.test(busca) ? '<div class="card alerta mb pequeno">Seu perfil não tem nenhuma tela liberada. Fale com o administrador.</div>' : '');

  raiz.innerHTML =
    '<div class="login-marca"><div class="logo" aria-hidden="true">🅿️</div><h1>' + Ui.esc(Dados.config.estabelecimento) + '</h1>' +
    '<div class="mudo">Entre com seu usuário e senha</div></div>' + aviso +
    '<form id="f-login" novalidate>' +
    '<div class="campo mb"><label class="rotulo" for="l-usuario">Usuário</label>' +
    '<input id="l-usuario" type="text" maxlength="30" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" data-foco></div>' +
    '<div class="campo mb"><label class="rotulo" for="l-senha">Senha</label>' +
    '<div class="campo-senha"><input id="l-senha" type="password" maxlength="40" autocomplete="current-password">' +
    '<button type="button" class="btn btn-contorno" id="l-ver" aria-label="Mostrar senha" aria-pressed="false">👁</button></div></div>' +
    '<div class="dica erro" id="l-erro" role="alert"></div>' +
    '<button type="submit" class="btn btn-primario btn-grande btn-bloco mt" id="l-entrar">Entrar</button></form>' +
    '<div class="centro mt2 pequeno"><a href="painel.html" target="_blank" rel="noopener">Abrir painel do cliente (TV) ↗</a></div>' +
    rodapeStatus();

  var campoUsuario = Ui.$('#l-usuario'), campoSenha = Ui.$('#l-senha'), erro = Ui.$('#l-erro');
  campoUsuario.focus();

  Ui.$('#l-ver').onclick = function () {
    var mostrar = campoSenha.type === 'password';
    campoSenha.type = mostrar ? 'text' : 'password';
    this.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
    this.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  };

  Ui.$('#f-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    erro.textContent = '';
    if (!campoUsuario.value.trim() || !campoSenha.value) { erro.textContent = 'Informe o usuário e a senha.'; return; }
    var r;
    try { r = Auth.entrar(campoUsuario.value, campoSenha.value); } catch (e) { r = { ok: false, erro: e.message }; }
    if (r.ok) { irParaHome(r.usuario); return; }
    erro.textContent = r.erro;
    campoSenha.value = '';
    campoSenha.focus();
  });
})();
