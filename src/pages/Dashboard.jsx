import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, TrendingUp, BarChart3, Clock, Info, Database, Upload, RefreshCw, AlertCircle, Check, Award, Brain } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';

import StatsCard from '../components/lottery/StatsCard';
import DrawCard from '../components/lottery/DrawCard';
import FrequencyChart from '../components/lottery/FrequencyChart';
import UploadDrawsButton from '../components/lottery/UploadDrawsButton';

export default function Dashboard() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRepopulating, setIsRepopulating] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);

  const queryClient = useQueryClient();

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: async () => {
      const all = await base44.entities.Lottery.filter({ is_active: true });
      // Remove duplicates by name
      const unique = [];
      const seen = new Set();
      all.forEach(lottery => {
        if (!seen.has(lottery.name)) {
          seen.add(lottery.name);
          unique.push(lottery);
        }
      });
      return unique;
    },
  });

  const { data: recentDraws = [] } = useQuery({
    queryKey: ['draws', selectedLottery],
    queryFn: () => selectedLottery
      ? base44.entities.Draw.filter({ lottery_id: selectedLottery }, '-draw_date', 10)
      : [],
    enabled: !!selectedLottery,
  });

  const { data: allDraws = [] } = useQuery({
    queryKey: ['all-draws', selectedLottery],
    queryFn: () => selectedLottery
      ? base44.entities.Draw.filter({ lottery_id: selectedLottery })
      : [],
    enabled: !!selectedLottery,
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ['suggestions', selectedLottery],
    queryFn: () => selectedLottery
      ? base44.entities.Suggestion.filter({ lottery_id: selectedLottery }, '-created_date', 5)
      : [],
    enabled: !!selectedLottery,
  });

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) {
      // Ensure selectedLottery is set to the first unique lottery's ID
      setSelectedLottery(lotteries[0].id);
    }
  }, [lotteries, selectedLottery]);

  const handleSync = async () => {
        setIsSyncing(true);
        setSyncMessage(null);

        try {
          const response = await base44.functions.invoke('syncLotteryDraws');

          if (response.data.success) {
            setSyncMessage({
              type: 'success',
              text: response.data.message
            });
            queryClient.invalidateQueries({ queryKey: ['draws'] });
            queryClient.invalidateQueries({ queryKey: ['all-draws'] });
          } else {
            setSyncMessage({
              type: 'error',
              text: response.data.message || 'Erro desconhecido ao sincronizar.'
            });
          }
        } catch (error) {
          setSyncMessage({
            type: 'error',
            text: error.message || 'Erro ao sincronizar'
          });
        } finally {
          setIsSyncing(false);
          setTimeout(() => setSyncMessage(null), 5000);
        }
      };

      const handleRepopulate = async () => {
        setIsRepopulating(true);
        setSyncMessage({ type: 'info', text: '⏳ Recuperando dados históricos... Isso pode demorar alguns minutos.' });

        try {
          const response = await base44.functions.invoke('repopulateDraws');

          if (response.data.success) {
            setSyncMessage({
              type: 'success',
              text: response.data.message
            });
            queryClient.invalidateQueries({ queryKey: ['draws'] });
            queryClient.invalidateQueries({ queryKey: ['all-draws'] });
          } else {
            setSyncMessage({
              type: 'error',
              text: response.data.error || 'Erro ao recuperar dados.'
            });
          }
        } catch (error) {
          setSyncMessage({
            type: 'error',
            text: error.message || 'Erro ao recuperar'
          });
        } finally {
          setIsRepopulating(false);
          setTimeout(() => setSyncMessage(null), 10000);
        }
      };

  const calculateFrequency = () => {
    const freqMap = {};
    recentDraws.forEach(draw => {
      draw.main_numbers?.forEach(num => {
        freqMap[num] = (freqMap[num] || 0) + 1;
      });
    });
    return Object.entries(freqMap)
      .map(([number, frequency]) => ({ number: parseInt(number), frequency }))
      .sort((a, b) => a.number - b.number);
  };

  const frequencyData = calculateFrequency();
  const currentLottery = lotteries.find(l => l.id === selectedLottery);

  const formatLastDrawDate = () => {
    try {
      if (!recentDraws[0]?.draw_date) return '--';
      const date = new Date(recentDraws[0].draw_date);
      if (isNaN(date.getTime())) return '--';
      return date.toLocaleDateString('pt-PT');
    } catch {
      return '--';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-blue-50">
      {/* Top Bar with Logo */}
      <div className="bg-white shadow-xl border-b border-indigo-100">
        <div className="max-w-7xl mx-auto py-4 px-6 flex justify-center">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68e7d9054f905ab0cb15db1c/c02da0b50_Gemini_Generated_Image_b05kdwb05kdwb05k.png" 
            alt="Caishen Logo" 
            className="h-20 w-auto"
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-6 p-6">
        {/* Header Redesenhado */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white p-6 rounded-3xl shadow-xl border border-indigo-50">
          <div>
            <h1 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
              CAISHEN AI
            </h1>
            <p className="text-gray-400 font-medium mt-1">Motor de Inteligência Preditiva</p>
          </div>

          <div className="flex gap-3 w-full md:w-auto flex-wrap">
            <Select value={selectedLottery || ''} onValueChange={setSelectedLottery}>
              <SelectTrigger className="w-48 border-indigo-200">
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

            <Button
              variant="ghost"
              onClick={handleSync}
              disabled={isSyncing || isRepopulating}
              className="text-indigo-600"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </Button>

            <Button
              variant="ghost"
              onClick={() => setShowDataPanel(!showDataPanel)}
              className="text-gray-600"
            >
              <Database className="w-4 h-4" />
            </Button>

            <Link to={createPageUrl('Generator')}>
              <Button className="h-12 px-8 bg-gradient-to-r from-blue-600 to-indigo-700 hover:scale-105 transition-transform rounded-2xl shadow-lg">
                <Sparkles className="mr-2 h-5 w-5" />
                Gerar Previsão Certeira
              </Button>
            </Link>
          </div>
          </div>

          {/* Card de Status do Machine Learning */}
          <Card className="bg-gradient-to-br from-indigo-900 to-purple-900 text-white p-6 border-none overflow-hidden relative">
          <div className="relative z-10 flex justify-between items-center">
             <div>
               <p className="text-indigo-200 text-sm uppercase tracking-wider font-semibold">Status do Aprendizado</p>
               <h2 className="text-3xl font-bold mt-1">{allDraws.length} Sorteios Analisados</h2>
               <p className="text-indigo-300 text-sm mt-2">IA em modo autônomo • Performance crescente</p>
             </div>
             <Brain className="w-16 h-16 opacity-30" />
          </div>
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl"></div>
          </Card>

        {/* Sync Message */}
        {syncMessage && (
          <Alert
            variant={syncMessage.type === 'error' ? 'destructive' : 'default'}
            className={syncMessage.type === 'success' ? 'border-green-500 bg-green-50' : ''}
          >
            {syncMessage.type === 'success' ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription className={syncMessage.type === 'success' ? 'text-green-800' : ''}>
              {syncMessage.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Data Management Panel */}
        {showDataPanel && (
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-purple-50">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Importar Histórico de Sorteios
            </h3>

            <Alert className="mb-4 border-blue-200 bg-blue-50">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-800">
                Faça upload de um ficheiro Excel (.xlsx) ou CSV com os dados históricos.
                <br />O ficheiro deve ter as colunas: Data, Números Principais, Números Extras
              </AlertDescription>
            </Alert>

            <div className="grid md:grid-cols-3 gap-4">
              {lotteries.map(lottery => (
                <UploadDrawsButton
                  key={lottery.id}
                  lotteryId={lottery.id}
                  lotteryName={lottery.name}
                />
              ))}
            </div>

            {allDraws.length > 0 && (
              <div className="mt-4 p-3 bg-white rounded-lg border">
                <p className="text-sm text-gray-600">
                  <strong>{allDraws.length}</strong> sorteios de <strong>{currentLottery?.name}</strong> na base de dados
                  {recentDraws.length > 0 && (
                    <> • Último: <strong>{new Date(recentDraws[0].draw_date).toLocaleDateString('pt-PT')}</strong></>
                  )}
                </p>
              </div>
            )}
          </Card>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Total de Sorteios"
            value={allDraws.length}
            icon={BarChart3}
            color="blue"
          />
          <StatsCard
            title="Sugestões Geradas"
            value={suggestions.length}
            icon={Sparkles}
            color="purple"
          />
          <StatsCard
            title="Taxa de Acerto"
            value="--"
            trend={0}
            icon={TrendingUp}
            color="green"
          />
          <StatsCard
            title="Último Sorteio"
            value={formatLastDrawDate()}
            icon={Clock}
            color="yellow"
          />
        </div>

        {/* Charts and Recent Draws */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {frequencyData.length > 0 ? (
              <FrequencyChart data={frequencyData} />
            ) : (
              <Card className="p-12">
                <div className="text-center text-gray-500">
                  <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium mb-2">Sem dados para análise</p>
                  <p className="text-sm mb-4">Importe ou sincronize os sorteios</p>
                  <Button
                    variant="outline"
                    onClick={() => setShowDataPanel(true)}
                  >
                    <Database className="w-4 h-4 mr-2" />
                    Abrir Gestão de Dados
                  </Button>
                </div>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-bold">Sorteios Recentes</h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {recentDraws.slice(0, 5).map(draw => (
                <DrawCard key={draw.id} draw={draw} />
              ))}
              {recentDraws.length === 0 && (
                <Card className="p-6">
                  <p className="text-center text-gray-500 text-sm">
                    Nenhum sorteio disponível.<br/>
                    Importe ou sincronize os dados.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-3 gap-4">
          <Link to={createPageUrl('Analysis')} className="block">
            <Card className="p-6 hover:shadow-lg transition-all cursor-pointer bg-gradient-to-br from-blue-50 to-blue-100">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500 rounded-xl">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold">Análise Detalhada</h3>
                  <p className="text-sm text-gray-600">Padrões e estatísticas</p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to={createPageUrl('SuggestionsHistory')} className="block">
            <Card className="p-6 hover:shadow-lg transition-all cursor-pointer bg-gradient-to-br from-green-50 to-green-100">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500 rounded-xl">
                  <Award className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold">Histórico de Sugestões</h3>
                  <p className="text-sm text-gray-600">Performance das previsões</p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to={createPageUrl('AIChat')} className="block">
            <Card className="p-6 hover:shadow-lg transition-all cursor-pointer bg-gradient-to-br from-purple-50 to-purple-100">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-500 rounded-xl">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold">Assistente IA</h3>
                  <p className="text-sm text-gray-600">Análise inteligente</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}