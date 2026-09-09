# Catálogo HMD

Painel web que lê o catálogo de produtos do Bling e escreve na planilha do
Google Sheets. O banco de dados guarda uma cópia para busca rápida e para que a
planilha possa ser reescrita sem precisar consultar o Bling de novo.

- **Desenvolvimento:** Next.js 15 + TypeScript + Tailwind CSS 4
- **Banco:** PostgreSQL
- **Hospedagem:** Railway

---

## Por que estas escolhas

**Banco de dados entre o Bling e a planilha.** A leitura do Bling grava no
Postgres e, em seguida, a planilha é reescrita a partir dele. Isso separa as duas
operações: se a escrita na planilha falhar, os dados já estão salvos e basta
clicar em Reescrever planilha — sem repetir a leitura inteira, que é a parte
demorada.

**Conta de serviço para o Google.** A escrita na planilha usa uma identidade que
pertence ao aplicativo, não a uma pessoa. Não expira e não depende de ninguém
estar logado.

**Contêiner persistente em vez de serverless.** A leitura completa do catálogo
leva minutos. No Vercel, Netlify ou Apps Script existe um teto de poucos minutos
por execução, o que obriga a fatiar o trabalho e a remendar retomadas. No Railway
o processo fica de pé e a leitura roda do começo ao fim, de uma vez.

**Fila de requisições no cliente do Bling.** Todas as chamadas passam por um
único portão que garante o espaçamento de 380 ms entre elas. Fica dentro do
limite de 3 por segundo do Bling sem depender de `sleep` espalhado pelo código.

---

## Passo a passo

### 1. Instalar as ferramentas

Você vai precisar de três coisas no computador:

| Ferramenta | Para quê | Onde baixar |
|---|---|---|
| Node.js (versão 20 ou maior) | rodar o projeto | nodejs.org |
| Git | enviar o código para o GitHub | git-scm.com |
| Editor de código | ver e editar arquivos | code.visualstudio.com |

### 2. Colocar o projeto no seu computador

Descompacte a pasta do projeto onde preferir. Abra o terminal dentro dela e rode:

```bash
npm install
```

### 3. Criar o aplicativo no Bling

Em `developer.bling.com.br`, crie um aplicativo:

- **Escopos:** marque apenas `Produtos`
- **Link de redirecionamento:** deixe em branco por enquanto — você preenche no passo 6

Guarde o **client ID** e o **client secret**.

### 4. Preparar o acesso à planilha

**4.1 — Criar a conta de serviço**

Em `console.cloud.google.com`, com o projeto selecionado:

1. **APIs e serviços** → **Biblioteca** → procure "Google Sheets API" → **Ativar**.
2. **IAM e administrador** → **Contas de serviço** → **Criar conta de serviço**.
   Dê um nome qualquer e conclua sem atribuir papéis.
3. Abra a conta criada → aba **Chaves** → **Adicionar chave** → **Criar nova
   chave** → **JSON**. O arquivo baixa automaticamente.

Esse arquivo é uma senha. Ele não entra no projeto nem no GitHub.

**4.2 — Converter a chave para base64**

O JSON tem quebras de linha que costumam se corromper ao serem coladas em
painéis de variáveis. Converta para uma linha só.

No Mac ou Linux:

```bash
base64 -i ~/Downloads/nome-do-arquivo.json | tr -d '\n'
```

