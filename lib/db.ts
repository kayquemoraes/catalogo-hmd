import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

const connection = process.env.DATABASE_URL;
if (!connection) {
  throw new Error("DATABASE_URL não configurada.");
}

// Reaproveita a conexão entre recarregamentos em desenvolvimento
export const sql =
  global.__sql ??
  postgres(connection, {
    max: 5,
    ssl: connection.includes("localhost") ? false : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") global.__sql = sql;

let ready: Promise<void> | null = null;

/** Cria as tabelas na primeira chamada. Seguro para rodar sempre. */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    // Uma promessa recusada não pode ficar memorizada: o erro voltaria em
    // todas as chamadas seguintes, mesmo já resolvida a causa, até o
    // processo reiniciar.
    ready = migrate().catch((erro) => {
      ready = null;
      throw erro;
    });
  }
  return ready;
}

async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS bling_tokens (
      id            int PRIMARY KEY DEFAULT 1,
      access_token  text NOT NULL,
      refresh_token text NOT NULL,
      expires_at    timestamptz NOT NULL,
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT linha_unica CHECK (id = 1)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS produtos (
      id            bigint PRIMARY KEY,
      codigo        text,
      nome          text NOT NULL,
      preco_custo   numeric(14,4) NOT NULL DEFAULT 0,
      peso_liquido  numeric(14,4) NOT NULL DEFAULT 0,
      saldo         numeric(14,4) NOT NULL DEFAULT 0,
      visto_em      timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS leituras (
      id           serial PRIMARY KEY,
      situacao     text NOT NULL,
      iniciada_em  timestamptz NOT NULL DEFAULT now(),
      encerrada_em timestamptz,
      processados  int NOT NULL DEFAULT 0,
      pagina       int NOT NULL DEFAULT 0,
      erro         text
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS estado (
      chave         text PRIMARY KEY,
      valor         text NOT NULL,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS produtos_nome_idx ON produtos (lower(nome))
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS produtos_codigo_idx ON produtos (lower(codigo))
  `;

  // Uma leitura que ficou 'rodando' só pode ser resquício de um reinício
  await sql`
    UPDATE leituras
       SET situacao = 'interrompida',
           encerrada_em = now(),
           erro = 'A aplicação foi reiniciada durante a leitura.'
     WHERE situacao = 'rodando'
  `;
}
