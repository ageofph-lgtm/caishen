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

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncMessage({ type: 'info', text: '🔄 Atualizando resultados e validando sugestões...' });

    try {
      const response = await base44.functions.invoke('syncLotteryDraws');

      if (response.data.success) {
        setSyncMessage({
          type: 'success',
          text: response.data.message || 'Atualização completa!'
        });
        queryClient.invalidateQueries({ queryKey: ['draws'] });
        queryClient.invalidateQueries({ queryKey: ['all-draws'] });
        queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      } else {
        setSyncMessage({
          type: 'error',
          text: response.data.error || 'Erro ao atualizar'
        });
      }
    } catch (error) {
      setSyncMessage({
        type: 'error',
        text: error.message || 'Erro ao atualizar'
      });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
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
    <div className="min-h-screen bg-slate-50">
      {/* NOVO HEADER DESIGN */}
      <div className="bg-white border-b border-slate-200 p-6 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
             <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg">
               <Sparkles className="text-white w-6 h-6" />
             </div>
             <div>
               <h1 className="text-2xl font-extrabold text-slate-900">CAISHEN INTELLIGENCE</h1>
               <p className="text-sm text-slate-500 font-medium">Motor de Probabilidades Adaptativo</p>
             </div>
          </div>

          <div className="flex gap-3 flex-wrap">
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

            <Button
              variant="outline"
              onClick={handleManualSync}
              disabled={isSyncing}
              className="border-green-200 text-green-600 hover:bg-green-50"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              Atualizar Resultados
            </Button>

            <Button
              variant="ghost"
              onClick={() => setShowDataPanel(!showDataPanel)}
              className="text-gray-600"
            >
              <Database className="w-4 h-4" />
            </Button>

            <Link to={createPageUrl('Generator')}>
              <Button className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200">
                <Sparkles className="mr-2 h-5 w-5" />
                Gerar Previsão IA
              </Button>
            </Link>
          </div>
          </div>
          </div>

          <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* INDICADOR DE SAÚDE DOS DADOS */}
          <Card className="bg-gradient-to-r from-slate-900 to-indigo-900 text-white p-6 border-none">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-indigo-300 text-xs uppercase font-bold tracking-widest">Estado da Inteligência</p>
              <h2 className="text-3xl font-bold mt-1">{allDraws.length} Sorteios no Cérebro</h2>
              <p className="text-indigo-200/60 text-sm mt-2">Dados sincronizados e validados automaticamente via Santa Casa.</p>
            </div>
            <Brain className="w-16 h-16 text-white/20" />
          </div>
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