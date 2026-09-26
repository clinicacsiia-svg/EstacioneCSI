/* ============================================================
   Codigo.gs — servidor do Estacionamento CSI no Google Apps Script
   ------------------------------------------------------------
   É o servidor do sistema: guarda tudo na
   planilha do Google: login, sincronização entre aparelhos, auditoria,
   backup e nota fiscal de teste.

   COMO USAR: veja apps-script/LEIA-ME.md (passo a passo).
     1. Cole este arquivo inteiro em Extensões > Apps Script.
     2. Rode a função  instalar  (autorize quando pedir).
     3. Implantar > Nova implantação > App da Web
        (Executar como: EU · Quem pode acessar: QUALQUER PESSOA).
     4. Cole a URL /exec em js/config.js do projeto.

   O QUE FICA EM CADA ABA (a planilha é só um espelho legível; o que vale
   é a coluna "json". NÃO EDITE AS CÉLULAS À MÃO — use o sistema):
     tickets, caixas, mensalistas, usuarios, log, notas  → uma linha por registro
     config, meta                                        → uma linha com o json
     _controle, _deltas, _segredos (ocultas)             → versões, histórico de
                                                            mudanças e hashes de senha

   REGRAS DE OURO
   - Dinheiro é sempre inteiro em centavos no json (a coluna legível mostra em R$).
   - Depois de mudar QUALQUER coisa neste arquivo: Implantar > Gerenciar
     implantações > (lápis) > Versão: Nova versão > Implantar.
   - As regras de delta (aplicar_) espelham js/dados.js (aplicarDelta): mantenha as duas iguais.
   ============================================================ */

var PLANILHA_ID = '1w68Oc2dv2Cok9hJB88MrKnwFd3MfvVC3DfqndV4EhrI'; // vazio = a planilha onde este script está
var FUSO = 'America/Bahia';

var ARRAYS = ['usuarios', 'tickets', 'caixas', 'mensalistas', 'log'];
var OBJETOS = ['config', 'meta'];
var COLECOES = ARRAYS.concat(OBJETOS);
var LIMITE_LOG = 3000;
var HISTORICO_DELTAS = 300;
var LIMITE_CELULA = 45000;       // o Google aceita 50.000 caracteres por célula
var SESSAO_TTL = 21600;          // segundos (6 h): máximo do CacheService
var SESSAO_OCIOSA_MS = 12 * 3600 * 1000; // sem usar o sistema por 12 h = precisa entrar de novo
var TAM_PEDACO = 30000;          // pedaço de cache (limite do Google: 100 KB por chave)
var BACKUPS_GUARDADOS = 30;
var PASTA_BACKUP = 'EstacionaMais - backups';
var ALFABETO_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
var ESCRITA = { usuarios: ['admin'], config: ['admin', 'gerente'] }; // quem grava em cada coleção (as demais: qualquer logado)

// ---------- Layout das abas ----------
// Colunas 1 e 2 são sempre: id e json. O resto é só para você ler/filtrar/somar na planilha.
var DATA_HORA = 'dd/MM/yyyy HH:mm';
var DINHEIRO = '#,##0.00';
var LAYOUT = {
  tickets: {
    cab: ['Ticket', 'json', 'Placa', 'Categoria', 'Pátio', 'Vaga', 'Status', 'Entrada', 'Entrada por', 'Pago em', 'Valor pago (R$)', 'Forma de pagamento', 'Entregue em', 'Entregue por', 'Cancelado', 'Nota fiscal', 'Observação'],
    fmt: ['@', '@', '@', '@', '@', '@', '@', DATA_HORA, '@', DATA_HORA, DINHEIRO, '@', DATA_HORA, '@', '@', '@', '@'],
    extra: function (t) {
      var pags = (Array.isArray(t.pagamentos) ? t.pagamentos : []).filter(function (p) { return p && !p.estornado; });
      var total = 0, metodos = [], notas = [];
      pags.forEach(function (p) {
        total += typeof p.valor === 'number' ? p.valor : 0;
        if (p.metodo && metodos.indexOf(p.metodo) === -1) metodos.push(p.metodo);
        if (p.nota && p.nota.numero) notas.push(p.nota.numero);
      });
      return [tx_(t.placa), tx_(t.categoria), tx_(t.patio), tx_(t.vaga), tx_(t.status), dt_(t.entradaEm), tx_(t.entradaPorNome),
        dt_(t.pagoEm), pags.length ? total / 100 : '', tx_(metodos.join(', ')), dt_(t.entregueEm), tx_(t.entreguePorNome),
        t.cancelado ? 'Sim' : '', tx_(notas.join(', ')), tx_(t.obs)];
    }
  },
  caixas: {
    cab: ['id', 'json', 'Nº', 'Operador', 'Aberto em', 'Fundo (R$)', 'Fechado em', 'Contado (R$)', 'Esperado (R$)', 'Diferença (R$)'],
    fmt: ['@', '@', '', '@', DATA_HORA, DINHEIRO, DATA_HORA, DINHEIRO, DINHEIRO, DINHEIRO],
    extra: function (c) {
      return [typeof c.numero === 'number' ? c.numero : tx_(c.numero), tx_(c.operadorNome), dt_(c.abertoEm), din_(c.fundo),
        dt_(c.fechadoEm), din_(c.contado), din_(c.esperado), din_(c.diferenca)];
    }
  },
  mensalistas: {
    cab: ['id', 'json', 'Nome', 'Placas', 'Telefone', 'Validade', 'Valor (R$)', 'Ativo', 'Observação'],
    fmt: ['@', '@', '@', '@', '@', '@', DINHEIRO, '@', '@'],
    extra: function (m) {
      return [tx_(m.nome), tx_([].concat(m.placas || []).join(', ')), tx_(m.telefone), tx_(dataTxt_(m.validade)), din_(m.valor),
        m.ativo === false ? 'Não' : 'Sim', tx_(m.obs)];
    }
  },
  usuarios: {
    cab: ['id', 'json', 'Nome', 'Login', 'Perfil', 'Ativo', 'Último login'],
    fmt: ['@', '@', '@', '@', '@', '@', DATA_HORA],
    extra: function (u) { return [tx_(u.nome), tx_(u.login), tx_(u.perfil), u.ativo ? 'Sim' : 'Não', dt_(u.ultimoLogin)]; }
  },
  log: {
    cab: ['id', 'json', 'Quando', 'Usuário', 'Perfil', 'Ação', 'Detalhe'],
    fmt: ['@', '@', DATA_HORA, '@', '@', '@', '@'],
    extra: function (l) { return [dt_(l.em), tx_(l.usuario), tx_(l.perfil), tx_(l.acao), tx_(l.detalhe)]; }
  },
  notas: {
    cab: ['pagamentoId', 'json', 'Número', 'Ticket', 'Valor (R$)', 'Emitida em', 'Cliente', 'Documento', 'Teste?'],
    fmt: ['@', '@', '@', '@', DINHEIRO, DATA_HORA, '@', '@', '@'],
    extra: function (n) {
      var t = n.tomador || {};
      return [tx_(n.numero), tx_(n.ticketId), din_(n.valor), dt_(n.emitidaEm), tx_(t.nome), tx_(mascarar_(t.doc)), n.homologacao ? 'Sim' : 'Não'];
    }
  },
  config: { cab: ['json'], fmt: ['@'] },
  meta: { cab: ['json'], fmt: ['@'] },
  _controle: { cab: ['coleção', 'versão'], fmt: ['@', ''], oculta: true },
  _deltas: { cab: ['coleção', 'versão', 'delta'], fmt: ['@', '', '@'], oculta: true },
  _segredos: { cab: ['id', 'hash', 'salt'], fmt: ['@', '@', '@'], oculta: true }
};

