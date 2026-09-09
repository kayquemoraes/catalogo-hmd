import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE = "hmd_sessao";

function assinatura(): string {
  const senha = process.env.APP_PASSWORD;
  if (!senha) throw new Error("APP_PASSWORD não configurada.");
  return createHmac("sha256", senha).update("sessao-valida").digest("hex");
}

export function conferirSenha(enviada: string): boolean {
  const senha = process.env.APP_PASSWORD ?? "";
  const a = Buffer.from(enviada);
  const b = Buffer.from(senha);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function abrirSessao() {
  const jar = await cookies();
  jar.set(COOKIE, assinatura(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function temSessao(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value === assinatura();
}
