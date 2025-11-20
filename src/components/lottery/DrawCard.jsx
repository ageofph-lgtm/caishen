import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Calendar } from 'lucide-react';
import NumberBall from './NumberBall';

export default function DrawCard({ draw }) {
  const formatDate = (dateStr) => {
    try {
      if (!dateStr) return '--';
      
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      
      return date.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch (error) {
      console.error('Date format error:', error);
      return dateStr || '--';
    }
  };

  return (
    <Card className="hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Sorteio</CardTitle>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-4 h-4" />
            {formatDate(draw.draw_date)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-gray-500 mb-2">Números Principais</p>
            <div className="flex gap-2 flex-wrap">
              {draw.main_numbers?.map((num, idx) => (
                <NumberBall key={idx} number={num} size="md" />
              ))}
            </div>
          </div>
          {draw.extra_numbers && draw.extra_numbers.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Números Extras</p>
              <div className="flex gap-2 flex-wrap">
                {draw.extra_numbers.map((num, idx) => (
                  <NumberBall key={idx} number={num} size="md" isExtra />
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}