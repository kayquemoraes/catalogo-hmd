/**
 * Confere o motor de cálculo contra os números que a planilha já produzia.
 *
 * Cada caso abaixo foi lido diretamente das células da planilha original
 * (abas mlHmd1 e spHmd1, linhas 10 a 14). Se o motor divergir de qualquer
 * um deles, a lógica foi traduzida errado.
 *
 * Rodar com:  npm run verificar
 */

import {
  calcular,
  comoCanal,
  precoParaMargem,
  type Canal,
  type Produto,
} from "../lib/precificacao.ts";
import { TABELA_FRETE_INICIAL as FRETE } from "../lib/freteInicial.ts";
import { enderecoDaAplicacao, enderecoDeCallback } from "../lib/appUrl.ts";
import { emPercentual, emReais, limparNumerico, paraNumero } from "../lib/numero.ts";

const ML: Canal = {
  tipo: "ml",
  imposto: 0.1, // custo!B3
  antecipacao: 0, // mlHmd1!A6 = "Não"
  embalagem: 1.5, // mlHmd1!C6 = "Sim" -> custo!B7
};

const SHOPEE: Canal = {
  tipo: "shopee",
  imposto: 0.1,
  antecipacao: 0.038, // spHmd1!A6 = "Sim" -> custo!B5
  embalagem: 1.5,
};

type Caso = {
  nome: string;
  produto: Produto;
  canal: Canal;
  anuncio: { comissao: number; taxaFixa: number; preco: number; promocao: number };
  esperado: {
    custoFinal: number;
    frete: number;
    comissao: number;
    sobra: number;
    lucro: number;
    margem: number;
  };
};

const CASOS: Caso[] = [
  {
    nome: "mlHmd1 L10 CLÁSSICO — Conversor x3",
    produto: { custo: 9.9675, peso: 0.2 },
    canal: ML,
    anuncio: { comissao: 0.11, taxaFixa: 0, preco: 32, promocao: 0 },
    esperado: {
      custoFinal: 14.6675,
      frete: 6.55,
      comissao: 3.52,
      sobra: 21.93,
      lucro: 7.2625,
      margem: 0.7286180085,
    },
  },
  {
    nome: "mlHmd1 L10 PREMIUM — Conversor x3",
    produto: { custo: 9.9675, peso: 0.2 },
    canal: ML,
    anuncio: { comissao: 0.16, taxaFixa: 0, preco: 35, promocao: 0 },
    esperado: {
      custoFinal: 14.9675,
      frete: 6.55,
      comissao: 5.6,
      sobra: 22.85,
      lucro: 7.8825,
      margem: 0.7908201655,
    },
  },
  {
    nome: "mlHmd1 L11 CLÁSSICO — Remote",
    produto: { custo: 24.8, peso: 0.2 },
    canal: ML,
    anuncio: { comissao: 0.1, taxaFixa: 0, preco: 43, promocao: 0 },
    esperado: {
      custoFinal: 30.6,
      frete: 6.55,
      comissao: 4.3,
      sobra: 32.15,
      lucro: 1.55,
      margem: 0.0625,
    },
  },
  {
    nome: "mlHmd1 L12 CLÁSSICO — VOLT USB (faixa R$ 49 a 78,99)",
    produto: { custo: 33.822, peso: 0.2 },
    canal: ML,
    anuncio: { comissao: 0.1, taxaFixa: 0, preco: 61, promocao: 0 },
    esperado: {
      custoFinal: 41.422,
      frete: 7.75,
      comissao: 6.1,
      sobra: 47.15,
      lucro: 5.728,
      margem: 0.1693572231,
    },
  },
  {
    nome: "mlHmd1 L14 CLÁSSICO — 2 Nanoblack (faixa R$ 79 a 99,99)",
    produto: { custo: 44, peso: 0.2 },
    canal: ML,
    anuncio: { comissao: 0.1, taxaFixa: 0, preco: 96, promocao: 0 },
    esperado: {
      custoFinal: 55.1,
      frete: 12.35,
      comissao: 9.6,
      sobra: 74.05,
      lucro: 18.95,
      margem: 0.4306818182,
    },
  },
  {
    // Prova a correção do erro da mlHmd2: o Premium usa a SUA faixa de preço.
    // Aqui o Clássico está em R$ 79-99,99 e o Premium em R$ 100-119,99.
    nome: "mlHmd1 L14 PREMIUM — 2 Nanoblack (faixa própria, R$ 100 a 119,99)",
    produto: { custo: 44, peso: 0.2 },
    canal: ML,
    anuncio: { comissao: 0.15, taxaFixa: 0, preco: 103, promocao: 0 },
    esperado: {
      custoFinal: 55.8,
      frete: 14.35,
      comissao: 15.45,
      sobra: 73.2,
      lucro: 17.4,
      margem: 0.3954545455,
    },
  },
  {
    nome: "spHmd1 L11 — Remote (sem frete, taxa fixa R$ 2, com antecipação)",
    produto: { custo: 24.8, peso: 0.2 },
    canal: SHOPEE,
    anuncio: { comissao: 0.14, taxaFixa: 2, preco: 40, promocao: 0 },
    esperado: {
      custoFinal: 30.3,
      frete: 0,
      comissao: 7.6,
      sobra: 32.4,
      lucro: 0.8688,
      margem: 0.03503225806,
    },
  },
  {
    // A planilha tinha promoção zerada em todas as abas, então esta parte da
    // fórmula nunca chegou a ser exercida por lá. Conferido na mão:
    //   custoFinal = 30 + 10%*100 + 1,50            = 41,50
    //   comissão   = 11% * (100 - 10%*100)          =  9,90
    //   sobra      = 100 - 9,90 - 14,35 - 10        = 65,75
    //   lucro      = 65,75 - 41,50                  = 24,25
    nome: "Promoção de 10% (conferido à mão, não vem da planilha)",
    produto: { custo: 30, peso: 0.2 },
    canal: ML,
    anuncio: { comissao: 0.11, taxaFixa: 0, preco: 100, promocao: 0.1 },
    esperado: {
      custoFinal: 41.5,
      frete: 14.35,
      comissao: 9.9,
      sobra: 65.75,
      lucro: 24.25,
      margem: 0.8083333333333333,
    },
  },
];

