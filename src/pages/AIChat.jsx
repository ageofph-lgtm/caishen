import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Send, Sparkles, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function AIChat() {
  const [selectedLottery, setSelectedLottery] = useState(null);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Olá! Sou seu assistente de análise de loterias. Posso ajudá-lo a entender padrões, tendências e estatísticas dos sorteios. Como posso ajudar?'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { data: lotteries = [] } = useQuery({
    queryKey: ['lotteries'],
    queryFn: () => base44.entities.Lottery.filter({ is_active: true }),
  });

  const { data: draws = [] } = useQuery({
    queryKey: ['draws', selectedLottery],
    queryFn: () => selectedLottery 
      ? base44.entities.Draw.filter({ lottery_id: selectedLottery }, '-draw_date', 50)
      : [],
    enabled: !!selectedLottery,
  });

  React.useEffect(() => {
    if (lotteries.length > 0 && !selectedLottery) {
      setSelectedLottery(lotteries[0].id);
    }
  }, [lotteries, selectedLottery]);

  const currentLottery = lotteries.find(l => l.id === selectedLottery);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Prepare context about draws
      const context = `
Loteria: ${currentLottery?.name}
Total de sorteios analisados: ${draws.length}
Últimos 5 sorteios: ${draws.slice(0, 5).map(d => 
  `Data: ${d.draw_date}, Números: ${d.main_numbers?.join(', ')}`
).join(' | ')}
      `;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é um especialista em análise de loterias. Responda de forma concisa e objetiva em português.
        
Contexto dos dados:
${context}

Pergunta do usuário: ${input}

Forneça insights práticos e estatísticos.`,
        add_context_from_internet: false
      });

      const assistantMessage = {
        role: 'assistant',
        content: response || 'Desculpe, não consegui processar sua pergunta. Tente reformular.'
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente.'
      }]);
    }

    setIsLoading(false);
  };

  const quickQuestions = [
    'Quais são os números mais quentes?',
    'Análise dos últimos 10 sorteios',
    'Sugestão de números baseada em padrões',
    'Qual o melhor momento para jogar?'
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl('Dashboard')}>
              <Button variant="outline" size="icon">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Assistente IA</h1>
              <p className="text-gray-600">Análise inteligente com IA</p>
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

        {/* Chat Area */}
        <Card className="flex flex-col h-[600px]">
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-green-500" />
              <CardTitle>Conversa</CardTitle>
            </div>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl px-4 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                </div>
              </div>
            )}
          </CardContent>

          {/* Quick Questions */}
          <div className="border-t p-4">
            <p className="text-xs text-gray-500 mb-2">Sugestões:</p>
            <div className="flex gap-2 flex-wrap">
              {quickQuestions.map((q, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  onClick={() => setInput(q)}
                  className="text-xs"
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>

          {/* Input Area */}
          <div className="border-t p-4">
            <div className="flex gap-2">
              <Input
                placeholder="Digite sua pergunta..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                disabled={isLoading}
              />
              <Button 
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="bg-gradient-to-r from-green-500 to-green-600"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}