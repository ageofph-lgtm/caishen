import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Clock, TrendingUp, BarChart2, Trophy, Loader2, RefreshCw, Euro } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import NumberBall from '../components/lottery/NumberBall';

function matchColor(n) {
  if (n === 0) return { bg: 'rgba(100,100,100,0.15)', text: '#94a3b8', border: 'rgba(100,100,100,0.2)' };
  if (n === 1) return { bg: 'rgba(234,179,8,0.12)', text: '#fbbf24', border: 'rgba(234,179,8,0.25)' };
  if (n === 2) return { bg: 'rgba(249,115,22,0.12)', text: '#fb923c', border: 'rgba(249,115,22,0.25)' };
  if (n === 3) return { bg: 'rgba(168,85,247,0.12)', text: '#c084fc', border: 'rgba(168,85,247,0.25)' };
  return { bg: 'rgba(34,197,94,0.12)', text: '#4ade80', border: 'rgba(34,197,94,0.25)' };
}

function algoLabel(algo) {
  // Motor v3 — ensemble estatístico por estratégia
  if (algo === 'caishen_v3_ensemble') return { label: 'Ensemble v3', color: '#6366f1' };
  if (algo === 'caishen_v3_hot') return { label: 'Quentes v3', color: '#f97316' };
  if (algo === 'caishen_v3_overdue') return { label: 'Atrasados v3', color: '#06b6d4' };
  if (algo === 'caishen_v3_pattern') return { label: 'Padrão Real v3', color: '#8b5cf6' };
  if (algo === 'caishen_v3_antihuman') return { label: 'Anti-Humano v3', color: '#10b981' };
  // Legado
  if (algo === 'anti_human_v2') return { label: 'Anti-Humano v2', color: '#6366f1' };
  if (algo === 'quantum_chaos_lln') return { label: 'Chaos+LLN v1', color: '#8b5cf6' };
  if (algo === 'auto_learning_ai') return { label: 'Auto-Learning', color: '#0891b2' };
  if (algo === 'manual') return { label: 'Manual', color: '#6b7280' };
  return { label: algo || 'Desconhecido', color: '#6b7280' };
}

