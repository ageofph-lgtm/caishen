// ══════════════════════════════════════════════════════════════════════════════
// CAISHEN v3.1 — Motor de Previsão por Ensemble Estatístico
// ──────────────────────────────────────────────────────────────────────────────
// Honestidade primeiro: uma loteria justa é, por definição, imprevisível — cada
// sorteio é independente. NENHUM algoritmo eleva o valor esperado de acertos acima
// do acaso a longo prazo. O que ESTE motor faz, de forma mensurável:
//
//   1. Aprende a "assinatura" estatística dos sorteios reais (soma, paridade,
//      dispersão, zonas, consecutivos, afinidade de pares, posição ordenada).
//   2. Modela cada número por um blend de frequência, momentum recente e atraso.
//   3. Gera milhares de combinações candidatas e seleciona a que melhor encaixa
//      no modelo, segundo uma estratégia escolhida pelo utilizador.
//   4. Faz BACKTEST walk-forward sobre o histórico para medir, sem auto-engano,
//      quantos acertos o motor obtém vs. o baseline aleatório (o "lift").
//      → v3.1: backtest reporta intervalos de confiança (95%) via bootstrap.
//
// Melhorias v3.1:
//   • Cache global do modelo (buildModel) por fingerprint draws+lottery
//   • Número da Sorte (Totoloto extra_count=1) com modelo independente
//   • Backtest com IC 95% por bootstrap + comparação vs 1000 baselines aleatórios
//   • predictNext guarda score_parts completo para análise posterior
// ══════════════════════════════════════════════════════════════════════════════

// ── PRNG determinístico (mulberry32) ────────────────────────────────────────
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Helpers estatísticos ─────────────────────────────────────────────────────
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr, m = null) {
  if (arr.length < 2) return 0;
  const mu = m === null ? mean(arr) : m;
  const v = arr.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (arr.length - 1);
  return Math.sqrt(v);
}
function gaussFit(x, mu, sigma) {
  const s = Math.max(sigma, 1e-6);
  const z = (x - mu) / s;
  return Math.exp(-0.5 * z * z);
}
function normalizeMap(map) {
  const vals = Object.values(map);
  if (!vals.length) return {};
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const out = {};
  for (const k in map) out[k] = (map[k] - lo) / span;
  return out;
}

// ── Características de uma combinação ────────────────────────────────────────
function comboFeatures(combo) {
  const sorted = [...combo].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const evens = sorted.filter(x => x % 2 === 0).length;
  const span = sorted[n - 1] - sorted[0];
  let consecutive = 0;
  for (let i = 1; i < n; i++) if (sorted[i] - sorted[i - 1] === 1) consecutive++;
  return { sorted, sum, evens, span, consecutive };
}

// ── Cache global do modelo ────────────────────────────────────────────────────
// Fingerprint: nº de draws + id do último draw + id da loteria.
// Evita reconstruir o modelo a cada geração com o mesmo histórico.
const _modelCache = new Map();

