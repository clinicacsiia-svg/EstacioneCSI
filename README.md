# Estacionamento CSI

Sistema de estacionamento (entrada/saída, caixa, mensalistas, gerência, painel para TV) feito só com HTML/CSS/JavaScript.

- **Telas:** publicadas de graça no **GitHub Pages** (HTTPS, funciona no celular e libera a impressora Bluetooth).
- **Dados e login:** ficam numa **planilha do Google**, por meio de um **Google Apps Script** (`apps-script/Codigo.gs`).
- Nenhum computador do estacionamento precisa ficar ligado como servidor.

Passo a passo completo: [`apps-script/LEIA-ME.md`](apps-script/LEIA-ME.md).

## Estrutura

```
index.html, caixa.html, manobrista.html, gerencia.html, admin.html, painel.html   telas
css/  js/                                   estilo e lógica
js/config.js                                endereço /exec do Apps Script (você preenche)
js/api.js                                   como o site fala com o Google
apps-script/Codigo.gs                       servidor: cole na planilha do Google
.github/workflows/publicar.yml              publica as telas no GitHub Pages a cada push
```

## Segurança em uma linha

Dados de clientes ficam **na planilha**: mantenha-a **restrita** (sem "qualquer pessoa com o link"). Nada de dados vai para o GitHub: o `.gitignore` barra backups e certificados. Antes de cada `git push`, rode `git status` e confira.
