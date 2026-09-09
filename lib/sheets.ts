import { JWT } from "google-auth-library";
import { sql, ensureSchema } from "./db";

/**
 * Escreve o catálogo na planilha do Google Sheets.
 *
 * A autenticação usa uma conta de serviço: uma identidade do Google que
 * pertence ao aplicativo, não a uma pessoa. Não expira e não depende de
 * ninguém estar logado. Em troca, a planilha precisa ser compartilhada
 * com o e-mail dessa conta, como Editor.
 */

const ESCOPO = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

/** Colunas gravadas, na ordem. A linha 1 da planilha é o cabeçalho. */
const COLUNAS = ["Código", "ID Bling", "Nome", "Preço de custo", "Peso líquido", "Saldo"];

function credenciais(): { email: string; chave: string } {
  const bruto = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!bruto) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT não configurada.");
  }

  // Aceita o JSON direto ou codificado em base64. O base64 evita que as
  // quebras de linha da chave privada sejam corrompidas pelo painel de
  // variáveis de ambiente — é o formato recomendado.
  const texto = bruto.trim().startsWith("{")
    ? bruto
    : Buffer.from(bruto, "base64").toString("utf8");

  let dados: { client_email?: string; private_key?: string };
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT não é um JSON válido. Confira se o conteúdo foi colado inteiro."
    );
  }

  if (!dados.client_email || !dados.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT não contém client_email e private_key.");
  }

  return {
    email: dados.client_email,
    chave: dados.private_key.replace(/\\n/g, "\n"),
  };
}

export function contaDeServico(): string | null {
  try {
    return credenciais().email;
  } catch {
    return null;
  }
}

function planilhaId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error("SPREADSHEET_ID não configurada.");
  return id;
}

function aba(): string {
  return process.env.SHEET_NAME || "dataBase";
}

async function token(): Promise<string> {
  const { email, chave } = credenciais();
  const cliente = new JWT({ email, key: chave, scopes: [ESCOPO] });
  const { token } = await cliente.getAccessToken();
  if (!token) throw new Error("Não foi possível autenticar na conta de serviço do Google.");
  return token;
}

async function chamar(caminho: string, init: RequestInit): Promise<unknown> {
  const acesso = await token();

  const resposta = await fetch(`${SHEETS}/${planilhaId()}${caminho}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${acesso}`,
      "Content-Type": "application/json",
    },
  });

  if (!resposta.ok) {
    const texto = await resposta.text();

    if (resposta.status === 403) {
      throw new Error(
        `Sem permissão na planilha. Compartilhe-a como Editor com ${contaDeServico()}.`
      );
    }
    if (resposta.status === 404) {
      throw new Error("Planilha não encontrada. Confira o SPREADSHEET_ID.");
    }
    if (resposta.status === 400 && texto.includes("Unable to parse range")) {
      throw new Error(`A aba "${aba()}" não existe na planilha.`);
    }

    throw new Error(`Google Sheets respondeu ${resposta.status}: ${texto.slice(0, 200)}`);
  }

  return resposta.json();
}

/**
 * Substitui o conteúdo da aba pelos produtos guardados no banco.
 * Grava o cabeçalho, limpa o que havia e escreve tudo de uma vez.
 */
export async function escreverPlanilha(): Promise<{ linhas: number }> {
  await ensureSchema();

  const produtos = await sql`
    SELECT codigo, id, nome, preco_custo, peso_liquido, saldo
      FROM produtos ORDER BY nome
  `;

  if (produtos.length === 0) {
    throw new Error("Não há produtos no banco. Leia o catálogo do Bling antes.");
  }

  const valores = produtos.map((p) => [
    p.codigo ?? "",
    Number(p.id),
    p.nome,
    Number(p.preco_custo),
    Number(p.peso_liquido),
    Number(p.saldo),
  ]);

  const nome = aba();

  // Limpa a área de dados antiga para não deixar sobras quando o catálogo encolhe
  await chamar(`/values/${encodeURIComponent(`${nome}!A1:F`)}:clear`, { method: "POST" });

  await chamar(
    `/values/${encodeURIComponent(`${nome}!A1`)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [COLUNAS, ...valores] }),
    }
  );

  await sql`
    INSERT INTO estado (chave, valor, atualizado_em)
    VALUES ('planilha_escrita_em', ${new Date().toISOString()}, now())
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()
  `;

  return { linhas: valores.length };
}

export async function planilhaEscritaEm(): Promise<string | null> {
  await ensureSchema();
  const [linha] = await sql<{ valor: string }[]>`
    SELECT valor FROM estado WHERE chave = 'planilha_escrita_em'
  `;
  return linha?.valor ?? null;
}

export function urlDaPlanilha(): string | null {
  const id = process.env.SPREADSHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

export function planilhaConfigurada(): boolean {
  return Boolean(process.env.SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT);
}
