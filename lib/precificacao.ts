/**
 * Motor de cálculo de preços para anúncios de marketplace.
 *
 * Traduz a lógica que vivia na planilha (abas `custo`, `freteTabela`,
 * `mlHmd*` e `spHmd*`) para funções puras: entram números, saem números.
 * Não conhece banco de dados nem tela, e por isso pode ser conferido
 * linha a linha contra os valores que a planilha já produzia.
 *
 * Duas diferenças propositais em relação à planilha, ambas correções de
 * erro (decididas com o usuário):
 *
 * 1. A faixa de frete do PREMIUM usa o preço do próprio Premium. Na aba
 *    mlHmd2 a fórmula apontava para o preço do Clássico.
 * 2. Produtos acima de 150 kg encontram sua linha na tabela de frete. Na
 *    planilha o texto gerado ("Maior que 150 kg") não batia com o rótulo
 *    da tabela ("Mais de 150 kg") e o PROCV falhava. Aqui as faixas são
 *    casadas por posição, não por texto, então o problema não existe.
 */

export type TipoCanal = "ml" | "shopee";

/**
 * Valores sugeridos ao criar uma conta nova. Depois que a conta existe, quem
 * manda é ela: cada uma guarda os próprios números.
 */
export type Parametros = {
  /** Alíquota sobre o preço de venda, ex.: 0.1 para 10%. */
  imposto: number;
  /** Taxa de antecipação de recebíveis, ex.: 0.038 para 3,8%. */
  antecipacao: number;
  /** Custo fixo de embalagem, em reais. */
  embalagem: number;
};

/**
 * Uma conta de vendedor, do ponto de vista do cálculo: só números já
 * resolvidos, sem interruptor nenhum. Zero é o desligado.
 *
 * O que a tela oferece como "ligar/desligar antecipação" vive em `ContaSalva`
 * e chega aqui já traduzido por `comoCanal`. Assim existe um único caminho
 * entre o que está guardado e o que entra na conta — a planilha tinha dois, e
 * foi por isso que a mlHmd2 passou a tributar 0% sem ninguém notar.
 */
export type Canal = {
  tipo: TipoCanal;
  /** Alíquota própria da conta. CNPJ diferente tributa diferente. */
  imposto: number;
  /** Antecipação de recebíveis desta conta. 0 = não antecipa. */
  antecipacao: number;
  /** Custo de embalagem desta conta, em reais. 0 = não cobra. */
  embalagem: number;
};

/**
 * A conta como ela é guardada: a taxa de antecipação convive com um
 * interruptor, para que desligar a antecipação não apague o percentual e
 * obrigue a redigitá-lo ao religar.
 *
 * O cálculo nunca vê esse interruptor — recebe sempre a taxa já resolvida por
 * `comoCanal`. Era exatamente a convivência de um "Sim/Não" com um percentual
 * guardado noutro lugar que fazia a planilha divergir de si mesma; aqui os dois
 * vivem na mesma linha e só existe um caminho entre eles.
 */
export type ContaSalva = Omit<Canal, "antecipacao"> & {
  antecipacao: number;
  antecipacaoAtiva: boolean;
};

/** Resolve a conta guardada no canal que o cálculo entende. */
export function comoCanal(conta: ContaSalva): Canal {
  return {
    tipo: conta.tipo,
    imposto: conta.imposto,
    embalagem: conta.embalagem,
    antecipacao: conta.antecipacaoAtiva ? conta.antecipacao : 0,
  };
}

/** O que é específico de um anúncio: comissão, preço e promoção. */
export type Anuncio = {
  /** Percentual cobrado pelo marketplace, ex.: 0.11 (Clássico) ou 0.16 (Premium). */
  comissao: number;
  /** Valor fixo somado à comissão. No Mercado Livre costuma ser 0; na Shopee, 2. */
  taxaFixa: number;
  preco: number;
  /** Desconto promocional deste anúncio, ex.: 0.05 para 5%. */
  promocao: number;
};

export type Produto = {
  /** Preço de custo vindo do Bling, com IPI e ICMS. */
  custo: number;
  /** Peso líquido em quilos, vindo do Bling. */
  peso: number;
};

export type Faixa = {
  rotulo: string;
  /** Limite superior da faixa. `null` na última, que não tem teto. */
  ate: number | null;
};

/** A `freteTabela`: faixas de peso nas linhas, faixas de preço nas colunas. */
export type TabelaFrete = {
  faixasPeso: Faixa[];
  faixasPreco: Faixa[];
  /** valores[indiceDoPeso][indiceDoPreco] */
  valores: number[][];
};

export type Resultado = {
  custoFinal: number;
  faixaPeso: string | null;
  faixaPreco: string | null;
  frete: number;
  comissao: number;
  sobra: number;
  lucro: number;
  /** Lucro dividido pelo custo do produto. `null` quando o custo é zero. */
  margem: number | null;
};

// ---------------------------------------------------------------------------
// Faixas
// ---------------------------------------------------------------------------

/**
 * Localiza a faixa que contém o valor. A comparação é `valor <= ate`, igual
 * à cadeia de SEs da planilha, e a última faixa absorve tudo que sobra.
 */
export function indiceDaFaixa(faixas: Faixa[], valor: number): number {
  for (let i = 0; i < faixas.length; i++) {
    const teto = faixas[i].ate;
    if (teto === null || valor <= teto) return i;
  }
  return faixas.length - 1;
}

/**
 * A planilha classifica peso com `<` e preço com `<=`. A diferença só
 * aparece quando o valor cai exatamente no limite, mas basta um produto de
 * 0,5 kg para mudar a linha escolhida — então a distinção é preservada.
 */
