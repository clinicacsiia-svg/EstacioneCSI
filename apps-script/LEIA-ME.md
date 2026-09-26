# Estacionamento CSI no GitHub + Google Planilhas — passo a passo

## Como fica (visão geral)

```
 Celular / PC / TV                GitHub Pages                    Google
 (navegador)          ───────►    telas (html, css, js)
      │                           https://USUARIO.github.io/REPO/
      │
      └──── login, tickets, caixa ────────────────►  Apps Script (Codigo.gs)  ──►  Planilha
            (POST para o endereço /exec)             "o servidor"                  "o banco de dados"
                                                                                     + backups no Drive
```

- **GitHub** guarda o código e publica as telas de graça, com HTTPS (o que libera a **impressora Bluetooth** no celular).
- **Apps Script** (`apps-script/Codigo.gs`) é o servidor do sistema: login, sincronização entre aparelhos, auditoria, backup.
- **Planilha** guarda os dados. Uma aba por assunto (`tickets`, `caixas`, `mensalistas`, `usuarios`, `log`, `notas`, `config`, `meta`) e três abas ocultas de controle.
- Não existe mais servidor no seu computador: nenhum PC precisa ficar ligado. Tudo roda no GitHub e no Google.

Tempo total: uns 30 minutos.

---

## PARTE 0 — Proteger a planilha (faça ANTES de tudo)

A planilha guarda placas, telefones e CPF/CNPJ de clientes. Quem tem o link dela **não pode** conseguir abri-la.

O script roda **com a sua conta** ("Executar como: Eu"), então ninguém mais precisa de acesso à planilha.

1. Abra a planilha → botão **Compartilhar**.
2. Em **Acesso geral**, troque para **Restrito** (nada de "Qualquer pessoa com o link").
3. Confira que a **conta que vai fazer os passos abaixo** aparece como **Editor** ou **Proprietário**. Se você entra com outra conta que não é a dona, adicione-a como Editor *antes* de restringir, senão perde o acesso.
4. Use sempre **a mesma conta** nas partes 1 a 3. Os backups diários vão para o **Drive dessa conta**.

> Por que isso importa: a coluna `json` guarda tudo, e as abas `usuarios`/`_segredos` têm os dados de login. Com a planilha aberta ao público, qualquer pessoa leria (ou apagaria) tudo direto, sem passar pelo login do sistema.

---

## PARTE 1 — Colocar o script na planilha

1. Na planilha: menu **Extensões → Apps Script**. Abre uma aba nova (o editor).
2. Renomeie o projeto (canto superior esquerdo, "Projeto sem título") para `Estacionamento CSI`.
3. No arquivo `Code.gs` que já existe: **selecione tudo (Ctrl+A) e apague**.
4. Abra o arquivo [`Codigo.gs`](Codigo.gs) deste repositório, **copie tudo** e **cole** no editor.
5. Confira a linha 29 (aprox.): `var PLANILHA_ID = '1EOeH...';` — já vem com o ID da sua planilha. Se algum dia usar outra planilha, troque aqui (é o trecho entre `/d/` e `/edit` do endereço dela).
6. **Ctrl+S** para salvar.

> O editor precisa estar no motor **V8** (padrão dos projetos novos). Em **Configurações do projeto** (engrenagem) não deve haver a opção "Ativar V8" desmarcada.

---

## PARTE 2 — Preparar a planilha (rodar `instalar` uma vez)

1. No editor, no topo, ao lado do botão **Executar**, escolha a função **`instalar`** na lista.
2. Clique **Executar**.
3. Aparece **"Autorização necessária"** → **Revisar permissões** → escolha a conta.
4. Aparece "O Google não verificou este app": clique **Avançado** → **Acessar Estacionamento CSI (não seguro)** → **Permitir**.
   Isso é normal: o script é *seu*. As permissões são: planilhas (gravar os dados), Drive (backups) e gatilhos (backup diário).