// ---------------------------------------------------------------------------

const TOLERANCIA = 1e-6;
let falhas = 0;

function conferir(nome: string, obtido: number, esperado: number) {
  const diferenca = Math.abs(obtido - esperado);
  if (diferenca > TOLERANCIA) {
    console.log(`    ✗ ${nome}: obtido ${obtido}, esperado ${esperado} (dif ${diferenca})`);
    falhas++;
  }
}

console.log("=== Motor de precificação vs. planilha original ===\n");

for (const caso of CASOS) {
  const r = calcular(caso.produto, caso.canal, caso.anuncio, FRETE);
  const antes = falhas;

  conferir("custoFinal", r.custoFinal, caso.esperado.custoFinal);
  conferir("frete", r.frete, caso.esperado.frete);
  conferir("comissao", r.comissao, caso.esperado.comissao);
  conferir("sobra", r.sobra, caso.esperado.sobra);
  conferir("lucro", r.lucro, caso.esperado.lucro);
  conferir("margem", r.margem ?? NaN, caso.esperado.margem);

  console.log(`${falhas === antes ? "  ✓" : "  ✗"} ${caso.nome}`);
}

// --- Caminho inverso: pedir a margem deve devolver o preço original ---------
console.log("\n=== Cálculo inverso (margem alvo -> preço) ===\n");