// ---------- Utilidades ----------
function ErroHttp_(codigo, msg, extra) { this.codigo = codigo; this.message = msg; this.extra = extra || {}; }

function clone_(v) { return JSON.parse(JSON.stringify(v)); }
function ehObj_(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function ehInt_(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
function agora_() { return Date.now(); }

/** Texto seguro para a planilha: nada que comece com = + - @ vira fórmula. */
function tx_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? ' ' + s : s;
}
function dt_(ms) { return typeof ms === 'number' && ms > 0 ? new Date(ms) : ''; }
function din_(c) { return typeof c === 'number' ? c / 100 : ''; }
function dataTxt_(v) { return typeof v === 'number' ? Utilities.formatDate(new Date(v), FUSO, 'dd/MM/yyyy') : (v || ''); }
function mascarar_(doc) {
  var d = String(doc || '').replace(/\D/g, '');
  return d ? d.slice(0, 3) + '.***.***-' + d.slice(-2) : '';
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function sha256_(txt) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt, Utilities.Charset.UTF_8));
}
// Formato sha256("salt:senha"), o mesmo que o navegador sempre usou: backups antigos continuam valendo.
function hashSenha_(senha, salt) { return sha256_(salt + ':' + senha); }
function novoSalt_() { return sha256_(Utilities.getUuid() + Utilities.getUuid() + agora_()).slice(0, 24); }
function novoToken_() { return sha256_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + agora_()); }
function senhaAleatoria_() {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid(), Utilities.Charset.UTF_8), s = '';
  for (var i = 0; i < 12; i++) s += ALFABETO_SENHA.charAt((b[i] & 255) % ALFABETO_SENHA.length);
  return s;
}
function igual_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Confere a senha. Com usuário null gasta o mesmo tempo (não revela se o login existe). */
function verificarSenha_(u, senha) {
  var ok = igual_(hashSenha_(senha, (u && u.salt) || '-'), (u && u.hash) || new Array(65).join('0'));
  return !!u && ok;
}

// ---------- Planilha ----------
var _ss = null, _folhas = {};

function planilha_() {
  if (!_ss) _ss = PLANILHA_ID ? SpreadsheetApp.openById(PLANILHA_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return _ss;
}

function prepararFolha_(sh, nome) {
  var def = LAYOUT[nome];
  sh.getRange(1, 1, 1, def.cab.length).setValues([def.cab]).setFontWeight('bold');
  sh.setFrozenRows(1);
  def.fmt.forEach(function (f, i) { if (f) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat(f); });
  if (nome === '_controle') sh.getRange(2, 1, COLECOES.length, 2).setValues(COLECOES.map(function (c) { return [c, 0]; }));
  try { sh.protect().setWarningOnly(true).setDescription('Dados do sistema: edite pelo programa, não aqui.'); } catch (e) { /* sem permissão: segue */ }
  if (def.oculta) { try { sh.hideSheet(); } catch (e) { /* ignora */ } }
}

function folha_(nome) {
  if (_folhas[nome]) return _folhas[nome];
  var sh = planilha_().getSheetByName(nome);
  if (!sh) {
    comTrava_(function () {
      sh = planilha_().getSheetByName(nome);
      if (!sh) { sh = planilha_().insertSheet(nome); prepararFolha_(sh, nome); }
    });
  }
  _folhas[nome] = sh;
  return sh;
}

function limparCorpo_(sh) {
  var n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, sh.getMaxColumns()).clearContent();
}

function anexarLinhas_(sh, linhas) {
  if (!linhas.length) return;
  var ini = sh.getLastRow() + 1, fim = ini + linhas.length - 1;
  if (fim > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), fim - sh.getMaxRows());
  sh.getRange(ini, 1, linhas.length, linhas[0].length).setValues(linhas);
}

/** Lê a coluna "json" (coluna 2) de uma aba de registros. */
function lerJsonLista_(sh) {
  var n = sh.getLastRow() - 1, out = [];
  if (n < 1) return out;
  var v = sh.getRange(2, 2, n, 1).getValues();
  for (var i = 0; i < v.length; i++) {
    var s = v[i][0];
    if (typeof s === 'string' && s) {
      try { out.push(JSON.parse(s)); } catch (e) { console.error('Linha ' + (i + 2) + ' de ' + sh.getName() + ' ilegível.'); }
    }
  }
  return out;
}

// ---------- Trava (uma gravação por vez) ----------
var _travaAtiva = false;
function comTrava_(fn) {
  if (_travaAtiva) return fn();
  var l = LockService.getScriptLock();
  if (!l.tryLock(25000)) throw new ErroHttp_(503, 'O sistema está ocupado. Tente de novo em instantes.');
  _travaAtiva = true;
  try { return fn(); } finally { _travaAtiva = false; l.releaseLock(); }
}

// ---------- Cache (só acelera; a verdade está na planilha) ----------
function cGet_(k) { try { return CacheService.getScriptCache().get(k); } catch (e) { return null; } }
function cPut_(k, v, ttl) { try { CacheService.getScriptCache().put(k, v, ttl || SESSAO_TTL); } catch (e) { /* grande demais/indisponível */ } }
function cDel_(k) { try { CacheService.getScriptCache().remove(k); } catch (e) { /* ok */ } }

