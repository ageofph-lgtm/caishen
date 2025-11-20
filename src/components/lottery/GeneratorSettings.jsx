import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

export default function GeneratorSettings({ settings, onChange }) {
  const handleWeightChange = (key, value) => {
    onChange({
      ...settings,
      weights: {
        ...settings.weights,
        [key]: value[0]
      }
    });
  };

  const weightConfigs = [
    { key: 'base_frequency', label: 'Frequência Base', min: 0, max: 3, step: 0.1 },
    { key: 'recency_hot', label: 'Números Quentes', min: 0, max: 3, step: 0.1 },
    { key: 'delay_cold', label: 'Números Frios', min: 0, max: 3, step: 0.1 },
    { key: 'pair_affinity', label: 'Afinidade de Pares', min: 0, max: 2, step: 0.1 },
    { key: 'even_odd_balance', label: 'Equilíbrio Par/Ímpar', min: 0, max: 1, step: 0.1 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações do Gerador</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label>Modo Adaptativo</Label>
          <Switch 
            checked={settings.adaptive_mode}
            onCheckedChange={(checked) => onChange({ ...settings, adaptive_mode: checked })}
          />
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-semibold">Pesos do Algoritmo</h4>
          {weightConfigs.map(({ key, label, min, max, step }) => (
            <div key={key} className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-sm">{label}</Label>
                <span className="text-sm text-gray-500">
                  {settings.weights[key]?.toFixed(1) || 1.0}
                </span>
              </div>
              <Slider
                value={[settings.weights[key] || 1.0]}
                onValueChange={(value) => handleWeightChange(key, value)}
                min={min}
                max={max}
                step={step}
                className="w-full"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}