for (const caso of CASOS) {
  const { comissao, taxaFixa, promocao } = caso.anuncio;
  const sugerido = precoParaMargem(
    caso.produto,
    caso.canal,
    { comissao, taxaFixa, promocao },
    FRETE,
    caso.esperado.margem
  );

  if (!sugerido) {
    console.log(`  ✗ ${caso.nome}: não devolveu preço`);
    falhas++;
    continue;
  }

  const conferido = calcular(
    caso.produto,
    caso.canal,
    { comissao, taxaFixa, promocao, preco: sugerido.preco },
    FRETE
  );
  const margemObtida = conferido.margem ?? NaN;
  const ok = Math.abs(margemObtida - caso.esperado.margem) < 1e-6 && !sugerido.aproximado;
  if (!ok) falhas++;

  const outroPreco = Math.abs(sugerido.preco - caso.anuncio.preco) > 0.005;
  console.log(
    `  ${ok ? "✓" : "✗"} ${caso.nome}: margem ${(caso.esperado.margem * 100).toFixed(2)}%` +
      ` -> R$ ${sugerido.preco.toFixed(2)}` +
      (outroPreco
        ? ` (mais barato que os R$ ${caso.anuncio.preco} cadastrados, mesma margem)`
        : "") +
      (sugerido.aproximado ? " [aproximado]" : "")
  );
}

// --- Casos de borda --------------------------------------------------------
console.log("\n=== Casos de borda ===\n");

const pesado = calcular(
  { custo: 500, peso: 200 },
  ML,
  { comissao: 0.11, taxaFixa: 0, preco: 900, promocao: 0 },
  FRETE
);
const okPesado = pesado.frete === 261.95 && pesado.faixaPeso === "Mais de 150 kg";
if (!okPesado) falhas++;
console.log(
  `  ${okPesado ? "✓" : "✗"} Produto de 200 kg encontra a última linha da tabela` +
    ` (frete ${pesado.frete}, faixa "${pesado.faixaPeso}")`
);

const impossivel = precoParaMargem(
  { custo: 10, peso: 0.2 },
  { ...ML, imposto: 0.5 },
  { comissao: 0.6, taxaFixa: 0, promocao: 0.3 },
  FRETE,
  2
);
const okImpossivel = impossivel === null;
if (!okImpossivel) falhas++;
console.log(
  `  ${okImpossivel ? "✓" : "✗"} Margem inalcançável devolve nulo em vez de preço absurdo`
);

const semCusto = calcular(
  { custo: 0, peso: 0.2 },
  ML,
  { comissao: 0.11, taxaFixa: 0, preco: 50, promocao: 0 },
  FRETE
);
const okSemCusto = semCusto.margem === null;
if (!okSemCusto) falhas++;
console.log(`  ${okSemCusto ? "✓" : "✗"} Produto sem custo cadastrado devolve margem nula`);

// --- Endereço da aplicação --------------------------------------------------
// O que a APP_URL vira, na prática, é o redirect_uri enviado ao Bling. Um
// "https://" faltando aqui derruba a autorização inteira com uma mensagem que
// não aponta a causa, então cada forma de digitar errado tem seu caso.
console.log("\n=== Normalização da APP_URL ===\n");

const ESPERADO = "https://app.up.railway.app";
const ENTRADAS: [string, string][] = [
  ["https://app.up.railway.app", ESPERADO],
  ["app.up.railway.app", ESPERADO],
  ["https://app.up.railway.app/", ESPERADO],
  ["app.up.railway.app///", ESPERADO],
  ["  https://app.up.railway.app  ", ESPERADO],
  ["http://localhost:3000", "http://localhost:3000"],
  ["localhost:3000", "http://localhost:3000"],
];

for (const [entrada, esperado] of ENTRADAS) {
  process.env.APP_URL = entrada;
  let obtido: string;
  try {
    obtido = enderecoDaAplicacao();
  } catch (e) {
    obtido = `erro: ${e instanceof Error ? e.message : String(e)}`;
  }
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? "✓" : "✗"} "${entrada}" -> ${obtido}`);
}

process.env.APP_URL = "app.up.railway.app";
const callback = enderecoDeCallback();
const okCallback = callback === `${ESPERADO}/bling/callback`;
if (!okCallback) falhas++;
console.log(`  ${okCallback ? "✓" : "✗"} callback -> ${callback}`);

process.env.APP_URL = "";
let recusou = false;
try {
  enderecoDaAplicacao();
} catch {
  recusou = true;
}
if (!recusou) falhas++;
console.log(`  ${recusou ? "✓" : "✗"} APP_URL vazia é recusada com erro claro`);

// --- Números digitados ------------------------------------------------------
// A tela escreve "1.000,00" e aceita de volta o que a pessoa editar. Ler
// errado aqui não dá erro nenhum: grava um preço absurdo em silêncio.
console.log("\n=== Números digitados ===\n");

const NUMEROS: [string, number | null][] = [
  ["1000", 1000],
  ["1.000,00", 1000],
  ["1.234.567,89", 1234567.89],
  ["1.000", 1000],        // centavos apagados de um "1.000,00"
  ["32,5", 32.5],
  ["32.5", 32.5],         // teclado numérico ou campo do navegador
  ["0,75", 0.75],
  ["0.75", 0.75],
  ["R$ 1.999,90", 1999.9],
  ["11,5", 11.5],
  ["  42  ", 42],
  ["", null],
  ["abc", null],
];

for (const [entrada, esperado] of NUMEROS) {
  const obtido = paraNumero(entrada);
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? "✓" : "✗"} "${entrada}" -> ${obtido}`);
}