No Windows (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\nome-do-arquivo.json"))
```

Copie o resultado — é o valor de `GOOGLE_SERVICE_ACCOUNT`.

**4.3 — Compartilhar a planilha**

Abra o JSON num editor de texto e copie o valor de `client_email` — algo como
`nome@projeto.iam.gserviceaccount.com`.

Na planilha do Google, clique em **Compartilhar**, cole esse e-mail e dê
permissão de **Editor**.

Sem esse passo a aplicação recebe erro de permissão. A conta de serviço é um
usuário como outro qualquer: precisa ser convidada.

**4.4 — Anotar o ID da planilha**

Está no endereço dela, entre `/d/` e `/edit`:

```
https://docs.google.com/spreadsheets/d/ESTE-PEDACO-AQUI/edit
```

A aba de destino é `dataBase`. Para usar outro nome, ajuste `SHEET_NAME`.

### 5. Enviar o código para o GitHub

Crie um repositório **privado** no GitHub. O código não tem segredos dentro dele,
mas privado é o padrão certo para ferramenta interna.

No terminal, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "Primeira versão"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

### 6. Publicar no Railway

Em `railway.app`, entre com a conta do GitHub.

1. **New Project** → **Deploy from GitHub repo** → escolha o repositório.
2. Dentro do projeto criado: **New** → **Database** → **Add PostgreSQL**.
   O Railway cria a variável `DATABASE_URL` e conecta sozinho.
3. Abra o serviço da aplicação → aba **Settings** → **Networking** →
   **Generate Domain**. Copie o endereço gerado.
4. Aba **Variables** → adicione:

   | Variável | Valor |
   |---|---|
   | `BLING_CLIENT_ID` | o client ID do passo 3 |
   | `BLING_CLIENT_SECRET` | o client secret do passo 3 |
   | `APP_URL` | o endereço gerado no item 3 acima, sem barra no final |
   | `APP_PASSWORD` | uma senha forte, que você inventa agora |
   | `SPREADSHEET_ID` | o ID do passo 4.4 |
   | `SHEET_NAME` | `dataBase` |
   | `GOOGLE_SERVICE_ACCOUNT` | o base64 do passo 4.2 |

   `DATABASE_URL` já está lá. Não mexa nela.

5. O Railway reconstrói sozinho a cada mudança nas variáveis.

### 7. Fechar o ciclo do OAuth

Volte ao aplicativo no Bling e preencha o **link de redirecionamento** com:

```
https://SEU-ENDERECO.up.railway.app/bling/callback
```

Tem que ser idêntico, incluindo `/bling/callback` no final.

### 8. Usar

Abra o endereço da aplicação, entre com a senha que você definiu em
`APP_PASSWORD` e clique em **Conectar conta do Bling**. Autorize no Bling e você
volta para o painel.

Clique em **Ler catálogo agora**. A leitura roda em segundo plano — pode fechar a
página. A faixa no topo mostra o andamento quando você voltar. Ao terminar, a
planilha é reescrita sozinha.

**Reescrever planilha** repete só a escrita, a partir do que já está no banco.
Serve para quando alguém bagunçou a aba e você quer o conteúdo de volta sem
esperar a leitura do Bling inteira.

---

## Rodar no seu computador (opcional)

Para testar mudanças antes de publicar, crie um arquivo `.env` na raiz, copiando
o modelo de `.env.example`. Você precisa de um Postgres local ou pode apontar
`DATABASE_URL` para o banco do Railway (aba Variables → `DATABASE_URL`).

```bash
npm run dev
```

Com `APP_URL=http://localhost:3000`, cadastre também
`http://localhost:3000/bling/callback` como link de redirecionamento no Bling.

---

## Como o código está organizado

```
app/
  page.tsx              painel (exige sessão)
  entrar/page.tsx       tela de senha
  bling/authorize/      leva o usuário ao Bling
  bling/callback/       recebe o código e guarda os tokens
  api/                  status, leitura, produtos, exportação, login
components/
  Painel.tsx            toda a interface do painel
lib/
  bling.ts              OAuth, renovação de token e fila de requisições
  sheets.ts             escrita na planilha do Google
  sync.ts               motor da leitura do catálogo
  db.ts                 conexão e criação das tabelas
  auth.ts               sessão por senha única
```

A aba de destino é apagada e reescrita inteira a cada envio, cabeçalho incluído.
Se você tem fórmulas na planilha, coloque-as numa **outra aba**, apontando para
`dataBase` — o que estiver dentro de `dataBase` some a cada atualização.

As tabelas são criadas sozinhas na primeira execução. Não há passo de migração
manual.

---

## Manutenção

**Trocar o client secret do Bling:** gere o novo no painel do Bling, atualize
`BLING_CLIENT_SECRET` no Railway e reconecte a conta pelo painel.

**Leitura automática:** no Railway, **New** → **Cron Job** apontando para o
serviço, com agendamento `0 6 * * *`, chamando `POST /api/sync`. Exige incluir a
autenticação por senha na chamada — peça ajuda quando for fazer.

**Erro de permissão na planilha:** confirme que o `client_email` da conta de
serviço está compartilhado como Editor na planilha.

**A leitura falhou:** a mensagem de erro aparece em vermelho no topo do painel e
o log completo fica na aba **Deployments** → **View Logs** do Railway.