function grandePut_(chave, texto) {
  if (texto.length > 2000000) return;
  var mapa = {}, n = Math.max(1, Math.ceil(texto.length / TAM_PEDACO));
  for (var i = 0; i < n; i++) mapa[chave + ':' + i] = texto.slice(i * TAM_PEDACO, (i + 1) * TAM_PEDACO);
  mapa[chave + ':n'] = String(n);
  try { CacheService.getScriptCache().putAll(mapa, SESSAO_TTL); } catch (e) { /* ok */ }
}
function grandeGet_(chave) {
  var n = parseInt(cGet_(chave + ':n'), 10);
  if (!n) return null;
  var chaves = [];
  for (var i = 0; i < n; i++) chaves.push(chave + ':' + i);
  var mapa;
  try { mapa = CacheService.getScriptCache().getAll(chaves); } catch (e) { return null; }
  var txt = '';
  for (var j = 0; j < n; j++) {
    if (typeof mapa[chaves[j]] !== 'string') return null;
    txt += mapa[chaves[j]];
  }
  return txt;
}

// ---------- Versões e histórico ----------
function lerVersoesPlanilha_(atualizarCache) {
  var v = folha_('_controle').getRange(2, 1, COLECOES.length, 2).getValues(), mapa = {};
  for (var i = 0; i < v.length; i++) mapa[String(v[i][0])] = Number(v[i][1]) || 0;
  COLECOES.forEach(function (c) { if (mapa[c] === undefined) mapa[c] = 0; });
  if (atualizarCache) cPut_('v', JSON.stringify(mapa));
  return mapa;
}

function versoes_() {
  var c = cGet_('v');
  if (c) { try { return JSON.parse(c); } catch (e) { /* refaz */ } }
  return lerVersoesPlanilha_(true);
}

function guardarHistoricoCache_(col, hist) {
  var h = hist.slice(), js = JSON.stringify(h);
  while (js.length > TAM_PEDACO && h.length > 1) { h.shift(); js = JSON.stringify(h); }
  if (js.length <= TAM_PEDACO) cPut_('h:' + col, js); else cDel_('h:' + col);
}

/** Últimas mudanças de uma coleção: [[versão, delta], ...] em ordem. */
function historico_(col) {
  var c = cGet_('h:' + col);
  if (c) { try { return JSON.parse(c); } catch (e) { /* refaz */ } }
  var sh = folha_('_deltas'), n = sh.getLastRow() - 1, out = [];
  if (n > 0) {
    sh.getRange(2, 1, n, 3).getValues().forEach(function (r) {
      if (r[0] !== col) return;
      try { out.push([Number(r[1]), JSON.parse(r[2])]); } catch (e) { /* buraco: obriga a baixar tudo */ }
    });
  }
  out.sort(function (a, b) { return a[0] - b[0]; });
  return out.slice(-HISTORICO_DELTAS);
}

function podarDeltas_() {
  var sh = folha_('_deltas'), n = sh.getLastRow() - 1;
  if (n <= HISTORICO_DELTAS * COLECOES.length) return;
  var linhas = sh.getRange(2, 1, n, 3).getValues(), cont = {}, manter = [];
  for (var i = linhas.length - 1; i >= 0; i--) {
    var c = linhas[i][0];
    cont[c] = (cont[c] || 0) + 1;
    if (cont[c] <= HISTORICO_DELTAS) manter.unshift(linhas[i]);
  }
  limparCorpo_(sh);
  anexarLinhas_(sh, manter);
}

// ---------- Deltas (espelham js/dados.js) ----------
function chave_(x) {
  if (ehObj_(x) && (typeof x.id === 'string' || typeof x.id === 'number')) return String(x.id);
  return null;
}

function aplicar_(dados, d) {
  if (d.t === 't') return d.dados;
  var lista = dados.slice();
  if (d.t === 'm') {
    var pos = {};
    lista.forEach(function (x, i) { var k = chave_(x); if (k !== null) pos[k] = i; });
    d.up.forEach(function (x) {
      var k = chave_(x);
      if (Object.prototype.hasOwnProperty.call(pos, k)) lista[pos[k]] = x;
      else { pos[k] = lista.length; lista.push(x); }
    });
    var rm = {};
    d.rm.forEach(function (i) { rm[String(i)] = true; });
    if (Object.keys(rm).length) lista = lista.filter(function (x) { var k = chave_(x); return k === null || !rm[k]; });
    return lista;
  }
  if (d.t === 'a') return lista.slice(d.n).concat(d.add);
  throw new ErroHttp_(400, 'Tipo de alteração desconhecido.');
}

function listaDeObjetos_(v) { return Array.isArray(v) && v.every(ehObj_); }

function validarDelta_(col, d) {
  if (!ehObj_(d)) throw new ErroHttp_(400, 'Alteração inválida.');
  var ehLista = ARRAYS.indexOf(col) !== -1;
  if (d.t === 't') {
    if (!(ehLista ? listaDeObjetos_(d.dados) : ehObj_(d.dados))) throw new ErroHttp_(400, "Dados inválidos para '" + col + "'.");
  } else if (d.t === 'm') {
    if (!ehLista || !listaDeObjetos_(d.up) || !Array.isArray(d.rm)) throw new ErroHttp_(400, 'Alteração inválida.');
    if (d.up.some(function (x) { return chave_(x) === null; }) || d.rm.some(function (i) { return typeof i !== 'string' && typeof i !== 'number'; })) {
      throw new ErroHttp_(400, "Todo registro precisa de 'id'.");
    }
  } else if (d.t === 'a') {
    if (!ehLista || !ehInt_(d.n) || d.n < 0 || !listaDeObjetos_(d.add)) throw new ErroHttp_(400, 'Alteração inválida.');
  } else {
    throw new ErroHttp_(400, 'Tipo de alteração desconhecido.');
  }
}

function semSegredo_(u) {
  var r = {};
  Object.keys(u).forEach(function (k) { if (k !== 'hash' && k !== 'salt') r[k] = u[k]; });
  return r;
}
function publico_(col, dados) { return col === 'usuarios' ? dados.map(semSegredo_) : dados; }
function deltaPublico_(col, d) {
  if (col !== 'usuarios') return d;
  if (d.t === 't') return { t: 't', dados: publico_(col, d.dados) };
  if (d.t === 'm') return { t: 'm', up: publico_(col, d.up), rm: d.rm };
  return d;
}

// ---------- Leitura das coleções ----------
function lerDaPlanilha_(col) {
  if (OBJETOS.indexOf(col) !== -1) {
    var sh = folha_(col), s = sh.getLastRow() > 1 ? sh.getRange(2, 1).getValue() : '';
    if (typeof s === 'string' && s) { try { var o = JSON.parse(s); if (ehObj_(o)) return o; } catch (e) { console.error(col + ' ilegível.'); } }
    return {};
  }
  var lista = lerJsonLista_(folha_(col));
  if (col === 'usuarios') {
    var seg = {}, ss = folha_('_segredos'), n = ss.getLastRow() - 1;
    if (n > 0) ss.getRange(2, 1, n, 3).getValues().forEach(function (r) { seg[String(r[0])] = { hash: String(r[1]), salt: String(r[2]) }; });
    lista.forEach(function (u) { var s = seg[String(u.id)]; if (s) { u.hash = s.hash; u.salt = s.salt; } });
  }
  return lista;
}

