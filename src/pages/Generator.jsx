import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, ArrowLeft, Save, RefreshCw, TrendingUp, Brain } from 'lucide-react';
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
  
  // Auto-learning weights (no manual control)
  const [settings, setSettings] = useState({
    weights: {
      base_frequency: 1.0,
      recency_hot: 1.5,
      delay_cold: 1.8,
      pair_affinity: 0.5,
      even_odd_balance: 0.4,
    }
  });

  const queryClient = useQueryClient();

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
  });

  // Buscar TODOS os sorteios (não apenas 50)
  const { data: allDraws = [] } = useQuery({
    queryKey: ['all-draws-complete', selectedLottery],
    queryFn: async () => {
      if (!selectedLottery) return [];
      const draws = await base44.entities.Draw.filter({ lottery_id: selectedLottery });
      console.log('Total draws loaded:', draws.length);
      return draws.sort((a, b) => b.draw_date.localeCompare(a.draw_date));
    },
    enabled: !!selectedLottery,
  });

  const { data: validatedSuggestions = [] } = useQuery({
    queryKey: ['validated-suggestions', selectedLottery],
    queryFn: async () => {
      if (!selectedLottery) return [];
      const all = await base44.entities.Suggestion.list();
      const filtered = all.filter(s => s.lottery_id === selectedLottery && s.was_validated);
      console.log('Validated suggestions loaded:', filtered.length);
      return filtered;
    },
    enabled: !!selectedLottery,
  });

  const saveSuggestionMutation = useMutation({
    mutationFn: (data) => base44.entities.Suggestion.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      alert('Sugestão salva com sucesso!');
      setGeneratedNumbers(null);
    },
    onError: (error) => {
      console.error('Erro ao salvar sugestão:', error);
      alert('Erro ao salvar sugestão: ' + error.message);
    }
  });

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) {
      setSelectedLottery(lotteries[0].id);
    }
  }, [lotteries, selectedLottery]);

  // Auto-adjust weights based on validated suggestions performance
  React.useEffect(() => {
    if (validatedSuggestions.length >= 3) {
      console.log('🧠 Analyzing', validatedSuggestions.length, 'validated suggestions...');
      
      // Calculate average performance
      const avgMatches = validatedSuggestions.reduce((sum, s) => sum + (s.matches_main || 0), 0) / validatedSuggestions.length;
      
      // Analyze which numbers worked best
      const successfulNumbers = {};
      validatedSuggestions.forEach(sugg => {
        if (sugg.matches_main > 0) {
          sugg.main_numbers.forEach(num => {
            if (sugg.actual_main_numbers && sugg.actual_main_numbers.includes(num)) {
              successfulNumbers[num] = (successfulNumbers[num] || 0) + 1;
            }
          });
        }
      });

      const topSuccessfulNumbers = Object.entries(successfulNumbers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([num]) => parseInt(num));

      console.log('📊 Top successful numbers from AI:', topSuccessfulNumbers);
      console.log('📈 Average matches:', avgMatches.toFixed(2));
      
      // Adjust weights based on performance
      let adjustmentFactor = 1.0;
      if (avgMatches < 1) {
        adjustmentFactor = 0.8;
        console.log('⚠️ Low performance - reducing confidence');
      } else if (avgMatches < 2) {
        adjustmentFactor = 0.95;
        console.log('📉 Medium performance - slight adjustment');
      } else {
        console.log('✅ Good performance - maintaining strategy');
      }
      
      if (adjustmentFactor !== 1.0) {
        setSettings(prev => ({
          ...prev,
          weights: {
            base_frequency: prev.weights.base_frequency * adjustmentFactor,
            recency_hot: prev.weights.recency_hot * (1 / adjustmentFactor),
            delay_cold: prev.weights.delay_cold * adjustmentFactor,
            pair_affinity: prev.weights.pair_affinity,
            even_odd_balance: prev.weights.even_odd_balance,
          }
        }));
      }
    }
  }, [validatedSuggestions]);

  const currentLottery = lotteries.find(l => l.id === selectedLottery);

  const calculateNextDrawDate = () => {
    if (!currentLottery) return null;

    const today = new Date();
    const dayOfWeek = today.getDay();
    let nextDrawDate = new Date(today);

    if (currentLottery.name === 'EuroMilhões') {
      if (dayOfWeek < 2) {
        nextDrawDate.setDate(today.getDate() + (2 - dayOfWeek));
      } else if (dayOfWeek >= 2 && dayOfWeek < 5) {
        nextDrawDate.setDate(today.getDate() + (5 - dayOfWeek));
      } else {
        nextDrawDate.setDate(today.getDate() + (9 - dayOfWeek));
      }
    } else if (currentLottery.name === 'Totoloto') {
      if (dayOfWeek < 3) {
        nextDrawDate.setDate(today.getDate() + (3 - dayOfWeek));
      } else if (dayOfWeek >= 3 && dayOfWeek < 6) {
        nextDrawDate.setDate(today.getDate() + (6 - dayOfWeek));
      } else {
        nextDrawDate.setDate(today.getDate() + (10 - dayOfWeek));
      }
    } else if (currentLottery.name === 'EuroDreams') {
      if (dayOfWeek === 0) {
        nextDrawDate.setDate(today.getDate() + 1);
      } else if (dayOfWeek < 4) {
        nextDrawDate.setDate(today.getDate() + (4 - dayOfWeek));
      } else {
        nextDrawDate.setDate(today.getDate() + (8 - dayOfWeek));
      }
    }

    return nextDrawDate.toISOString().split('T')[0];
  };

  const generateNumbers = () => {
    if (!currentLottery || allDraws.length < 10) return;

    setIsGenerating(true);
    setLearningInsights(null);
    
    setTimeout(async () => {
      console.log('\n🎲 === GENERATING NUMBERS ===');
      console.log('📊 Using', allDraws.length, 'historical draws');
      console.log('🧠 Learning from', validatedSuggestions.length, 'validated suggestions');

      // PHASE 1: Analyze historical draws
      const freqMap = {};
      const delayMap = {};
      const pairMap = {};
      
      allDraws.forEach((draw, idx) => {
        draw.main_numbers?.forEach(num => {
          freqMap[num] = (freqMap[num] || 0) + 1;
          if (!delayMap[num]) delayMap[num] = idx;
        });

        // Analyze pairs
        for (let i = 0; i < (draw.main_numbers?.length || 0) - 1; i++) {
          for (let j = i + 1; j < (draw.main_numbers?.length || 0); j++) {
            const pair = [draw.main_numbers[i], draw.main_numbers[j]].sort().join('-');
            pairMap[pair] = (pairMap[pair] || 0) + 1;
          }
        }
      });

      // PHASE 2: Analyze AI suggestions performance
      const successfulNumbers = new Set();
      const aiRecommendedNumbers = {};
      
      validatedSuggestions.forEach(sugg => {
        // Track which numbers the AI suggested
        sugg.main_numbers.forEach(num => {
          aiRecommendedNumbers[num] = (aiRecommendedNumbers[num] || 0) + 1;
        });

        // Track which ones actually worked
        if (sugg.matches_main > 0) {
          sugg.main_numbers.forEach(num => {
            if (sugg.actual_main_numbers && sugg.actual_main_numbers.includes(num)) {
              successfulNumbers.add(num);
            }
          });
        }
      });

      console.log('✅ AI successful numbers:', Array.from(successfulNumbers));
      console.log('🎯 Most recommended by AI:', Object.entries(aiRecommendedNumbers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([num, count]) => `${num}(${count}x)`));

      // PHASE 3: Create weighted pool with combined intelligence
      const weightedPool = [];
      const numberScores = {};
      
      for (let i = currentLottery.main_min; i <= currentLottery.main_max; i++) {
        const freq = freqMap[i] || 0;
        const delay = delayMap[i] !== undefined ? delayMap[i] : allDraws.length;
        const aiRecommendations = aiRecommendedNumbers[i] || 0;
        
        let weight = settings.weights.base_frequency * (freq + 1);
        
        // LEARNING: Major boost for numbers that worked in AI suggestions
        if (successfulNumbers.has(i)) {
          weight *= 2.0;
          console.log(`🚀 Boosting ${i} - worked in AI suggestions`);
        }
        
        // Bonus for numbers frequently recommended by AI
        if (aiRecommendations > 0) {
          weight *= (1 + (aiRecommendations * 0.2));
        }
        
        // Hot numbers bonus (recent 20 draws)
        const recentFreq = allDraws.slice(0, 20).filter(d => 
          d.main_numbers?.includes(i)
        ).length;
        if (recentFreq > 0) {
          weight += settings.weights.recency_hot * recentFreq;
        }
        
        // Cold numbers bonus
        if (delay > 30) {
          weight += settings.weights.delay_cold * (delay / 20);
        }

        numberScores[i] = weight;
        const weightedCount = Math.max(1, Math.round(weight * 10));
        for (let j = 0; j < weightedCount; j++) {
          weightedPool.push(i);
        }
      }

      // PHASE 4: Select main numbers with pair affinity
      const mainNumbers = [];
      const poolCopy = [...weightedPool];
      
      while (mainNumbers.length < currentLottery.main_count && poolCopy.length > 0) {
        const randomIndex = Math.floor(Math.random() * poolCopy.length);
        let num = poolCopy[randomIndex];
        
        // Pair affinity: if we have numbers already, boost numbers that pair well
        if (mainNumbers.length > 0 && settings.weights.pair_affinity > 0) {
          const pairScores = {};
          
          poolCopy.forEach(candidate => {
            if (mainNumbers.includes(candidate)) return;
            
            let pairScore = 0;
            mainNumbers.forEach(existing => {
              const pair = [existing, candidate].sort().join('-');
              pairScore += (pairMap[pair] || 0);
            });
            
            pairScores[candidate] = pairScore;
          });
          
          // Occasionally pick based on pair affinity (30% of the time)
          if (Math.random() < 0.3) {
            const topPairs = Object.entries(pairScores)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10);
            
            if (topPairs.length > 0 && topPairs[0][1] > 0) {
              num = parseInt(topPairs[Math.floor(Math.random() * Math.min(3, topPairs.length))][0]);
            }
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
      console.log('🎯 Generated numbers:', mainNumbers);

      // Generate extra numbers with similar logic
      let extraNumbers = [];
      if (currentLottery.extra_count > 0) {
        const extraPool = [];
        for (let i = currentLottery.extra_min; i <= currentLottery.extra_max; i++) {
          extraPool.push(i);
        }
        
        while (extraNumbers.length < currentLottery.extra_count && extraPool.length > 0) {
          const randomIndex = Math.floor(Math.random() * extraPool.length);
          extraNumbers.push(extraPool.splice(randomIndex, 1)[0]);
        }
        extraNumbers.sort((a, b) => a - b);
      }

      // PHASE 5: Generate insights
      const topNumbers = Object.entries(numberScores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([num]) => parseInt(num));

      const insights = {
        totalDrawsAnalyzed: allDraws.length,
        suggestionsLearned: validatedSuggestions.length,
        aiSuccessfulCount: successfulNumbers.size,
        topRecommended: topNumbers,
        selectedFromAI: mainNumbers.filter(n => successfulNumbers.has(n)).length
      };

      setLearningInsights(insights);
      setGeneratedNumbers({ mainNumbers, extraNumbers });
      setIsGenerating(false);

      console.log('📊 Insights:', insights);
      console.log('=== GENERATION COMPLETE ===\n');

      // AUTO-SAVE: Salva automaticamente a sugestão
      const nextDrawDate = calculateNextDrawDate();
      if (nextDrawDate && selectedLottery) {
        try {
          const existingSuggestions = await base44.entities.Suggestion.filter({
            lottery_id: selectedLottery,
            draw_date: nextDrawDate
          });

          if (existingSuggestions.length === 0) {
            await base44.entities.Suggestion.create({
              lottery_id: selectedLottery,
              draw_date: nextDrawDate,
              main_numbers: mainNumbers,
              extra_numbers: extraNumbers,
              algorithm: 'auto_learning_ai',
              parameters: {
                weights: settings.weights,
                learned_from_suggestions: validatedSuggestions.length,
                total_draws_analyzed: allDraws.length,
                auto_saved: true
              },
              confidence_score: 0.80,
              was_validated: false,
              notes: `Auto-salvo em ${new Date().toLocaleString('pt-PT')}`
            });
            console.log('✅ Sugestão salva automaticamente');
            queryClient.invalidateQueries({ queryKey: ['suggestions'] });
          }
        } catch (autoSaveError) {
          console.error('Erro ao auto-salvar:', autoSaveError);
        }
      }
      }, 1500);
      };

      // Gerar números para todas as loterias automaticamente ao carregar
      const generateForAllLotteries = async () => {
      for (const lottery of lotteries) {
        const draws = await base44.entities.Draw.filter({ lottery_id: lottery.id });
        if (draws.length < 10) continue;

        const nextDrawDate = (() => {
          const today = new Date();
          const dayOfWeek = today.getDay();
          let nextDate = new Date(today);

          if (lottery.name === 'EuroMilhões') {
            if (dayOfWeek < 2) nextDate.setDate(today.getDate() + (2 - dayOfWeek));
            else if (dayOfWeek >= 2 && dayOfWeek < 5) nextDate.setDate(today.getDate() + (5 - dayOfWeek));
            else nextDate.setDate(today.getDate() + (9 - dayOfWeek));
          } else if (lottery.name === 'Totoloto') {
            if (dayOfWeek < 3) nextDate.setDate(today.getDate() + (3 - dayOfWeek));
            else if (dayOfWeek >= 3 && dayOfWeek < 6) nextDate.setDate(today.getDate() + (6 - dayOfWeek));
            else nextDate.setDate(today.getDate() + (10 - dayOfWeek));
          } else if (lottery.name === 'EuroDreams') {
            if (dayOfWeek === 0) nextDate.setDate(today.getDate() + 1);
            else if (dayOfWeek < 4) nextDate.setDate(today.getDate() + (4 - dayOfWeek));
            else nextDate.setDate(today.getDate() + (8 - dayOfWeek));
          }
          return nextDate.toISOString().split('T')[0];
        })();

        // Verificar se já existe sugestão para essa data
        const existing = await base44.entities.Suggestion.filter({
          lottery_id: lottery.id,
          draw_date: nextDrawDate
        });

        if (existing.length > 0) continue;

        // Gerar números simples para auto-save
        const freqMap = {};
        draws.forEach(d => d.main_numbers?.forEach(n => freqMap[n] = (freqMap[n] || 0) + 1));

        const pool = [];
        for (let i = lottery.main_min; i <= lottery.main_max; i++) {
          const weight = Math.max(1, (freqMap[i] || 0) * 10);
          for (let j = 0; j < weight; j++) pool.push(i);
        }

        const mainNumbers = [];
        while (mainNumbers.length < lottery.main_count && pool.length > 0) {
          const idx = Math.floor(Math.random() * pool.length);
          const num = pool[idx];
          if (!mainNumbers.includes(num)) mainNumbers.push(num);
          pool.splice(idx, 1);
        }
        mainNumbers.sort((a, b) => a - b);

        const extraNumbers = [];
        if (lottery.extra_count > 0) {
          const extraPool = [];
          for (let i = lottery.extra_min; i <= lottery.extra_max; i++) extraPool.push(i);
          while (extraNumbers.length < lottery.extra_count && extraPool.length > 0) {
            const idx = Math.floor(Math.random() * extraPool.length);
            extraNumbers.push(extraPool.splice(idx, 1)[0]);
          }
          extraNumbers.sort((a, b) => a - b);
        }

        await base44.entities.Suggestion.create({
          lottery_id: lottery.id,
          draw_date: nextDrawDate,
          main_numbers: mainNumbers,
          extra_numbers: extraNumbers,
          algorithm: 'auto_batch',
          confidence_score: 0.75,
          was_validated: false,
          notes: `Gerado automaticamente em ${new Date().toLocaleString('pt-PT')}`
        });

        console.log(`✅ Auto-gerado para ${lottery.name}: ${mainNumbers.join(', ')}`);
      }
      };

  const saveSuggestion = async () => {
    if (!generatedNumbers || !selectedLottery) {
      alert('Gere números primeiro!');
      return;
    }

    try {
      const nextDrawDate = calculateNextDrawDate();
      
      if (!nextDrawDate) {
        alert('Não foi possível calcular a data do próximo sorteio');
        return;
      }

      const existingSuggestions = await base44.entities.Suggestion.filter({
        lottery_id: selectedLottery,
        draw_date: nextDrawDate
      });

      if (existingSuggestions.length > 0) {
        alert(`Já existe uma sugestão salva para ${currentLottery?.name} no dia ${nextDrawDate}`);
        return;
      }

      await saveSuggestionMutation.mutateAsync({
        lottery_id: selectedLottery,
        draw_date: nextDrawDate,
        main_numbers: generatedNumbers.mainNumbers,
        extra_numbers: generatedNumbers.extraNumbers,
        algorithm: 'auto_learning_ai',
        parameters: {
          weights: settings.weights,
          learned_from_suggestions: validatedSuggestions.length,
          total_draws_analyzed: allDraws.length,
          ai_successful_numbers: learningInsights?.aiSuccessfulCount || 0,
          auto_adjusted: true
        },
        confidence_score: 0.80,
        was_validated: false,
        notes: `Gerado com análise de ${allDraws.length} sorteios + aprendizado de ${validatedSuggestions.length} sugestões validadas`
      });

    } catch (error) {
      console.error('Error in saveSuggestion:', error);
      alert('Erro ao salvar: ' + error.message);
    }
  };

  const performanceStats = validatedSuggestions.length > 0 ? {
    total: validatedSuggestions.length,
    avgMatches: (validatedSuggestions.reduce((sum, s) => sum + (s.matches_main || 0), 0) / validatedSuggestions.length).toFixed(2),
    bestMatch: Math.max(...validatedSuggestions.map(s => s.matches_main || 0))
  } : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-purple-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl('Dashboard')}>
              <Button variant="outline" size="icon">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Gerador de Números</h1>
              <p className="text-gray-600">IA com Aprendizado Contínuo Robusto</p>
            </div>
          </div>

          <Select value={selectedLottery || ''} onValueChange={setSelectedLottery}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Selecione a loteria" />
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

        {/* Performance Stats */}
        {performanceStats && (
          <Card className="bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Brain className="w-8 h-8 text-green-600" />
                <div className="flex-1">
                  <p className="text-sm text-gray-600 font-semibold">Inteligência Artificial em Aprendizado</p>
                  <div className="flex gap-6 mt-2 flex-wrap">
                    <Badge variant="outline" className="bg-white">
                      📊 {allDraws.length} sorteios analisados
                    </Badge>
                    <Badge variant="outline" className="bg-white">
                      🧠 {performanceStats.total} sugestões validadas
                    </Badge>
                    <Badge variant="outline" className="bg-white">
                      📈 Média: {performanceStats.avgMatches} acertos
                    </Badge>
                    <Badge variant="outline" className="bg-white">
                      🏆 Melhor: {performanceStats.bestMatch} acertos
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Learning Insights */}
        {learningInsights && (
          <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5 text-purple-600" />
                Insights da IA
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600 mb-2">Números mais recomendados pela análise:</p>
                  <div className="flex gap-2 flex-wrap">
                    {learningInsights.topRecommended.slice(0, 8).map((num, idx) => (
                      <NumberBall key={idx} number={num} size="sm" />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Badge variant="outline">
                    ✅ {learningInsights.selectedFromAI} números da IA aplicados
                  </Badge>
                  <Badge variant="outline">
                    🎯 {learningInsights.aiSuccessfulCount} números com histórico de sucesso
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Generator Area */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full opacity-10 transform translate-x-32 -translate-y-32" />
              
              <CardHeader>
                <CardTitle>Números Gerados com IA</CardTitle>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <AnimatePresence mode="wait">
                  {!generatedNumbers ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-16"
                    >
                      <Brain className="w-16 h-16 text-gray-300 mb-4" />
                      <p className="text-gray-500 text-center">
                        Clique em "Gerar" para criar números com IA
                      </p>
                      <p className="text-sm text-gray-400 mt-2">
                        Usando {allDraws.length} sorteios + {validatedSuggestions.length} sugestões validadas
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="numbers"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="space-y-6"
                    >
                      <div>
                        <p className="text-sm text-gray-500 mb-3">Números Principais</p>
                        <div className="flex gap-3 flex-wrap">
                          {generatedNumbers.mainNumbers.map((num, idx) => (
                            <NumberBall 
                              key={idx} 
                              number={num} 
                              size="lg"
                              selected={learningInsights && learningInsights.topRecommended.includes(num)}
                            />
                          ))}
                        </div>
                      </div>

                      {generatedNumbers.extraNumbers.length > 0 && (
                        <div>
                          <p className="text-sm text-gray-500 mb-3">
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

                <div className="flex gap-3">
                  <Button 
                    onClick={generateNumbers}
                    disabled={isGenerating || !currentLottery || allDraws.length < 10}
                    className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Gerando com IA...
                      </>
                    ) : (
                      <>
                        <Brain className="w-4 h-4 mr-2" />
                        Gerar Números
                      </>
                    )}
                  </Button>

                  {generatedNumbers && (
                    <>
                      <Button
                        variant="outline"
                        onClick={generateNumbers}
                        disabled={isGenerating}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        onClick={saveSuggestion}
                        disabled={saveSuggestionMutation.isPending}
                      >
                        {saveSuggestionMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                      </Button>
                    </>
                  )}
                </div>

                {allDraws.length < 10 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800">
                      ⚠️ Necessário pelo menos 10 sorteios no histórico para gerar números
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Analysis Info */}
            {generatedNumbers && (
              <Card>
                <CardHeader>
                  <CardTitle>Análise da Combinação</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Números Pares</p>
                      <p className="text-2xl font-bold">
                        {generatedNumbers.mainNumbers.filter(n => n % 2 === 0).length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Números Ímpares</p>
                      <p className="text-2xl font-bold">
                        {generatedNumbers.mainNumbers.filter(n => n % 2 !== 0).length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Soma Total</p>
                      <p className="text-2xl font-bold">
                        {generatedNumbers.mainNumbers.reduce((a, b) => a + b, 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Média</p>
                      <p className="text-2xl font-bold">
                        {(generatedNumbers.mainNumbers.reduce((a, b) => a + b, 0) / generatedNumbers.mainNumbers.length).toFixed(1)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Auto-Learning Status */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-purple-600" />
                  Aprendizado Automático
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <p className="text-sm text-purple-900 font-semibold mb-2">
                    🧠 IA em Modo Autônomo
                  </p>
                  <p className="text-xs text-purple-700">
                    O algoritmo ajusta automaticamente suas estratégias baseado nos resultados reais. Quanto mais sorteios e validações, mais inteligente fica.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Frequência Base</p>
                    <div className="bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full" 
                        style={{ width: `${(settings.weights.base_frequency / 2) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Números Quentes</p>
                    <div className="bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-orange-500 h-2 rounded-full" 
                        style={{ width: `${(settings.weights.recency_hot / 3) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Números Frios</p>
                    <div className="bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-cyan-500 h-2 rounded-full" 
                        style={{ width: `${(settings.weights.delay_cold / 3) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Afinidade de Pares</p>
                    <div className="bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-purple-500 h-2 rounded-full" 
                        style={{ width: `${(settings.weights.pair_affinity / 2) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t">
                  <p className="text-xs text-gray-600 italic">
                    ✨ Pesos ajustados automaticamente após cada validação
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Próximos Passos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-600">
                <div className="flex items-start gap-2">
                  <span className="text-purple-600">1.</span>
                  <p>Gere números com a IA</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-600">2.</span>
                  <p>Salve a sugestão</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-600">3.</span>
                  <p>Sincronize após o sorteio</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-600">4.</span>
                  <p>IA aprende e melhora automaticamente</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}