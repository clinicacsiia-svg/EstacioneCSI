/* ============================================================
   admin.js — painel do administrador
   Usuários (cadastro de gerentes, atendentes e manobristas)
   e Permissões (o que manobrista e atendente podem fazer).
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  const usuario = Auth.exigirPagina('admin');
  if (!usuario) return;

  const $ = Ui.$, esc = Ui.esc;
  Ui.montarTopo({ pagina: 'Administração', ativo: 'admin', impressora: false });

  const secao = $('#secao');
  const estado = { sec: 'usuarios' };

  // ============================================================
  //  USUÁRIOS
  // ============================================================
  function renderUsuarios() {
    secao.innerHTML = `<div class="gap"><h2 class="titulo-pagina espaco">Usuários</h2><button type="button" class="btn btn-primario" id="u-novo">+ Novo usuário</button></div>
      <div class="card"><p class="mudo" style="margin-top:0">Cadastre aqui quem vai usar o sistema, inclusive os <b>gerentes</b>. Cada pessoa entra com o <b>usuário</b> e a <b>senha</b> definidos aqui. Se alguém esquecer a senha, edite o usuário e informe uma nova.</p>
        <div id="u-lista"></div></div>`;
    $('#u-novo').onclick = () => editarUsuario(null);
    $('#u-lista').onclick = ev => {
      const x = ev.target.closest('[data-excluir]'); if (x) { excluirUsuario(x.dataset.excluir); return; }
      const b = ev.target.closest('[data-u]'); if (b) editarUsuario(b.dataset.u);
    };
    atualizarUsuarios();
  }

  function atualizarUsuarios() {
    const alvo = $('#u-lista'); if (!alvo) return;
    const l = Dados.usuarios.slice().sort((a, b) => (a.perfil === 'admin' ? -1 : 0) - (b.perfil === 'admin' ? -1 : 0) || (b.ativo - a.ativo) || a.nome.localeCompare(b.nome));
    alvo.innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead><tbody>` +
      l.map(u => `<tr><td class="negrito">${esc(u.nome)}${u.id === usuario.id ? ' <span class="badge azul">você</span>' : ''}</td><td class="mono">${esc(u.login)}</td>
        <td>${Auth.PERFIS[u.perfil].emoji} ${esc(Auth.PERFIS[u.perfil].rotulo)}</td>
        <td>${u.ativo ? '<span class="badge verde">Ativo</span>' : '<span class="badge">Inativo</span>'}</td><td>${u.ultimoLogin ? Ui.dataHora(u.ultimoLogin) : '—'}</td>
        <td class="gap"><button type="button" class="btn btn-sm btn-contorno" data-u="${esc(u.id)}">Editar</button>${u.perfil === 'admin' || u.id === usuario.id ? '' : `<button type="button" class="btn btn-sm btn-contorno" data-excluir="${esc(u.id)}" aria-label="Excluir ${esc(u.nome)}">🗑 Excluir</button>`}</td></tr>`).join('') + '</tbody></table></div>';
  }

  async function excluirUsuario(id) {
    const u = Dados.usuarios.find(x => x.id === id); if (!u) return;
    if (!await Ui.confirmar({ titulo: 'Excluir usuário?', mensagem: `${u.nome} (${u.login}) será removido e não poderá mais entrar no sistema. O histórico de operações dele continua guardado. Para apenas bloquear o acesso, use Editar e desmarque "Usuário ativo".`, ok: 'Excluir', perigo: true })) return;
    const r = Auth.excluirUsuario(id);
    if (!r.ok) { Ui.toast(r.erro, 'erro'); return; }
    Ui.toast('Usuário excluído.'); atualizarUsuarios();
  }

  function editarUsuario(id) {
    const u0 = id ? Dados.usuarios.find(x => x.id === id) : null;
    const ehAdmin = !!u0 && u0.perfil === 'admin';
    const campoEmail = `<div class="campo mb"><label class="rotulo" for="us-email">E-mail de recuperação (opcional)</label><input id="us-email" type="email" maxlength="80" value="${esc(u0 ? (u0.email || '') : '')}" autocomplete="email"><div class="dica">Usado só pelo botão "Esqueci minha senha" da tela de entrada.</div></div>`;
    const dadosPessoa = ehAdmin
      ? `<p class="mudo" style="margin-top:0">Usuário de entrada: <b>${esc(u0.login)}</b>. Do administrador só a senha e o e-mail de recuperação podem ser alterados.</p>` + campoEmail
      : `<div class="campo mb"><label class="rotulo" for="us-nome">Nome (aparece nas telas e na auditoria)</label><input id="us-nome" type="text" maxlength="30" value="${esc(u0 ? u0.nome : '')}" data-foco autocomplete="off"></div>
        <div class="campo mb"><label class="rotulo" for="us-login">Usuário (para entrar no sistema)</label><input id="us-login" type="text" maxlength="20" value="${esc(u0 ? u0.login : '')}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        <div class="campo mb"><label class="rotulo" for="us-perfil">Perfil</label><select id="us-perfil">${u0 ? '' : '<option value="">Escolha…</option>'}${Auth.PERFIS_OPERACIONAIS.map(p => `<option value="${p}" ${u0 && u0.perfil === p ? 'selected' : ''}>${esc(Auth.PERFIS[p].rotulo)}</option>`).join('')}</select></div>` + campoEmail;
    Ui.modal({
      titulo: ehAdmin ? 'Senha do administrador' : (u0 ? 'Editar usuário' : 'Novo usuário'), largura: 'sm',
      html: dadosPessoa +
        `<div class="campo mb"><label class="rotulo" for="us-senha">${u0 ? 'Nova senha (deixe vazio para manter)' : 'Senha (6 a 40 caracteres)'}</label>
          <div class="campo-senha"><input id="us-senha" type="password" maxlength="40" autocomplete="new-password" ${ehAdmin ? 'data-foco' : ''}>
          <button type="button" class="btn btn-contorno" id="us-ver" aria-label="Mostrar senha" aria-pressed="false">👁</button></div></div>
        ${u0 && !ehAdmin ? `<label class="check"><input type="checkbox" id="us-ativo" ${u0.ativo ? 'checked' : ''}> Usuário ativo (desmarque para bloquear o acesso)</label>` : ''}
        <div class="dica erro" id="us-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: m => m.fechar() },
        {
          rotulo: 'Salvar', classe: 'btn-primario', padrao: true, aoClicar: m => {
            const c = m.corpo, val = s => { const e = $(s, c); return e ? e.value : undefined; };
            const senha = val('#us-senha');
            let r;
            if (u0) {
              r = Auth.atualizarUsuario(id, {
                nome: val('#us-nome'), login: val('#us-login'), perfil: val('#us-perfil'), email: val('#us-email'),
                senha: senha || undefined, ativo: ehAdmin ? undefined : $('#us-ativo', c).checked
              });
            } else {
              r = Auth.criarUsuario({ nome: val('#us-nome'), login: val('#us-login'), perfil: val('#us-perfil'), email: val('#us-email'), senha: senha });
            }
            if (!r.ok) { $('#us-erro', c).textContent = r.erro; return; }
            m.fechar(); Ui.toast('Usuário salvo.'); atualizarUsuarios();
          }
        }
      ]
    }).corpo.addEventListener('click', ev => {
      if (!ev.target.closest('#us-ver')) return;
      const campo = ev.currentTarget.querySelector('#us-senha'), b = ev.target.closest('#us-ver');
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      b.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
      b.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    });
  }

  // ============================================================
  //  PERMISSÕES
  // ============================================================
  function renderPermissoes() {
    const cfg = Dados.config;
    const cel = (perfil, g) => {
      if (g.fixo) return '<span class="mudo">—</span>';
      const marcado = g.acoes.every(a => Auth.perfilPode(perfil, a));
      const pin = g.acoes.some(a => Auth.EXIGE_AUTORIZACAO[a] && cfg.autorizacao[Auth.EXIGE_AUTORIZACAO[a]] !== false);
      return `<label class="check" style="justify-content:center"><input type="checkbox" data-perfil="${perfil}" data-grupo="${Auth.GRUPOS_PERMISSAO.indexOf(g)}" ${marcado ? 'checked' : ''} aria-label="${esc(Auth.PERFIS[perfil].rotulo)}: ${esc(g.rotulo)}">${pin && perfil === 'caixa' ? '<span class="pequeno mudo">com senha do gerente</span>' : ''}</label>`;
    };
    secao.innerHTML = `<h2 class="titulo-pagina">Permissões</h2>
      <div class="card"><p class="mudo" style="margin-top:0">Marque o que cada perfil pode fazer. O <b>gerente</b> sempre pode tudo. Ações em que o atendente pede a senha do gerente (desconto, cancelamento etc.) continuam pedindo — isso o gerente ajusta em Configurações.</p>
        <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Ação</th><th class="centro">${Auth.PERFIS.manobrista.rotulo}</th><th class="centro">${Auth.PERFIS.caixa.rotulo}</th><th class="centro">${Auth.PERFIS.gerente.rotulo}</th></tr></thead><tbody>` +
      Auth.GRUPOS_PERMISSAO.map(g => `<tr><td>${esc(g.rotulo)}</td><td class="centro">${cel('manobrista', g)}</td><td class="centro">${cel('caixa', g)}</td><td class="centro"><span class="verde negrito">✔</span></td></tr>`).join('') +
      `</tbody></table></div>
        <p class="dica">Quem receber permissão de outra área (ex.: o atendente poder entregar veículos) ganha um atalho para essa tela no topo.</p>
        <div class="dica erro" id="p-erro" role="alert"></div>
        <div class="gap mt"><button type="button" class="btn btn-sucesso btn-grande" id="p-salvar">💾 Salvar permissões</button>
          <button type="button" class="btn btn-contorno" id="p-padrao">Voltar ao padrão do sistema</button></div></div>`;

    const lerMarcas = () => {
      const mapa = {};
      Auth.GRUPOS_PERMISSAO.forEach(g => g.acoes.forEach(a => { mapa[a] = []; }));
      Ui.$$('input[data-perfil]', secao).forEach(i => {
        if (!i.checked) return;
        Auth.GRUPOS_PERMISSAO[Number(i.dataset.grupo)].acoes.forEach(a => mapa[a].push(i.dataset.perfil));
      });
      return mapa;
    };
    const gravar = (mapa, msg) => {
      const r = Auth.salvarPermissoes(mapa);
      if (!r.ok) { $('#p-erro').textContent = r.erro; return; }
      Ui.toast(msg);
      renderPermissoes();
    };
    $('#p-salvar').onclick = () => gravar(lerMarcas(), 'Permissões salvas.');
    $('#p-padrao').onclick = async () => {
      if (!await Ui.confirmar({ titulo: 'Voltar ao padrão?', mensagem: 'As permissões de manobrista e atendente voltam ao que o sistema traz de fábrica.', ok: 'Voltar ao padrão' })) return;
      const mapa = {};
      Auth.GRUPOS_PERMISSAO.forEach(g => g.acoes.forEach(a => { mapa[a] = (Auth.PERMISSOES[a] || []).filter(p => Auth.PERFIS_AJUSTAVEIS.indexOf(p) !== -1); }));
      gravar(mapa, 'Permissões restauradas.');
    };
  }

  // ============================================================
  //  NAVEGAÇÃO
  // ============================================================
  const secoes = {
    usuarios: { render: renderUsuarios, atualizar: atualizarUsuarios },
    permissoes: { render: renderPermissoes }
  };

  function ir(nome) {
    if (!secoes[nome]) nome = 'usuarios';
    estado.sec = nome;
    Ui.$$('#menu button').forEach(b => b.classList.toggle('ativo', b.dataset.sec === nome));
    secoes[nome].render();
    $('.conteudo').scrollTop = 0;
  }
  $('#menu').addEventListener('click', ev => { const b = ev.target.closest('[data-sec]'); if (b) ir(b.dataset.sec); });

  Dados.aoMudar(nome => {
    if (!Auth.atual()) { window.location.replace('index.html'); return; }
    const s = secoes[estado.sec];
    if (nome === 'usuarios' && s && s.atualizar) Ui.agendar(s.atualizar);
  });

  ir('usuarios');
})();
