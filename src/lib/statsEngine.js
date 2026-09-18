// ══════════════════════════════════════════════════════════════════════════════
// CAISHEN v4 — Núcleo de Estatística Rigorosa
// ──────────────────────────────────────────────────────────────────────────────
// "Prever o imprevisível" da única forma cientificamente válida:
//   1. Higiene de dados — sorteios inválidos/corrompidos nunca entram no modelo.
//   2. Teste de viés real (qui-quadrado) — se o sorteio físico tiver viés
//      detetável, os sinais de frequência ganham justificação; senão, o
//      programa DIZ que não há viés, em vez de fingir que encontrou padrões.
//   3. Distribuição hipergeométrica exata — o que a aleatoriedade PERMITE
//      prever: a distribuição dos acertos (ex.: "95% de certeza: 0–2 acertos").
//   4. Significância estatística no backtest — só chamamos "sinal" ao que
//      sobrevive a um teste z; o resto é declarado ruído, honestamente.
// Sem dependências externas: todas as funções especiais implementadas aqui
// (ln Γ via Lanczos, gama incompleta regularizada, CDF normal).
// ══════════════════════════════════════════════════════════════════════════════

// ── Funções especiais ────────────────────────────────────────────────────────

// ln Γ(x) — aproximação de Lanczos (precisão ~1e-10, suficiente aqui).
export function gammln(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// P(a,x): gama incompleta regularizada inferior, por série (x < a+1).
function gammpSeries(a, x) {
  if (x <= 0) return 0;
  const gln = gammln(a);
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 200; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gln);
}

// Q(a,x): gama incompleta regularizada superior, por fração continuada (x ≥ a+1).
function gammqCF(a, x) {
  const gln = gammln(a);
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

// Survival function do qui-quadrado: P(X² > chi2) com df graus de liberdade.
export function chi2SF(chi2, df) {
  if (chi2 <= 0) return 1;
  const a = df / 2;
  const x = chi2 / 2;
  return x < a + 1 ? 1 - gammpSeries(a, x) : gammqCF(a, x);
}

// P(Z > z) para a normal padrão (Abramowitz & Stegun 26.2.17, erro < 7.5e-8).
export function normalSF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? p : 1 - p;
}

// ── Combinatória exata (em log, estável para C(50,5) etc.) ───────────────────
export function lnChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return gammln(n + 1) - gammln(k + 1) - gammln(n - k + 1);
}
export function choose(n, k) {
  return Math.round(Math.exp(lnChoose(n, k)));
}

// ── Higiene de dados ─────────────────────────────────────────────────────────
// Um modelo confiável começa por recusar dados corrompidos (ex.: um sorteio do
// EuroMilhões com "50" arquivado como EuroDreams). Devolve válidos + rejeitados
// com o motivo, para o utilizador VER o que foi excluído.
export function validateDraws(draws, lottery) {
  const { main_min, main_max, main_count, extra_min, extra_max, extra_count } = lottery;
  const valid = [];
  const rejected = [];
  const seenDates = new Set();

  for (const d of draws || []) {
    const main = d.main_numbers || [];
    const extra = d.extra_numbers || [];
    let reason = null;

    if (!d.draw_date) reason = 'sem data';
    else if (seenDates.has(d.draw_date)) reason = `data duplicada (${d.draw_date})`;
    else if (main.length !== main_count) reason = `${main.length} números principais (esperado ${main_count})`;
    else if (main.some(n => !Number.isInteger(n) || n < main_min || n > main_max))
      reason = `número fora do intervalo ${main_min}–${main_max}: [${main.join(',')}]`;
    else if (new Set(main).size !== main.length) reason = 'números principais repetidos';
    else if (extra_count > 0 && extra.some(n => !Number.isInteger(n) || n < extra_min || n > extra_max))
      reason = `extra fora do intervalo ${extra_min}–${extra_max}: [${extra.join(',')}]`;

    if (reason) rejected.push({ draw_date: d.draw_date, reason });
    else { valid.push(d); seenDates.add(d.draw_date); }
  }
  return { valid, rejected };
}