/** { v, dados } da coleção inteira (dados completos, com hash das senhas). Consistente: lê sob trava se o cache falhar. */
function lerColecao_(col) {
  var v = versoes_()[col], c = grandeGet_('d:' + col + ':' + v);
  if (c !== null) { try { return { v: v, dados: JSON.parse(c) }; } catch (e) { /* refaz */ } }
  return comTrava_(function () {
    var vv = lerVersoesPlanilha_(true)[col], dados = lerDaPlanilha_(col);
    grandePut_('d:' + col + ':' + vv, JSON.stringify(dados));
    return { v: vv, dados: dados };
  });
}

function tudo_() {
  var r = {};
  COLECOES.forEach(function (c) { var x = lerColecao_(c); r[c] = { v: x.v, dados: publico_(c, x.dados) }; });
  return r;
}

function completo_() {
  var r = {};
  COLECOES.forEach(function (c) { r[c] = lerColecao_(c).dados; });
  return r;
}

function mudancas_(col, desde) {
  var v = versoes_()[col];
  if (desde === v) return { v: v, igual: true };
  if (ehInt_(desde) && desde >= 0 && desde < v) {
    var seq = historico_(col).filter(function (p) { return p[0] > desde; });
    if (seq.length === v - desde && seq.every(function (p) { return p[1].t !== 'x'; })) {
      return { v: v, deltas: seq.map(function (p) { return deltaPublico_(col, p[1]); }) };
    }
  }
  var c = lerColecao_(col);
  return { v: c.v, dados: publico_(col, c.dados) };
}

// ---------- Escrita ----------
function linha_(col, obj) {
  var js = JSON.stringify(col === 'usuarios' ? semSegredo_(obj) : obj);
  if (js.length > LIMITE_CELULA) throw new ErroHttp_(400, 'Registro grande demais para a planilha.');
  var extra;
  try { extra = LAYOUT[col].extra(obj); } catch (e) { extra = LAYOUT[col].cab.slice(2).map(function () { return ''; }); }
  var id = col === 'notas' ? obj.pagamentoId : obj.id; // a nota é identificada pelo pagamento
  return [id !== undefined && id !== null ? String(id) : '', js].concat(extra);
}

function gravarLista_(col, delta) {
  var sh = folha_(col), t = delta.t;
  if (t === 't') {
    var todas = delta.dados.map(function (x) { return linha_(col, x); }); // monta tudo antes de mexer na aba
    limparCorpo_(sh);
    anexarLinhas_(sh, todas);
    return;
  }
  if (t === 'a') {
    var novas = delta.add.map(function (x) { return linha_(col, x); });
    if (delta.n > 0) sh.deleteRows(2, delta.n);
    anexarLinhas_(sh, novas);
    return;
  }
  // 'm': atualiza no lugar, acrescenta os novos no fim, remove os apagados
  var rmSet = {};
  delta.rm.forEach(function (i) { rmSet[String(i)] = true; });
  var ultima = sh.getLastRow(), pos = {}, ids;
  if (ultima > 1) {
    ids = sh.getRange(2, 1, ultima - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) { var k0 = String(ids[i][0]); if (k0 !== '') pos[k0] = i + 2; }
  }
  var existentes = [], novosIdx = {}, novos = [];
  delta.up.forEach(function (x) {
    var k = String(x.id), l = linha_(col, x);
    if (pos[k]) existentes.push([pos[k], l]);
    else if (novosIdx[k] !== undefined) novos[novosIdx[k]] = l;
    else { novosIdx[k] = novos.length; novos.push(l); }
  });
  var nc = LAYOUT[col].cab.length;
  existentes.forEach(function (p) { sh.getRange(p[0], 1, 1, nc).setValues([p[1]]); });
  anexarLinhas_(sh, novos.filter(function (l) { return !rmSet[l[0]]; }));
  var apagar = Object.keys(rmSet).map(function (k) { return pos[k]; }).filter(function (r) { return r; }).sort(function (a, b) { return b - a; });
  apagar.forEach(function (r) { sh.deleteRow(r); });
}

function gravarObjeto_(col, dados) {
  var js = JSON.stringify(dados);
  if (js.length > LIMITE_CELULA) throw new ErroHttp_(400, 'Configuração grande demais para a planilha.');
  folha_(col).getRange(2, 1).setValue(js);
}

function gravarUsuarios_(lista) {
  var linhas = lista.map(function (u) { return linha_('usuarios', u); });
  var seg = lista.filter(function (u) { return u.hash && u.salt; }).map(function (u) { return [String(u.id), u.hash, u.salt]; });
  var sh = folha_('usuarios'), ss = folha_('_segredos');
  limparCorpo_(sh); anexarLinhas_(sh, linhas);
  limparCorpo_(ss); anexarLinhas_(ss, seg);
}

/** Grava um delta já validado, sobe a versão e atualiza histórico e cache. Só chame dentro da trava. */
function confirmar_(col, delta) {
  return comTrava_(function () {
    var vs = lerVersoesPlanilha_(false), v1 = vs[col] + 1;
    var hist = historico_(col); // antes de acrescentar a linha nova em _deltas
    if (col === 'usuarios') gravarUsuarios_(aplicar_(lerDaPlanilha_('usuarios'), delta));
    else if (OBJETOS.indexOf(col) !== -1) gravarObjeto_(col, delta.dados);
    else gravarLista_(col, delta);

    // Usuários (têm hash de senha) e mudanças enormes não vão para o histórico: quem estiver atrás baixa a coleção inteira.
    var corpo = col === 'usuarios' ? { t: 'x' } : delta, js = JSON.stringify(corpo);
    if (js.length > LIMITE_CELULA) { corpo = { t: 'x' }; js = '{"t":"x"}'; }
    anexarLinhas_(folha_('_deltas'), [[col, v1, js]]);
    folha_('_controle').getRange(COLECOES.indexOf(col) + 2, 2).setValue(v1);
    hist.push([v1, corpo]);
    guardarHistoricoCache_(col, hist.slice(-HISTORICO_DELTAS));
    vs[col] = v1;
    cPut_('v', JSON.stringify(vs));
    podarDeltas_();
    SpreadsheetApp.flush();
    return v1;
  });
}

function preservarSenhas_(delta, atuais) {
  var porId = {};
  atuais.forEach(function (u) { if (u.id !== undefined) porId[String(u.id)] = u; });
  function completar(u) {
    if (u.hash && u.salt) return u;
    var velho = porId[String(u.id)];
    if (!velho) throw new ErroHttp_(400, 'Usuário novo sem senha.');
    var r = clone_(u); r.hash = velho.hash; r.salt = velho.salt;
    return r;
  }
  if (delta.t === 't') return { t: 't', dados: delta.dados.map(completar) };
  if (delta.t === 'm') return { t: 'm', up: delta.up.map(completar), rm: delta.rm };
  throw new ErroHttp_(400, 'Alteração inválida.');
}

