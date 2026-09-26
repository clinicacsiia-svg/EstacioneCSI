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

  /** Pontinho verde/vermelho (conexão com a planilha) + versão, sempre no rodapé da tela de login. */
  function rodapeStatus() {
    var conectado = !Dados.semServidor;
    return '<div class="login-status">' +
      '<span class="ponto' + (conectado ? ' on' : '') + '" title="' + (conectado ? 'Conectado à planilha' : 'Sem conexão com a planilha') + '"></span>' +
      ' v' + VERSAO + '</div>';
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
    '<div class="centro mt pequeno"><button type="button" class="btn btn-link" id="l-esqueci">Esqueci minha senha</button></div>' +
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

  // ---------- Esqueci minha senha (código de 6 dígitos por e-mail) ----------
  Ui.$('#l-esqueci').onclick = function () { abrirRecuperacao(campoUsuario.value.trim()); };

  function abrirRecuperacao(loginInicial) {
    var m = Ui.modal({
      titulo: 'Esqueci minha senha', largura: 'sm', html: '<div id="rec-corpo"></div>',
      botoes: [{ rotulo: 'Fechar', classe: 'btn-contorno', aoClicar: function (mm) { mm.fechar(); } }]
    });
    var corpo = Ui.$('#rec-corpo', m.corpo);

    function passoPedir() {
      corpo.innerHTML =
        '<p class="mudo" style="margin-top:0">Informe seu usuário. Se houver um e-mail de recuperação cadastrado para ele, enviaremos um código de 6 dígitos.</p>' +
        '<label class="rotulo" for="rec-usuario">Usuário</label>' +
        '<input id="rec-usuario" type="text" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" data-foco value="' + Ui.esc(loginInicial || '') + '">' +
        '<div class="dica erro" id="rec-erro1" role="alert"></div>' +
        '<button type="button" class="btn btn-primario btn-bloco mt" id="rec-enviar" data-padrao="1">Enviar código</button>';
      var campo = Ui.$('#rec-usuario', corpo), erroP = Ui.$('#rec-erro1', corpo), btn = Ui.$('#rec-enviar', corpo);
      btn.onclick = function () {
        var login = campo.value.trim();
        if (!login) { erroP.textContent = 'Informe o usuário.'; return; }
        btn.disabled = true;
        var r = Auth.pedirRecuperacaoSenha(login);
        btn.disabled = false;
        if (!r.ok) { erroP.textContent = r.erro; return; }
        passoCodigo(login);
      };
    }

    function passoCodigo(login) {
      corpo.innerHTML =
        '<p class="mudo" style="margin-top:0">Se o usuário <b>' + Ui.esc(login) + '</b> tiver e-mail de recuperação cadastrado, um código de 6 dígitos foi enviado para ele. Vale por 15 minutos.</p>' +
        '<label class="rotulo" for="rec-codigo">Código recebido</label>' +
        '<input id="rec-codigo" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" data-foco>' +
        '<label class="rotulo mt" for="rec-nova">Nova senha (6 a 40 caracteres)</label>' +
        '<div class="campo-senha"><input id="rec-nova" type="password" maxlength="40" autocomplete="new-password">' +
        '<button type="button" class="btn btn-contorno" id="rec-ver" aria-label="Mostrar senha">👁</button></div>' +
        '<div class="dica erro" id="rec-erro2" role="alert"></div>' +
        '<button type="button" class="btn btn-primario btn-bloco mt" id="rec-confirmar" data-padrao="1">Redefinir senha</button>' +
        '<button type="button" class="btn btn-link btn-bloco mt" id="rec-voltar">Não recebi / usar outro usuário</button>';
      var eCod = Ui.$('#rec-codigo', corpo), eNova = Ui.$('#rec-nova', corpo), erroP = Ui.$('#rec-erro2', corpo), btn = Ui.$('#rec-confirmar', corpo);
      Ui.$('#rec-ver', corpo).onclick = function () { eNova.type = eNova.type === 'password' ? 'text' : 'password'; };
      Ui.$('#rec-voltar', corpo).onclick = passoPedir;
      btn.onclick = function () {
        erroP.textContent = '';
        if (!/^\d{6}$/.test(eCod.value.trim())) { erroP.textContent = 'Informe o código de 6 dígitos.'; return; }
        btn.disabled = true;
        var r = Auth.redefinirSenhaComCodigo(login, eCod.value.trim(), eNova.value);
        btn.disabled = false;
        if (!r.ok) { erroP.textContent = r.erro; return; }
        m.fechar();
        Ui.toast('Senha redefinida! Já pode entrar com ela.', 'sucesso', 5000);
        campoUsuario.value = login; campoSenha.value = ''; campoSenha.focus();
      };
    }

    passoPedir();
  }
})();