5. Quando terminar, abra **Execuções** (menu lateral) ou **Registro de execução** (embaixo): aparece o texto com o **usuário `admin` e a senha inicial**.
   - Se você rodou com a planilha aberta em outra aba, a mesma mensagem também aparece como janela na planilha.
   - **Anote a senha.** Para ver de novo: recarregue a planilha → menu **Estacionamento CSI → Mostrar senha inicial do admin**.
6. Volte à planilha: agora ela tem as abas do sistema, e a aba vazia "Página1" some.

O que o `instalar` fez: criou as abas, ajustou o fuso para `America/Bahia`, criou o usuário `admin`, e ligou o **backup diário** (todo dia por volta das 3h, guarda os últimos 30 na pasta **`EstacionaMais - backups`** do seu Drive).
Pode rodar de novo sem medo — ele não duplica nada.

### (Opcional) Código mestre de emergência do admin

Além da senha inicial e do "Redefinir senha do admin" pelo menu da planilha, dá pra configurar um **código mestre** que redefine a senha do admin direto pela tela de login (botão "Esqueci minha senha" → "Sou o administrador e não tenho e-mail cadastrado"), sem precisar abrir a planilha. Útil se você perder o acesso à conta Google também.

Esse código **nunca fica no código-fonte** (o repositório é público): ele mora só nas Propriedades do seu projeto Apps Script.

1. No editor: ⚙️ **Configurações do projeto** (ícone de engrenagem, menu lateral).
2. Em **Propriedades do script** → **Adicionar propriedade do script**.
3. Nome: `CODIGO_MESTRE_ADMIN`. Valor: algo **longo e aleatório** (não use "8865" nem nada curto/adivinhável — pense em 20+ caracteres, tipo uma senha de gerenciador de senhas). Salvar.
4. Guarde esse valor num lugar seguro fora do sistema (gerenciador de senhas, cofre físico). Quem tiver esse código consegue redefinir a senha do admin — só a do admin, nada além disso.

Sem essa propriedade configurada, o botão de emergência simplesmente não funciona (sempre "código incorreto") — é opcional.

---

## PARTE 3 — Publicar o servidor (Implantar)

1. No editor: **Implantar → Nova implantação**.
2. Na engrenagem ao lado de "Selecionar tipo": **App da Web**.
3. Preencha:
   - **Descrição:** `Estacionamento CSI`
   - **Executar como:** **Eu** (a sua conta)
   - **Quem pode acessar:** **Qualquer pessoa** ← precisa ser este. Não significa que qualquer um vê a planilha: só que qualquer um pode *chamar* o servidor, que exige usuário e senha do sistema.
4. **Implantar** → autorize de novo se pedir → **copie o "URL do app da Web"**.
   Ele termina em **`/exec`** (exemplo: `https://script.google.com/macros/s/AKfycb.../exec`). Um endereço terminado em `/dev` **não serve**.
5. Teste: cole o endereço numa aba do navegador. Deve aparecer:
   `{"ok":true,"sistema":"EstacionaMais","mensagem":"Servidor no ar. ..."}`

---

## PARTE 4 — GitHub

### 4.1 Colocar o endereço no site
Abra [`js/config.js`](../js/config.js) e troque a linha:

```js
window.ESTACIONA_API = 'https://script.google.com/macros/s/AKfycb.../exec';
```

(Pode ficar no GitHub: sem usuário e senha do sistema, o endereço não dá acesso a nada.)

### 4.2 Criar o repositório e enviar
1. Em github.com: **New repository** → nome (ex.: `estacionamento`) → **Public** → *não* marque README/.gitignore → **Create**.
   (Repositório **privado** só publica Pages em planos pagos. Público é seguro aqui: o código não tem dados; os dados ficam na planilha, e o `.gitignore` do projeto barra pastas de dados e certificados.)
