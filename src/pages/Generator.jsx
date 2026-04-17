import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, ArrowLeft, Save, RefreshCw, Info, TrendingUp, BarChart2, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import NumberBall from '../components/lottery/NumberBall';

// ══════════════════════════════════════════════════════════════════════════════
// CAISHEN v2 — Motor Anti-Humano
// Filosofia: loterias são IMPREVISÍVEIS por definição.
// O que é possível: gerar combinações que humanos raramente escolhem,
// maximizando o prize-share potencial se ganhar. + Análise honesta.
// ══════════════════════════════════════════════════════════════════════════════

// Combinações "humanas" a evitar (muito jogas):
// — sequências aritméticas: 1-2-3-4-5, 5-10-15-20-25
// — datas: concentração em 1-31
// — espelhados: 11,22,33,44
// — baixos: 1-12 (aniversários / meses)

function humanBiasScore(combo) {
  // Retorna 0-1: 0 = muito humano, 1 = pouco humano
  let penalty = 0;
  const sorted = [...combo].sort((a, b) => a - b);
  const n = sorted.length;

  // Penalizar concentração em 1-31 (datas)
  const low = sorted.filter(x => x <= 31).length;
  if (low / n >= 0.8) penalty += 0.4;
  else if (low / n >= 0.6) penalty += 0.2;

  // Penalizar sequências
  let seqCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i-1] === 1) seqCount++;
  }
  if (seqCount >= 3) penalty += 0.4;
  else if (seqCount >= 2) penalty += 0.2;

  // Penalizar multípliplos regulares (5, 10, 15...)
  const mults = sorted.filter(x => x % 5 === 0).length;
  if (mults >= 3) penalty += 0.2;

  // Penalizar espelhados (11, 22, 33...)
  const mirrors = sorted.filter(x => x % 11 === 0 && x > 0).length;
  if (mirrors >= 2) penalty += 0.2;

  return Math.max(0, 1 - penalty);
}

// Calcular score de originalidade real baseado no histórico
function originalityScore(combo, draws, mainMin, mainMax) {
  if (!draws || draws.length === 0) return 0.5;
  // Verificar se esta combinação (ou muito parecida) já saiu
  const comboSet = new Set(combo);
  let maxOverlap = 0;
  for (const draw of draws.slice(0, 200)) {
    const overlap = (draw.main_numbers || []).filter(n => comboSet.has(n)).length;
    if (overlap > maxOverlap) maxOverlap = overlap;
  }
  // Quanto menos overlap com histórico, mais "original"
  return Math.max(0, 1 - (maxOverlap / combo.length) * 0.5);
}

// Distribuição equilibrada: paridade + amplitude
function distributionScore(combo, mainMin, mainMax) {
  const sorted = [...combo].sort((a, b) => a - b);
  const n = sorted.length;
  const range = mainMax - mainMin;
  const mid = mainMin + range / 2;

  // Paridade: idealmente 50/50 par/ímpar
  const evens = sorted.filter(x => x % 2 === 0).length;
  const parityScore = 1 - Math.abs((evens / n) - 0.5) * 2;

  // Amplitude: queremos números espalhados
  const span = sorted[n-1] - sorted[0];
  const spanScore = span / range;

  // Cobertura de zonas (dividir o range em 3 terços)
  const third = range / 3;
  const zones = new Set(sorted.map(x => Math.floor((x - mainMin) / third)));
  const zoneScore = zones.size / 3;

  return (parityScore * 0.3 + spanScore * 0.4 + zoneScore * 0.3);
}

// Calcular confiança REAL baseada em métricas objectivas
function calcConfidence(combo, draws, mainMin, mainMax) {
  const human = humanBiasScore(combo);
  const distrib = distributionScore(combo, mainMin, mainMax);
  const original = originalityScore(combo, draws, mainMin, mainMax);
  // Confiança = média ponderada das métricas (nunca > 0.72 — honesto)
  const raw = human * 0.35 + distrib * 0.40 + original * 0.25;
  return Math.min(0.72, Math.max(0.28, raw));
}

