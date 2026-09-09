import { sql, ensureSchema } from "./db";

/**
 * O Bling usa dois endereços diferentes, e trocá-los é a causa mais comum
 * de integração que "não funciona":
 *   OAUTH — login e emissão de tokens
 *   API   — todos os dados
 */
const OAUTH = "https://www.bling.com.br/Api/v3/oauth";
const API = "https://api.bling.com.br/Api/v3";

export const ESCOPOS = "produtos";

function config() {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    throw new Error(
      "Faltam variáveis de ambiente: BLING_CLIENT_ID, BLING_CLIENT_SECRET ou APP_URL."
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, "")}/bling/callback`,
  };
}

export function urlDeAutorizacao(state: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: ESCOPOS,
    state,
  });
  return `${OAUTH}/authorize?${params}`;
}

// ------------------------------------------------------------
// Tokens
// ------------------------------------------------------------

type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

async function pedirTokens(corpo: Record<string, string>): Promise<Tokens> {
  const { clientId, clientSecret } = config();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resposta = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(corpo),
  });

  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`Bling recusou a emissão de token (${resposta.status}): ${texto.slice(0, 300)}`);
  }
  return JSON.parse(texto) as Tokens;
}

async function guardar(t: Tokens) {
  const expiraEm = new Date(Date.now() + (t.expires_in ?? 21600) * 1000);
  await sql`
    INSERT INTO bling_tokens (id, access_token, refresh_token, expires_at, updated_at)
    VALUES (1, ${t.access_token}, ${t.refresh_token}, ${expiraEm}, now())
    ON CONFLICT (id) DO UPDATE SET
      access_token  = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at    = EXCLUDED.expires_at,
      updated_at    = now()
  `;
}

/** Troca o código do callback pelos tokens e os guarda. */
export async function trocarCodigo(code: string): Promise<void> {
  await ensureSchema();
  const { redirectUri } = config();
  const tokens = await pedirTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  await guardar(tokens);
}

export async function contaConectada(): Promise<boolean> {
  await ensureSchema();
  const [linha] = await sql`SELECT 1 FROM bling_tokens WHERE id = 1`;
  return Boolean(linha);
}

export async function desconectar(): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM bling_tokens WHERE id = 1`;
}

const MARGEM_MS = 5 * 60 * 1000;

/**
 * Devolve um access token válido, renovando pela data de expiração.
 * O Bling troca o refresh token a cada renovação, então o novo valor
 * precisa ser gravado — guardar só o access token quebra a conexão
 * na renovação seguinte.
 */
async function tokenValido(): Promise<string> {
  await ensureSchema();

  const [linha] = await sql<
    { access_token: string; refresh_token: string; expires_at: Date }[]
  >`SELECT access_token, refresh_token, expires_at FROM bling_tokens WHERE id = 1`;

  if (!linha) {
    throw new Error("Conta do Bling não conectada.");
  }

  if (linha.expires_at.getTime() - MARGEM_MS > Date.now()) {
    return linha.access_token;
  }

  const tokens = await pedirTokens({
    grant_type: "refresh_token",
    refresh_token: linha.refresh_token,
  });
  await guardar(tokens);
  return tokens.access_token;
}

// ------------------------------------------------------------
// Controle de taxa
// ------------------------------------------------------------

/**
 * O Bling permite 3 requisições por segundo. Este portão serializa todas
 * as chamadas e garante o espaçamento mínimo, o que é mais confiável do
 * que espalhar `sleep` pelo código.
 */
const ESPACAMENTO_MS = 380;
let ultimaChamada = 0;
let fila: Promise<unknown> = Promise.resolve();

function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
  const proxima = fila.then(async () => {
    const espera = ultimaChamada + ESPACAMENTO_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaChamada = Date.now();
    return tarefa();
  });
  fila = proxima.catch(() => undefined);
  return proxima;
}

// ------------------------------------------------------------
// Chamadas de dados
// ------------------------------------------------------------

async function buscar(caminho: string, tentativas = 4): Promise<unknown> {
  let espera = 1000;

  for (let i = 0; i < tentativas; i++) {
    const resposta = await naFila(async () => {
      const token = await tokenValido();
      return fetch(`${API}${caminho}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    });

    if (resposta.ok) return resposta.json();

    const recuperavel = resposta.status === 429 || resposta.status >= 500;
    if (!recuperavel || i === tentativas - 1) {
      const texto = await resposta.text();
      throw new Error(`Bling respondeu ${resposta.status} em ${caminho}: ${texto.slice(0, 200)}`);
    }

    const retryAfter = Number(resposta.headers.get("Retry-After") ?? 0);
    await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : espera));
    espera *= 2;
  }

  throw new Error(`Falha ao chamar ${caminho}.`);
}

export type ProdutoLista = {
  id: number;
  codigo?: string | null;
  nome: string;
  precoCusto?: number | null;
  estoque?: { saldoVirtualTotal?: number | null } | null;
};

export async function listarProdutos(
  pagina: number,
  limite = 100
): Promise<ProdutoLista[]> {
  const dados = (await buscar(`/produtos?pagina=${pagina}&limite=${limite}`)) as {
    data?: ProdutoLista[];
  };
  return dados.data ?? [];
}

/** O peso líquido não vem na listagem; exige uma consulta por produto. */
export async function pesoLiquido(produtoId: number): Promise<number> {
  try {
    const dados = (await buscar(`/produtos/${produtoId}`)) as {
      data?: { pesoLiquido?: number | null };
    };
    return Number(dados.data?.pesoLiquido ?? 0);
  } catch {
    return 0;
  }
}
