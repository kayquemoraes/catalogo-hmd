import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { situacaoAtual } from "@/lib/sync";
import { contaConectada } from "@/lib/bling";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  await ensureSchema();

  const [leitura, conectado, [contagem]] = await Promise.all([
    situacaoAtual(),
    contaConectada(),
    sql<{ total: number; atualizado: Date | null }[]>`
      SELECT count(*)::int AS total, max(visto_em) AS atualizado FROM produtos
    `,
  ]);

  return NextResponse.json({
    conectado,
    leitura,
    total: contagem?.total ?? 0,
    atualizadoEm: contagem?.atualizado?.toISOString() ?? null,
  });
}
