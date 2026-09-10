import Link from "next/link";

export type Secao = "inicio" | "catalogo" | "precificacao" | "contas" | "fretes";

const ITENS: { id: Secao; rotulo: string; href: string }[] = [
  { id: "inicio", rotulo: "Início", href: "/" },
  { id: "catalogo", rotulo: "Catálogo", href: "/catalogo" },
  { id: "precificacao", rotulo: "Precificação", href: "/precificacao" },
  { id: "contas", rotulo: "Contas", href: "/contas" },
  { id: "fretes", rotulo: "Fretes", href: "/fretes" },
];

/**
 * Barra única no topo de todas as páginas. Substitui os links "voltar" que
 * cada tela tinha por conta própria: o caminho de volta é sempre o mesmo,
 * está sempre no mesmo lugar, e mostra onde você está.
 */
export default function Navegacao({ ativo }: { ativo: Secao }) {
  return (
    <nav className="bg-ink text-paper border-ink-line sticky top-0 z-40 border-b">
      <div className="mx-auto flex max-w-[1800px] items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="py-3.5 text-sm font-semibold tracking-tight">
          HMD
        </Link>

        <ul className="flex items-center gap-1">
          {ITENS.map((item) => {
            const selecionado = item.id === ativo;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={selecionado ? "page" : undefined}
                  className={`-mb-px inline-block border-b-2 px-3 py-3.5 text-sm transition-colors ${
                    selecionado
                      ? "border-signal text-paper font-medium"
                      : "text-sage-deep hover:text-paper border-transparent"
                  }`}
                >
                  {item.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
