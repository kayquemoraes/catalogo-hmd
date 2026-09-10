import { redirect } from "next/navigation";
import { temSessao } from "@/lib/auth";
import Precificacao from "@/components/Precificacao";

export const dynamic = "force-dynamic";

export default async function Pagina() {
  if (!(await temSessao())) redirect("/entrar");
  return <Precificacao />;
}