const idaEVolta: [string, number][] = [
  [emReais(1000), 1000],
  [emReais(1234567.89), 1234567.89],
  [emReais(0.5), 0.5],
  [emPercentual(11.5), 11.5],
  [emPercentual(72.9, 1), 72.9],
];
for (const [texto, esperado] of idaEVolta) {
  const volta = paraNumero(texto);
  const ok = volta === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? "✓" : "✗"} escreve "${texto}" e lê de volta ${volta}`);
}

// --- Interruptor da antecipação ---------------------------------------------
// Desligar precisa zerar a taxa no cálculo sem apagar o percentual guardado,
// senão religar obrigaria a redigitá-lo — e um erro aqui muda todos os lucros
// da conta sem aviso.
const GUARDADA = { tipo: "ml" as const, imposto: 0.1, embalagem: 1.5, antecipacao: 0.038 };

const ligada = comoCanal({ ...GUARDADA, antecipacaoAtiva: true });
const desligada = comoCanal({ ...GUARDADA, antecipacaoAtiva: false });

const okLigada = ligada.antecipacao === 0.038;
const okDesligada = desligada.antecipacao === 0;
if (!okLigada) falhas++;
if (!okDesligada) falhas++;
console.log(`  ${okLigada ? "✓" : "✗"} ligada usa a taxa guardada: ${ligada.antecipacao}`);
console.log(`  ${okDesligada ? "✓" : "✗"} desligada zera no cálculo: ${desligada.antecipacao}`);

const comAntecipacao = calcular(
  { custo: 24.8, peso: 0.2 },
  ligada,
  { comissao: 0.14, taxaFixa: 2, preco: 40, promocao: 0 },
  FRETE
);
const semAntecipacao = calcular(
  { custo: 24.8, peso: 0.2 },
  desligada,
  { comissao: 0.14, taxaFixa: 2, preco: 40, promocao: 0 },
  FRETE
);
// A diferença é a antecipação sobre a sobra: 3,8% de 25,85.
const diferenca = semAntecipacao.lucro - comAntecipacao.lucro;
const okDiferenca = Math.abs(diferenca - comAntecipacao.sobra * 0.038) < 1e-9;
if (!okDiferenca) falhas++;
console.log(
  `  ${okDiferenca ? "✓" : "✗"} desligar devolve ao lucro exatamente a antecipação` +
    ` (R$ ${diferenca.toFixed(4)})`
);

const DIGITACAO: [string, string][] = [
  ["abc", ""],
  ["12abc34", "1234"],
  ["R$ 1.999,90", "1.999,90"],
  ["72,9%", "72,9"],
  ["  1 0 0  ", "100"],
  ["1.000,00", "1.000,00"],
];
for (const [entrada, esperado] of DIGITACAO) {
  const obtido = limparNumerico(entrada);
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? "✓" : "✗"} campo numérico recusa letras: "${entrada}" -> "${obtido}"`);
}

console.log(
  falhas === 0
    ? "\n✅ TUDO CONFERE — motor, caminho inverso, bordas, APP_URL e números.\n"
    : `\n❌ ${falhas} verificação(ões) falharam.\n`
);

process.exit(falhas === 0 ? 0 : 1);
