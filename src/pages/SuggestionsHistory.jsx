
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, Award, TrendingUp, Calendar, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import NumberBall from '../components/lottery/NumberBall';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function SuggestionsHistory() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [validationMessage, setValidationMessage] = useState(null);
  const queryClient = useQueryClient();

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
  });

  const { data: suggestions = [], refetch: refetchSuggestions } = useQuery({
    queryKey: ['suggestions', selectedLottery],
    queryFn: async () => {
      if (!selectedLottery) return [];
      
      console.log('Fetching suggestions for lottery:', selectedLottery);
      const allSuggestions = await base44.entities.Suggestion.list('-created_date', 100);
      
      console.log('All suggestions:', allSuggestions.length);
      
      // Filter by lottery_id
      const filtered = allSuggestions.filter(s => {
        console.log('Checking suggestion:', s.id, 'lottery_id:', s.lottery_id, 'vs', selectedLottery);
        return s.lottery_id === selectedLottery;
      });
      
      console.log('Filtered suggestions for', selectedLottery, ':', filtered.length);
      
      return filtered;
    },
    enabled: !!selectedLottery,
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      console.log('Starting validation...');
      const response = await base44.functions.invoke('validateSuggestions');
      console.log('Validation response:', response);
      return response.data;
    },
    onSuccess: (data) => {
      console.log('Validation success:', data);
      if (data.success) {
        setValidationMessage({
          type: 'success',
          text: data.message
        });
        refetchSuggestions(); // Force refetch
      } else {
        setValidationMessage({
          type: 'error',
          text: data.error || 'Erro ao validar'
        });
      }
      setTimeout(() => setValidationMessage(null), 5000);
    },
    onError: (error) => {
      console.error('Validation error:', error);
      setValidationMessage({
        type: 'error',
        text: error.message || 'Erro ao validar sugestões'
      });
      setTimeout(() => setValidationMessage(null), 5000);
    }
  });

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) {
      setSelectedLottery(lotteries[0].id);
    }
  }, [lotteries, selectedLottery]);

  React.useEffect(() => {
    // Refetch when lottery changes
    if (selectedLottery) {
      console.log('Selected lottery changed to:', selectedLottery);
      refetchSuggestions();
    }
  }, [selectedLottery, refetchSuggestions]);

  const validatedSuggestions = suggestions.filter(s => s.was_validated);
  const totalMatches = validatedSuggestions.reduce((sum, s) => sum + (s.matches_main || 0) + (s.matches_extra || 0), 0);
  const avgMatchesMain = validatedSuggestions.length > 0
    ? (validatedSuggestions.reduce((sum, s) => sum + (s.matches_main || 0), 0) / validatedSuggestions.length).toFixed(2)
    : 0;

  const bestSuggestion = validatedSuggestions.reduce((best, current) => {
    const currentTotal = (current.matches_main || 0) + (current.matches_extra || 0);
    const bestTotal = (best?.matches_main || 0) + (best?.matches_extra || 0);
    return currentTotal > bestTotal ? current : best;
  }, validatedSuggestions[0]);

  const formatDate = (dateStr) => {
    try {
      if (!dateStr) return 'Data não definida';
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return 'Data inválida';
      return date.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return 'Data não definida';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50 p-6">
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
              <h1 className="text-3xl font-bold">Histórico de Sugestões</h1>
              <p className="text-gray-600">Acompanhe o desempenho das previsões</p>
            </div>
          </div>

          <div className="flex gap-3">
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
              onClick={() => validateMutation.mutate()}
              disabled={validateMutation.isPending}
              className="bg-gradient-to-r from-green-600 to-green-700"
            >
              {validateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Validando...
                </>
              ) : (
                'Validar Resultados'
              )}
            </Button>
          </div>
        </div>

        {/* Validation Message */}
        {validationMessage && (
          <Alert variant={validationMessage.type === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>
              {validationMessage.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Stats */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Sugestões Geradas</p>
                  <p className="text-2xl font-bold mt-1">{suggestions.length}</p>
                </div>
                <Award className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Validadas</p>
                  <p className="text-2xl font-bold mt-1">{validatedSuggestions.length}</p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Acertos Totais</p>
                  <p className="text-2xl font-bold mt-1">{totalMatches}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Média de Acertos</p>
                  <p className="text-2xl font-bold mt-1">{avgMatchesMain}</p>
                </div>
                <Award className="w-8 h-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Best Suggestion */}
        {bestSuggestion && (
          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-6 h-6 text-green-600" />
                Melhor Sugestão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-gray-600 mb-2">Números Sugeridos</p>
                  <div className="flex gap-2 flex-wrap mb-4">
                    {bestSuggestion.main_numbers?.map((num, idx) => (
                      <NumberBall key={idx} number={num} size="md" />
                    ))}
                  </div>
                  {bestSuggestion.extra_numbers?.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {bestSuggestion.extra_numbers.map((num, idx) => (
                        <NumberBall key={idx} number={num} size="md" isExtra />
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-2">Resultado Real</p>
                  <div className="flex gap-2 flex-wrap mb-4">
                    {bestSuggestion.actual_main_numbers?.map((num, idx) => (
                      <NumberBall 
                        key={idx} 
                        number={num} 
                        size="md"
                        selected={bestSuggestion.main_numbers?.includes(num)}
                      />
                    ))}
                  </div>
                  {bestSuggestion.actual_extra_numbers?.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {bestSuggestion.actual_extra_numbers.map((num, idx) => (
                        <NumberBall 
                          key={idx} 
                          number={num} 
                          size="md" 
                          isExtra
                          selected={bestSuggestion.extra_numbers?.includes(num)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex gap-4">
                <Badge className="bg-green-600 text-white">
                  {bestSuggestion.matches_main} acertos principais
                </Badge>
                {bestSuggestion.matches_extra > 0 && (
                  <Badge className="bg-yellow-600 text-white">
                    {bestSuggestion.matches_extra} acertos extras
                  </Badge>
                )}
                <Badge variant="outline">
                  {formatDate(bestSuggestion.draw_date)}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Suggestions List */}
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Todas as Sugestões</h3>
          
          {suggestions.map((suggestion) => (
            <Card key={suggestion.id} className={
              suggestion.was_validated 
                ? 'bg-white' 
                : 'bg-yellow-50 border-yellow-200'
            }>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-gray-500" />
                    <CardTitle className="text-lg">
                      {formatDate(suggestion.draw_date)}
                    </CardTitle>
                  </div>
                  
                  {suggestion.was_validated ? (
                    <Badge className="bg-green-600">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Validada
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-yellow-500 text-yellow-700">
                      Aguardando resultado
                    </Badge>
                  )}
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Números Sugeridos</p>
                    <div className="flex gap-2 flex-wrap mb-3">
                      {suggestion.main_numbers?.map((num, idx) => (
                        <NumberBall 
                          key={idx} 
                          number={num} 
                          size="sm"
                          selected={suggestion.actual_main_numbers?.includes(num)}
                        />
                      ))}
                    </div>
                    {suggestion.extra_numbers?.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {suggestion.extra_numbers.map((num, idx) => (
                          <NumberBall 
                            key={idx} 
                            number={num} 
                            size="sm" 
                            isExtra
                            selected={suggestion.actual_extra_numbers?.includes(num)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {suggestion.was_validated && (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">Resultado Real</p>
                      <div className="flex gap-2 flex-wrap mb-3">
                        {suggestion.actual_main_numbers?.map((num, idx) => (
                          <NumberBall key={idx} number={num} size="sm" />
                        ))}
                      </div>
                      {suggestion.actual_extra_numbers?.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {suggestion.actual_extra_numbers.map((num, idx) => (
                            <NumberBall key={idx} number={num} size="sm" isExtra />
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex gap-2">
                        <Badge variant="outline">
                          {suggestion.matches_main || 0} acertos principais
                        </Badge>
                        {suggestion.matches_extra > 0 && (
                          <Badge variant="outline">
                            {suggestion.matches_extra} acertos extras
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {suggestion.notes && (
                  <p className="text-sm text-gray-500 mt-3 italic">{suggestion.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Debug info / Empty state */}
          {suggestions.length === 0 && (
            <Card className="p-6 bg-blue-50">
              <p className="text-sm text-gray-700">
                <strong>Debug:</strong> Nenhuma sugestão encontrada para esta loteria.
                <br />
                Loteria selecionada: {selectedLottery || 'Nenhuma loteria selecionada'}
                <br />
                Vá ao Gerador e salve uma sugestão para a loteria selecionada.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