/** Grava um delta se a versão base for a atual. Devolve [http, corpo]. */
function escrever_(col, vBase, delta, perfil) {
  validarDelta_(col, delta);
  return comTrava_(function () {
    var v = lerVersoesPlanilha_(true)[col];
    if (vBase !== v) { var m = mudancas_(col, vBase); m.ok = false; m.conflito = true; return [409, m]; }
    if (col === 'usuarios') {
      delta = preservarSenhas_(delta, lerColecao_('usuarios').dados);
    } else if (col === 'log') {
      if (delta.t !== 'a') throw new ErroHttp_(400, 'A auditoria só aceita novos registros.');
      var atual = Math.max(0, folha_('log').getLastRow() - 1);
      if (delta.n > Math.max(0, atual + delta.add.length - LIMITE_LOG)) throw new ErroHttp_(400, 'A auditoria não pode ser apagada.');
    }
    return [200, { ok: true, v: confirmar_(col, delta) }];
  });
}

function registrarLog_(usuario, acao, detalhe) {
  var reg = { em: agora_(), usuarioId: usuario ? usuario.id : null, usuario: usuario ? usuario.nome : 'sistema',
    perfil: usuario ? usuario.perfil : '', acao: acao, detalhe: detalhe || '' };
  comTrava_(function () {
    var n = Math.max(0, folha_('log').getLastRow() - 1 + 1 - LIMITE_LOG);
    confirmar_('log', { t: 'a', n: n, add: [reg] });
  });
}

function usuarioPor_(campo, valor) {
  var lista = lerColecao_('usuarios').dados;
  for (var i = 0; i < lista.length; i++) if (lista[i][campo] === valor) return clone_(lista[i]);
  return null;
}

function marcarLogin_(u) {
  comTrava_(function () {
    var atual = lerColecao_('usuarios').dados.filter(function (x) { return x.id === u.id; })[0];
    if (!atual) return;
    var novo = clone_(atual); novo.ultimoLogin = agora_();
    confirmar_('usuarios', { t: 'm', up: [novo], rm: [] });
  });
}

// ---------- Usuário administrador inicial ----------
function senhaAdminInicial_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('SENHA_ADMIN_INICIAL');
  if (s) return { senha: s, nova: false };
  s = senhaAleatoria_();
  p.setProperty('SENHA_ADMIN_INICIAL', s);
  return { senha: s, nova: true };
}

function loginDoNome_(nome, usados) {
  var base = String(nome || 'usuario').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 16) || 'usuario';
  if (base.length < 3) base += '.usr';
  var login = base, n = 2;
  while (usados.indexOf(login) !== -1) { login = base + n; n++; }
  return login;
}

/** Garante o usuário 'admin' e um login para cada cadastro. Devolve a senha se acabou de criar o admin. */
function garantirUsuarios_() {
  return comTrava_(function () {
    var lista = clone_(lerColecao_('usuarios').dados), mudou = false, criada = null;
    var usados = lista.filter(function (u) { return u.login; }).map(function (u) { return u.login; });
    lista.forEach(function (u) {
      if (!u.login) { u.login = loginDoNome_(u.nome, usados); usados.push(u.login); mudou = true; }
    });
    if (!lista.some(function (u) { return u.perfil === 'admin'; })) {
      var s = senhaAdminInicial_(), salt = novoSalt_();
      lista.push({ id: 'u_admin', nome: 'Administrador', login: 'admin', perfil: 'admin', salt: salt, hash: hashSenha_(s.senha, salt),
        ativo: true, criadoEm: agora_(), ultimoLogin: null });
      criada = s.senha; mudou = true;
    }
    if (mudou) confirmar_('usuarios', { t: 't', dados: lista });
    return criada;
  });
}

// ---------- Sessões e limite de tentativas ----------
// A sessão fica no cache (rápido) E nas propriedades do script (durável): se o Google limpar o
// cache, ninguém é deslogado no meio do turno. A propriedade só é regravada a cada 1 h de uso.
function tokenOk_(t) { return typeof t === 'string' && /^[0-9a-f]{64}$/.test(t); }

function sessaoGuardar_(token, s, persistir) {
  cPut_('s:' + token, JSON.stringify(s), SESSAO_TTL);
  if (persistir) { try { PropertiesService.getScriptProperties().setProperty('s:' + token, JSON.stringify(s)); } catch (e) { /* segue só com o cache */ } }
}

function sessaoLimparVelhas_() {
  var p = PropertiesService.getScriptProperties(), todas = p.getProperties();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf('s:') !== 0) return;
    try { if (agora_() - JSON.parse(todas[k]).ultimo > SESSAO_OCIOSA_MS) p.deleteProperty(k); } catch (e) { p.deleteProperty(k); }
  });
}

function sessaoCriar_(u) {
  var token = novoToken_(), agora = agora_();
  try { sessaoLimparVelhas_(); } catch (e) { /* não é essencial */ }
  sessaoGuardar_(token, { uid: u.id, pwv: u.hash || '', ultimo: agora, pu: agora }, true);
  return token;
}

function sessaoObter_(token, tocar) {
  if (!tokenOk_(token)) return null;
  var raw = cGet_('s:' + token), doCache = !!raw, s = null;
  if (!raw) { try { raw = PropertiesService.getScriptProperties().getProperty('s:' + token); } catch (e) { raw = null; } }
  if (!raw) return null;
  try { s = JSON.parse(raw); } catch (e) { return null; }
  var agora = agora_();
  if (agora - s.ultimo > SESSAO_OCIOSA_MS) { sessaoEncerrar_(token); return null; }
  if (!doCache || (tocar && agora - s.ultimo > 60000)) { // cache vazio (repõe) ou passou 1 min desde o último toque
    if (tocar) s.ultimo = agora;
    var persistir = agora - (s.pu || 0) > 3600000;
    if (persistir) s.pu = agora;
    sessaoGuardar_(token, s, persistir);
  }
  return s;
}

function sessaoEncerrar_(token) {
  if (!tokenOk_(token)) return;
  cDel_('s:' + token);
  try { PropertiesService.getScriptProperties().deleteProperty('s:' + token); } catch (e) { /* ok */ }
}

function sessaoAtualizarSenha_(token, hash) {
  var s = sessaoObter_(token, false);
  if (s) { s.pwv = hash; sessaoGuardar_(token, s, true); }
}

