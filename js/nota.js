/* ============================================================
   nota.js — emissão de nota fiscal de serviço (NFS-e)
   ------------------------------------------------------------
   A tela só pede os dados do cliente (CPF/CNPJ e nome) e chama o
   servidor (Google Apps Script). Hoje só emite nota de TESTE; a emissão
   real na prefeitura exigiria certificado digital num servidor próprio.
   A nota emitida fica gravada no pagamento (pagamento.nota).
   O CPF/CNPJ completo NÃO é guardado no navegador, só mascarado.
   ============================================================ */
(function (global) {
  'use strict';

  var R = global.Regras, esc = Ui.esc, $ = Ui.$;

  // ---------- Documentos ----------
  function digitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

  function cpfValido(c) {
    c = digitos(c);
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (var t = 9; t < 11; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(c.charAt(i)) * (t + 1 - i);
      if ((soma * 10) % 11 % 10 !== Number(c.charAt(t))) return false;
    }
    return true;
  }

  function cnpjValido(c) {
    c = digitos(c);
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    var pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    for (var t = 12; t < 14; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(c.charAt(i)) * pesos[pesos.length - t + i];
      var resto = soma % 11;
      if ((resto < 2 ? 0 : 11 - resto) !== Number(c.charAt(t))) return false;
    }
    return true;
  }

  function formatarDoc(v) {
    var d = digitos(v).slice(0, 14);
    if (d.length <= 11) {
      return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
    }
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  }

  /** Guarda só o começo e o fim: 123.***.***-45 */
  function mascarar(v) {
    var d = digitos(v);
    return d.slice(0, 3) + '.***.***-' + d.slice(-2);
  }

  // ---------- Servidor de notas ----------
  var SEM_SERVIDOR = 'Não foi possível falar com o servidor de notas. Confira a conexão com a internet e tente de novo.';

  function chamar(caminho, corpo) {
    var ctl = new AbortController(), timer = global.setTimeout(function () { ctl.abort(); }, 45000);
    return global.Api.buscar(caminho, { metodo: corpo ? 'POST' : 'GET', corpo: corpo || undefined, signal: ctl.signal }).then(function (r) {
      return r.json().catch(function () { return { ok: false, erro: 'Resposta inválida do servidor de notas.' }; });
    }).catch(function (e) {
      return {
        ok: false, semServidor: true,
        erro: e && e.name === 'AbortError'
          ? 'O servidor de notas demorou demais. Tente de novo: o sistema não emite duas notas para o mesmo pagamento.'
          : SEM_SERVIDOR
      };
    }).then(function (r) { global.clearTimeout(timer); return r; });
  }

  function status() {
    return chamar('/api/nfse/status').then(function (r) {
      return r && r.habilitado ? r : { habilitado: false, erro: (r && r.erro) || SEM_SERVIDOR };
    });
  }

  // ---------- Regras de tela ----------
  function podeEmitir(p) { return !!p && p.valor > 0 && !p.estornado && !p.nota && Auth.pode('nota.emitir'); }

  function achar(ticketId, pagId) {
    var t = Op.achar(ticketId);
    var p = t && (t.pagamentos || []).filter(function (x) { return x.id === pagId; })[0];
    return { t: t, p: p || null };
  }

  function linkSeguro(u) { return /^https?:\/\//i.test(String(u || '')) ? u : null; }

  function mostrarResultado(t, nota, salvou) {
    var pdf = linkSeguro(nota.linkPdf);
    Ui.modal({
      titulo: 'Nota fiscal emitida', largura: 'sm', semFechar: true,
      html: '<div class="centro"><div style="font-size:3rem" aria-hidden="true">📄</div>' +
        (nota.homologacao ? '<div class="card alerta mb pequeno"><b>NOTA DE TESTE</b> — sem valor fiscal.</div>' : '') +
        '<div class="negrito" style="font-size:1.3rem">NFS-e nº ' + esc(nota.numero) + '</div>' +
        '<div class="mudo">' + esc(t.placa) + ' · ticket #' + esc(t.id) + '</div>' +
        (nota.codigoVerificacao ? '<div class="pequeno mt">Código de verificação: <b class="mono">' + esc(nota.codigoVerificacao) + '</b></div>' : '') +
        (pdf ? '<p><a href="' + esc(pdf) + '" target="_blank" rel="noopener">Abrir / imprimir a nota ↗</a></p>' : '') +
        (salvou ? '' : '<div class="card perigo mt pequeno">A nota foi emitida, mas não consegui gravá-la neste ticket. Anote o número acima.</div>') +
        '</div>',
      botoes: [{ rotulo: 'Concluir', classe: 'btn-primario', padrao: true, aoClicar: function (m) { m.fechar(); } }]
    });
  }

  /** Abre a janela para pedir os dados do cliente e emitir a nota do pagamento. */
  function emitir(ticketId, pagId) {
    var a = achar(ticketId, pagId), t = a.t, p = a.p;
    if (!t || !p) { Ui.toast('Pagamento não encontrado.', 'erro'); return; }
    if (p.nota) { Ui.toast('Este pagamento já tem a nota nº ' + p.nota.numero + '.', 'info'); return; }
    if (!podeEmitir(p)) { Ui.toast('Não é possível emitir nota para este pagamento.', 'aviso'); return; }

    status().then(function (st) {
      if (!st.habilitado) { Ui.toast(st.erro, 'erro', 8000); return; }
      abrirJanela(t, p, st);
    });
  }

  function abrirJanela(t, p, st) {
    var ocupado = false;
    var m = Ui.modal({
      titulo: 'Nota fiscal · ticket #' + t.id, largura: 'sm',
      html: '<div class="centro mb"><div class="item-placa">' + esc(t.placa) + '</div>' +
        '<div class="negrito" style="font-size:1.4rem">' + esc(R.moeda(p.valor)) + '</div></div>' +
        (st.homologacao ? '<div class="card alerta mb pequeno"><b>Modo de teste:</b> a nota emitida não tem valor fiscal.</div>' : '') +
        '<div class="campo mb"><label class="rotulo" for="nf-doc">CPF ou CNPJ do cliente</label>' +
        '<input id="nf-doc" type="text" inputmode="numeric" maxlength="18" autocomplete="off" data-foco></div>' +
        '<div class="campo mb"><label class="rotulo" for="nf-nome">Nome completo ou razão social</label>' +
        '<input id="nf-nome" type="text" maxlength="115" autocomplete="off"></div>' +
        '<div class="campo mb"><label class="rotulo" for="nf-email">E-mail (opcional)</label>' +
        '<input id="nf-email" type="email" maxlength="80" autocomplete="off"></div>' +
        '<div class="dica" id="nf-doc-info"></div>' +
        '<div class="dica erro" id="nf-erro" role="alert"></div>',
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: function (mm) { mm.fechar(); } },
        { id: 'ok', rotulo: '📄 Emitir nota', classe: 'btn-sucesso', padrao: true, aoClicar: confirmar }
      ]
    });
    var c = m.corpo, campoDoc = $('#nf-doc', c);

    campoDoc.addEventListener('input', function () {
      campoDoc.value = formatarDoc(campoDoc.value);
      var d = digitos(campoDoc.value), info = $('#nf-doc-info', c);
      if (d.length === 11) info.textContent = cpfValido(d) ? '✔ CPF válido' : '⚠ CPF inválido';
      else if (d.length === 14) info.textContent = cnpjValido(d) ? '✔ CNPJ válido' : '⚠ CNPJ inválido';
      else info.textContent = '';
    });

    function confirmar(mm) {
      if (ocupado) return;
      var er = $('#nf-erro', c); er.textContent = '';
      var doc = digitos(campoDoc.value), nome = $('#nf-nome', c).value.trim().replace(/\s+/g, ' '), email = $('#nf-email', c).value.trim();
      if (doc.length === 11 ? !cpfValido(doc) : doc.length === 14 ? !cnpjValido(doc) : true) { er.textContent = 'Informe um CPF ou CNPJ válido.'; return; }
      if (nome.length < 3) { er.textContent = 'Informe o nome do cliente.'; return; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { er.textContent = 'E-mail inválido.'; return; }

      ocupado = true;
      var btn = mm.botao('ok'); btn.disabled = true; btn.textContent = 'Emitindo...';
      chamar('/api/nfse/emitir', {
        ticketId: t.id, pagamentoId: p.id, valor: p.valor,
        descricao: 'Estacionamento de veículo · placa ' + t.placa + ' · permanência ' + R.duracao(p.minutos) + ' · ticket ' + t.id,
        tomador: { doc: doc, nome: nome, email: email }
      }).then(function (r) {
        if (!r.ok) {
          ocupado = false; btn.disabled = false; btn.textContent = '📄 Emitir nota';
          er.textContent = r.erro || 'Não foi possível emitir a nota.';
          return;
        }
        var reg = Op.registrarNota(t.id, p.id, {
          numero: r.nota.numero, codigoVerificacao: r.nota.codigoVerificacao, chaveAcesso: r.nota.chaveAcesso,
          emitidaEm: r.nota.emitidaEm, linkPdf: linkSeguro(r.nota.linkPdf), homologacao: !!r.nota.homologacao,
          tomadorNome: nome, tomadorDoc: mascarar(doc)
        });
        var salvou = reg.ok || /Já existe/.test(reg.erro || '');
        mm.fechar();
        mostrarResultado(t, r.nota, salvou);
      });
    }
  }

  global.Nota = {
    emitir: emitir, podeEmitir: podeEmitir, status: status,
    cpfValido: cpfValido, cnpjValido: cnpjValido
  };
})(window);
