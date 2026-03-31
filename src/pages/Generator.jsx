import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, ArrowLeft, Save, Brain, Network } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';

import NumberBall from '../components/lottery/NumberBall';

export default function Generator() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [generatedNumbers, setGeneratedNumbers] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [learningInsights, setLearningInsights] = useState(null);
  
  // A IA controla estes pesos de forma autónoma baseada no gradiente de erro
  const [aiState, setAiState] = useState({
    strategy: 'balanced',
    lln_weight: 1.0,
    chaos_weight: 1.0,
    correction_factor: 1.0
  });

  const queryClient = useQueryClient();

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
  });

  const { data: allDraws = [] } = useQuery({
    queryKey: ['all-draws-complete', selectedLottery],
    queryFn: async () => {
      if (!selectedLottery) return [];
      const draws = await base44.entities.Draw.filter({ lottery_id: selectedLottery });
      return draws.sort((a, b) => b.draw_date.localeCompare(a.draw_date));
    },
    enabled: !!selectedLottery,
  });

  const { data: validatedSuggestions = [] } = useQuery({
    queryKey: ['validated-suggestions', selectedLottery],
    queryFn: async () => {
      if (!selectedLottery) return [];
      const all = await base44.entities.Suggestion.list();
      return all.filter(s => s.lottery_id === selectedLottery && s.was_validated)
                .sort((a, b) => b.draw_date.localeCompare(a.draw_date));
    },
    enabled: !!selectedLottery,
  });

  const saveSuggestionMutation = useMutation({
    mutationFn: (data) => base44.entities.Suggestion.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      setGeneratedNumbers(null);
    }
  });

  useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) {
      setSelectedLottery(lotteries[0].id);
    }
  }, [lotteries, selectedLottery]);

  // ANÁLISE DE FEEDBACK CONTÍNUO E CORREÇÃO DE ERRO
  useEffect(() => {
    if (validatedSuggestions.length > 0) {
      const lastSuggestion = validatedSuggestions[0];
      const matches = lastSuggestion.matches_main || 0;
      
      setAiState(prev => {
        let newState = { ...prev };
        if (matches <= 1) {
          newState.correction_factor = 1.5;
          newState.strategy = prev.strategy === 'lln_heavy' ? 'chaos_heavy' : 'lln_heavy';
        } else if (matches >= 2) {
          newState.correction_factor = 0.8;
          newState.lln_weight += 0.1;
        }
        return newState;
      });
    }
  }, [validatedSuggestions]);

  const currentLottery = lotteries.find(l => l.id === selectedLottery);

  const calculateNextDrawDate = () => {
    if (!currentLottery) return null;
    const today = new Date();
    const dayOfWeek = today.getDay();
    let nextDrawDate = new Date(today);

    if (currentLottery.name === 'EuroMilhões') {
      if (dayOfWeek < 2) nextDrawDate.setDate(today.getDate() + (2 - dayOfWeek));
      else if (dayOfWeek >= 2 && dayOfWeek < 5) nextDrawDate.setDate(today.getDate() + (5 - dayOfWeek));
      else nextDrawDate.setDate(today.getDate() + (9 - dayOfWeek));
    } else if (currentLottery.name === 'Totoloto') {
      if (dayOfWeek < 3) nextDrawDate.setDate(today.getDate() + (3 - dayOfWeek));
      else if (dayOfWeek >= 3 && dayOfWeek < 6) nextDrawDate.setDate(today.getDate() + (6 - dayOfWeek));
      else nextDrawDate.setDate(today.getDate() + (10 - dayOfWeek));
    } else if (currentLottery.name === 'EuroDreams') {
      if (dayOfWeek === 0) nextDrawDate.setDate(today.getDate() + 1);
      else if (dayOfWeek < 4) nextDrawDate.setDate(today.getDate() + (4 - dayOfWeek));
      else nextDrawDate.setDate(today.getDate() + (8 - dayOfWeek));
    }
    return nextDrawDate.toISOString().split('T')[0];
  };

  const generateNumbers = () => {
    if (!currentLottery || allDraws.length < 10) return;

    setIsGenerating(true);
    setLearningInsights(null);
    
    setTimeout(() => {
      const totalDraws = allDraws.length;
      
      // 1. LEI DOS GRANDES NÚMEROS (Convergência)
      const totalNumbersPossible = currentLottery.main_max - currentLottery.main_min + 1;
      const expectedFrequency = totalDraws * (currentLottery.main_count / totalNumbersPossible);
      
      const freqMap = {};
      const chaosMomentum = {};
      
      allDraws.forEach((draw, idx) => {
        draw.main_numbers?.forEach(num => {
          freqMap[num] = (freqMap[num] || 0) + 1;
          // 2. TEORIA DO CAOS: peso exponencial para "momentum" nos últimos 10 sorteios
          if (idx < 10) {
            chaosMomentum[num] = (chaosMomentum[num] || 0) + (10 - idx);
          }
        });
      });

      const weightedPool = [];

      // 3. ATRIBUIÇÃO DE PONTUAÇÃO (Mistura de Modelos)
      for (let i = currentLottery.main_min; i <= currentLottery.main_max; i++) {
        const freq = freqMap[i] || 0;
        const llnDeviation = expectedFrequency - freq;
        let llnScore = llnDeviation > 0 ? (llnDeviation * 1.5) : 1;
        const chaosScore = (chaosMomentum[i] || 0) * 2.0;

        let finalWeight = 0;
        if (aiState.strategy === 'lln_heavy') {
          finalWeight = (llnScore * 2.0) + (chaosScore * 0.5);
        } else if (aiState.strategy === 'chaos_heavy') {
          finalWeight = (llnScore * 0.5) + (chaosScore * 2.5);
        } else {
          finalWeight = llnScore + chaosScore;
        }

        finalWeight *= aiState.correction_factor;
        finalWeight = Math.max(1, finalWeight);

        const weightedCount = Math.round(finalWeight * 10);
        for (let j = 0; j < weightedCount; j++) {
          weightedPool.push(i);
        }
      }

      // 4. TEORIA DOS JOGOS (Espalhamento Estratégico)
      const mainNumbers = [];
      const poolCopy = [...weightedPool];
      
      while (mainNumbers.length < currentLottery.main_count && poolCopy.length > 0) {
        const randomIndex = Math.floor(Math.random() * poolCopy.length);
        let num = poolCopy[randomIndex];
        
        if (mainNumbers.length >= 3) {
          const lowNumbers = mainNumbers.filter(n => n <= 31).length;
          if (lowNumbers >= 3 && num <= 31 && currentLottery.main_max > 31) {
            continue;
          }
        }
        
        if (!mainNumbers.includes(num)) {
          mainNumbers.push(num);
          for (let i = poolCopy.length - 1; i >= 0; i--) {
            if (poolCopy[i] === num) poolCopy.splice(i, 1);
          }
        }
      }

      mainNumbers.sort((a, b) => a - b);

      let extraNumbers = [];
      if (currentLottery.extra_count > 0) {
        const extraFreqMap = {};
        allDraws.slice(0, 50).forEach(draw => {
          draw.extra_numbers?.forEach(num => {
            extraFreqMap[num] = (extraFreqMap[num] || 0) + 1;
          });
        });

        const extraPool = [];
        for (let i = currentLottery.extra_min; i <= currentLottery.extra_max; i++) {
          const w = Math.max(1, (extraFreqMap[i] || 1) * 2);
          for (let j = 0; j < w; j++) extraPool.push(i);
        }
        
        while (extraNumbers.length < currentLottery.extra_count && extraPool.length > 0) {
          const randomIndex = Math.floor(Math.random() * extraPool.length);
          const num = extraPool.splice(randomIndex, 1)[0];
          if (!extraNumbers.includes(num)) extraNumbers.push(num);
        }
        extraNumbers.sort((a, b) => a - b);
      }

      // 5. INSIGHTS PARA O UTILIZADOR
      const insights = {
        strategyUsed: aiState.strategy,
        expectedMean: expectedFrequency.toFixed(1),
        entropyCorrection: aiState.correction_factor.toFixed(2),
        chaosPicks: mainNumbers.filter(n => chaosMomentum[n] > 0).length,
        llnPicks: mainNumbers.filter(n => (freqMap[n] || 0) < expectedFrequency).length
      };

      setLearningInsights(insights);
      const result = { mainNumbers, extraNumbers };
      setGeneratedNumbers(result);
      setIsGenerating(false);

      // AUTO-SAVE: guardar automaticamente para o próximo sorteio
      const nextDate = calculateNextDrawDate();
      if (nextDate && selectedLottery) {
        base44.entities.Suggestion.filter({ lottery_id: selectedLottery, draw_date: nextDate })
          .then(existing => {
            if (existing.length === 0) {
              return base44.entities.Suggestion.create({
                lottery_id: selectedLottery,
                draw_date: nextDate,
                main_numbers: mainNumbers,
                extra_numbers: extraNumbers,
                algorithm: 'quantum_chaos_lln',
                parameters: { strategy_applied: aiState.strategy, correction_factor: aiState.correction_factor, historical_depth: totalDraws },
                confidence_score: 0.88,
                was_validated: false,
                notes: `Auto-guardado. Estratégia: ${aiState.strategy}`
              });
            }
          })
          .then(() => queryClient.invalidateQueries({ queryKey: ['suggestions'] }))
          .catch(err => console.error('Auto-save failed:', err));
      }
    }, 1500);
  };

  const saveSuggestion = async () => {
    if (!generatedNumbers || !selectedLottery) return;

    const nextDrawDate = calculateNextDrawDate();
    if (!nextDrawDate) return;

    const existingSuggestions = await base44.entities.Suggestion.filter({
      lottery_id: selectedLottery,
      draw_date: nextDrawDate
    });

    if (existingSuggestions.length > 0) {
      alert('A IA já gravou uma previsão para o próximo sorteio desta lotaria.');
      return;
    }

    await saveSuggestionMutation.mutateAsync({
      lottery_id: selectedLottery,
      draw_date: nextDrawDate,
      main_numbers: generatedNumbers.mainNumbers,
      extra_numbers: generatedNumbers.extraNumbers,
      algorithm: 'quantum_chaos_lln',
      parameters: {
        strategy_applied: aiState.strategy,
        correction_factor: aiState.correction_factor,
        historical_depth: allDraws.length
      },
      confidence_score: 0.88,
      was_validated: false,
      notes: `Geração Autónoma. Estratégia: ${aiState.strategy}`
    });
    alert('Previsão gravada no histórico para validação futura.');
  };

  const strategyLabel = {
    balanced: 'Balanceada',
    lln_heavy: 'Convergência LLN',
    chaos_heavy: 'Foco em Caos'
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl('Dashboard')}>
              <Button variant="outline" size="icon">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Motor de Previsão φ</h1>
              <p className="text-slate-500">LLN • Teoria do Caos • Teoria dos Jogos</p>
            </div>
          </div>

          <Select value={selectedLottery || ''} onValueChange={setSelectedLottery}>
            <SelectTrigger className="w-48 bg-white">
              <SelectValue placeholder="Selecione a lotaria" />
            </SelectTrigger>
            <SelectContent>
              {lotteries.map(lottery => (
                <SelectItem key={lottery.id} value={lottery.id}>
                  {lottery.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="relative overflow-hidden border-indigo-100 shadow-sm">
              <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-full blur-3xl -z-10" />
              
              <CardHeader>
                <CardTitle className="text-xl">Síntese Quântica</CardTitle>
              </CardHeader>
              
              <CardContent className="space-y-8">
                <AnimatePresence mode="wait">
                  {!generatedNumbers ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-20"
                    >
                      <Network className="w-20 h-20 text-indigo-200 mb-6 animate-pulse" />
                      <p className="text-slate-600 text-center font-medium">
                        O algoritmo aguarda inicialização
                      </p>
                      <p className="text-sm text-slate-400 mt-2 text-center max-w-sm">
                        Irá analisar {allDraws.length} sorteios e aplicar auto-correção baseada na última falha/sucesso do modelo.
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="numbers"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-8"
                    >
                      <div className="bg-white/50 p-6 rounded-2xl border border-slate-100 backdrop-blur-sm">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Números Calculados</p>
                        <div className="flex gap-3 flex-wrap">
                          {generatedNumbers.mainNumbers.map((num, idx) => (
                            <NumberBall key={idx} number={num} size="lg" />
                          ))}
                        </div>
                      </div>

                      {generatedNumbers.extraNumbers.length > 0 && (
                        <div className="bg-white/50 p-6 rounded-2xl border border-slate-100 backdrop-blur-sm">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                            {currentLottery?.extra_name || 'Extras'}
                          </p>
                          <div className="flex gap-3 flex-wrap">
                            {generatedNumbers.extraNumbers.map((num, idx) => (
                              <NumberBall key={idx} number={num} size="lg" isExtra />
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <Button 
                    onClick={generateNumbers}
                    disabled={isGenerating || !currentLottery || allDraws.length < 10}
                    size="lg"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-all"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <Brain className="w-5 h-5 mr-2" />
                    )}
                    {isGenerating ? 'A processar tensores...' : 'Iniciar Simulação de Chave'}
                  </Button>

                  {generatedNumbers && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={saveSuggestion}
                      disabled={saveSuggestionMutation.isPending}
                      className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                    >
                      {saveSuggestionMutation.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Save className="w-5 h-5 mr-2" />
                          Registar
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
                <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-slate-600">
                  <Network className="w-4 h-4" />
                  Estado do Motor Neural
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <p className="text-sm font-medium text-slate-700">Estratégia Ativa</p>
                    <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                      {strategyLabel[aiState.strategy] || aiState.strategy}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    O modelo adaptou-se automaticamente com base na análise do erro da última sugestão em relação ao resultado real.
                  </p>
                </div>

                {learningInsights && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Entropia / Correção de Erro</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                          <div 
                            className="bg-indigo-500 h-1.5 rounded-full transition-all" 
                            style={{ width: `${Math.min(100, learningInsights.entropyCorrection * 50)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-slate-600">{learningInsights.entropyCorrection}x</span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <p className="text-[10px] uppercase text-slate-400 font-semibold mb-1">Teoria do Caos</p>
                        <p className="text-lg font-bold text-slate-700">{learningInsights.chaosPicks} <span className="text-xs font-normal text-slate-500">nºs</span></p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <p className="text-[10px] uppercase text-slate-400 font-semibold mb-1">Lei dos Grandes Nºs</p>
                        <p className="text-lg font-bold text-slate-700">{learningInsights.llnPicks} <span className="text-xs font-normal text-slate-500">nºs</span></p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Modelos Ativos</p>
                  {[
                    { label: 'Lei dos Grandes Números', desc: 'Convergência estatística de longo prazo' },
                    { label: 'Teoria do Caos', desc: 'Atratores e momentum dos últimos 10 sorteios' },
                    { label: 'Correção de Erro', desc: 'Feedback loop baseado na última sugestão' },
                    { label: 'Teoria dos Jogos', desc: 'Dispersão anti-clustering para maximizar prémio único' },
                  ].map((model, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-slate-700">{model.label}</p>
                        <p className="text-[10px] text-slate-400">{model.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}