export default function SuggestionsHistory() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [validatingId, setValidatingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
  });

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) setSelectedLottery(lotteries[0].id);
  }, [lotteries, selectedLottery]);

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) setSelectedLottery(lotteries[0].id);
  }, [lotteries]);

  const { data: suggestions = [], isLoading, refetch } = useQuery({
    queryKey: ['suggestions-history', selectedLottery],
    queryFn: async () => {
      const all = await base44.entities.Suggestion.list();
      return all
        .filter(s => s.lottery_id === selectedLottery)
        .sort((a, b) => new Date(b.draw_date) - new Date(a.draw_date));
    },
    enabled: !!selectedLottery,
  });

  // Validação manual de uma sugestão específica
  const validate = async (suggestion) => {
    setValidatingId(suggestion.id);
    try {
      const draws = await base44.entities.Draw.filter({ lottery_id: selectedLottery, draw_date: suggestion.draw_date });
      if (!draws.length) { alert('Sorteio real ainda não disponível para ' + suggestion.draw_date); return; }
      const actual = draws[0];
      const matchesMain = suggestion.main_numbers.filter(n => actual.main_numbers.includes(n)).length;
      const matchesExtra = (suggestion.extra_numbers || []).filter(n => (actual.extra_numbers || []).includes(n)).length;
      await base44.entities.Suggestion.update(suggestion.id, {
        actual_main_numbers: actual.main_numbers,
        actual_extra_numbers: actual.extra_numbers || [],
        matches_main: matchesMain,
        matches_extra: matchesExtra,
        was_validated: true,
      });
      queryClient.invalidateQueries({ queryKey: ['suggestions-history'] });
    } catch (e) { alert('Erro: ' + e.message); }
    setValidatingId(null);
  };

  const validated = suggestions.filter(s => s.was_validated);
  const pending   = suggestions.filter(s => !s.was_validated);

  // Stats globais
  const totalMatches = validated.reduce((s, x) => s + (x.matches_main || 0), 0);
  const avgMatches   = validated.length ? (totalMatches / validated.length).toFixed(2) : '—';
  const best         = validated.length ? Math.max(...validated.map(s => s.matches_main || 0)) : 0;
  const dist         = { 0: 0, 1: 0, 2: 0, '3+': 0 };
  validated.forEach(s => {
    const m = s.matches_main || 0;
    if (m >= 3) dist['3+']++;
    else dist[m]++;
  });

  // Por algoritmo
  const byAlgo = {};
  validated.forEach(s => {
    const a = s.algorithm || 'unknown';
    if (!byAlgo[a]) byAlgo[a] = { count: 0, matches: 0 };
    byAlgo[a].count++;
    byAlgo[a].matches += (s.matches_main || 0);
  });

  const currentLottery = lotteries.find(l => l.id === selectedLottery);

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
              <h1 className="text-xl font-black text-white">Histórico de Sugestões</h1>
              <p className="text-xs text-slate-400">{validated.length} validadas · {pending.length} pendentes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()}
              className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <Select value={selectedLottery || ''} onValueChange={setSelectedLottery}>
              <SelectTrigger className="w-32 bg-white/10 border-white/20 text-white text-xs">
                <SelectValue placeholder="Loteria" />
              </SelectTrigger>
              <SelectContent>
                {lotteries.map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* KPIs */}
        {validated.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {[
              [validated.length, 'Validadas', TrendingUp],
              [avgMatches, 'Média acertos', BarChart2],
              [best, 'Melhor', Trophy],
              [`${dist['3+']}`, '3+ acertos', CheckCircle2],
            ].map(([v, l, Icon]) => (
              <div key={l} className="rounded-2xl p-3 text-center border border-white/10"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Icon className="w-3.5 h-3.5 text-slate-400 mx-auto mb-1" />
                <p className="text-lg font-black text-white">{v}</p>
                <p className="text-[9px] text-slate-500 mt-0.5">{l}</p>
              </div>
            ))}
          </div>
        )}

        {/* Por algoritmo */}
        {Object.keys(byAlgo).length > 1 && (
          <div className="rounded-2xl border border-white/10 p-4"
            style={{ background: 'rgba(255,255,255,0.04)' }}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Performance por versão</p>
            <div className="space-y-2">
              {Object.entries(byAlgo)
                .sort((a, b) => (b[1].matches / b[1].count) - (a[1].matches / a[1].count))
                .map(([algo, data]) => {
                  const { label, color } = algoLabel(algo);
                  const avg = (data.matches / data.count).toFixed(2);
                  const pct = Math.min(100, (data.matches / data.count) / 0.9 * 100); // 0.9 = benchmark aleatório
                  return (
                    <div key={algo} className="flex items-center gap-3">
                      <div className="w-20 text-[10px] font-bold truncate" style={{ color }}>{label}</div>
                      <div className="flex-1 bg-white/10 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <div className="text-[10px] font-bold text-slate-300 w-14 text-right">
                        {avg}/sorteio · n={data.count}
                      </div>
                    </div>
                  );
                })}
            </div>
            <p className="text-[9px] text-slate-600 mt-2">Benchmark aleatório: ~0.50–0.90 acertos/sorteio</p>
          </div>
        )}

        {/* Lista de sugestões */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
          </div>
        ) : suggestions.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhuma sugestão ainda</p>
            <Link to={createPageUrl('Generator')}>
              <button className="mt-3 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors">
                Ir ao gerador →
              </button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Pendentes primeiro */}
            {pending.length > 0 && (
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
                ⏳ Aguardando resultado
              </p>
            )}
            {pending.map(s => (
              <SuggestionCard key={s.id} s={s} onValidate={validate} validatingId={validatingId} lottery={currentLottery} />
            ))}
            {validated.length > 0 && (
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pt-2">
                ✓ Validadas
              </p>
            )}
            {validated.map(s => (
              <SuggestionCard key={s.id} s={s} onValidate={validate} validatingId={validatingId} lottery={currentLottery} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({ s, onValidate, validatingId, lottery }) {
  const m = s.matches_main || 0;
  const me = s.matches_extra || 0;
  const mc = matchColor(m);
  const { label: algoLbl, color: algoColor } = algoLabel(s.algorithm);
  const conf = s.confidence_score ? Math.round(s.confidence_score * 100) : null;

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border p-4 space-y-3"
      style={{
        background: s.was_validated ? 'rgba(255,255,255,0.04)' : 'rgba(99,102,241,0.05)',
        borderColor: s.was_validated ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.2)',
      }}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-white">{s.draw_date}</p>
          <p className="text-[10px] font-semibold mt-0.5" style={{ color: algoColor }}>{algoLbl}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {conf && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-slate-400 bg-white/5 border border-white/10">
              Score {conf}%
            </span>
          )}
          {s.was_validated ? (
            <span className="text-[10px] font-black px-2 py-1 rounded-full border"
              style={{ background: mc.bg, color: mc.text, borderColor: mc.border }}>
              {m} acerto{m !== 1 ? 's' : ''}{me > 0 ? ` +${me}★` : ''}
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Pendente
            </span>
          )}
        </div>
      </div>

      {/* Números sugeridos */}
      <div>
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Sugerido</p>
        <div className="flex gap-1.5 flex-wrap">
          {(s.main_numbers || []).map((n, i) => {
            const hit = s.was_validated && (s.actual_main_numbers || []).includes(n);
            return (
              <span key={i} className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black transition-all"
                style={{
                  background: hit ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)',
                  color: hit ? '#4ade80' : '#cbd5e1',
                  border: hit ? '1.5px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.1)',
                }}>
                {n}
              </span>
            );
          })}
          {(s.extra_numbers || []).map((n, i) => {
            const hit = s.was_validated && (s.actual_extra_numbers || []).includes(n);
            return (
              <span key={`e${i}`} className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black"
                style={{
                  background: hit ? 'rgba(251,191,36,0.2)' : 'rgba(99,102,241,0.15)',
                  color: hit ? '#fbbf24' : '#818cf8',
                  border: hit ? '1.5px solid rgba(251,191,36,0.4)' : '1px solid rgba(99,102,241,0.3)',
                }}>
                {n}
              </span>
            );
          })}
        </div>
      </div>

      {/* Resultado real (se validado) */}
      {s.was_validated && (s.actual_main_numbers || []).length > 0 && (
        <div>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Resultado real</p>
          <div className="flex gap-1.5 flex-wrap">
            {(s.actual_main_numbers || []).map((n, i) => (
              <span key={i} className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-slate-300"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Botão validar (pendente) */}
      {!s.was_validated && (
        <button onClick={() => onValidate(s)}
          disabled={validatingId === s.id}
          className="w-full py-2.5 rounded-xl text-xs font-bold transition-all border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50">
          {validatingId === s.id
            ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> A validar...</span>
            : '✓ Validar resultado'}
        </button>
      )}
    </motion.div>
  );
}