/** 5 erros seguidos na mesma conta: bloqueia 30 s; cada bloqueio seguido dobra (até 15 min). Um acerto zera. */
function limRestante_(chave) {
  var raw = cGet_('lim:' + chave);
  if (!raw) return 0;
  try { return Math.max(0, Math.ceil((JSON.parse(raw).ate - agora_()) / 1000)); } catch (e) { return 0; }
}
function limFalha_(chave) {
  var e = { e: 0, ate: 0, n: 0 };
  try { var raw = cGet_('lim:' + chave); if (raw) e = JSON.parse(raw); } catch (x) { /* zera */ }
  e.e++;
  if (e.e >= 5) { e.e = 0; e.n++; e.ate = agora_() + Math.min(30 * Math.pow(2, e.n - 1), 900) * 1000; }
  cPut_('lim:' + chave, JSON.stringify(e), SESSAO_TTL);
}
function limSucesso_(chave) { cDel_('lim:' + chave); }

// ---------- Nota fiscal (só o provedor de TESTE: sem valor fiscal) ----------
function digitos_(v) { return String(v === null || v === undefined ? '' : v).replace(/\D/g, ''); }
function todosIguais_(s) { return /^(\d)\1+$/.test(s); }

function cpfValido_(c) {
  c = digitos_(c);
  if (c.length !== 11 || todosIguais_(c)) return false;
  for (var t = 9; t < 11; t++) {
    var soma = 0;
    for (var i = 0; i < t; i++) soma += Number(c.charAt(i)) * (t + 1 - i);
    if ((soma * 10) % 11 % 10 !== Number(c.charAt(t))) return false;
  }
  return true;
}
function cnpjValido_(c) {
  c = digitos_(c);
  if (c.length !== 14 || todosIguais_(c)) return false;
  var pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (var t = 12; t < 14; t++) {
    var soma = 0;
    for (var i = 0; i < t; i++) soma += Number(c.charAt(i)) * pesos[pesos.length - t + i];
    var resto = soma % 11;
    if ((resto < 2 ? 0 : 11 - resto) !== Number(c.charAt(t))) return false;
  }
  return true;
}

/** Devolve o pedido limpo ou lança ErroHttp_(400). */
function validarPedidoNota_(d) {
  function erro(m) { throw new ErroHttp_(400, m); }
  var ticket = String(d.ticketId || '').trim(), pagamento = String(d.pagamentoId || '').trim();
  if (!ticket || !pagamento) erro('Faltam o ticket e o pagamento.');
  if (!ehInt_(d.valor) || d.valor <= 0) erro('Valor inválido (deve ser maior que zero, em centavos).');
  var descricao = String(d.descricao || '').replace(/\s+/g, ' ').trim().slice(0, 200), t = d.tomador;
  if (!ehObj_(t)) erro('Informe os dados do cliente.');
  var doc = digitos_(t.doc), tipo = doc.length === 11 ? 'cpf' : doc.length === 14 ? 'cnpj' : '';
  if (tipo === 'cpf' && !cpfValido_(doc)) erro('CPF inválido.');
  if (tipo === 'cnpj' && !cnpjValido_(doc)) erro('CNPJ inválido.');
  if (!tipo) erro('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');
  var nome = String(t.nome || '').replace(/\s+/g, ' ').trim().slice(0, 115);
  if (nome.length < 3) erro('Informe o nome (ou razão social) do cliente.');
  var email = String(t.email || '').trim().slice(0, 80);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erro('E-mail inválido.');
  return { ticketId: ticket, pagamentoId: pagamento, valor: d.valor, descricao: descricao, tomador: { tipo: tipo, doc: doc, nome: nome, email: email } };
}

function lerNotas_() { return lerJsonLista_(folha_('notas')); }

function notaPublica_(r) {
  return { numero: r.numero, codigoVerificacao: r.codigoVerificacao || '', chaveAcesso: r.chaveAcesso || '', emitidaEm: r.emitidaEm,
    linkPdf: r.linkPdf || null, homologacao: !!r.homologacao };
}

function emitirNota_(dados) {
  var pedido = validarPedidoNota_(dados);
  return comTrava_(function () { // uma emissão por vez: impede nota duplicada
    var notas = lerNotas_();
    for (var i = 0; i < notas.length; i++) {
      if (notas[i].pagamentoId === pedido.pagamentoId) return { ok: true, jaEmitida: true, nota: notaPublica_(notas[i]) };
    }
    var seq = String(notas.length + 1);
    var reg = { numero: 'T' + new Array(7 - seq.length).join('0') + seq, codigoVerificacao: 'TESTE', chaveAcesso: '', emitidaEm: agora_(), linkPdf: null,
      pagamentoId: pedido.pagamentoId, ticketId: pedido.ticketId, valor: pedido.valor, descricao: pedido.descricao, tomador: pedido.tomador, homologacao: true };
    anexarLinhas_(folha_('notas'), [linha_('notas', reg)]); // uma nota emitida nunca pode ficar sem registro
    SpreadsheetApp.flush();
    return { ok: true, jaEmitida: false, nota: notaPublica_(reg) };
  });
}

function podeEmitirNota_(u) {
  var perfis = ['caixa', 'gerente'];
  var aj = ((lerColecao_('config').dados.permissoes) || {})['nota.emitir'];
  if (Array.isArray(aj)) perfis = ['gerente'].concat(aj.filter(function (p) { return p === 'manobrista' || p === 'caixa'; }));
  return perfis.indexOf(u.perfil) !== -1;
}

// ---------- Painel da TV (público: só números de ticket) ----------
function nomeEstabelecimento_() { return lerColecao_('config').dados.estabelecimento || 'Estacionamento CSI'; }

function painelPublico_() {
  var cfg = lerColecao_('config').dados, tickets = lerColecao_('tickets').dados;
  function ordenar(status, campo) {
    return tickets.filter(function (t) { return t.status === status; })
      .sort(function (a, b) { return (a[campo] || 0) - (b[campo] || 0); })
      .map(function (t) { return String(t.id); });
  }
  return { estabelecimento: cfg.estabelecimento || 'Estacionamento CSI',
    mensagem: cfg.mensagemPainel || 'Aguarde no ponto de retirada com o ticket em mãos.',
    preparando: ordenar('PAGO', 'pagoEm'), aCaminho: ordenar('A_CAMINHO', 'buscaEm') };
}

// ---------- Backup (arquivos .json na pasta "EstacionaMais - backups" do seu Drive) ----------
// O arquivo tem o mesmo formato do botão Backup da Gerência: dá para restaurar por lá.
function pastaBackup_() {
  var it = DriveApp.getFoldersByName(PASTA_BACKUP);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_BACKUP);
}

