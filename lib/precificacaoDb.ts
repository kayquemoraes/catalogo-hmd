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
  ativo: boolean;
};

export type Modalidade = "classico" | "premium" | "unico";

export type AnuncioSalvo = {
  id: number;
  canalId: number;
  sku: string;
  modalidade: Modalidade;
  comissao: number;
  taxaFixa: number;
  preco: number;
};

let pronto: Promise<void> | null = null;

/** Cria e carrega as tabelas do módulo. Seguro para chamar sempre. */
export function ensureSchemaPrecificacao(): Promise<void> {
  if (!pronto) pronto = migrar();
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

  await sql`
    CREATE TABLE IF NOT EXISTS prec_canais (
      id                serial PRIMARY KEY,
      nome              text NOT NULL UNIQUE,
      tipo              text NOT NULL CHECK (tipo IN ('ml', 'shopee')),
      imposto           numeric(8,5) NOT NULL DEFAULT 0,
      antecipacao_ativa boolean NOT NULL DEFAULT false,
      embalagem_ativa   boolean NOT NULL DEFAULT true,
      promocao          numeric(8,5) NOT NULL DEFAULT 0,
      ativo             boolean NOT NULL DEFAULT true,
      criado_em         timestamptz NOT NULL DEFAULT now()
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
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      UNIQUE (canal_id, sku, modalidade)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS prec_anuncios_canal_idx ON prec_anuncios (canal_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS prec_anuncios_sku_idx ON prec_anuncios (lower(sku))
  `;

  await carregarDadosIniciais();
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
        INSERT INTO prec_canais (nome, tipo, imposto, antecipacao_ativa, embalagem_ativa, promocao)
        VALUES (
          ${canal.nome},
          ${canal.tipo},
          ${canal.imposto},
          ${canal.antecipacaoAtiva},
          ${canal.embalagemAtiva},
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
        }));
        await sql`
          INSERT INTO prec_anuncios ${sql(
            lote,
            "canal_id",
            "sku",
            "modalidade",
            "comissao",
            "taxa_fixa",
            "preco"
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

export async function salvarParametros(p: Parametros): Promise<void> {
  await ensureSchemaPrecificacao();
  await sql`
    INSERT INTO prec_parametros (id, imposto, antecipacao, embalagem, atualizado_em)
    VALUES (1, ${p.imposto}, ${p.antecipacao}, ${p.embalagem}, now())
    ON CONFLICT (id) DO UPDATE
       SET imposto = EXCLUDED.imposto,
           antecipacao = EXCLUDED.antecipacao,
           embalagem = EXCLUDED.embalagem,
           atualizado_em = now()
  `;
}

export async function listarCanais(): Promise<CanalSalvo[]> {
  await ensureSchemaPrecificacao();
  const linhas = await sql<
    {
      id: number;
      nome: string;
      tipo: TipoCanal;
      imposto: string;
      antecipacao_ativa: boolean;
      embalagem_ativa: boolean;
      promocao: string;
      ativo: boolean;
    }[]
  >`
    SELECT id, nome, tipo, imposto, antecipacao_ativa, embalagem_ativa, promocao, ativo
      FROM prec_canais
     ORDER BY tipo, nome
  `;
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    tipo: l.tipo,
    imposto: Number(l.imposto),
    antecipacaoAtiva: l.antecipacao_ativa,
    embalagemAtiva: l.embalagem_ativa,
    promocao: Number(l.promocao),
    ativo: l.ativo,
  }));
}

export async function criarCanal(entrada: {
  nome: string;
  tipo: TipoCanal;
  imposto: number;
  antecipacaoAtiva: boolean;
  embalagemAtiva: boolean;
  promocao: number;
}): Promise<CanalSalvo> {
  await ensureSchemaPrecificacao();
  const [linha] = await sql<{ id: number }[]>`
    INSERT INTO prec_canais (nome, tipo, imposto, antecipacao_ativa, embalagem_ativa, promocao)
    VALUES (
      ${entrada.nome},
      ${entrada.tipo},
      ${entrada.imposto},
      ${entrada.antecipacaoAtiva},
      ${entrada.embalagemAtiva},
      ${entrada.promocao}
    )
    RETURNING id
  `;
  return { ...entrada, id: linha.id, ativo: true };
}

export async function atualizarCanal(
  id: number,
  entrada: {
    imposto: number;
    antecipacaoAtiva: boolean;
    embalagemAtiva: boolean;
    promocao: number;
  }
): Promise<void> {
  await ensureSchemaPrecificacao();
  await sql`
    UPDATE prec_canais
       SET imposto = ${entrada.imposto},
           antecipacao_ativa = ${entrada.antecipacaoAtiva},
           embalagem_ativa = ${entrada.embalagemAtiva},
           promocao = ${entrada.promocao}
     WHERE id = ${id}
  `;
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

export type LinhaAnuncio = {
  anuncioId: number;
  sku: string;
  modalidade: Modalidade;
  comissao: number;
  taxaFixa: number;
  preco: number;
  /** Nome curto vindo da planilha; cai para o nome do Bling quando vazio. */
  nome: string;
  marca: string | null;
  /** Falso quando o SKU não existe no catálogo lido do Bling. */
  temProduto: boolean;
  custo: number;
  peso: number;
  saldo: number;
};

/** Os anúncios de um canal, já cruzados com o catálogo do Bling. */
export async function listarAnuncios(canalId: number): Promise<LinhaAnuncio[]> {
  await ensureSchemaPrecificacao();
  const linhas = await sql<
    {
      id: number;
      sku: string;
      modalidade: Modalidade;
      comissao: string;
      taxa_fixa: string;
      preco: string;
      nome_curto: string | null;
      marca: string | null;
      nome: string | null;
      preco_custo: string | null;
      peso_liquido: string | null;
      saldo: string | null;
    }[]
  >`
    SELECT a.id, a.sku, a.modalidade, a.comissao, a.taxa_fixa, a.preco,
           i.nome_curto, i.marca,
           p.nome, p.preco_custo, p.peso_liquido, p.saldo
      FROM prec_anuncios a
      LEFT JOIN prec_itens i ON i.sku = a.sku
      LEFT JOIN produtos  p ON p.codigo = a.sku
     WHERE a.canal_id = ${canalId}
     ORDER BY coalesce(i.nome_curto, p.nome, a.sku), a.modalidade
  `;

  return linhas.map((l) => ({
    anuncioId: l.id,
    sku: l.sku,
    modalidade: l.modalidade,
    comissao: Number(l.comissao),
    taxaFixa: Number(l.taxa_fixa),
    preco: Number(l.preco),
    nome: l.nome_curto || l.nome || l.sku,
    marca: l.marca,
    temProduto: l.nome !== null,
    custo: Number(l.preco_custo ?? 0),
    peso: Number(l.peso_liquido ?? 0),
    saldo: Number(l.saldo ?? 0),
  }));
}

export type ProdutoDisponivel = {
  sku: string;
  nome: string;
  marca: string | null;
  custo: number;
  peso: number;
  saldo: number;
};

/** Produtos do catálogo que ainda não têm anúncio neste canal. */
export async function listarDisponiveis(
  canalId: number,
  busca: string,
  limite = 50
): Promise<{ produtos: ProdutoDisponivel[]; total: number }> {
  await ensureSchemaPrecificacao();
  const termo = busca.trim().toLowerCase();
  const filtro = `%${termo}%`;

  // Duas versões da consulta em vez de um booleano solto no WHERE: o Postgres
  // às vezes não consegue inferir o tipo de um parâmetro isolado. É também o
  // formato já usado em /api/products.
  type Linha = {
    codigo: string;
    nome: string;
    marca: string | null;
    preco_custo: string;
    peso_liquido: string;
    saldo: string;
  };

  const linhas = termo
    ? await sql<Linha[]>`
        SELECT p.codigo, coalesce(i.nome_curto, p.nome) AS nome, i.marca,
               p.preco_custo, p.peso_liquido, p.saldo
          FROM produtos p
          LEFT JOIN prec_itens i ON i.sku = p.codigo
         WHERE p.codigo IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1 FROM prec_anuncios a
                  WHERE a.canal_id = ${canalId} AND a.sku = p.codigo
               )
           AND (lower(p.nome) LIKE ${filtro}
                OR lower(p.codigo) LIKE ${filtro}
                OR lower(coalesce(i.nome_curto, '')) LIKE ${filtro})
         ORDER BY nome
         LIMIT ${limite}
      `
    : await sql<Linha[]>`
        SELECT p.codigo, coalesce(i.nome_curto, p.nome) AS nome, i.marca,
               p.preco_custo, p.peso_liquido, p.saldo
          FROM produtos p
          LEFT JOIN prec_itens i ON i.sku = p.codigo
         WHERE p.codigo IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1 FROM prec_anuncios a
                  WHERE a.canal_id = ${canalId} AND a.sku = p.codigo
               )
         ORDER BY nome
         LIMIT ${limite}
      `;

  const [{ total }] = termo
    ? await sql<{ total: number }[]>`
        SELECT count(*)::int AS total
          FROM produtos p
          LEFT JOIN prec_itens i ON i.sku = p.codigo
         WHERE p.codigo IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1 FROM prec_anuncios a
                  WHERE a.canal_id = ${canalId} AND a.sku = p.codigo
               )
           AND (lower(p.nome) LIKE ${filtro}
                OR lower(p.codigo) LIKE ${filtro}
                OR lower(coalesce(i.nome_curto, '')) LIKE ${filtro})
      `
    : await sql<{ total: number }[]>`
        SELECT count(*)::int AS total
          FROM produtos p
          LEFT JOIN prec_itens i ON i.sku = p.codigo
         WHERE p.codigo IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1 FROM prec_anuncios a
                  WHERE a.canal_id = ${canalId} AND a.sku = p.codigo
               )
      `;

  return {
    produtos: linhas.map((l) => ({
      sku: l.codigo,
      nome: l.nome,
      marca: l.marca,
      custo: Number(l.preco_custo),
      peso: Number(l.peso_liquido),
      saldo: Number(l.saldo),
    })),
    total,
  };
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
  const [canal] = await sql<{ tipo: TipoCanal }[]>`
    SELECT tipo FROM prec_canais WHERE id = ${canalId}
  `;
  if (!canal) throw new Error("Canal não encontrado.");

  const modalidades: Modalidade[] =
    canal.tipo === "ml" ? ["classico", "premium"] : ["unico"];

  for (const modalidade of modalidades) {
    const padrao = COMISSAO_PADRAO[modalidade];
    await sql`
      INSERT INTO prec_anuncios (canal_id, sku, modalidade, comissao, taxa_fixa, preco)
      VALUES (${canalId}, ${sku}, ${modalidade}, ${padrao.comissao}, ${padrao.taxaFixa}, 0)
      ON CONFLICT (canal_id, sku, modalidade) DO NOTHING
    `;
  }
}

export async function salvarAnuncio(
  anuncioId: number,
  campos: { comissao?: number; taxaFixa?: number; preco?: number }
): Promise<void> {
  await ensureSchemaPrecificacao();
  const [atual] = await sql<{ comissao: string; taxa_fixa: string; preco: string }[]>`
    SELECT comissao, taxa_fixa, preco FROM prec_anuncios WHERE id = ${anuncioId}
  `;
  if (!atual) throw new Error("Anúncio não encontrado.");

  await sql`
    UPDATE prec_anuncios
       SET comissao = ${campos.comissao ?? Number(atual.comissao)},
           taxa_fixa = ${campos.taxaFixa ?? Number(atual.taxa_fixa)},
           preco = ${campos.preco ?? Number(atual.preco)},
           atualizado_em = now()
     WHERE id = ${anuncioId}
  `;
}

export async function removerDoCanal(canalId: number, sku: string): Promise<void> {
  await ensureSchemaPrecificacao();
  await sql`DELETE FROM prec_anuncios WHERE canal_id = ${canalId} AND sku = ${sku}`;
}
