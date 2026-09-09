"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Entrar() {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  const entrar = async () => {
    setEnviando(true);
    setErro(null);

    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });

    if (r.ok) {
      router.push("/");
      router.refresh();
    } else {
      setErro("Senha incorreta.");
      setEnviando(false);
    }
  };

  return (
    <div className="bg-ink text-paper flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="text-sage-deep text-sm">Catálogo HMD</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Entrar no painel
        </h1>

        <input
          type="password"
          value={senha}
          autoFocus
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && senha && entrar()}
          placeholder="Senha de acesso"
          className="border-ink-line bg-ink-soft placeholder:text-sage-deep/60 mt-7 w-full rounded-[6px] border px-3.5 py-3 text-sm"
        />

        {erro && <p className="text-alert mt-3 text-sm">{erro}</p>}

        <button
          onClick={entrar}
          disabled={!senha || enviando}
          className="bg-signal mt-4 w-full rounded-[6px] px-4 py-3 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}
