import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { trocarCodigo } from "@/lib/bling";
import { enderecoDaAplicacao } from "@/lib/appUrl";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const jar = await cookies();
  const esperado = jar.get("bling_state")?.value;
  jar.delete("bling_state");

  // Se APP_URL estiver ausente ou torta, ainda dá para voltar pela origem
  // desta própria requisição — melhor que estourar em cima do usuário.
  let base: string;
  try {
    base = enderecoDaAplicacao();
  } catch {
    base = new URL(req.url).origin;
  }

  if (!esperado || state !== esperado) {
    return NextResponse.redirect(`${base}/?erro=state`);
  }
  if (!code) {
    return NextResponse.redirect(`${base}/?erro=sem-codigo`);
  }

  try {
    await trocarCodigo(code);
    return NextResponse.redirect(`${base}/?conectado=1`);
  } catch (erro) {
    console.error("Falha ao trocar o código:", erro);
    return NextResponse.redirect(`${base}/?erro=token`);
  }
}
