import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, ArrowLeft, Save, RefreshCw, Info, TrendingUp, BarChart2, Shield, FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import NumberBall from '../components/lottery/NumberBall';
import { predictNext, backtest, STRATEGIES, clearModelCache } from '@/lib/predictionEngine';

// ══════════════════════════════════════════════════════════════════════════════
// CAISHEN v3 — Gerador por Ensemble Estatístico
// O motor (predictionEngine.js) aprende a assinatura dos sorteios reais e mede
// a sua própria performance via backtest walk-forward. Aqui só orquestramos a UI.
// ══════════════════════════════════════════════════════════════════════════════

function nextDrawDate(lotteryName) {
  const today = new Date();
  const d = today.getDay();
  const next = new Date(today);
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

function MetricBar({ label, value, color, tooltip }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-400 font-medium">{label}</span>
        <span className="font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="w-full bg-white/10 rounded-full h-2">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="h-2 rounded-full"
          style={{ background: color }}
        />
      </div>
      {tooltip && <p className="text-[10px] text-slate-500 leading-tight">{tooltip}</p>}
    </div>
  );
}

function factorial(n) {
  if (n <= 1) return 1;
  if (n > 20) return Math.sqrt(2 * Math.PI * n) * Math.pow(n / Math.E, n);
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export default function Generator() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [strategy, setStrategy] = useState('ensemble');
  const [result, setResult] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  // Cache de backtests: chave `${lotteryId}|${strategy}` → resultado.
  const backtestCache = useRef({});
  const queryClient = useQueryClient();

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
  });

  useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) {
      setSelectedLottery(lotteries[0].id);
    }
  }, [lotteries, selectedLottery]);

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
    setTimeout(() => {
      try {
        // Backtest (pesado) memoizado por loteria+estratégia.
        const key = `${selectedLottery}|${strategy}`;
        let bt = backtestCache.current[key];
        if (!bt) {
          bt = backtest(draws, currentLottery, { strategy });
          backtestCache.current[key] = bt;
        }
        const r = predictNext(draws, currentLottery, { strategy, backtest: bt });
        setResult(r);
      } catch (e) {
        console.error('Generation error:', e);
      }
      setIsGenerating(false);
    }, 50);
  };

  const save = async () => {
    if (!result || !currentLottery) return;
    const date = nextDrawDate(currentLottery.name);
    try {
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
        algorithm: `caishen_v3_${strategy}`,
        parameters: { metrics: result.metrics, score_parts: result.score_parts, backtest: result.backtest, draws_analyzed: result.drawsAnalyzed },
        confidence_score: result.confidence,
        was_validated: false,
        notes: `Ensemble v3 (${result.strategyLabel}). Backtest: ${result.backtest ? `${result.backtest.avgHits} acertos/sorteio vs ${result.backtest.randomBaseline} aleatório (n=${result.backtest.samples})` : 'n/d'}`,
      });
    } catch {
      setSavedMsg('Erro ao guardar');
      setTimeout(() => setSavedMsg(''), 3000);
    }
  };

  const metrics = result?.metrics;
  const confidence = result ? Math.round(result.confidence * 100) : null;
  const bt = result?.backtest;
  const liftPct = bt && bt.samples ? Math.round(bt.lift * 100) : null;
  const stratMeta = STRATEGIES[strategy] || STRATEGIES.ensemble;

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to={createPageUrl('Dashboard')}>
              <button className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <ArrowLeft className="w-4 h-4" />
              </button>
            </Link>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Motor de Previsão v3</h1>
              <p className="text-xs" style={{ color: '#64748b' }}>Ensemble estatístico validado por backtest</p>
            </div>
          </div>
          <Select value={selectedLottery || ''} onValueChange={v => { clearModelCache(); setSelectedLottery(v); setResult(null); }}>
            <SelectTrigger className="w-36 text-xs" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}>
              <SelectValue placeholder="Loteria" />
            </SelectTrigger>
            <SelectContent>
              {lotteries.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Seletor de estratégia */}
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(STRATEGIES).map(([key, s]) => {
            const active = strategy === key;
            return (
              <button key={key} onClick={() => { setStrategy(key); setResult(null); }}
                className="py-2 px-1 rounded-xl text-[10px] font-bold transition-all"
                style={{
                  background: active ? `${s.color}22` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? s.color : 'rgba(255,255,255,0.08)'}`,
                  color: active ? s.color : '#94a3b8',
                }}>
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] leading-relaxed -mt-2" style={{ color: '#64748b' }}>
          <strong style={{ color: stratMeta.color }}>{stratMeta.label}:</strong> {stratMeta.desc}
        </p>

        {/* Info banner */}
        <div className="rounded-2xl p-4 flex gap-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <p className="text-xs leading-relaxed" style={{ color: '#fcd34d' }}>
            <strong>Transparência:</strong> uma loteria justa é imprevisível — nenhum motor garante acertos.
            Este motor aprende a assinatura real dos sorteios e <strong>mede-se a si próprio</strong> (backtest):
            o "lift" mostra, sem ilusões, o quanto supera (ou não) o puro acaso.
          </p>
        </div>

        {/* Card principal */}
        <div className="rounded-3xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="p-6 space-y-6">

            <AnimatePresence mode="wait">
              {!result && !isGenerating && (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                    <Sparkles className="w-8 h-8" style={{ color: '#6366f1' }} />
                  </div>
                  <p className="text-sm text-center" style={{ color: '#64748b' }}>
                    {draws.length > 0
                      ? `${draws.length} sorteios no modelo — pronto para gerar`
                      : 'A carregar histórico...'}
                  </p>
                </motion.div>
              )}

              {isGenerating && (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#6366f1' }} />
                  <p className="text-sm" style={{ color: '#64748b' }}>A treinar modelo e validar com backtest...</p>
                </motion.div>
              )}

              {result && !isGenerating && (
                <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#475569' }}>
                      {currentLottery?.name}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {result.mainNumbers.map((num, i) => <NumberBall key={i} number={num} size="lg" />)}
                    </div>
                  </div>
                  {result.extraNumbers.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#475569' }}>
                        {currentLottery?.extra_name || 'Estrelas'}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {result.extraNumbers.map((num, i) => <NumberBall key={i} number={num} size="lg" isExtra />)}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Botões */}
            <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button onClick={generate}
                disabled={isGenerating || !currentLottery || draws.length < 5}
                className="flex-1 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-opacity disabled:opacity-40"
                style={{ background: '#6366f1', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
                {isGenerating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> A gerar...</>
                  : <><RefreshCw className="w-4 h-4" /> Gerar combinação</>}
              </button>
              {result && (
                <button onClick={save} disabled={saveMutation.isPending}
                  className="py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center gap-2 text-white transition-opacity disabled:opacity-40"
                  style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)' }}>
                  <Save className="w-4 h-4" />
                  {saveMutation.isPending ? '...' : 'Guardar'}
                </button>
              )}
            </div>

            {savedMsg && (
              <p className="text-center text-xs font-bold"
                style={{ color: savedMsg.startsWith('✓') ? '#4ade80' : '#fbbf24' }}>
                {savedMsg}
              </p>
            )}
          </div>
        </div>

        {/* Backtest — a prova honesta */}
        {result && bt && bt.samples > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-5 space-y-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: '#94a3b8' }}>
              <FlaskConical className="w-3.5 h-3.5" /> Backtest walk-forward
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                [bt.avgHits, 'Acertos/sorteio', '#a5b4fc'],
                [bt.randomBaseline, 'Acaso (baseline)', '#64748b'],
                [`${liftPct > 0 ? '+' : ''}${liftPct}%`, 'Lift vs acaso', liftPct > 5 ? '#4ade80' : liftPct < -5 ? '#f87171' : '#fbbf24'],
              ].map(([v, l, c]) => (
                <div key={l} className="text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <p className="text-lg font-black" style={{ color: c }}>{v}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: '#475569' }}>{l}</p>
                </div>
              ))}
            </div>
            {/* IC 95% + p-value */}
            <div className="grid grid-cols-2 gap-3 mt-1">
              {bt.ci95 && (
                <div className="text-center p-3 rounded-xl" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
                  <p className="text-sm font-black" style={{ color: '#a5b4fc' }}>
                    [{bt.ci95.lo} – {bt.ci95.hi}]
                  </p>
                  <p className="text-[9px] mt-0.5" style={{ color: '#475569' }}>IC 95% acertos/sorteio</p>
                  <p className="text-[8px] mt-0.5" style={{ color: '#334155' }}>
                    {bt.ci95.lo > bt.randomBaseline ? '✓ acima do acaso com 95% confiança' : '⚠ sobrepõe o acaso'}
                  </p>
                </div>
              )}
              {bt.pValue !== undefined && (
                <div className="text-center p-3 rounded-xl" style={{ background: bt.pValue < 0.05 ? 'rgba(34,197,94,0.07)' : 'rgba(245,158,11,0.07)', border: `1px solid ${bt.pValue < 0.05 ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
                  <p className="text-sm font-black" style={{ color: bt.pValue < 0.05 ? '#4ade80' : '#fbbf24' }}>
                    p = {bt.pValue}
                  </p>
                  <p className="text-[9px] mt-0.5" style={{ color: '#475569' }}>vs baseline aleatório</p>
                  <p className="text-[8px] mt-0.5" style={{ color: '#334155' }}>
                    {bt.pValue < 0.05 ? '✓ resultado estatisticamente significativo' : '⚠ dentro do ruído estatístico'}
                  </p>
                </div>
              )}
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: '#475569' }}>
              Testado em <strong style={{ color: '#64748b' }}>{bt.samples}</strong> sorteios reais (treino só com o passado).
              Melhor resultado: <strong style={{ color: '#64748b' }}>{bt.best} acertos</strong> ·
              taxa de 2+ acertos: <strong style={{ color: '#64748b' }}>{Math.round(bt.hitRate2 * 100)}%</strong>.
              {Math.abs(liftPct) <= 5
                ? ' Lift próximo de zero confirma a natureza aleatória — honesto e esperado.'
                : liftPct > 5
                  ? ' Lift positivo: esta estratégia bateu o acaso neste histórico.'
                  : ' Lift negativo neste histórico — experimente outra estratégia.'}
            </p>
          </motion.div>
        )}

        {/* Métricas da combinação */}
        {result && metrics && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-5 space-y-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: '#94a3b8' }}>
                <BarChart2 className="w-3.5 h-3.5" /> Encaixe no modelo real
              </p>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black"
                style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}>
                <Shield className="w-3 h-3" /> Confiança {confidence}%
              </div>
            </div>
            <MetricBar label="Força dos números (freq/atraso/momentum)" value={metrics.numberModel} color="#6366f1"
              tooltip="Quão fortes são os números escolhidos no modelo per-número" />
            <MetricBar label="Assinatura estatística" value={metrics.signature} color="#8b5cf6"
              tooltip="Encaixe em soma, paridade, dispersão, zonas e consecutivos dos sorteios reais" />
            <MetricBar label="Afinidade de pares" value={metrics.pairAffinity} color="#ec4899"
              tooltip="Frequência histórica com que estes números saíram juntos" />
            <MetricBar label="Encaixe posicional" value={metrics.positional} color="#06b6d4"
              tooltip="Cada número cai na faixa típica da sua posição ordenada" />
            <MetricBar label="Originalidade" value={metrics.originality} color="#10b981"
              tooltip="Distância face aos sorteios recentes — evita repetir o passado" />
            <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-[10px] leading-relaxed" style={{ color: '#475569' }}>
                <strong style={{ color: '#64748b' }}>Importante:</strong> estas métricas medem o encaixe estatístico,
                não a probabilidade de ganhar. A confiança deriva do <strong>lift real do backtest</strong>, não de promessas.
              </p>
            </div>
          </motion.div>
        )}

        {/* Contexto histórico */}
        {draws.length > 0 && currentLottery && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="rounded-2xl p-4"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1" style={{ color: '#475569' }}>
              <TrendingUp className="w-3 h-3" /> Contexto histórico
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Sorteios', draws.length.toLocaleString()],
                ['Range', `${currentLottery.main_min}–${currentLottery.main_max}`],
                ['Combinações', (() => {
                  const n = currentLottery.main_max;
                  const k = currentLottery.main_count;
                  const c = factorial(n) / (factorial(k) * factorial(n - k));
                  return c > 1e6 ? c.toExponential(1) : c.toLocaleString();
                })()],
              ].map(([l, v]) => (
                <div key={l} className="text-center p-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <p className="text-sm font-black text-white">{v}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>{l}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

      </div>
    </div>
  );
}