// ── GERADOR PRINCIPAL ────────────────────────────────────────────────────────
function generateAntiHuman(lottery, draws, seed = null) {
  const { main_count, main_min, main_max, extra_count, extra_min, extra_max } = lottery;
  const range = main_max - main_min + 1;
  const rng = seed ? mulberry32(seed) : Math.random;

  // Tentar até 200 combinações, guardar a melhor
  let bestCombo = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 200; attempt++) {
    const combo = [];
    const pool = Array.from({ length: range }, (_, i) => i + main_min);

    // Shuffle Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // Pegar os primeiros main_count
    combo.push(...pool.slice(0, main_count));
    combo.sort((a, b) => a - b);

    const human = humanBiasScore(combo);
    const distrib = distributionScore(combo, main_min, main_max);
    const score = human * 0.5 + distrib * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestCombo = combo;
    }
  }

  // Extras: mesmo processo com range menor
  let extras = [];
  if (extra_count > 0) {
    let bestExtra = null, bestExtraScore = -1;
    for (let attempt = 0; attempt < 50; attempt++) {
      const ePool = Array.from({ length: extra_max - extra_min + 1 }, (_, i) => i + extra_min);
      for (let i = ePool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [ePool[i], ePool[j]] = [ePool[j], ePool[i]];
      }
      const eCombo = ePool.slice(0, extra_count).sort((a, b) => a - b);
      const s = distributionScore(eCombo, extra_min, extra_max);
      if (s > bestExtraScore) { bestExtraScore = s; bestExtra = eCombo; }
    }
    extras = bestExtra || [];
  }

  const confidence = calcConfidence(bestCombo, draws, main_min, main_max);
  const humanScore = humanBiasScore(bestCombo);
  const distribScore = distributionScore(bestCombo, main_min, main_max);

  return {
    mainNumbers: bestCombo,
    extraNumbers: extras,
    confidence,
    metrics: {
      antiHuman: Math.round(humanScore * 100),
      distribution: Math.round(distribScore * 100),
      originality: Math.round(originalityScore(bestCombo, draws, main_min, main_max) * 100),
    }
  };
}

// Seedable RNG (para reprodutibilidade)
function mulberry32(seed) {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── DATA DO PRÓXIMO SORTEIO ──────────────────────────────────────────────────
function nextDrawDate(lotteryName) {
  const today = new Date();
  const d = today.getDay();
  let next = new Date(today);
  if (lotteryName === 'EuroMilhões') {
    if (d < 2) next.setDate(today.getDate() + (2 - d));
    else if (d < 5) next.setDate(today.getDate() + (5 - d));
    else next.setDate(today.getDate() + (9 - d));
  } else if (lotteryName === 'Totoloto') {
    if (d < 3) next.setDate(today.getDate() + (3 - d));
    else if (d < 6) next.setDate(today.getDate() + (6 - d));
    else next.setDate(today.getDate() + (10 - d));
  } else if (lotteryName === 'EuroDreams') {
    if (d === 0) next.setDate(today.getDate() + 1);
    else if (d < 4) next.setDate(today.getDate() + (4 - d));
    else next.setDate(today.getDate() + (8 - d));
  } else {
    next.setDate(today.getDate() + 1);
  }
  return next.toISOString().split('T')[0];
}

// ── COMPONENTE MÉTRICA ───────────────────────────────────────────────────────
function MetricBar({ label, value, color, tooltip }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-500 font-medium">{label}</span>
        <span className="font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="h-2 rounded-full"
          style={{ background: color }}
        />
      </div>
      {tooltip && <p className="text-[10px] text-slate-400 leading-tight">{tooltip}</p>}
    </div>
  );
}

// ── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function Generator() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [result, setResult] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const queryClient = useQueryClient();

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
    onSuccess: (data) => { if (data.length && !selectedLottery) setSelectedLottery(data[0].id); }
  });

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) setSelectedLottery(lotteries[0].id);
  }, [lotteries]);

  const { data: draws = [] } = useQuery({
    queryKey: ['draws-generator', selectedLottery],
    queryFn: () => base44.entities.Draw.filter({ lottery_id: selectedLottery }),
    enabled: !!selectedLottery,
  });

  const saveMutation = useMutation({
    mutationFn: (data) => base44.entities.Suggestion.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      setSavedMsg('✓ Guardado para validação');
      setTimeout(() => setSavedMsg(''), 3000);
    }
  });

  const currentLottery = lotteries.find(l => l.id === selectedLottery);

  const generate = () => {
    if (!currentLottery || draws.length < 5) return;
    setIsGenerating(true);
    setResult(null);
    // setTimeout para dar feedback visual
    setTimeout(() => {
      const r = generateAntiHuman(currentLottery, draws);
      setResult(r);
      setIsGenerating(false);
    }, 600);
  };

  const save = async () => {
    if (!result || !currentLottery) return;
    const date = nextDrawDate(currentLottery.name);
    // Evitar duplicado
    const existing = await base44.entities.Suggestion.filter({ lottery_id: selectedLottery, draw_date: date });
    if (existing.length > 0) {
      setSavedMsg('⚠ Já existe sugestão para este sorteio');
      setTimeout(() => setSavedMsg(''), 3000);
      return;
    }
    await saveMutation.mutateAsync({
      lottery_id: selectedLottery,
      draw_date: date,
      main_numbers: result.mainNumbers,
      extra_numbers: result.extraNumbers,
      algorithm: 'anti_human_v2',
      parameters: {
        metrics: result.metrics,
        draws_analyzed: draws.length,
      },
      confidence_score: result.confidence,
      was_validated: false,
      notes: `Anti-humano v2. Anti-bias: ${result.metrics.antiHuman}%, Distribuição: ${result.metrics.distribution}%`,
    });
  };

  const metrics = result?.metrics;
  const confidence = result ? Math.round(result.confidence * 100) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to={createPageUrl('Dashboard')}>
              <button className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
            </Link>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Gerador Anti-Humano</h1>
              <p className="text-xs text-slate-400">Combinações que jogadores raramente escolhem</p>
            </div>
          </div>
          <Select value={selectedLottery || ''} onValueChange={v => { setSelectedLottery(v); setResult(null); }}>
            <SelectTrigger className="w-36 bg-white/10 border-white/20 text-white text-xs">
              <SelectValue placeholder="Loteria" />
            </SelectTrigger>
            <SelectContent>
              {lotteries.map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Info banner */}
        <div className="rounded-2xl p-4 border border-amber-500/30 bg-amber-500/10 flex gap-3">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200 leading-relaxed">
            <strong>Como funciona:</strong> Loterias são aleatórias — ninguém pode prever o resultado.
            Este gerador cria combinações que os jogadores humanos raramente escolhem (evita datas, sequências,
            números redondos). Se ganhar, partilha o prémio com menos pessoas.
          </p>
        </div>

        {/* Gerador */}
        <div className="rounded-3xl overflow-hidden border border-white/10" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="p-6 space-y-6">

            {/* Números */}
            <AnimatePresence mode="wait">
              {!result && !isGenerating && (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-10 gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-slate-400 text-sm text-center">
                    {draws.length > 0
                      ? `Pronto — ${draws.length} sorteios analisados`
                      : 'Carregando histórico...'}
                  </p>
                </motion.div>
              )}

              {isGenerating && (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                  <p className="text-slate-400 text-sm">A analisar {draws.length} sorteios...</p>
                </motion.div>
              )}

              {result && !isGenerating && (
                <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="space-y-5">
                  {/* Números principais */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                      {currentLottery?.name}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {result.mainNumbers.map((num, i) => (
                        <NumberBall key={i} number={num} size="lg" />
                      ))}
                    </div>
                  </div>
                  {/* Extras */}
                  {result.extraNumbers.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                        {currentLottery?.extra_name || 'Estrelas'}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {result.extraNumbers.map((num, i) => (
                          <NumberBall key={i} number={num} size="lg" isExtra />
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Botões */}
            <div className="flex gap-3 pt-2 border-t border-white/10">
              <button onClick={generate}
                disabled={isGenerating || !currentLottery || draws.length < 5}
                className="flex-1 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40"
                style={{ background: isGenerating ? 'rgba(99,102,241,0.5)' : '#6366f1', color: '#fff', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
                {isGenerating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> A gerar...</>
                  : <><RefreshCw className="w-4 h-4" /> Gerar combinação</>
                }
              </button>
              {result && (
                <button onClick={save}
                  disabled={saveMutation.isPending}
                  className="py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all border border-white/20 text-white hover:bg-white/10">
                  <Save className="w-4 h-4" />
                  {saveMutation.isPending ? 'A guardar...' : 'Guardar'}
                </button>
              )}
            </div>
            {savedMsg && (
              <p className="text-center text-xs font-bold" style={{ color: savedMsg.startsWith('✓') ? '#4ade80' : '#fbbf24' }}>
                {savedMsg}
              </p>
            )}
          </div>
        </div>

        {/* Métricas (só quando há resultado) */}
        {result && metrics && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-white/10 p-5 space-y-4"
            style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <BarChart2 className="w-3.5 h-3.5" /> Análise da Combinação
              </p>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black"
                style={{
                  background: confidence >= 55 ? 'rgba(99,102,241,0.2)' : 'rgba(100,100,100,0.2)',
                  color: confidence >= 55 ? '#a5b4fc' : '#94a3b8',
                  border: `1px solid ${confidence >= 55 ? 'rgba(99,102,241,0.4)' : 'rgba(100,100,100,0.3)'}`,
                }}>
                <Shield className="w-3 h-3" /> Score: {confidence}%
              </div>
            </div>

            <MetricBar
              label="Anti-bias humano"
              value={metrics.antiHuman}
              color="#6366f1"
              tooltip="Evita datas, sequências e padrões que jogadores humanos preferem"
            />
            <MetricBar
              label="Distribuição espacial"
              value={metrics.distribution}
              color="#8b5cf6"
              tooltip="Números bem espalhados pelo range — cobertura máxima do espaço"
            />
            <MetricBar
              label="Originalidade histórica"
              value={metrics.originality}
              color="#06b6d4"
              tooltip="Quanto esta combinação difere dos resultados reais anteriores"
            />

            <div className="pt-2 border-t border-white/10">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Score calculado com base em {draws.length} sorteios históricos.
                <strong className="text-slate-400"> Lembrete:</strong> nenhum algoritmo pode prever loterias.
                Este score mede qualidade da distribuição, não probabilidade de acerto.
              </p>
            </div>
          </motion.div>
        )}

        {/* Stats do histórico */}
        {draws.length > 0 && currentLottery && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="rounded-2xl border border-white/10 p-4"
            style={{ background: 'rgba(255,255,255,0.03)' }}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Contexto histórico
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Sorteios', draws.length.toLocaleString()],
                ['Range', `${currentLottery.main_min}–${currentLottery.main_max}`],
                ['Combinações', `${(factorial(currentLottery.main_max) / (factorial(currentLottery.main_count) * factorial(currentLottery.main_max - currentLottery.main_count))).toExponential(1)}`],
              ].map(([l, v]) => (
                <div key={l} className="text-center p-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-sm font-black text-white">{v}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{l}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

      </div>
    </div>
  );
}

function factorial(n) {
  if (n <= 1) return 1;
  // Aproximação de Stirling para números grandes
  if (n > 20) return Math.sqrt(2 * Math.PI * n) * Math.pow(n / Math.E, n);
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
