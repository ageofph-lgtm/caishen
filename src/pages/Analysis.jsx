import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, TrendingUp, TrendingDown, Flame, Snowflake } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import FrequencyChart from '../components/lottery/FrequencyChart';
import NumberBall from '../components/lottery/NumberBall';

export default function Analysis() {
  const [selectedLottery, setSelectedLottery] = useState(null);

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
  });

  const { data: draws = [] } = useQuery({
    queryKey: ['draws', selectedLottery],
    queryFn: () => selectedLottery 
      ? base44.entities.Draw.filter({ lottery_id: selectedLottery }, '-draw_date', 100)
      : [],
    enabled: !!selectedLottery,
  });

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) {
      setSelectedLottery(lotteries[0].id);
    }
  }, [lotteries, selectedLottery]);

  const currentLottery = lotteries.find(l => l.id === selectedLottery);

  const analyzeNumbers = () => {
    const freqMap = {};
    const lastSeenMap = {};
    
    draws.forEach((draw, idx) => {
      draw.main_numbers?.forEach(num => {
        freqMap[num] = (freqMap[num] || 0) + 1;
        if (lastSeenMap[num] === undefined) {
          lastSeenMap[num] = idx;
        }
      });
    });

    const numbers = [];
    for (let i = currentLottery?.main_min || 1; i <= (currentLottery?.main_max || 50); i++) {
      numbers.push({
        number: i,
        frequency: freqMap[i] || 0,
        delay: lastSeenMap[i] !== undefined ? lastSeenMap[i] : draws.length
      });
    }

    return numbers;
  };

  const stats = analyzeNumbers();
  const sortedByFreq = [...stats].sort((a, b) => b.frequency - a.frequency);
  const sortedByDelay = [...stats].sort((a, b) => b.delay - a.delay);

  const hotNumbers = sortedByFreq.slice(0, 10);
  const coldNumbers = sortedByDelay.slice(0, 10);

  const frequencyData = stats.map(s => ({
    number: s.number,
    frequency: s.frequency
  }));

  const calculatePairs = () => {
    const pairMap = {};
    
    draws.forEach(draw => {
      const nums = draw.main_numbers || [];
      for (let i = 0; i < nums.length; i++) {
        for (let j = i + 1; j < nums.length; j++) {
          const pair = [nums[i], nums[j]].sort((a, b) => a - b).join('-');
          pairMap[pair] = (pairMap[pair] || 0) + 1;
        }
      }
    });

    return Object.entries(pairMap)
      .map(([pair, count]) => ({
        pair: pair.split('-').map(Number),
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  };

  const topPairs = calculatePairs();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl('Dashboard')}>
              <Button variant="outline" size="icon">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Análise Estatística</h1>
              <p className="text-gray-600">Padrões e tendências dos sorteios</p>
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

        {/* Frequency Chart */}
        <FrequencyChart data={frequencyData} />

        {/* Hot and Cold Numbers */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-orange-500" />
                Números Quentes
              </CardTitle>
              <p className="text-sm text-gray-500">Mais sorteados recentemente</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {hotNumbers.map((item, idx) => (
                  <div key={item.number} className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-500 w-6">#{idx + 1}</span>
                      <NumberBall number={item.number} size="sm" />
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{item.frequency}x</p>
                      <p className="text-xs text-gray-500">Saídas</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Snowflake className="w-5 h-5 text-blue-500" />
                Números Frios
              </CardTitle>
              <p className="text-sm text-gray-500">Mais atrasados</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {coldNumbers.map((item, idx) => (
                  <div key={item.number} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-500 w-6">#{idx + 1}</span>
                      <NumberBall number={item.number} size="sm" />
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{item.delay}</p>
                      <p className="text-xs text-gray-500">Sorteios atrás</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Pairs */}
        <Card>
          <CardHeader>
            <CardTitle>Pares Mais Frequentes</CardTitle>
            <p className="text-sm text-gray-500">Números que mais saem juntos</p>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {topPairs.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <NumberBall number={item.pair[0]} size="sm" />
                    <span className="text-gray-400">+</span>
                    <NumberBall number={item.pair[1]} size="sm" />
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-purple-600">{item.count}x</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Statistics Summary */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p className="text-2xl font-bold">{hotNumbers[0]?.number || '--'}</p>
                <p className="text-sm text-gray-500">Número mais quente</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <TrendingDown className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                <p className="text-2xl font-bold">{coldNumbers[0]?.number || '--'}</p>
                <p className="text-sm text-gray-500">Número mais frio</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Flame className="w-8 h-8 mx-auto mb-2 text-orange-500" />
                <p className="text-2xl font-bold">{hotNumbers[0]?.frequency || 0}</p>
                <p className="text-sm text-gray-500">Máximo de saídas</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Snowflake className="w-8 h-8 mx-auto mb-2 text-cyan-500" />
                <p className="text-2xl font-bold">{coldNumbers[0]?.delay || 0}</p>
                <p className="text-sm text-gray-500">Máximo de atraso</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}