function backup_(prefixo) {
  var obj = { sistema: 'EstacionaMais', versao: 2, exportadoEm: agora_(), dados: completo_(), notas: lerNotas_() };
  var nome = prefixo + '-' + Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd_HH-mm-ss') + '.json';
  pastaBackup_().createFile(nome, JSON.stringify(obj), 'application/json');
  return nome;
}

/** Roda sozinha todo dia (gatilho criado por instalar). Guarda os últimos 30. */
function backupDiario() {
  var pasta = pastaBackup_(), hoje = 'diario-' + Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
  var it = pasta.getFiles(), nomes = [], tem = false;
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (n.indexOf('diario-') === 0) { nomes.push([n, f]); if (n.indexOf(hoje) === 0) tem = true; }
  }
  if (!tem) backup_('diario');
  nomes.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  nomes.slice(0, Math.max(0, nomes.length + (tem ? 0 : 1) - BACKUPS_GUARDADOS)).forEach(function (p) { p[1].setTrashed(true); });
}

function substituirTudo_(porColecao) {
  COLECOES.forEach(function (c) { validarDelta_(c, { t: 't', dados: porColecao[c] }); });
  comTrava_(function () {
    try { backup_('antes-de-restaurar'); } catch (e) {
      console.error(e);
      throw new ErroHttp_(500, 'Não consegui guardar a cópia de segurança no Drive antes de substituir os dados. Nada foi alterado.');
    }
    COLECOES.forEach(function (c) { confirmar_(c, { t: 't', dados: porColecao[c] }); });
    garantirUsuarios_();
  });
}

// ---------- Rotas (caminhos /api/... que o js/api.js chama) ----------
function exigir_(token, tocar, perfis) {
  var s = sessaoObter_(token, tocar), u = null;
  if (s) {
    u = usuarioPor_('id', s.uid);
    if (!u || !u.ativo || (u.hash || '') !== s.pwv) { sessaoEncerrar_(token); u = null; }
  }
  if (!u) throw new ErroHttp_(401, 'Sessão expirada. Entre novamente.', { estabelecimento: nomeEstabelecimento_() });
  if (perfis && perfis.indexOf(u.perfil) === -1) throw new ErroHttp_(403, 'Seu perfil não tem permissão para isso.');
  return u;
}

function ok_(corpo) { return { s: 200, c: corpo }; }

function parseQuery_(qs) {
  var r = {};
  String(qs || '').split('&').forEach(function (p) {
    if (!p) return;
    var i = p.indexOf('=');
    var k = decodeURIComponent(i < 0 ? p : p.slice(0, i)), v = i < 0 ? '' : decodeURIComponent(p.slice(i + 1));
    r[k] = v;
  });
  return r;
}

function rotear_(metodo, rota, token, corpo) {
  var partes = String(rota).split('?'), caminho = partes[0], consulta = parseQuery_(partes[1]), u;

  if (metodo === 'GET') {
    if (caminho === '/api/painel') return ok_(painelPublico_());
    if (caminho === '/api/versoes') { exigir_(token, false); return ok_({ versoes: versoes_() }); }
    if (caminho === '/api/dados') { u = exigir_(token, true); return ok_({ sessao: { usuarioId: u.id }, colecoes: tudo_() }); }
    if (caminho.indexOf('/api/dados/') === 0) {
      exigir_(token, true);
      var col = caminho.slice('/api/dados/'.length);
      if (COLECOES.indexOf(col) === -1) throw new ErroHttp_(404, 'Coleção desconhecida.');
      var desde = /^\d+$/.test(consulta.desde || '') ? parseInt(consulta.desde, 10) : null;
      return ok_(mudancas_(col, desde));
    }
    if (caminho === '/api/backup') {
      exigir_(token, true, ['gerente', 'admin']);
      return ok_({ sistema: 'EstacionaMais', versao: 2, exportadoEm: agora_(), dados: completo_() });
    }
    if (caminho === '/api/nfse/status') {
      exigir_(token, true);
      return ok_({ habilitado: true, provedor: 'mock', homologacao: true, teste: true });
    }
    throw new ErroHttp_(404, 'Não encontrado.');
  }

  if (metodo === 'PUT' && caminho.indexOf('/api/dados/') === 0) {
    u = exigir_(token, true);
    var c2 = caminho.slice('/api/dados/'.length);
    if (COLECOES.indexOf(c2) === -1) throw new ErroHttp_(404, 'Coleção desconhecida.');
    if (ESCRITA[c2] && ESCRITA[c2].indexOf(u.perfil) === -1) throw new ErroHttp_(403, 'Seu perfil não pode alterar isso.');
    if (!ehInt_(corpo.v)) throw new ErroHttp_(400, 'Versão ausente.');
    var r = escrever_(c2, corpo.v, corpo.delta, u.perfil);
    if (r[0] === 200 && c2 === 'usuarios') {
      var eu = usuarioPor_('id', u.id);
      if (eu) sessaoAtualizarSenha_(token, eu.hash || '');
    }
    return { s: r[0], c: r[1] };
  }

  if (metodo === 'POST') {
    if (caminho === '/api/login') return rotaLogin_(corpo);
    if (caminho === '/api/logout') { sessaoEncerrar_(token); return ok_({ ok: true }); }
    if (caminho === '/api/senha/verificar') { exigir_(token, true); return rotaVerificarSenha_(corpo); }
    if (caminho === '/api/restaurar') {
      exigir_(token, true, ['gerente']);
      var dados = corpo.dados;
      if (!ehObj_(dados) || COLECOES.some(function (x) { return !(x in dados); })) throw new ErroHttp_(400, 'Backup incompleto.');
      var pc = {};
      COLECOES.forEach(function (x) { pc[x] = dados[x]; });
      substituirTudo_(pc);
      return ok_({ ok: true });
    }
    if (caminho === '/api/zerar') {
      exigir_(token, true, ['gerente']);
      var vazio = {};
      COLECOES.forEach(function (x) { vazio[x] = ARRAYS.indexOf(x) !== -1 ? [] : {}; });
      substituirTudo_(vazio);
      return ok_({ ok: true });
    }
    if (caminho === '/api/nfse/emitir') {
      u = exigir_(token, true);
      if (!podeEmitirNota_(u)) throw new ErroHttp_(403, 'Seu perfil não pode emitir nota fiscal.');
      return ok_(emitirNota_(corpo));
    }
  }
  throw new ErroHttp_(404, 'Não encontrado.');
}