// ── Teste de viés: qui-quadrado de uniformidade ──────────────────────────────
// H0: todos os números têm a mesma probabilidade de sair (sorteio justo).
// p ≥ 0.05 → sem viés detetável (frequências "quentes" são ruído normal).
// p < 0.05 → desvio real da uniformidade; sinais de frequência ganham peso.
export function biasTest(draws, lottery) {
  const { main_min, main_max } = lottery;
  const range = main_max - main_min + 1;
  const counts = {};
  for (let i = main_min; i <= main_max; i++) counts[i] = 0;
  let total = 0;
  for (const d of draws) {
    for (const n of d.main_numbers || []) {
      if (n >= main_min && n <= main_max) { counts[n]++; total++; }
    }
  }
  if (total < range * 3) {
    return { chi2: 0, df: range - 1, pValue: 1, biased: false, total, note: 'amostra pequena demais para o teste' };
  }
  const expected = total / range;
  let chi2 = 0;
  for (let i = main_min; i <= main_max; i++) {
    const diff = counts[i] - expected;
    chi2 += (diff * diff) / expected;
  }
  const df = range - 1;
  const pValue = chi2SF(chi2, df);
  return { chi2: +chi2.toFixed(2), df, pValue: +pValue.toFixed(4), biased: pValue < 0.05, total };
}

// ── Distribuição hipergeométrica: o que a aleatoriedade permite prever ───────
// P(k acertos) ao apostar `n` números num sorteio que tira `K` de `N`.
// Para EuroDreams (6 de 40): P(0)=35%, P(1)=43.5%, P(2)=18.1%, P(3+)=3.3%.
export function hitDistribution(lottery) {
  const N = lottery.main_max - lottery.main_min + 1;
  const K = lottery.main_count; // números sorteados
  const n = lottery.main_count; // números apostados
  const lnTotal = lnChoose(N, n);
  const probs = [];
  for (let k = 0; k <= n; k++) {
    const lnP = lnChoose(K, k) + lnChoose(N - K, n - k) - lnTotal;
    probs.push(Math.exp(lnP));
  }
  const mean = (n * K) / N;
  const p = K / N;
  const variance = n * p * (1 - p) * ((N - n) / (N - 1));
  return { probs, mean, sd: Math.sqrt(variance) };
}

// Odds "1 em X" por escalão de acertos — a verdade nua do jogo.
export function oddsTable(lottery) {
  const { probs } = hitDistribution(lottery);
  return probs.map((p, k) => ({
    hits: k,
    probability: p,
    oneIn: p > 0 ? Math.round(1 / p) : Infinity,
  }));
}

// ── Significância do backtest ────────────────────────────────────────────────
// Compara a média de acertos observada com a esperada sob H0 (acaso puro),
// usando o desvio-padrão hipergeométrico. Devolve z, p e veredicto.
export function backtestSignificance(avgHits, samples, lottery) {
  const { mean, sd } = hitDistribution(lottery);
  if (!samples || samples < 2) {
    return { mean, sd, se: null, z: null, pValue: null, significant: false, ci95: null };
  }
  const se = sd / Math.sqrt(samples);
  const z = (avgHits - mean) / se;
  const pValue = 2 * normalSF(Math.abs(z)); // bicaudal
  return {
    mean: +mean.toFixed(3),
    sd: +sd.toFixed(3),
    se: +se.toFixed(3),
    z: +z.toFixed(2),
    pValue: +pValue.toFixed(4),
    significant: pValue < 0.05,
    ci95: [+(avgHits - 1.96 * se).toFixed(3), +(avgHits + 1.96 * se).toFixed(3)],
  };
}

// ── Confiança calibrada ──────────────────────────────────────────────────────
// Em vez de um número inventado, devolvemos P(2+ acertos): a probabilidade real
// de o palpite acertar 2 ou mais números. Parte da hipergeométrica exata e só
// se afasta dela na medida em que o backtest tem amostra para o justificar
// (encolhimento empírico-Bayes: lift × amostra/(amostra+150)).
export function calibratedConfidence(lottery, backtestResult) {
  const { probs } = hitDistribution(lottery);
  const pAtLeast2 = probs.slice(2).reduce((a, b) => a + b, 0);
  if (!backtestResult || !backtestResult.samples) {
    return { p2plus: pAtLeast2, base: pAtLeast2, liftApplied: 0 };
  }
  const shrink = backtestResult.samples / (backtestResult.samples + 150);
  const liftApplied = (backtestResult.lift || 0) * shrink;
  const adjusted = Math.max(pAtLeast2 * 0.5, Math.min(pAtLeast2 * 2, pAtLeast2 * (1 + liftApplied)));
  return { p2plus: adjusted, base: pAtLeast2, liftApplied: +liftApplied.toFixed(4) };
}
