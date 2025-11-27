import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, Calendar, Filter, BarChart3, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import DrawCard from '../components/lottery/DrawCard';

export default function History() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedDraws, setSelectedDraws] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState(null);

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (drawIds) => {
      for (const id of drawIds) {
        await base44.entities.Draw.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['draws'] });
      setSelectedDraws([]);
      setMessage({ type: 'success', text: 'Sorteios apagados com sucesso!' });
      setTimeout(() => setMessage(null), 3000);
    }
  });

  const handleSync = async () => {
    setIsSyncing(true);
    setMessage(null);
    try {
      const response = await base44.functions.invoke('syncSantaCasa');
      setMessage({ 
        type: response.data.success ? 'success' : 'error', 
        text: response.data.message 
      });
      queryClient.invalidateQueries({ queryKey: ['draws'] });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const toggleSelectDraw = (drawId) => {
    setSelectedDraws(prev => 
      prev.includes(drawId) 
        ? prev.filter(id => id !== drawId)
        : [...prev, drawId]
    );
  };

  const handleDeleteSelected = () => {
    if (selectedDraws.length === 0) return;
    if (confirm(`Tem certeza que deseja apagar ${selectedDraws.length} sorteio(s)?`)) {
      deleteMutation.mutate(selectedDraws);
    }
  };

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

  const filterDraws = () => {
    let filtered = [...draws];

    // Filter by date
    if (dateFilter !== 'all') {
      const now = new Date();
      const filterDate = new Date();

      if (dateFilter === 'week') {
        filterDate.setDate(now.getDate() - 7);
      } else if (dateFilter === 'month') {
        filterDate.setMonth(now.getMonth() - 1);
      } else if (dateFilter === 'year') {
        filterDate.setFullYear(now.getFullYear() - 1);
      }

      filtered = filtered.filter(d => new Date(d.draw_date) >= filterDate);
    }

    // Filter by search term (numbers)
    if (searchTerm) {
      const searchNum = parseInt(searchTerm);
      if (!isNaN(searchNum)) {
        filtered = filtered.filter(d =>
          d.main_numbers?.includes(searchNum) || d.extra_numbers?.includes(searchNum)
        );
      }
    }

    return filtered;
  };

  const filteredDraws = filterDraws();

  const formatDate = (dateStr) => {
    try {
      if (!dateStr) return '--';
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '--';
      return date.toLocaleDateString('pt-PT');
    } catch (error) {
      console.error("Error formatting date:", error);
      return '--';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl('Dashboard')}>
              <Button variant="outline" size="icon">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Histórico de Sorteios</h1>
              <p className="text-gray-600">Consulte todos os sorteios realizados</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSync}
              disabled={isSyncing}
              className="bg-green-50 hover:bg-green-100 border-green-200"
            >
              {isSyncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sincronizar Santa Casa
            </Button>
            {selectedDraws.length > 0 && (
              <Button
                variant="destructive"
                onClick={handleDeleteSelected}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Apagar ({selectedDraws.length})
              </Button>
            )}
          </div>
        </div>

        {message && (
          <Alert className={message.type === 'success' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
            <AlertDescription className={message.type === 'success' ? 'text-green-800' : 'text-red-800'}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid md:grid-cols-4 gap-4">
              <Select value={selectedLottery || ''} onValueChange={setSelectedLottery}>
                <SelectTrigger>
                  <SelectValue placeholder="Loteria" />
                </SelectTrigger>
                <SelectContent>
                  {lotteries.map(lottery => (
                    <SelectItem key={lottery.id} value={lottery.id}>
                      {lottery.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os períodos</SelectItem>
                  <SelectItem value="week">Última semana</SelectItem>
                  <SelectItem value="month">Último mês</SelectItem>
                  <SelectItem value="year">Último ano</SelectItem>
                </SelectContent>
              </Select>

              <div className="md:col-span-2 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Buscar por número..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total de Sorteios</p>
                  <p className="text-2xl font-bold mt-1">{filteredDraws.length}</p>
                </div>
                <BarChart3 className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Último Sorteio</p>
                  <p className="text-xl font-bold mt-1">
                    {formatDate(filteredDraws[0]?.draw_date)}
                  </p>
                </div>
                <Calendar className="w-8 h-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Resultados</p>
                  <p className="text-2xl font-bold mt-1">{filteredDraws.length}</p>
                </div>
                <Filter className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Draws Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDraws.map(draw => (
            <div key={draw.id} className="relative">
              <div 
                className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 cursor-pointer flex items-center justify-center transition-all ${
                  selectedDraws.includes(draw.id) 
                    ? 'bg-red-500 border-red-500 text-white' 
                    : 'bg-white border-gray-300 hover:border-red-400'
                }`}
                onClick={() => toggleSelectDraw(draw.id)}
              >
                {selectedDraws.includes(draw.id) && <Trash2 className="w-3 h-3" />}
              </div>
              <DrawCard draw={draw} />
            </div>
          ))}
        </div>

        {filteredDraws.length === 0 && (
          <Card className="p-12">
            <div className="text-center text-gray-500">
              <Calendar className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium mb-2">Nenhum sorteio encontrado</p>
              <p className="text-sm">Tente ajustar os filtros ou sincronize os dados históricos</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}