function rotaLogin_(d) {
  var login = String(d.login || '').trim().toLowerCase().slice(0, 40), senha = String(d.senha || '').slice(0, 200);
  // Tudo sob a trava: tentativas em paralelo não furam o limite de erros.
  return comTrava_(function () {
    garantirUsuarios_();
    var chave = 'c:' + login, espera = limRestante_(chave);
    if (espera) return { s: 429, c: { ok: false, bloqueado: true, erro: 'Muitas tentativas. Aguarde ' + espera + ' s.' } };
    var u = login ? usuarioPor_('login', login) : null;
    if (!verificarSenha_(u, senha)) {
      limFalha_(chave);
      if (u) registrarLog_(u, 'senha_incorreta', u.nome);
      return { s: 401, c: { ok: false, erro: 'Usuário ou senha incorretos.' } };
    }
    if (!u.ativo) return { s: 403, c: { ok: false, erro: 'Usuário desativado. Fale com o administrador.' } };
    limSucesso_(chave);
    marcarLogin_(u);
    registrarLog_(u, 'login', u.nome);
    return ok_({ ok: true, token: sessaoCriar_(usuarioPor_('id', u.id)) });
  });
}

/** Autorização de gerente: o usuário logado confirma a senha de um gerente. */
function rotaVerificarSenha_(d) {
  var senha = String(d.senha || '').slice(0, 200);
  return comTrava_(function () {
    var alvo = usuarioPor_('id', String(d.id || '')), chave = 'c:' + ((alvo || {}).login || '?'), espera = limRestante_(chave);
    if (espera) return ok_({ ok: false, bloqueado: true, erro: 'Muitas tentativas. Aguarde ' + espera + ' s.' });
    if (!alvo || alvo.perfil !== 'gerente' || !verificarSenha_(alvo, senha)) {
      limFalha_(chave);
      if (alvo) registrarLog_(alvo, 'senha_incorreta', alvo.nome);
      return ok_({ ok: false, erro: 'Senha incorreta.' });
    }
    if (!alvo.ativo) return ok_({ ok: false, erro: 'Usuário desativado. Fale com o administrador.' });
    limSucesso_(chave);
    return ok_({ ok: true });
  });
}

// ---------- Entrada da Web App ----------
function saida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Toda chamada do site chega aqui como POST text/plain: { m: método, r: rota, t: token, b: corpo }. Responde { s: status, c: corpo }. */
function doPost(e) {
  var resp;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!ehObj_(req)) throw new ErroHttp_(400, 'JSON inválido.');
    var corpo = ehObj_(req.b) ? req.b : {};
    resp = rotear_(String(req.m || 'GET').toUpperCase(), String(req.r || ''), req.t, corpo);
  } catch (err) {
    if (err instanceof ErroHttp_) {
      var c = { ok: false, erro: err.message };
      Object.keys(err.extra).forEach(function (k) { c[k] = err.extra[k]; });
      resp = { s: err.codigo, c: c };
    } else if (err instanceof SyntaxError) {
      resp = { s: 400, c: { ok: false, erro: 'JSON inválido.' } };
    } else {
      console.error(err && err.stack ? err.stack : String(err));
      resp = { s: 500, c: { ok: false, erro: 'Erro inesperado no servidor. Veja Execuções no Apps Script.' } };
    }
  }
  return saida_(resp);
}

function doGet() {
  return saida_({ ok: true, sistema: 'EstacionaMais', mensagem: 'Servidor no ar. Abra o site do estacionamento para usar.' });
}

// ---------- Menu da planilha e instalação ----------
function alerta_(msg) {
  try { SpreadsheetApp.getUi().alert('Estacionamento CSI', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { Logger.log(msg); }
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Estacionamento CSI')
      .addItem('1) Preparar planilha (rodar uma vez)', 'instalar')
      .addItem('Mostrar senha inicial do admin', 'mostrarSenhaAdmin')
      .addItem('Redefinir senha do admin', 'redefinirSenhaAdmin')
      .addItem('Fazer backup agora', 'backupAgora')
      .addToUi();
  } catch (e) { /* aberto fora da planilha */ }
}

function ativarBackupDiario_() {
  var ja = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'backupDiario'; });
  if (!ja) ScriptApp.newTrigger('backupDiario').timeBased().everyDays(1).atHour(3).create();
  return !ja;
}

/** Rode UMA vez: cria as abas, o usuário admin e o backup diário. Pode rodar de novo sem medo. */
function instalar() {
  var ss = planilha_();
  try { ss.setSpreadsheetTimeZone(FUSO); } catch (e) { /* ignora */ }
  ['tickets', 'caixas', 'mensalistas', 'usuarios', 'log', 'notas', 'config', 'meta', '_controle', '_deltas', '_segredos'].forEach(folha_);
  ss.getSheets().forEach(function (sh) { // remove a aba vazia que veio com a planilha ("Página1", "Sheet1"...)
    if (/^(P[áa]gina|Sheet|Planilha)\s?1$/i.test(sh.getName()) && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  var senha = garantirUsuarios_(), gatilho = ativarBackupDiario_();
  var msg = 'Planilha preparada.\n\n';
  msg += senha ? 'Usuário do administrador: admin\nSenha inicial: ' + senha + '\n(Troque-a na tela do administrador. Para ver de novo: menu Estacionamento CSI > Mostrar senha inicial.)\n\n'
    : 'O usuário admin já existia (use o menu Estacionamento CSI > Mostrar senha inicial, se ainda não a trocou).\n\n';
  msg += gatilho ? 'Backup diário ativado (pasta "' + PASTA_BACKUP + '" no seu Drive).\n\n' : 'Backup diário já estava ativo.\n\n';
  msg += 'Próximo passo: Implantar > Nova implantação > App da Web.';
  Logger.log(msg);
  alerta_(msg);
}

function mostrarSenhaAdmin() {
  var s = PropertiesService.getScriptProperties().getProperty('SENHA_ADMIN_INICIAL');
  alerta_(s ? 'Senha inicial do admin: ' + s + '\n\nVale só se você ainda não a trocou na tela do administrador. Se esqueceu a nova: menu > Redefinir senha do admin.'
    : 'Ainda não existe senha inicial. Rode "Preparar planilha".');
}

function redefinirSenhaAdmin() {
  var nova = senhaAleatoria_(), salt = novoSalt_();
  comTrava_(function () {
    var lista = clone_(lerColecao_('usuarios').dados), adm = lista.filter(function (u) { return u.perfil === 'admin'; })[0];
    if (!adm) { garantirUsuarios_(); return; }
    adm.salt = salt; adm.hash = hashSenha_(nova, salt); adm.ativo = true;
    confirmar_('usuarios', { t: 'm', up: [adm], rm: [] });
    PropertiesService.getScriptProperties().setProperty('SENHA_ADMIN_INICIAL', nova);
  });
  alerta_('Nova senha do admin: ' + (PropertiesService.getScriptProperties().getProperty('SENHA_ADMIN_INICIAL')) + '\n\nQuem estava logado como admin precisará entrar de novo.');
}

function backupAgora() {
  alerta_('Backup salvo na pasta "' + PASTA_BACKUP + '" do seu Drive:\n' + backup_('manual'));
}
