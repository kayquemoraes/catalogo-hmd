import { redirect } from "next/navigation";
import { temSessao } from "@/lib/auth";
import Navegacao from "@/components/Navegacao";
import Painel from "@/components/Painel";

export const dynamic = "force-dynamic";

export default async function Pagina() {
  if (!(await temSessao())) redirect("/entrar");
  return (
    <>
      <Navegacao ativo="catalogo" />
      <Painel />
    </>
  );
}
