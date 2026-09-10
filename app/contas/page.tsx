import { redirect } from "next/navigation";
import { temSessao } from "@/lib/auth";
import Navegacao from "@/components/Navegacao";
import Contas from "@/components/Contas";

export const dynamic = "force-dynamic";

export default async function Pagina() {
  if (!(await temSessao())) redirect("/entrar");
  return (
    <>
      <Navegacao ativo="contas" />
      <Contas />
    </>
  );
}
