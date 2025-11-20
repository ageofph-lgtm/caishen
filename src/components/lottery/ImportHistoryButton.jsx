import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Upload, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function ImportHistoryButton({ lotteryId, lotteryName }) {
  const [importStatus, setImportStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (fileUrl) => {
      const response = await base44.functions.invoke('importHistoricalDraws', {
        lottery_id: lotteryId,
        file_url: fileUrl
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        setImportStatus({ 
          type: 'success', 
          message: data.message
        });
        queryClient.invalidateQueries({ queryKey: ['draws'] });
      }
      setTimeout(() => setImportStatus(null), 5000);
    },
    onError: (error) => {
      const errorData = error.response?.data;
      setImportStatus({ 
        type: 'error', 
        message: errorData?.error || 'Erro ao importar'
      });
      setTimeout(() => setImportStatus(null), 8000);
    }
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setImportStatus(null);

    try {
      // Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      // Import from file
      await importMutation.mutateAsync(file_url);
    } catch (error) {
      setImportStatus({ 
        type: 'error', 
        message: 'Erro ao fazer upload do arquivo'
      });
      setTimeout(() => setImportStatus(null), 5000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      <Button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || importMutation.isPending}
        variant="outline"
        className="w-full"
      >
        {uploading || importMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {uploading ? 'Enviando...' : 'Importando...'}
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Importar {lotteryName}
          </>
        )}
      </Button>

      {importStatus && (
        <Alert 
          variant={importStatus.type === 'error' ? 'destructive' : 'default'}
          className={importStatus.type === 'success' ? 'border-green-500 bg-green-50 text-green-800' : ''}
        >
          {importStatus.type === 'success' ? (
            <Check className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertTitle className="text-sm font-semibold">
            {importStatus.type === 'success' ? 'Sucesso!' : 'Erro'}
          </AlertTitle>
          <AlertDescription className="text-xs">
            {importStatus.message}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}