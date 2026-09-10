# Catálogo HMD

Painel web interno com duas ferramentas:

- **Catálogo** — lê os produtos do Bling e guarda no banco: código, nome, preço
  de custo, peso líquido e saldo.
- **Precificação** — calcula frete, comissão, lucro e margem de cada anúncio do
  Mercado Livre e da Shopee, a partir do custo e do peso vindos do catálogo.

Stack: Next.js 15 + TypeScript + Tailwind CSS 4 + PostgreSQL. Hospedagem: Railway.

---

## Por que estas escolhas

**Um banco no meio.** A leitura do Bling grava no Postgres, e a precificação lê
de lá. Ler o catálogo inteiro leva minutos; consultar custo e peso na hora de
calcular um preço precisa ser instantâneo.

**Contêiner persistente em vez de serverless.** No Vercel, Netlify ou Apps
Script existe um teto de poucos minutos por execução, o que obrigaria a fatiar a
leitura e remendar retomadas. No Railway o processo fica de pé e a leitura roda
do começo ao fim.

**Fila de requisições no cliente do Bling.** Todas as chamadas passam por um
único portão que garante o espaçamento de 380 ms entre elas. Fica dentro do
limite de 3 por segundo do Bling sem depender de `sleep` espalhado pelo código.

**O cálculo mora num arquivo só.** `lib/precificacao.ts` são funções puras:
entram números, saem números, sem banco e sem tela. É o que permite conferi-lo
contra valores conhecidos — e o motivo de o mesmo código rodar no navegador (para
o número acompanhar a digitação) e no servidor (para somar a conta inteira).

**Valores em vez de interruptores.** Cada conta guarda os próprios imposto,
antecipação e embalagem como números; zero é o desligado. A planilha que deu
origem a isto mantinha um "Sim/Não" ao lado de um percentual guardado noutro
lugar, e foi assim que uma das contas passou a tributar 0% sem ninguém notar.

---

## Como usar

### Catálogo

**Ler catálogo agora** busca todos os produtos no Bling e grava no banco. Roda em
segundo plano — pode fechar a página; a faixa no topo mostra o andamento quando
você voltar. Leva minutos, porque o Bling limita a três consultas por segundo.

### Contas

Cada conta é um vendedor: `mlHmd1`, `spHmd1`, etc. Guarda o **imposto**, a
**antecipação**, o custo de **embalagem** e a **promoção padrão** sugerida a
anúncios novos. Dá para renomear, criar e apagar.

O tipo — Mercado Livre ou Shopee — não é editável. Trocá-lo mudaria quantas
modalidades a conta tem e deixaria anúncios órfãos de uma modalidade que deixou
de existir. Para mudar de marketplace, crie outra conta.

### Fretes

A tabela que o Mercado Livre cobra, cruzando faixa de peso com faixa de preço.
Todos os valores são editáveis no lugar.

O **simulador** no topo mostra a regra agindo: informe peso e preço e ele
destaca na tabela a célula escolhida. Uma matriz de 232 números não explica
sozinha por que um produto pagou o que pagou.

O **reajuste** multiplica a tabela inteira de uma vez, que é como a
transportadora anuncia mudança — corrigir 232 células à mão é onde se erra uma
sem notar.

**Editar faixas** abre os rótulos e os limites. Fica fechado por padrão: mexer
ali muda em que célula cada produto cai, o que é mais consequente do que
corrigir um valor.

### Precificação

Escolha a conta no topo. A lista traz o catálogo e os anúncios juntos, com
filtros por SKU, produto, marca e situação (todos, anunciados, não anunciados).

No Mercado Livre cada produto tem **Clássico** e **Premium** lado a lado; na
Shopee, um anúncio só.

**Preço e Margem são os dois lados da mesma conta.** Digite o preço e a margem
aparece; digite a margem e o preço se ajusta ao valor necessário para alcançá-la.

Os cartões no topo mostram a margem média — **ponderada pelo custo**, ou seja,
lucro total dividido por custo total — e quantos anúncios vendem abaixo do custo.
Eles respeitam os filtros e cobrem a conta inteira, não só a página visível.

---

## Passo a passo da instalação

### 1. Instalar as ferramentas

| Ferramenta | Para quê | Onde baixar |
|---|---|---|
| Node.js (versão 20 ou maior) | rodar o projeto | nodejs.org |
| Git | enviar o código para o GitHub | git-scm.com |
| Editor de código | ver e editar arquivos | code.visualstudio.com |

### 2. Colocar o projeto no seu computador

Abra o terminal dentro da pasta do projeto e rode:

```bash
npm install
```

### 3. Criar o aplicativo no Bling

Em `developer.bling.com.br`, crie um aplicativo:

- **Escopos:** marque apenas `Produtos`
- **Link de redirecionamento:** deixe em branco — você preenche no passo 6

Guarde o **client ID** e o **client secret**. O secret costuma aparecer uma vez só.

Se você mantém um ambiente de teste além do de produção, **crie um aplicativo
para cada um**. O Bling aceita um único link de redirecionamento por aplicativo,
e apontá-lo para um ambiente deixa o outro sem conseguir reautorizar.

### 4. Enviar o código para o GitHub

Crie um repositório **privado**. O código não tem segredos dentro dele, mas
privado é o padrão certo para ferramenta interna.

