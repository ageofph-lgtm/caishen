import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, ArrowLeft, Save, RefreshCw, Info, TrendingUp, BarChart2, Shield, FlaskConical, ShieldCheck, Dices, Wand2, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import NumberBall from '../components/lottery/NumberBall';
import { predictNext, backtest, selectBestStrategy, STRATEGIES, clearModelCache } from '@/lib/predictionEngine';

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
        let effective = strategy;
        let autoInfo = null;

        // Modo Auto: os dados escolhem — testa todas e exige significância.
        if (strategy === 'auto') {
          const key = `${selectedLottery}|__auto__`;
          autoInfo = backtestCache.current[key];
          if (!autoInfo) {
            autoInfo = selectBestStrategy(draws, currentLottery);
            backtestCache.current[key] = autoInfo;
          }
          effective = autoInfo.strategy;
        }

        // Backtest (pesado) memoizado por loteria+estratégia.
        const key = `${selectedLottery}|${effective}`;
        let bt = backtestCache.current[key];
        if (!bt) {
          bt = autoInfo?.results?.[effective] || backtest(draws, currentLottery, { strategy: effective });
          backtestCache.current[key] = bt;
        }
        const r = predictNext(draws, currentLottery, { strategy: effective, backtest: bt });
        setResult({ ...r, autoInfo, requestedStrategy: strategy });
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
        algorithm: `caishen_v4_${result.strategy}`,
        parameters: {
          metrics: result.metrics,
          score_parts: result.score_parts,
          backtest: result.backtest,
          reliability: result.reliability,
          requested_strategy: result.requestedStrategy,
          auto_reason: result.autoInfo?.reason || null,
          draws_analyzed: result.drawsAnalyzed,
        },
        confidence_score: result.confidence,
        was_validated: false,
        notes: `Motor v4 (${result.strategyLabel}). ${result.backtest ? `Backtest: ${result.backtest.avgHits} vs ${result.backtest.randomBaseline} acaso, p=${result.backtest.pValue} (${result.backtest.significant ? 'significativo' : 'ruído'}), n=${result.backtest.samples}.` : ''} Viés: p=${result.reliability?.bias?.pValue} (${result.reliability?.bias?.biased ? 'detetado' : 'sem viés'}). Dados: ${result.reliability?.dataQuality?.used} usados, ${result.reliability?.dataQuality?.rejected} rejeitados.`,
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
              <h1 className="text-xl font-black text-white tracking-tight">Motor de Previsão v4</h1>
              <p className="text-xs" style={{ color: '#64748b' }}>Rigor estatístico · viés testado · significância real</p>
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

        {/* Modo Auto — deixa os dados escolherem */}
        <button onClick={() => { setStrategy('auto'); setResult(null); }}
          className="w-full py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
          style={{
            background: strategy === 'auto' ? 'rgba(217,119,6,0.18)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${strategy === 'auto' ? '#d97706' : 'rgba(255,255,255,0.08)'}`,
            color: strategy === 'auto' ? '#fbbf24' : '#94a3b8',
          }}>
          <Wand2 className="w-3.5 h-3.5" />
          Modo Auto — os dados escolhem a estratégia
        </button>

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
          {strategy === 'auto'
            ? <><strong style={{ color: '#fbbf24' }}>Auto:</strong> testa todas as estratégias por backtest e escolhe a que os dados justificam com significância estatística. Se nenhuma bater o acaso, escolhe Anti-Humano e explica porquê.</>
            : <><strong style={{ color: stratMeta.color }}>{stratMeta.label}:</strong> {stratMeta.desc}</>}
        </p>

        {/* Info banner */}
        <div className="rounded-2xl p-4 flex gap-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <p className="text-xs leading-relaxed" style={{ color: '#fcd34d' }}>
            <strong>Transparência:</strong> uma loteria justa é imprevisível — nenhum motor garante acertos.
            O que é previsível é <strong>quantos</strong> acertos terás, não <strong>quais</strong> números saem.
            Este motor testa o sorteio quanto a viés real, mede-se por backtest com significância
            estatística, e só chama "sinal" ao que sobrevive ao teste. O resto, diz que é ruído.
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

        {/* Modo Auto — o raciocínio do programa */}
        {result?.autoInfo && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-5 space-y-2"
            style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.22)' }}>
            <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: '#fbbf24' }}>
              <Wand2 className="w-3.5 h-3.5" /> Decisão automática
            </p>
            <p className="text-xs leading-relaxed" style={{ color: '#fcd34d' }}>
              {result.autoInfo.reason}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {result.autoInfo.ranked.map(r => (
                <span key={r.key} className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: r.key === result.strategy ? 'rgba(217,119,6,0.25)' : 'rgba(255,255,255,0.05)',
                    color: r.key === result.strategy ? '#fbbf24' : '#64748b',
                    border: `1px solid ${r.key === result.strategy ? 'rgba(217,119,6,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  }}>
                  {STRATEGIES[r.key]?.label}: {(r.lift * 100).toFixed(1)}% (p={r.pValue})
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Qualidade dos dados — confiabilidade começa aqui */}
        {result?.reliability && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-5 space-y-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: '#94a3b8' }}>
              <ShieldCheck className="w-3.5 h-3.5" /> Integridade dos dados
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-3 rounded-xl" style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <p className="text-lg font-black" style={{ color: '#4ade80' }}>{result.reliability.dataQuality.used}</p>
                <p className="text-[9px] mt-0.5" style={{ color: '#475569' }}>sorteios válidos usados</p>
              </div>
              <div className="text-center p-3 rounded-xl"
                style={{
                  background: result.reliability.dataQuality.rejected > 0 ? 'rgba(248,113,113,0.07)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${result.reliability.dataQuality.rejected > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)'}`,
                }}>
                <p className="text-lg font-black" style={{ color: result.reliability.dataQuality.rejected > 0 ? '#f87171' : '#64748b' }}>
                  {result.reliability.dataQuality.rejected}
                </p>
                <p className="text-[9px] mt-0.5" style={{ color: '#475569' }}>registos corrompidos excluídos</p>
              </div>
            </div>
            {result.reliability.dataQuality.rejectedSamples.length > 0 && (
              <div className="space-y-1 pt-1">
                {result.reliability.dataQuality.rejectedSamples.map((r, i) => (
                  <p key={i} className="text-[10px] flex items-start gap-1.5" style={{ color: '#f87171' }}>
                    <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span><strong>{r.draw_date}</strong>: {r.reason}</span>
                  </p>
                ))}
                <p className="text-[9px] pt-1" style={{ color: '#475569' }}>
                  Estes registos estavam a contaminar o modelo. Agora ficam de fora.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* Teste de viés — há realmente algo a prever? */}
        {result?.reliability?.bias && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-5 space-y-2"
            style={{
              background: result.reliability.bias.biased ? 'rgba(34,197,94,0.07)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${result.reliability.bias.biased ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
            }}>
            <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: '#94a3b8' }}>
              <Dices className="w-3.5 h-3.5" /> O sorteio é justo? (qui-quadrado)
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: '#64748b' }}>
                χ² = {result.reliability.bias.chi2} · gl = {result.reliability.bias.df} · p = {result.reliability.bias.pValue}
              </span>
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full"
                style={{
                  background: result.reliability.bias.biased ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
                  color: result.reliability.bias.biased ? '#4ade80' : '#94a3b8',
                }}>
                {result.reliability.bias.biased ? 'VIÉS DETETADO' : 'SEM VIÉS'}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: '#475569' }}>
              {result.reliability.bias.biased
                ? 'Há desvio real da uniformidade: as frequências ("números quentes") têm justificação estatística nesta loteria.'
                : 'As frequências são compatíveis com puro acaso. Logo "números quentes" são ruído, não sinal — e o programa não finge o contrário.'}
            </p>
          </motion.div>
        )}

        {/* Prever o imprevisível — o que a matemática GARANTE */}
        {result?.reliability && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-5 space-y-3"
            style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)' }}>
            <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: '#a5b4fc' }}>
              <TrendingUp className="w-3.5 h-3.5" /> Prever o imprevisível
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: '#c7d2fe' }}>
              Não é possível prever <strong>quais</strong> números saem. É possível prever, com rigor matemático,
              <strong> quantos</strong> vais acertar:
            </p>
            <div className="text-center p-4 rounded-2xl" style={{ background: 'rgba(99,102,241,0.12)' }}>
              <p className="text-2xl font-black" style={{ color: '#a5b4fc' }}>
                {result.reliability.likelyRange.min}–{result.reliability.likelyRange.max} acertos
              </p>
              <p className="text-[10px] mt-1" style={{ color: '#818cf8' }}>
                com {(result.reliability.likelyRange.coverage * 100).toFixed(1)}% de certeza
              </p>
            </div>
            <div className="space-y-1">
              {result.reliability.odds.filter(o => o.probability > 0.0001).map(o => (
                <div key={o.hits} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold w-14" style={{ color: '#64748b' }}>{o.hits} acerto{o.hits !== 1 ? 's' : ''}</span>
                  <div className="flex-1 rounded-full h-1.5" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${o.probability * 100}%`, background: '#6366f1' }} />
                  </div>
                  <span className="text-[10px] font-bold w-24 text-right" style={{ color: '#94a3b8' }}>
                    {(o.probability * 100).toFixed(2)}% · 1 em {o.oneIn.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px]" style={{ color: '#475569' }}>
              Esperado por aposta: <strong style={{ color: '#64748b' }}>{result.reliability.expectedHits} acertos</strong> (±{result.reliability.hitSd}).
              Esta é a ordem real dentro do caos.
            </p>
          </motion.div>
        )}

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
              taxa de 2+ acertos: <strong style={{ color: '#64748b' }}>{Math.round(bt.hitRate2 * 100)}%</strong>
              {bt.zScore !== undefined && <> · z = <strong style={{ color: '#64748b' }}>{bt.zScore}</strong></>}.
            </p>
            {bt.verdict && (
              <p className="text-[11px] font-bold leading-relaxed px-3 py-2 rounded-xl"
                style={{
                  background: bt.significant ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
                  color: bt.significant ? '#4ade80' : '#94a3b8',
                }}>
                Veredicto: {bt.verdict}
              </p>
            )}
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
                <Shield className="w-3 h-3" /> P(2+ acertos) {confidence}%
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