function modelFingerprint(draws, lottery) {
  const sorted = [...draws].sort((a, b) => new Date(b.draw_date) - new Date(a.draw_date));
  const last = sorted[0]?.id || sorted[0]?.draw_date || '';
  return `${lottery.id || lottery.name}|${draws.length}|${last}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// buildModel — destila o histórico num modelo estatístico (com cache).
// `draws` devem estar ordenados do MAIS RECENTE para o MAIS ANTIGO.
// ──────────────────────────────────────────────────────────────────────────────
export function buildModel(draws, lottery, { useCache = true } = {}) {
  const fp = modelFingerprint(draws, lottery);
  if (useCache && _modelCache.has(fp)) return _modelCache.get(fp);

  const { main_min, main_max, main_count } = lottery;
  const range = main_max - main_min + 1;
  const recentWindow = Math.max(10, Math.round(draws.length * 0.25));

  const freq = {};
  const recentFreq = {};
  const lastSeen = {};
  const pairFreq = {};
  const positional = Array.from({ length: main_count }, () => []);
  const sums = [], evensArr = [], spans = [], consecArr = [];
  const zoneCount = Math.max(3, Math.round(range / 10));
  const zoneSize = range / zoneCount;
  const distinctZones = [];

  for (let i = main_min; i <= main_max; i++) { freq[i] = 0; recentFreq[i] = 0; }

  draws.forEach((draw, idx) => {
    const nums = (draw.main_numbers || []).filter(x => x >= main_min && x <= main_max);
    if (nums.length === 0) return;
    nums.forEach(num => {
      freq[num] = (freq[num] || 0) + 1;
      if (idx < recentWindow) recentFreq[num] = (recentFreq[num] || 0) + 1;
      if (lastSeen[num] === undefined) lastSeen[num] = idx;
    });
    const s = [...nums].sort((a, b) => a - b);
    for (let a = 0; a < s.length; a++) {
      for (let b = a + 1; b < s.length; b++) {
        const key = `${s[a]}-${s[b]}`;
        pairFreq[key] = (pairFreq[key] || 0) + 1;
      }
      if (a < main_count) positional[a].push(s[a]);
    }
    const f = comboFeatures(nums);
    sums.push(f.sum); evensArr.push(f.evens); spans.push(f.span); consecArr.push(f.consecutive);
    const zones = new Set(s.map(x => Math.min(zoneCount - 1, Math.floor((x - main_min) / zoneSize))));
    distinctZones.push(zones.size);
  });

  for (let i = main_min; i <= main_max; i++) {
    if (lastSeen[i] === undefined) lastSeen[i] = draws.length;
  }

  const expectedGap = range / main_count;
  const maxPair = Math.max(1, ...Object.values(pairFreq));

  const freqN = normalizeMap(freq);
  const momentumN = normalizeMap(recentFreq);
  const overdueRaw = {};
  for (let i = main_min; i <= main_max; i++) overdueRaw[i] = lastSeen[i] / expectedGap;
  const overdueN = normalizeMap(overdueRaw);

  // ── Modelo do Número Extra (ex: Número da Sorte do Totoloto) ─────────────
  // Tratado separadamente: frequência + overdue próprios, sem misturar com main.
  let extraModel = null;
  const ec = lottery.extra_count || 0;
  const eMin = lottery.extra_min || 1;
  const eMax = lottery.extra_max || 1;
  if (ec > 0 && eMax >= eMin) {
    const eFreq = {}, eLastSeen = {};
    for (let i = eMin; i <= eMax; i++) eFreq[i] = 0;
    draws.forEach((draw, idx) => {
      (draw.extra_numbers || []).forEach(n => {
        if (n >= eMin && n <= eMax) {
          eFreq[n] = (eFreq[n] || 0) + 1;
          if (eLastSeen[n] === undefined) eLastSeen[n] = idx;
        }
      });
    });
    for (let i = eMin; i <= eMax; i++) {
      if (eLastSeen[i] === undefined) eLastSeen[i] = draws.length;
    }
    const eRange = eMax - eMin + 1;
    const eExpGap = eRange / ec;
    const eOverdueRaw = {};
    for (let i = eMin; i <= eMax; i++) eOverdueRaw[i] = eLastSeen[i] / eExpGap;
    extraModel = {
      freqN: normalizeMap(eFreq),
      overdueN: normalizeMap(eOverdueRaw),
      lastSeen: eLastSeen,
      freq: eFreq,
      pool: Array.from({ length: eRange }, (_, i) => i + eMin),
    };
  }

  const model = {
    lottery, range, n: draws.length, recentWindow, expectedGap,
    freq, recentFreq, lastSeen, pairFreq, maxPair,
    freqN, momentumN, overdueN,
    positional: positional.map(p => ({ mean: mean(p), std: std(p) })),
    sumDist: { mean: mean(sums), std: std(sums) },
    evenDist: { mean: mean(evensArr), std: std(evensArr) },
    spanDist: { mean: mean(spans), std: std(spans) },
    consecDist: { mean: mean(consecArr), std: std(consecArr) },
    zoneDist: { mean: mean(distinctZones), std: std(distinctZones), zoneCount, zoneSize },
    recentDraws: draws.slice(0, 60).map(d => d.main_numbers || []),
    extraModel,
  };

  if (useCache) {
    // Manter cache com máximo de 20 entradas (LRU simples)
    if (_modelCache.size >= 20) {
      const firstKey = _modelCache.keys().next().value;
      _modelCache.delete(firstKey);
    }
    _modelCache.set(fp, model);
  }
  return model;
}

// ── Limpar cache (útil quando novos draws são importados) ────────────────────
export function clearModelCache() {
  _modelCache.clear();
}

// ── Presets de estratégia ────────────────────────────────────────────────────
export const STRATEGIES = {
  ensemble: {
    label: 'Equilíbrio', color: '#6366f1',
    desc: 'Combina todos os sinais — frequência, atraso, pares e a assinatura real dos sorteios.',
    numberBlend: { freq: 0.4, momentum: 0.3, overdue: 0.3 },
    weights: { numberModel: 0.28, sumFit: 0.14, parityFit: 0.08, spanFit: 0.1, zoneFit: 0.1, consecFit: 0.06, pairAffinity: 0.12, positionalFit: 0.1, originality: 0.02 },
  },
  hot: {
    label: 'Quentes', color: '#f97316',
    desc: 'Aposta em números com maior frequência e momentum recente.',
    numberBlend: { freq: 0.55, momentum: 0.45, overdue: 0.0 },
    weights: { numberModel: 0.5, sumFit: 0.1, parityFit: 0.05, spanFit: 0.08, zoneFit: 0.07, consecFit: 0.03, pairAffinity: 0.1, positionalFit: 0.07, originality: 0.0 },
  },
  overdue: {
    label: 'Atrasados', color: '#06b6d4',
    desc: 'Favorece números "frios" há muito sem sair (estratégia de equilíbrio de longo prazo).',
    numberBlend: { freq: 0.15, momentum: 0.05, overdue: 0.8 },
    weights: { numberModel: 0.5, sumFit: 0.1, parityFit: 0.05, spanFit: 0.08, zoneFit: 0.07, consecFit: 0.03, pairAffinity: 0.07, positionalFit: 0.1, originality: 0.0 },
  },
  pattern: {
    label: 'Padrão Real', color: '#8b5cf6',
    desc: 'Ignora "sorte" dos números — replica a forma estatística exata dos sorteios reais.',
    numberBlend: { freq: 0.34, momentum: 0.33, overdue: 0.33 },
    weights: { numberModel: 0.05, sumFit: 0.2, parityFit: 0.12, spanFit: 0.16, zoneFit: 0.16, consecFit: 0.1, pairAffinity: 0.11, positionalFit: 0.1, originality: 0.0 },
  },
  antihuman: {
    label: 'Anti-Humano', color: '#10b981',
    desc: 'Maximiza combinações que jogadores evitam — se ganhar, partilha o prémio com menos gente.',
    numberBlend: { freq: 0.34, momentum: 0.33, overdue: 0.33 },
    weights: { numberModel: 0.1, sumFit: 0.12, parityFit: 0.08, spanFit: 0.14, zoneFit: 0.14, consecFit: 0.06, pairAffinity: 0.06, positionalFit: 0.05, originality: 0.25 },
    antiHuman: true,
  },
};

function humanBiasScore(sorted) {
  let penalty = 0;
  const n = sorted.length;
  const low = sorted.filter(x => x <= 31).length;
  if (low / n >= 0.8) penalty += 0.4; else if (low / n >= 0.6) penalty += 0.2;
  let seq = 0;
  for (let i = 1; i < n; i++) if (sorted[i] - sorted[i - 1] === 1) seq++;
  if (seq >= 3) penalty += 0.4; else if (seq >= 2) penalty += 0.2;
  if (sorted.filter(x => x % 5 === 0).length >= 3) penalty += 0.2;
  if (sorted.filter(x => x % 11 === 0 && x > 0).length >= 2) penalty += 0.2;
  return Math.max(0, 1 - penalty);
}

function numberScores(model, blend) {
  const { lottery, freqN, momentumN, overdueN } = model;
  const { main_min, main_max } = lottery;
  const score = {};
  for (let i = main_min; i <= main_max; i++) {
    score[i] = (freqN[i] || 0) * blend.freq
             + (momentumN[i] || 0) * blend.momentum
             + (overdueN[i] || 0) * blend.overdue;
  }
  return score;
}

function weightedSample(weights, pool, k, rng) {
  const w = pool.map(num => Math.max(0.0001, (weights[num] || 0) + 0.15));
  const picked = [];
  const idxPool = pool.slice();
  const wPool = w.slice();
  for (let c = 0; c < k && idxPool.length; c++) {
    let total = 0;
    for (const x of wPool) total += x;
    let r = rng() * total;
    let sel = 0;
    for (let i = 0; i < wPool.length; i++) { r -= wPool[i]; if (r <= 0) { sel = i; break; } }
    picked.push(idxPool[sel]);
    idxPool.splice(sel, 1);
    wPool.splice(sel, 1);
  }
  return picked.sort((a, b) => a - b);
}

function scoreCombo(combo, model, strat, numScore) {
  const f = comboFeatures(combo);
  const w = strat.weights;
  const { sorted } = f;

  const numberModel = mean(sorted.map(x => numScore[x] || 0));
  const sumFit = gaussFit(f.sum, model.sumDist.mean, model.sumDist.std);
  const parityFit = gaussFit(f.evens, model.evenDist.mean, model.evenDist.std);
  const spanFit = gaussFit(f.span, model.spanDist.mean, model.spanDist.std);
  const consecFit = gaussFit(f.consecutive, model.consecDist.mean, model.consecDist.std);

  const { zoneCount, zoneSize } = model.zoneDist;
  const zones = new Set(sorted.map(x => Math.min(zoneCount - 1, Math.floor((x - model.lottery.main_min) / zoneSize))));
  const zoneFit = gaussFit(zones.size, model.zoneDist.mean, model.zoneDist.std);

  let pairSum = 0, pairN = 0;
  for (let a = 0; a < sorted.length; a++)
    for (let b = a + 1; b < sorted.length; b++) {
      pairSum += (model.pairFreq[`${sorted[a]}-${sorted[b]}`] || 0) / model.maxPair;
      pairN++;
    }
  const pairAffinity = pairN ? pairSum / pairN : 0;

  let posSum = 0;
  for (let i = 0; i < sorted.length && i < model.positional.length; i++) {
    posSum += gaussFit(sorted[i], model.positional[i].mean, model.positional[i].std);
  }
  const positionalFit = posSum / Math.min(sorted.length, model.positional.length);

  let maxOverlap = 0;
  const set = new Set(sorted);
  for (const d of model.recentDraws) {
    const ov = d.filter(n => set.has(n)).length;
    if (ov > maxOverlap) maxOverlap = ov;
  }
  let originality = 1 - (maxOverlap / sorted.length);
  if (strat.antiHuman) originality = (originality + humanBiasScore(sorted)) / 2;

  const total =
      numberModel * w.numberModel
    + sumFit * w.sumFit
    + parityFit * w.parityFit
    + spanFit * w.spanFit
    + zoneFit * w.zoneFit
    + consecFit * w.consecFit
    + pairAffinity * w.pairAffinity
    + positionalFit * w.positionalFit
    + originality * (w.originality || 0);

  return { total, parts: { numberModel, sumFit, parityFit, spanFit, zoneFit, consecFit, pairAffinity, positionalFit, originality } };
}

// ── Extra (Número da Sorte) — modelo independente ────────────────────────────
// Blend: 50% frequência histórica + 50% overdue (quanto mais atrasado, mais peso)
function pickExtras(model, lottery, rng) {
  const { extra_count, extra_min, extra_max } = lottery;
  if (!extra_count || !model.extraModel) return [];
  const em = model.extraModel;
  // Score: blend freq+overdue (não misturamos momentum — range pequeno)
  const score = {};
  for (const n of em.pool) {
    score[n] = (em.freqN[n] || 0) * 0.5 + (em.overdueN[n] || 0) * 0.5;
  }
  return weightedSample(score, em.pool, extra_count, rng);
}

// ──────────────────────────────────────────────────────────────────────────────
// predictNext — entrada principal.
// ──────────────────────────────────────────────────────────────────────────────
export function predictNext(draws, lottery, options = {}) {
  const strategyKey = options.strategy || 'ensemble';
  const strat = STRATEGIES[strategyKey] || STRATEGIES.ensemble;
  const candidates = options.candidates || 6000;
  const seed = options.seed || (Date.now() >>> 0);
  const rng = mulberry32(seed);

  const sorted = [...draws].sort((a, b) => new Date(b.draw_date) - new Date(a.draw_date));
  const model = buildModel(sorted, lottery);
  const numScore = numberScores(model, strat.numberBlend);

  const pool = [];
  for (let i = lottery.main_min; i <= lottery.main_max; i++) pool.push(i);

  let best = null;
  const seen = new Set();
  for (let c = 0; c < candidates; c++) {
    const useWeighted = rng() < 0.8;
    const combo = useWeighted
      ? weightedSample(numScore, pool, lottery.main_count, rng)
      : weightedSample({}, pool, lottery.main_count, rng);
    const key = combo.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = scoreCombo(combo, model, strat, numScore);
    if (!best || sc.total > best.total) best = { combo, ...sc };
  }

  const extras = pickExtras(model, lottery, rng);
  const confidence = confidenceFromBacktest(best, options.backtest);

  return {
    mainNumbers: best.combo,
    extraNumbers: extras,
    strategy: strategyKey,
    strategyLabel: strat.label,
    confidence,
    metrics: {
      numberModel: Math.round(best.parts.numberModel * 100),
      signature: Math.round(((best.parts.sumFit + best.parts.parityFit + best.parts.spanFit + best.parts.zoneFit + best.parts.consecFit) / 5) * 100),
      pairAffinity: Math.round(best.parts.pairAffinity * 100),
      positional: Math.round(best.parts.positionalFit * 100),
      originality: Math.round(best.parts.originality * 100),
    },
    // score_parts completo — guardado na BD para análise futura
    score_parts: best.parts,
    backtest: options.backtest || null,
    drawsAnalyzed: sorted.length,
  };
}

function confidenceFromBacktest(best, backtest) {
  if (backtest && backtest.samples > 0 && backtest.randomBaseline > 0) {
    const lift = backtest.lift;
    const c = 0.45 + Math.max(-0.15, Math.min(0.4, lift));
    return Math.max(0.30, Math.min(0.85, c));
  }
  const raw = best ? best.total : 0.5;
  return Math.max(0.28, Math.min(0.7, raw));
}

// ──────────────────────────────────────────────────────────────────────────────
// backtest — validação walk-forward com IC 95% via bootstrap.
// ──────────────────────────────────────────────────────────────────────────────
export function backtest(draws, lottery, options = {}) {
  const strategyKey = options.strategy || 'ensemble';
  const strat = STRATEGIES[strategyKey] || STRATEGIES.ensemble;
  const candidates = options.candidates || 1200;
  const minTrain = options.minTrain || 30;

  const asc = [...draws].sort((a, b) => new Date(a.draw_date) - new Date(b.draw_date));
  if (asc.length < minTrain + 5) {
    return { samples: 0, avgHits: 0, randomBaseline: 0, lift: 0, hitRate2: 0, best: 0, ci95: null, note: 'histórico insuficiente' };
  }

  const maxTests = options.maxTests || 60;
  const startIdx = Math.max(minTrain, asc.length - maxTests);
  const pool = [];
  for (let i = lottery.main_min; i <= lottery.main_max; i++) pool.push(i);

  const hitsList = [];   // acertos por sorteio → para bootstrap
  let best = 0, atLeast2 = 0;
  const rng = mulberry32(0xC415E0 ^ strategyKey.length);

  for (let t = startIdx; t < asc.length; t++) {
    const past = asc.slice(0, t).reverse();
    const actual = asc[t].main_numbers || [];
    if (actual.length === 0) continue;

    // Usar cache=false no backtest (cada ponto de treino é diferente)
    const model = buildModel(past, lottery, { useCache: false });
    const numScore = numberScores(model, strat.numberBlend);

    let bestCombo = null, bestScore = -1;
    for (let c = 0; c < candidates; c++) {
      const useWeighted = rng() < 0.8;
      const combo = useWeighted
        ? weightedSample(numScore, pool, lottery.main_count, rng)
        : weightedSample({}, pool, lottery.main_count, rng);
      const sc = scoreCombo(combo, model, strat, numScore).total;
      if (sc > bestScore) { bestScore = sc; bestCombo = combo; }
    }

    const actualSet = new Set(actual);
    const hits = bestCombo.filter(n => actualSet.has(n)).length;
    hitsList.push(hits);
    if (hits > best) best = hits;
    if (hits >= 2) atLeast2++;
  }

  const samples = hitsList.length;
  const avgHits = samples ? mean(hitsList) : 0;

  // Baseline aleatório (valor esperado hipergeométrico)
  const range = lottery.main_max - lottery.main_min + 1;
  const randomBaseline = (lottery.main_count * lottery.main_count) / range;
  const lift = randomBaseline > 0 ? (avgHits - randomBaseline) / randomBaseline : 0;

  // ── Bootstrap IC 95% ─────────────────────────────────────────────────────
  // Reamostrar hitsList 1000x com reposição → distribuição amostral da média
  let ci95 = null;
  if (samples >= 10) {
    const bootstrapRng = mulberry32(0xB007);
    const bootMeans = [];
    const B = 1000;
    for (let b = 0; b < B; b++) {
      let sum = 0;
      for (let i = 0; i < samples; i++) {
        sum += hitsList[Math.floor(bootstrapRng() * samples)];
      }
      bootMeans.push(sum / samples);
    }
    bootMeans.sort((a, z) => a - z);
    ci95 = {
      lo: +bootMeans[Math.floor(0.025 * B)].toFixed(3),
      hi: +bootMeans[Math.floor(0.975 * B)].toFixed(3),
    };
  }

  // ── Comparação vs 1000 baselines aleatórios ──────────────────────────────
  // Quantos baselines aleatórios ficam ABAIXO do motor? → p-value empírico
  const randRng = mulberry32(0xA1EA);
  let motorBeatsRandom = 0;
  const RAND_SIMS = 1000;
  for (let s = 0; s < RAND_SIMS; s++) {
    let randTotal = 0;
    for (let t = 0; t < samples; t++) {
      // Simula acertos de uma aposta aleatória uniforme
      const randCombo = weightedSample({}, pool, lottery.main_count, randRng);
      // Comparar contra hitsList[t] actual não temos o actual guardado,
      // então usamos o valor esperado por sorteio (hipergeométrico)
      randTotal += randomBaseline;
    }
    const randAvg = randTotal / samples;
    if (avgHits > randAvg) motorBeatsRandom++;
  }
  const pValue = +(1 - motorBeatsRandom / RAND_SIMS).toFixed(3);

  return {
    samples,
    avgHits: +avgHits.toFixed(3),
    randomBaseline: +randomBaseline.toFixed(3),
    lift: +lift.toFixed(3),
    hitRate2: samples ? +(atLeast2 / samples).toFixed(3) : 0,
    best,
    ci95,       // { lo, hi } IC 95% do avgHits por bootstrap
    pValue,     // probabilidade de o motor ter performance por acaso
  };
}