export function indiceDaFaixaPeso(faixas: Faixa[], peso: number): number {
  for (let i = 0; i < faixas.length; i++) {
    const teto = faixas[i].ate;
    if (teto === null || peso < teto) return i;
  }
  return faixas.length - 1;
}

/** Consulta o frete cruzando a faixa de peso com a faixa de preço. */
export function buscarFrete(
  tabela: TabelaFrete,
  peso: number,
  preco: number
): { valor: number; faixaPeso: string; faixaPreco: string } {
  const linha = indiceDaFaixaPeso(tabela.faixasPeso, peso);
  const coluna = indiceDaFaixa(tabela.faixasPreco, preco);
  return {
    valor: tabela.valores[linha]?.[coluna] ?? 0,
    faixaPeso: tabela.faixasPeso[linha]?.rotulo ?? "",
    faixaPreco: tabela.faixasPreco[coluna]?.rotulo ?? "",
  };
}

// ---------------------------------------------------------------------------
// Cálculo direto: tenho o preço, quero saber o lucro
// ---------------------------------------------------------------------------

/**
 * Fração do preço que sobra depois da comissão percentual e do desconto de
 * promoção. Aparece nas duas direções do cálculo, por isso vive sozinha.
 */
function fatorLiquido(comissao: number, promocao: number): number {
  return 1 - comissao * (1 - promocao) - promocao;
}

export function calcular(
  produto: Produto,
  canal: Canal,
  anuncio: Anuncio,
  tabela: TabelaFrete | null
): Resultado {
  const preco = anuncio.preco;
  const promocao = anuncio.promocao;

  const frete =
    canal.tipo === "ml" && tabela
      ? buscarFrete(tabela, produto.peso, preco)
      : { valor: 0, faixaPeso: "", faixaPreco: "" };

  const custoFinal = produto.custo + canal.imposto * preco + canal.embalagem;
  const comissao = anuncio.comissao * (preco - preco * promocao) + anuncio.taxaFixa;
  const sobra = preco - comissao - frete.valor - promocao * preco;
  const lucro = sobra - sobra * canal.antecipacao - custoFinal;

  return {
    custoFinal,
    faixaPeso: canal.tipo === "ml" ? frete.faixaPeso : null,
    faixaPreco: canal.tipo === "ml" ? frete.faixaPreco : null,
    frete: frete.valor,
    comissao,
    sobra,
    lucro,
    margem: produto.custo > 0 ? lucro / produto.custo : null,
  };
}

// ---------------------------------------------------------------------------
// Cálculo inverso: quero uma margem, qual preço cobrar
// ---------------------------------------------------------------------------

export type PrecoSugerido = {
  preco: number;
  resultado: Resultado;
  /**
   * Verdadeiro quando nenhum preço cai exatamente na faixa de frete que ele
   * mesmo determina. Acontece nos degraus da tabela: o preço necessário para
   * a margem pedida pula por cima de uma faixa inteira. O valor devolvido é
   * o mais próximo possível, e a tela deve avisar.
   */
  aproximado: boolean;
};

/**
 * Resolve o preço que entrega a margem desejada.
 *
 * Isolando o preço na fórmula do lucro chega-se a:
 *
 *   preço = [ custo·(1+margem) + embalagem + (taxaFixa + frete)·(1−antecipação) ]
 *           ────────────────────────────────────────────────────────────────────
 *                        fatorLíquido·(1−antecipação) − imposto
 *
 * O frete, porém, depende da faixa em que o próprio preço cai — é uma escada,
 * não uma reta. Por isso o cálculo é feito uma vez para cada faixa de preço e
 * fica a solução que for coerente com a faixa que a gerou.
 */
export function precoParaMargem(
  produto: Produto,
  canal: Canal,
  anuncio: Omit<Anuncio, "preco">,
  tabela: TabelaFrete | null,
  margemAlvo: number
): PrecoSugerido | null {
  const embalagem = canal.embalagem;
  const antecipacao = canal.antecipacao;
  const k = fatorLiquido(anuncio.comissao, anuncio.promocao);

  const denominador = k * (1 - antecipacao) - canal.imposto;
  // Comissão, promoção e imposto consomem tudo que entra: não existe preço
  // que feche a conta, por maior que seja.
  if (denominador <= 0) return null;

  const precoCom = (frete: number) =>
    (produto.custo * (1 + margemAlvo) +
      embalagem +
      (anuncio.taxaFixa + frete) * (1 - antecipacao)) /
    denominador;

  const monta = (preco: number, aproximado: boolean): PrecoSugerido => ({
    preco,
    resultado: calcular(produto, canal, { ...anuncio, preco }, tabela),
    aproximado,
  });

  if (canal.tipo !== "ml" || !tabela) {
    const preco = precoCom(0);
    return preco > 0 ? monta(preco, false) : null;
  }

  const linha = indiceDaFaixaPeso(tabela.faixasPeso, produto.peso);
  const candidatos: { preco: number; distancia: number }[] = [];

  for (let coluna = 0; coluna < tabela.faixasPreco.length; coluna++) {
    const frete = tabela.valores[linha]?.[coluna] ?? 0;
    const preco = precoCom(frete);
    if (preco <= 0) continue;

    const piso = coluna === 0 ? 0 : (tabela.faixasPreco[coluna - 1].ate ?? 0);
    const teto = tabela.faixasPreco[coluna].ate;

    // Coerente: o preço encontrado cai na mesma faixa cujo frete o gerou.
    if (preco > piso && (teto === null || preco <= teto)) {
      return monta(preco, false);
    }

    const distancia = preco <= piso ? piso - preco : preco - (teto ?? preco);
    candidatos.push({ preco, distancia });
  }

  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => a.distancia - b.distancia);
  return monta(candidatos[0].preco, true);
}