```bash
git init
git add .
git commit -m "Primeira versão"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

### 5. Publicar no Railway

Em `railway.app`, entre com a conta do GitHub.

1. **New Project** → **Deploy from GitHub repo** → escolha o repositório.
2. **New** → **Database** → **Add PostgreSQL**.
3. Abra o serviço da aplicação → **Variables** e confirme que `DATABASE_URL`
   está **lá**, e não só no bloco do Postgres. Se não estiver, crie-a como
   referência ao serviço do banco — o valor fica `${{Postgres.DATABASE_URL}}`.
   Sem isso a montagem falha com `DATABASE_URL não configurada`.
4. **Settings** → **Networking** → **Generate Domain**. A porta é **8080** — é a
   que o Railway injeta e a que o projeto obedece. Apontar o domínio para 3000
   devolve 502 com o deploy verde e a aplicação saudável.
5. Ainda em **Variables**, adicione:

   | Variável | Valor |
   |---|---|
   | `BLING_CLIENT_ID` | o client ID do passo 3 |
   | `BLING_CLIENT_SECRET` | o client secret do passo 3 |
   | `APP_URL` | o endereço gerado, **com `https://`** e sem barra no final |
   | `APP_PASSWORD` | uma senha forte, que você inventa agora |

### 6. Fechar o ciclo do OAuth

Volte ao aplicativo no Bling e preencha o **link de redirecionamento** com:

```
https://SEU-ENDERECO.up.railway.app/bling/callback
```

Tem que ser idêntico ao que a aplicação envia — que é o `APP_URL` com
`/bling/callback` no fim. Um `https://` faltando na variável derruba a
autorização com `redirect_uri_mismatch`, um erro que não diz onde está o
problema.

### 7. Usar

Abra o endereço, entre com a senha de `APP_PASSWORD` e clique em **Conectar
conta do Bling**. Depois, em **Catálogo**, clique em **Ler catálogo agora**.

Sem o catálogo lido a precificação abre e aceita preços, mas lucro e margem
ficam vazios — não há custo nem peso de onde calcular.

---

## Rodar no seu computador (opcional)

Crie um arquivo `.env` na raiz, copiando o modelo de `.env.example`. Você
precisa de um Postgres local ou pode apontar `DATABASE_URL` para o banco do
Railway.

```bash
npm run dev
```

Com `APP_URL=http://localhost:3000`, cadastre também
`http://localhost:3000/bling/callback` como link de redirecionamento no Bling.

---

## Conferir o cálculo

```bash
npm run verificar
```

Compara o motor de precificação com valores conhecidos da planilha que deu
origem a ele — custo final, frete, comissão, sobra, lucro e margem —, confere o
caminho inverso (margem alvo → preço), os casos de borda e a leitura de números
e endereços digitados à mão.

Rode isso depois de mexer em `lib/precificacao.ts`. Um erro de cálculo não
aparece na tela: ele só grava um preço errado.

---

## Como o código está organizado

```
app/
  page.tsx                    entrada, com atalhos e indicadores
  catalogo/                   painel de leitura do Bling
  precificacao/               tabela de preços
  contas/                     cadastro das contas de anúncio
  fretes/                     tabela de frete: consulta, edição e simulação
  entrar/                     tela de senha
  bling/authorize|callback/   ida e volta do OAuth
  api/                        status, leitura, produtos, precificação, login
components/
  Navegacao.tsx               barra do topo, comum a todas as páginas
  Painel.tsx                  interface do catálogo
  Precificacao.tsx            interface da tabela de preços
  Contas.tsx                  interface das contas
  Fretes.tsx                  interface da tabela de frete
lib/
  precificacao.ts             o cálculo, em funções puras
  precificacaoDb.ts           tabelas prec_*, carga inicial e consultas
  freteInicial.ts             tabela de frete: 29 faixas de peso x 8 de preço
  dadosIniciais.json          itens, contas e anúncios extraídos da planilha
  numero.ts                   leitura e escrita de números em português
  appUrl.ts                   normalização da APP_URL
  bling.ts                    OAuth, renovação de token e fila de requisições
  sync.ts                     motor da leitura do catálogo
  db.ts                       conexão e criação das tabelas
  auth.ts                     sessão por senha única
scripts/
  verificar-precificacao.ts   as conferências de `npm run verificar`
```

As tabelas são criadas sozinhas na primeira execução, e as tabelas `prec_*`
nascem carregadas com os dados da planilha original. Não há passo de migração
manual.

---

## Manutenção

**Trocar o client secret do Bling:** gere o novo no painel do Bling, atualize
`BLING_CLIENT_SECRET` no Railway e reconecte a conta pelo painel.

**Leitura automática:** no Railway, **New** → **Cron Job** apontando para o
serviço, com agendamento `0 6 * * *`, chamando `POST /api/sync`. Exige incluir a
autenticação por senha na chamada.

**A leitura falhou:** a mensagem aparece em vermelho no topo do painel e o log
completo fica na aba **Deployments** → **View Logs** do Railway.

**Produto sem custo:** aparece marcado na precificação. Ou o SKU não existe no
catálogo do Bling (kits e itens descontinuados costumam cair aqui), ou o produto
está sem preço de custo cadastrado no Bling.
