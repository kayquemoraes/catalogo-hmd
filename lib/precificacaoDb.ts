/**
 * Persistência do módulo de precificação.
 *
 * As tabelas nascem prefixadas com `prec_` para deixar claro, olhando o banco,
 * o que pertence a este módulo e o que é do catálogo. Nada aqui altera as
 * tabelas que a leitura do Bling já usa: os custos e pesos continuam vindo de
 * `produtos`, ligados por `codigo`.
 *
 * Na primeira execução as tabelas são carregadas com os dados extraídos da
 * planilha original — parâmetros, tabela de frete, canais e anúncios.
 */

import { sql, ensureSchema } from "./db";
import { TABELA_FRETE_INICIAL } from "./freteInicial";
import type { Canal, Parametros, TabelaFrete, TipoCanal } from "./precificacao";
import dados from "./dadosIniciais.json";

export type CanalSalvo = Canal & {
  id: number;
  nome: string;
  /** Sugerido aos anúncios novos; o cálculo usa a promoção de cada anúncio. */
  promocaoPadrao: number;
  ativo: boolean;
};

export type EntradaCanal = {
  nome: string;
  tipo: TipoCanal;
  imposto: number;
  antecipacao: number;
  embalagem: number;
  promocaoPadrao: number;
};

export type Modalidade = "classico" | "premium" | "unico";

let pronto: Promise<void> | null = null;

/** Cria e carrega as tabelas do módulo. Seguro para chamar sempre. */
export function ensureSchemaPrecificacao(): Promise<void> {
  if (!pronto) {
    // Guardar a promessa evita repetir o trabalho a cada requisição, mas uma
    // promessa recusada guardada é pior: o erro se repetiria em toda chamada
    // seguinte até alguém reiniciar o processo, mesmo já resolvida a causa.
    pronto = migrar().catch((erro) => {
      pronto = null;
      throw erro;
    });
  }
  return pronto;
}

