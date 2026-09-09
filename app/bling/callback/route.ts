import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { trocarCodigo } from "@/lib/bling";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const jar = await cookies();
  const esperado = jar.get("bling_state")?.value;
  jar.delete("bling_state");

  const base = process.env.APP_URL ?? new URL(req.url).origin;

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
