import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  await ensureSchema();

  const { searchParams } = new URL(req.url);
  const busca = (searchParams.get("q") ?? "").trim().toLowerCase();
  const pagina = Math.max(1, Number(searchParams.get("pagina") ?? 1));
  const porPagina = 50;
  const offset = (pagina - 1) * porPagina;

  const filtro = `%${busca}%`;

  const linhas = busca
    ? await sql`
        SELECT id, codigo, nome, preco_custo, peso_liquido, saldo
          FROM produtos
         WHERE lower(nome) LIKE ${filtro} OR lower(coalesce(codigo, '')) LIKE ${filtro}
         ORDER BY nome
         LIMIT ${porPagina} OFFSET ${offset}
      `
    : await sql`
        SELECT id, codigo, nome, preco_custo, peso_liquido, saldo
          FROM produtos
         ORDER BY nome
         LIMIT ${porPagina} OFFSET ${offset}
      `;

  const [{ total }] = busca
    ? await sql<{ total: number }[]>`
        SELECT count(*)::int AS total FROM produtos
         WHERE lower(nome) LIKE ${filtro} OR lower(coalesce(codigo, '')) LIKE ${filtro}
      `
    : await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM produtos`;

  return NextResponse.json({
    produtos: linhas.map((l) => ({
      id: Number(l.id),
      codigo: l.codigo ?? "",
      nome: l.nome,
      precoCusto: Number(l.preco_custo),
      pesoLiquido: Number(l.peso_liquido),
      saldo: Number(l.saldo),
    })),
    total,
    pagina,
    porPagina,
  });
}