async function migrar() {
  await ensureSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS prec_parametros (
      id            int PRIMARY KEY DEFAULT 1,
      imposto       numeric(8,5) NOT NULL DEFAULT 0,
      antecipacao   numeric(8,5) NOT NULL DEFAULT 0,
      embalagem     numeric(12,4) NOT NULL DEFAULT 0,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT prec_parametros_linha_unica CHECK (id = 1)
    )
  `;

  // Os três custos da conta são valores, não interruptores: zero é o desligado.
  // `promocao` aqui é só o padrão sugerido aos anúncios novos — quem manda no
  // cálculo é a promoção de cada anúncio.
  await sql`
    CREATE TABLE IF NOT EXISTS prec_canais (
      id          serial PRIMARY KEY,
      nome        text NOT NULL UNIQUE,
      tipo        text NOT NULL CHECK (tipo IN ('ml', 'shopee')),
      imposto     numeric(8,5) NOT NULL DEFAULT 0,
      antecipacao numeric(8,5) NOT NULL DEFAULT 0,
      embalagem   numeric(12,4) NOT NULL DEFAULT 0,
      promocao    numeric(8,5) NOT NULL DEFAULT 0,
      ativo       boolean NOT NULL DEFAULT true,
      criado_em   timestamptz NOT NULL DEFAULT now()
    )
  `;

  // As faixas guardam a ordem explicitamente: é por posição que a linha de peso
  // encontra a coluna de preço, e não pelo texto do rótulo. Era o texto que
  // fazia a planilha errar com produtos acima de 150 kg.
  await sql`
    CREATE TABLE IF NOT EXISTS prec_faixas_peso (
      ordem  int PRIMARY KEY,
      rotulo text NOT NULL,
      ate    numeric(12,4)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS prec_faixas_preco (
      ordem  int PRIMARY KEY,
      rotulo text NOT NULL,
      ate    numeric(12,4)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS prec_frete (
      peso_ordem  int NOT NULL REFERENCES prec_faixas_peso(ordem) ON DELETE CASCADE,
      preco_ordem int NOT NULL REFERENCES prec_faixas_preco(ordem) ON DELETE CASCADE,
      valor       numeric(12,4) NOT NULL DEFAULT 0,
      PRIMARY KEY (peso_ordem, preco_ordem)
    )
  `;

  // Nome curto e marca não existem no Bling: são a aba `custo` da planilha.
  await sql`
    CREATE TABLE IF NOT EXISTS prec_itens (
      sku        text PRIMARY KEY,
      nome_curto text,
      marca      text
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS prec_anuncios (
      id            serial PRIMARY KEY,
      canal_id      int NOT NULL REFERENCES prec_canais(id) ON DELETE CASCADE,
      sku           text NOT NULL,
      modalidade    text NOT NULL CHECK (modalidade IN ('classico', 'premium', 'unico')),
      comissao      numeric(8,5) NOT NULL DEFAULT 0,
      taxa_fixa     numeric(12,4) NOT NULL DEFAULT 0,
      preco         numeric(12,4) NOT NULL DEFAULT 0,
      promocao      numeric(8,5) NOT NULL DEFAULT 0,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      UNIQUE (canal_id, sku, modalidade)
    )
  `;

  await migrarParaValoresPorConta();

  await sql`
    CREATE INDEX IF NOT EXISTS prec_anuncios_canal_idx ON prec_anuncios (canal_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS prec_anuncios_sku_idx ON prec_anuncios (lower(sku))
  `;

  await carregarDadosIniciais();
}

/**
 * Converte o formato antigo, em que a conta guardava "tem antecipação? sim/não"
 * e o percentual morava numa tabela global, para o formato em que cada conta
 * guarda o próprio número.
 *
 * Roda uma vez só: o gatilho é a presença das colunas booleanas, que são
 * apagadas ao final. Manter as duas formas conviveria com o mesmo defeito que
 * a planilha tinha — dois lugares dizendo a mesma coisa, um deles desatualizado.
 */
async function migrarParaValoresPorConta() {
  // CREATE TABLE IF NOT EXISTS não altera tabela que já existe: num banco
  // criado pela versão anterior as colunas novas não nascem sozinhas e
  // precisam ser acrescentadas aqui.
  await sql`ALTER TABLE prec_canais ADD COLUMN IF NOT EXISTS antecipacao numeric(8,5) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE prec_canais ADD COLUMN IF NOT EXISTS embalagem numeric(12,4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE prec_canais ADD COLUMN IF NOT EXISTS promocao numeric(8,5) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE prec_anuncios ADD COLUMN IF NOT EXISTS promocao numeric(8,5) NOT NULL DEFAULT 0`;

  const colunas = await sql<{ column_name: string }[]>`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'prec_canais'
       AND column_name IN ('antecipacao_ativa', 'embalagem_ativa')
  `;
  const presentes = new Set(colunas.map((c) => c.column_name));
  if (presentes.size === 0) return;

  const [padroes] = await sql<{ antecipacao: string; embalagem: string }[]>`
    SELECT antecipacao, embalagem FROM prec_parametros WHERE id = 1
  `;
  const antecipacaoPadrao = Number(padroes?.antecipacao ?? 0);
  const embalagemPadrao = Number(padroes?.embalagem ?? 0);

  if (presentes.has("antecipacao_ativa")) {
    await sql`
      UPDATE prec_canais
         SET antecipacao = CASE WHEN antecipacao_ativa THEN ${antecipacaoPadrao}::numeric ELSE 0 END
    `;
    await sql`ALTER TABLE prec_canais DROP COLUMN antecipacao_ativa`;
  }

  if (presentes.has("embalagem_ativa")) {
    await sql`
      UPDATE prec_canais
         SET embalagem = CASE WHEN embalagem_ativa THEN ${embalagemPadrao}::numeric ELSE 0 END
    `;
    await sql`ALTER TABLE prec_canais DROP COLUMN embalagem_ativa`;

    // A promoção era da conta inteira; passa a ser de cada anúncio, herdando
    // o valor que estava valendo até agora.
    await sql`
      UPDATE prec_anuncios a
         SET promocao = c.promocao
        FROM prec_canais c
       WHERE c.id = a.canal_id
    `;
  }
}

/**
 * Carrega os dados da planilha uma única vez. Cada bloco confere se já existe
 * conteúdo antes de inserir, então rodar de novo não duplica nem sobrescreve
 * o que o usuário já ajustou.
 */
async function carregarDadosIniciais() {
  const [{ total: temParametros }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM prec_parametros
  `;
  if (temParametros === 0) {
    const p = dados.parametros;
    await sql`
      INSERT INTO prec_parametros (id, imposto, antecipacao, embalagem)
      VALUES (1, ${p.imposto}, ${p.antecipacao}, ${p.embalagem})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  const [{ total: temFaixas }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM prec_faixas_peso
  `;
  if (temFaixas === 0) {
    await sql`
      INSERT INTO prec_faixas_peso ${sql(
        TABELA_FRETE_INICIAL.faixasPeso.map((f, i) => ({
          ordem: i,
          rotulo: f.rotulo,
          ate: f.ate,
        })),
        "ordem",
        "rotulo",
        "ate"
      )}
    `;
    await sql`
      INSERT INTO prec_faixas_preco ${sql(
        TABELA_FRETE_INICIAL.faixasPreco.map((f, i) => ({
          ordem: i,
          rotulo: f.rotulo,
          ate: f.ate,
        })),
        "ordem",
        "rotulo",
        "ate"
      )}
    `;

    const fretes = TABELA_FRETE_INICIAL.valores.flatMap((linha, peso) =>
      linha.map((valor, preco) => ({ peso_ordem: peso, preco_ordem: preco, valor }))
    );
    await sql`
      INSERT INTO prec_frete ${sql(fretes, "peso_ordem", "preco_ordem", "valor")}
    `;
  }

  const [{ total: temItens }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM prec_itens
  `;
  if (temItens === 0 && dados.itens.length > 0) {
    // Em lotes para não estourar o limite de parâmetros do Postgres.
    for (let i = 0; i < dados.itens.length; i += 500) {
      const lote = dados.itens.slice(i, i + 500).map((it) => ({
        sku: it.sku,
        nome_curto: it.nomeCurto,
        marca: it.marca,
      }));
      await sql`
        INSERT INTO prec_itens ${sql(lote, "sku", "nome_curto", "marca")}
        ON CONFLICT (sku) DO NOTHING
      `;
    }
  }

  const [{ total: temCanais }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM prec_canais
  `;
  if (temCanais === 0) {
    for (const canal of dados.canais) {
      // Se duas instâncias subirem ao mesmo tempo, uma delas perde a corrida no
      // nome único. Em vez de estourar, ela reaproveita o canal que já existe.
      await sql`
        INSERT INTO prec_canais (nome, tipo, imposto, antecipacao, embalagem, promocao)
        VALUES (
          ${canal.nome},
          ${canal.tipo},
          ${canal.imposto},
          ${canal.antecipacaoAtiva ? dados.parametros.antecipacao : 0},
          ${canal.embalagemAtiva ? dados.parametros.embalagem : 0},
          ${canal.promocao}
        )
        ON CONFLICT (nome) DO NOTHING
      `;
      const [criado] = await sql<{ id: number }[]>`
        SELECT id FROM prec_canais WHERE nome = ${canal.nome}
      `;
      if (!criado) continue;

      for (let i = 0; i < canal.anuncios.length; i += 500) {
        const lote = canal.anuncios.slice(i, i + 500).map((a) => ({
          canal_id: criado.id,
          sku: a.sku,
          modalidade: a.modalidade,
          comissao: a.comissao,
          taxa_fixa: a.taxaFixa,
          preco: a.preco,
          promocao: canal.promocao,
        }));
        await sql`
          INSERT INTO prec_anuncios ${sql(
            lote,
            "canal_id",
            "sku",
            "modalidade",
            "comissao",
            "taxa_fixa",
            "preco",
            "promocao"
          )}
          ON CONFLICT (canal_id, sku, modalidade) DO NOTHING
        `;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Valores sugeridos ao criar uma conta nova. */
export async function lerParametros(): Promise<Parametros> {
  await ensureSchemaPrecificacao();
  const [linha] = await sql<
    { imposto: string; antecipacao: string; embalagem: string }[]
  >`SELECT imposto, antecipacao, embalagem FROM prec_parametros WHERE id = 1`;
  return {
    imposto: Number(linha?.imposto ?? 0),
    antecipacao: Number(linha?.antecipacao ?? 0),
    embalagem: Number(linha?.embalagem ?? 0),
  };
}

export async function listarCanais(): Promise<CanalSalvo[]> {
  await ensureSchemaPrecificacao();
  const linhas = await sql<
    {
      id: number;
      nome: string;
      tipo: TipoCanal;
      imposto: string;
      antecipacao: string;
      embalagem: string;
      promocao: string;
      ativo: boolean;
    }[]
  >`
    SELECT id, nome, tipo, imposto, antecipacao, embalagem, promocao, ativo
      FROM prec_canais
     ORDER BY tipo, nome
  `;
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    tipo: l.tipo,
    imposto: Number(l.imposto),
    antecipacao: Number(l.antecipacao),
    embalagem: Number(l.embalagem),
    promocaoPadrao: Number(l.promocao),
    ativo: l.ativo,
  }));
}

export async function criarCanal(entrada: EntradaCanal): Promise<CanalSalvo> {
  await ensureSchemaPrecificacao();
  const [linha] = await sql<{ id: number }[]>`
    INSERT INTO prec_canais (nome, tipo, imposto, antecipacao, embalagem, promocao)
    VALUES (
      ${entrada.nome},
      ${entrada.tipo},
      ${entrada.imposto},
      ${entrada.antecipacao},
      ${entrada.embalagem},
      ${entrada.promocaoPadrao}
    )
    RETURNING id
  `;
  return { ...entrada, id: linha.id, ativo: true };
}

/**
 * O tipo (Mercado Livre ou Shopee) fica de fora de propósito: trocá-lo mudaria
 * quantas modalidades a conta tem, deixando anúncios órfãos de uma modalidade
 * que deixou de existir. Para mudar de marketplace, cria-se outra conta.
 */
export async function atualizarCanal(
  id: number,
  entrada: Omit<EntradaCanal, "tipo">
): Promise<void> {
  await ensureSchemaPrecificacao();
  await sql`
    UPDATE prec_canais
       SET nome = ${entrada.nome},
           imposto = ${entrada.imposto},
           antecipacao = ${entrada.antecipacao},
           embalagem = ${entrada.embalagem},
           promocao = ${entrada.promocaoPadrao}
     WHERE id = ${id}
  `;
}

export async function removerCanal(id: number): Promise<void> {
  await ensureSchemaPrecificacao();
  await sql`DELETE FROM prec_canais WHERE id = ${id}`;
}

export async function carregarTabelaFrete(): Promise<TabelaFrete> {
  await ensureSchemaPrecificacao();

  const peso = await sql<{ ordem: number; rotulo: string; ate: string | null }[]>`
    SELECT ordem, rotulo, ate FROM prec_faixas_peso ORDER BY ordem
  `;
  const preco = await sql<{ ordem: number; rotulo: string; ate: string | null }[]>`
    SELECT ordem, rotulo, ate FROM prec_faixas_preco ORDER BY ordem
  `;
  const fretes = await sql<
    { peso_ordem: number; preco_ordem: number; valor: string }[]
  >`SELECT peso_ordem, preco_ordem, valor FROM prec_frete`;

  const valores = peso.map(() => preco.map(() => 0));
  for (const f of fretes) {
    if (valores[f.peso_ordem]) valores[f.peso_ordem][f.preco_ordem] = Number(f.valor);
  }

  return {
    faixasPeso: peso.map((f) => ({ rotulo: f.rotulo, ate: f.ate === null ? null : Number(f.ate) })),
    faixasPreco: preco.map((f) => ({ rotulo: f.rotulo, ate: f.ate === null ? null : Number(f.ate) })),
    valores,
  };
}

export type Situacao = "todos" | "anunciados" | "disponiveis";

export type LinhaTabela = {
  sku: string;
  nome: string;
  marca: string | null;
  /** Falso quando o SKU não existe no catálogo lido do Bling. */
  temProduto: boolean;
  custo: number;
  peso: number;
  saldo: number;
  anunciado: boolean;
  anuncios: {
    anuncioId: number;
    modalidade: Modalidade;
    comissao: number;
    taxaFixa: number;
    preco: number;
    promocao: number;
  }[];
};

/**
 * A lista da tela: catálogo e anúncios reunidos numa coisa só.
 *
 * O conjunto de SKUs é a união de dois lados — os produtos vindos do Bling e
 * os anúncios do canal. O segundo lado importa porque a planilha trazia SKUs
 * que não existem mais no catálogo (kits, itens descontinuados) e eles
 * precisam continuar visíveis, marcados, em vez de sumir sem aviso.
 */
export async function listarLinhas(
  canalId: number,
  opcoes: { busca?: string; situacao?: Situacao; pagina?: number; porPagina?: number } = {}
): Promise<{ linhas: LinhaTabela[]; total: number; pagina: number; porPagina: number }> {
  await ensureSchemaPrecificacao();

  const termo = (opcoes.busca ?? "").trim().toLowerCase();
  const situacao = opcoes.situacao ?? "todos";
  const porPagina = Math.min(200, Math.max(10, opcoes.porPagina ?? 50));
  const pagina = Math.max(1, opcoes.pagina ?? 1);
  const offset = (pagina - 1) * porPagina;
  const filtro = `%${termo}%`;

  const base = sql`
    SELECT b.sku,
           coalesce(i.nome_curto, b.nome, b.sku) AS nome,
           i.marca,
           b.tem_produto,
           b.preco_custo,
           b.peso_liquido,
           b.saldo,
           EXISTS (
             SELECT 1 FROM prec_anuncios a
              WHERE a.canal_id = ${canalId} AND a.sku = b.sku
           ) AS anunciado
      FROM (
            SELECT p.codigo AS sku, p.nome, p.preco_custo, p.peso_liquido, p.saldo,
                   true AS tem_produto
              FROM produtos p
             WHERE p.codigo IS NOT NULL AND p.codigo <> ''
            UNION
            SELECT a.sku, NULL::text, NULL::numeric, NULL::numeric, NULL::numeric,
                   false AS tem_produto
              FROM prec_anuncios a
             WHERE a.canal_id = ${canalId}
               AND NOT EXISTS (
                     SELECT 1 FROM produtos p
                      WHERE p.codigo = a.sku AND p.codigo IS NOT NULL
                   )
           ) b
      LEFT JOIN prec_itens i ON i.sku = b.sku
  `;

  const condSituacao =
    situacao === "anunciados"
      ? sql`WHERE anunciado`
      : situacao === "disponiveis"
        ? sql`WHERE NOT anunciado`
        : sql`WHERE true`;

  const condBusca = termo
    ? sql`AND (lower(nome) LIKE ${filtro} OR lower(sku) LIKE ${filtro} OR lower(coalesce(marca, '')) LIKE ${filtro})`
    : sql``;

  const linhas = await sql<
    {
      sku: string;
      nome: string;
      marca: string | null;
      tem_produto: boolean;
      preco_custo: string | null;
      peso_liquido: string | null;
      saldo: string | null;
      anunciado: boolean;
    }[]
  >`
    WITH tudo AS (${base})
    SELECT * FROM tudo
    ${condSituacao} ${condBusca}
    ORDER BY anunciado DESC, nome
    LIMIT ${porPagina} OFFSET ${offset}
  `;

  const [{ total }] = await sql<{ total: number }[]>`
    WITH tudo AS (${base})
    SELECT count(*)::int AS total FROM tudo
    ${condSituacao} ${condBusca}
  `;

  const skus = linhas.map((l) => l.sku);
  const anuncios = skus.length
    ? await sql<
        {
          id: number;
          sku: string;
          modalidade: Modalidade;
          comissao: string;
          taxa_fixa: string;
          preco: string;
          promocao: string;
        }[]
      >`
        SELECT id, sku, modalidade, comissao, taxa_fixa, preco, promocao
          FROM prec_anuncios
         WHERE canal_id = ${canalId} AND sku IN ${sql(skus)}
      `
    : [];

  const porSku = new Map<string, LinhaTabela["anuncios"]>();
  for (const a of anuncios) {
    const lista = porSku.get(a.sku) ?? [];
    lista.push({
      anuncioId: a.id,
      modalidade: a.modalidade,
      comissao: Number(a.comissao),
      taxaFixa: Number(a.taxa_fixa),
      preco: Number(a.preco),
      promocao: Number(a.promocao),
    });
    porSku.set(a.sku, lista);
  }

  return {
    linhas: linhas.map((l) => ({
      sku: l.sku,
      nome: l.nome,
      marca: l.marca,
      temProduto: l.tem_produto,
      custo: Number(l.preco_custo ?? 0),
      peso: Number(l.peso_liquido ?? 0),
      saldo: Number(l.saldo ?? 0),
      anunciado: l.anunciado,
      anuncios: porSku.get(l.sku) ?? [],
    })),
    total,
    pagina,
    porPagina,
  };
}

/** Quantos produtos o catálogo do Bling tem neste banco. Zero = nunca foi lido. */
export async function totalDoCatalogo(): Promise<number> {
  await ensureSchemaPrecificacao();
  const [{ total }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM produtos
  `;
  return total;
}


// ---------------------------------------------------------------------------
// Escrita de anúncios
// ---------------------------------------------------------------------------

/** Comissões padrão de cada modalidade, usadas ao adicionar um produto. */
const COMISSAO_PADRAO: Record<Modalidade, { comissao: number; taxaFixa: number }> = {
  classico: { comissao: 0.11, taxaFixa: 0 },
  premium: { comissao: 0.16, taxaFixa: 0 },
  unico: { comissao: 0.14, taxaFixa: 2 },
};

export async function adicionarAoCanal(canalId: number, sku: string): Promise<void> {
  await ensureSchemaPrecificacao();
  const [canal] = await sql<{ tipo: TipoCanal; promocao: string }[]>`
    SELECT tipo, promocao FROM prec_canais WHERE id = ${canalId}
  `;
  if (!canal) throw new Error("Canal não encontrado.");

  const modalidades: Modalidade[] =
    canal.tipo === "ml" ? ["classico", "premium"] : ["unico"];

  for (const modalidade of modalidades) {
    const padrao = COMISSAO_PADRAO[modalidade];
    await sql`
      INSERT INTO prec_anuncios (canal_id, sku, modalidade, comissao, taxa_fixa, preco, promocao)
      VALUES (${canalId}, ${sku}, ${modalidade}, ${padrao.comissao}, ${padrao.taxaFixa}, 0,
              ${Number(canal.promocao)})
      ON CONFLICT (canal_id, sku, modalidade) DO NOTHING
    `;
  }
}

export async function salvarAnuncio(
  anuncioId: number,
  campos: { comissao?: number; taxaFixa?: number; preco?: number; promocao?: number }
): Promise<void> {
  await ensureSchemaPrecificacao();
  const [atual] = await sql<
    { comissao: string; taxa_fixa: string; preco: string; promocao: string }[]
  >`
    SELECT comissao, taxa_fixa, preco, promocao FROM prec_anuncios WHERE id = ${anuncioId}
  `;
  if (!atual) throw new Error("Anúncio não encontrado.");

  await sql`
    UPDATE prec_anuncios
       SET comissao = ${campos.comissao ?? Number(atual.comissao)},
           taxa_fixa = ${campos.taxaFixa ?? Number(atual.taxa_fixa)},
           preco = ${campos.preco ?? Number(atual.preco)},
           promocao = ${campos.promocao ?? Number(atual.promocao)},
           atualizado_em = now()
     WHERE id = ${anuncioId}
  `;
}

export async function removerDoCanal(canalId: number, sku: string): Promise<void> {
  await ensureSchemaPrecificacao();
  await sql`DELETE FROM prec_anuncios WHERE canal_id = ${canalId} AND sku = ${sku}`;
}
