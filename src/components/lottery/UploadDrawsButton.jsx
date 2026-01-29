import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Upload, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function UploadDrawsButton({ lotteryId, lotteryName }) {
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async ({ fileContent, fileName }) => {
      const response = await base44.functions.invoke('importDrawsFromFile', {
        fileContent,
        fileName
      });
      return response.data;
    },
    onSuccess: (data) => {
      console.log('Import response:', data);
      if (data.success) {
        setStatus({ 
          type: 'success', 
          message: data.message,
          count: data.imported
        });
        queryClient.invalidateQueries({ queryKey: ['draws'] });
        queryClient.invalidateQueries({ queryKey: ['all-draws'] });
        setTimeout(() => setStatus(null), 5000);
      } else {
        setStatus({ 
          type: 'error', 
          message: data.error || 'Erro desconhecido'
        });
      }
    },
    onError: (error) => {
      console.error('Import mutation error:', error);
      console.error('Error response:', error.response?.data);
      
      const errorMsg = error.response?.data?.error 
        || error.response?.data?.message 
        || error.message 
        || 'Erro ao importar';
      
      setStatus({ 
        type: 'error', 
        message: errorMsg
      });
    }
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log('File selected:', file.name, 'Type:', file.type, 'Size:', file.size);

    // Validate file
    const validExtensions = ['.xlsx', '.xls', '.csv', '.pdf'];
    const hasValidExtension = validExtensions.some(ext => 
      file.name.toLowerCase().endsWith(ext)
    );

    if (!hasValidExtension) {
      setStatus({ 
        type: 'error', 
        message: 'Use ficheiros Excel (.xlsx, .xls), CSV (.csv) ou PDF (.pdf)'
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setStatus({ 
        type: 'error', 
        message: 'Ficheiro muito grande. Máximo 10MB.'
      });
      return;
    }

    setUploading(true);
    setStatus(null);

    try {
        console.log('Uploading file...');

        const uploadResult = await base44.integrations.Core.UploadFile({ file });
        console.log('Upload result:', uploadResult);

        if (!uploadResult || !uploadResult.file_url) {
          throw new Error('URL do ficheiro não foi retornado');
        }

        console.log('File uploaded:', uploadResult.file_url);

        let fileContent = '';

        // Se for PDF, extrai com a integração Core
        if (file.name.toLowerCase().endsWith('.pdf')) {
          console.log('PDF detected, extracting text...');

          // Extrai dados estruturados do PDF
          const extractResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
            file_url: uploadResult.file_url,
            json_schema: {
              type: "object",
              properties: {
                draws: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string" },
                      numbers: { type: "array", items: { type: "number" } },
                      extra: { type: "number" }
                    }
                  }
                }
              }
            }
          });

          if (extractResult.status === 'success' && extractResult.output?.draws) {
            // Converte para formato CSV
            const csvLines = ['DATA,N1,N2,N3,N4,N5,N6,SUENO'];
            extractResult.output.draws.forEach(draw => {
              const nums = draw.numbers.slice(0, 6).join(',');
              csvLines.push(`${draw.date},${nums},${draw.extra}`);
            });
            fileContent = csvLines.join('\n');
            console.log('Extracted draws:', extractResult.output.draws.length);
          } else {
            throw new Error('Falha ao extrair dados do PDF');
          }
        } else {
          // Para CSV/Excel, lê diretamente
          const fileContentResponse = await fetch(uploadResult.file_url);
          fileContent = await fileContentResponse.text();
        }

        // Invoca a função com fileContent e fileName
        await importMutation.mutateAsync({ fileContent, fileName: file.name });

      } catch (error) {
      console.error('Upload error:', error);
      setStatus({ 
        type: 'error', 
        message: error.message || 'Erro ao processar ficheiro'
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.pdf"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      <Button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || importMutation.isPending}
        className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
      >
        {uploading || importMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {uploading ? 'Enviando...' : 'A processar...'}
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Importar {lotteryName}
          </>
        )}
      </Button>

      {status && (
        <Alert 
          variant={status.type === 'error' ? 'destructive' : 'default'}
          className={status.type === 'success' ? 'border-green-500 bg-green-50 text-green-800' : ''}
        >
          {status.type === 'success' ? (
            <Check className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertTitle className="text-sm font-semibold">
            {status.type === 'success' ? 'Sucesso!' : 'Erro'}
          </AlertTitle>
          <AlertDescription className="text-xs">
            {status.message}
            {status.count > 0 && (
              <div className="mt-1 font-semibold">{status.count} sorteios adicionados</div>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}