2. Instale o **Git para Windows** (https://git-scm.com) ou o **GitHub Desktop**.
3. No PowerShell, dentro da pasta do projeto:

```bash
git init -b main
git add .
git status
```

   **Confira o `git status`:** não pode aparecer nenhum `.pfx`, `.env`, `backup-*.json` nem pasta `dados`. Se aparecer, pare e me avise.

```bash
git commit -m "Estacionamento CSI: site + Apps Script"
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

### 4.3 Ligar o GitHub Pages
1. No repositório: **Settings → Pages**.
2. Em **Build and deployment → Source**: escolha **GitHub Actions**.
3. Aba **Actions**: o fluxo **Publicar no GitHub Pages** roda sozinho após o push (1–2 min). Se não rodou: **Run workflow**.
4. Quando ficar verde, o endereço do site aparece no fim do fluxo e em **Settings → Pages**:
   `https://SEU_USUARIO.github.io/SEU_REPOSITORIO/`

O fluxo confere a sintaxe do JavaScript antes de publicar e **avisa** (aviso amarelo) se `js/config.js` ainda estiver vazio.

---

## PARTE 5 — Primeiro acesso

1. Abra o endereço do site. Entre com **`admin`** e a senha da Parte 2.
   - A primeira chamada ao Google pode levar uns 5–10 s (o Google "acorda" o script). Depois fica na faixa de 1–3 s.
2. Na tela do administrador: **troque a senha do admin** e cadastre gerentes, caixas e manobristas.
   - Em cada usuário (inclusive o admin) dá pra preencher um **e-mail de recuperação** opcional: é ele que recebe o código de 6 dígitos do botão **"Esqueci minha senha"** na tela de entrada. Sem e-mail cadastrado, esse usuário só recupera a senha pelo menu da planilha (Parte 2/tabela abaixo).
3. Conferir na planilha: as abas `usuarios`, `log`, `config` já têm linhas.
4. Painel da TV: `.../painel.html` (não pede login, só mostra números de ticket).
5. Celular: abra o endereço e use *Adicionar à tela inicial*. Como é HTTPS, a **impressora Bluetooth** funciona.

Se você já tinha dados no sistema antigo (servidor Python): baixe o backup por lá (**Gerência → Backup**) e use **Restaurar de um arquivo** no sistema novo.

---

## Atualizar depois

| Mudou… | Faça |
|---|---|
| Telas (`*.html`, `js/`, `css/`) | `git add .` → `git commit -m "..."` → `git push`. O GitHub publica sozinho. |
| `Codigo.gs` | Cole o arquivo novo no editor → **Implantar → Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar**. O endereço `/exec` continua o mesmo. **Sem essa "Nova versão", o Google continua rodando o código antigo.** A partir da versão com "Esqueci minha senha", o script também **envia e-mail** (`MailApp`): na primeira execução depois de colar o código novo, rode qualquer função no editor (ex.: `instalar`) para autorizar essa permissão extra, senão o envio falha silenciosamente. |
| Senha do admin esquecida | Na planilha: menu **Estacionamento CSI → Redefinir senha do admin**. |
| Backup na hora | Menu **Estacionamento CSI → Fazer backup agora** (vai para a pasta `EstacionaMais - backups` do Drive). |

**Restaurar um backup:** no sistema, **Gerência → Backup → Restaurar de um arquivo** e escolha o `.json` baixado do Drive. Antes de restaurar, o servidor grava uma cópia `antes-de-restaurar-...json`.
Além disso a planilha tem **Arquivo → Histórico de versões**.

---

## Limites do sistema (leia)

- **Velocidade.** Cada gravação vai ao Google e leva de 1 a 3 s, e a tela espera terminar. Registrar uma entrada faz 2–3 gravações (número do ticket, ticket, auditoria). É usável, mas depende de boa internet no estacionamento (4G do celular serve).
- **Sincronização entre aparelhos:** a cada **8 s** (era 2,5 s), para não estourar o limite de chamadas simultâneas do Google. Painel da TV: a cada 10 s.
- **Sem internet, sem sistema.** Se a internet cair, ninguém consegue registrar nada até ela voltar. Tenha um plano de papel para essa hora.
- **Nota fiscal:** só a nota de **teste** (sem valor fiscal). A emissão real na prefeitura exige certificado digital e um servidor próprio (não dá para fazer só com GitHub + Google) e ainda não foi implementada.
- **Login:** vale por aba do navegador (fechar a aba encerra) e por até 12 h sem uso.
- **Bloqueio por senha errada:** por conta (5 erros = 30 s, dobrando). O Apps Script não informa o IP de quem tentou, então não há limite por aparelho.
- **Não edite a planilha à mão.** As colunas legíveis (placa, status, valor em R$…) são só um espelho para você filtrar e somar. O que vale é a coluna `json`. Se editar uma célula, o sistema não vê a mudança; se apagar uma linha, apaga o registro. As abas têm aviso de edição para lembrar.
- **Volume.** O sistema carrega todos os tickets em cada tela. Com muitos milhares de tickets fica lento. Se notar, faça o backup, comece uma planilha nova por ano (repita as Partes 1–3) e guarde a antiga.
- **Cotas do Google:** o Google limita execuções simultâneas e o tempo de execução por chamada. Para o uso normal de um estacionamento não deve incomodar; se aparecer erro "muitas chamadas", espere alguns minutos.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| "Sem conexão com o servidor" logo na tela de login | `js/config.js` com endereço errado/incompleto, ou a implantação não está como **Qualquer pessoa** (Parte 3, passo 3). Abra o endereço `/exec` direto no navegador: se pedir login do Google, está errado. |
| "O servidor do Google não respondeu como esperado" | Mesma causa acima, ou o código do `Codigo.gs` tem erro: veja **Execuções** no editor do Apps Script. |
| Mudei o `Codigo.gs` e nada mudou | Faltou **Nova versão** na implantação (tabela acima). |
| "O sistema está ocupado" | Muitas gravações ao mesmo tempo. Tente de novo. |
| Volta ao login sozinho | Passou 12 h sem uso, senha trocada, usuário desativado ou `zerar`. |
| "Muitas tentativas. Aguarde…" | Bloqueio por senha errada (por conta). Aguarde. |
| Login mostra "Servidor ainda não configurado" | `js/config.js` ainda está vazio: cole o endereço `/exec` (Parte 4.1), faça commit e push. |
| Site do GitHub abre em branco / 404 | O fluxo da aba **Actions** ainda não terminou, ou **Settings → Pages → Source** não está em **GitHub Actions**. |
| Erro de autorização do Drive ao restaurar/zerar | Rode `instalar` de novo e autorize. O sistema se recusa a substituir os dados se não conseguir guardar a cópia `antes-de-restaurar`. |
| "Esqueci minha senha" não chega o e-mail | O usuário não tem e-mail de recuperação cadastrado (Administração → Usuários), ou o script ainda não foi autorizado a enviar e-mail (rode qualquer função no editor uma vez após colar o `Codigo.gs` novo). Veja **Execuções** no editor para o erro exato. Por segurança a tela sempre diz "código enviado", mesmo sem e-mail cadastrado. |
| Código mestre do admin sempre diz "código incorreto" | A propriedade `CODIGO_MESTRE_ADMIN` não está configurada (Parte 2, seção opcional), ou o valor digitado não bate exatamente com o salvo nas Propriedades do script. |

---

## Testes automáticos

`apps-script/teste/teste.html` roda o `Codigo.gs`, o `api.js` e o `dados.js` de verdade contra uma simulação do Google (planilha, cache, trava, Drive): login, conflito de versão, sincronização, permissões, formula-injection, restauração etc.
Para rodar (só precisa de qualquer servidor de arquivos estáticos; o Python serve para isso, mas não é parte do sistema), na pasta do projeto:

```bash
python -m http.server 8099
```

e abra `http://127.0.0.1:8099/apps-script/teste/teste.html`. O título da aba vira **PASSOU** ou **FALHOU**.
A simulação não substitui um teste no Google de verdade: na Parte 5, faça login, registre um ticket e confira a linha na aba `tickets`.
