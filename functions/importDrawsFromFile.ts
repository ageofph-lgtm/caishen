import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Função auxiliar para converter datas DD/MM/YYYY para YYYY-MM-DD
function formatDate(dateStr: string): string | null {
    if (!dateStr) return null;
    // Se já estiver em YYYY-MM-DD
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
    
    // Tenta DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return null;
}

// Função para limpar números (remove espaços e zeros à esquerda desnecessários)
function cleanNumbers(nums: any[]): number[] {
    return nums
        .map(n => parseInt(String(n).trim()))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { lottery_id, file_url } = await req.json();

        if (!lottery_id || !file_url) {
            throw new Error("Parâmetros obrigatórios: lottery_id e file_url");
        }

        console.log(`Baixando ficheiro: ${file_url}`);
        
        // Busca o ficheiro pela URL
        const fileResponse = await fetch(file_url);
        if (!fileResponse.ok) {
            throw new Error("Erro ao baixar o ficheiro");
        }
        
        const fileContent = await fileResponse.text();
        const fileName = file_url.split('/').pop() || 'file.csv';
        
        console.log(`Processando ficheiro: ${fileName}`);

        // Busca informações da lotaria
        const lottery = await base44.asServiceRole.entities.Lottery.get(lottery_id);
        if (!lottery) {
            throw new Error("Lotaria não encontrada");
        }
        
        const lotteryName = lottery.name;

        // Processa as linhas do CSV
        const lines = fileContent.split('\n');
        const drawsToSave = [];
        let skipped = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || i === 0) continue; // Pula cabeçalho e linhas vazias

            // Remove aspas extras que o CSV possa ter
            const cleanLine = line.replace(/"/g, ''); 
            const cols = cleanLine.split(',').map(c => c.trim());

            let drawDate = null;
            let mainNumbers: number[] = [];
            let extraNumbers: number[] = [];

            try {
                // LÓGICA DE PARSING ADAPTATIVA
                
                // CASO 1: EuroMilhões (Lotoideas CSV)
                // Formato: DATA, N1, N2, N3, N4, N5, (vazio), E1, E2
                if (lotteryName === "EuroMilhões") {
                    drawDate = formatDate(cols[0]);
                    mainNumbers = cleanNumbers(cols.slice(1, 6));
                    const startExtra = cols[6] === '' ? 7 : 6;
                    extraNumbers = cleanNumbers(cols.slice(startExtra, startExtra + 2));
                } 
                
                // CASO 2: Totoloto (toto..csv)
                // Formato: DATA, N1, N2, N3, N4, N5, NS
                else if (lotteryName === "Totoloto") {
                    drawDate = formatDate(cols[0]);
                    mainNumbers = cleanNumbers(cols.slice(1, 6));
                    if (cols[6]) extraNumbers = cleanNumbers([cols[6]]);
                }

                // CASO 3: EuroDreams (Lotoideas XLSX/CSV)
                // Formato: DATA, N1, N2, N3, N4, N5, N6, Sueño
                else if (lotteryName === "EuroDreams") {
                    drawDate = formatDate(cols[0]);
                    mainNumbers = cleanNumbers(cols.slice(1, 7));
                    if (cols[7]) extraNumbers = cleanNumbers([cols[7]]);
                }

                // Validação Final da Linha
                if (drawDate && mainNumbers.length >= 5) {
                    drawsToSave.push({
                        lottery_id: lottery_id,
                        draw_date: drawDate,
                        main_numbers: mainNumbers,
                        extra_numbers: extraNumbers
                    });
                } else {
                    skipped++;
                }

            } catch (e) {
                console.warn(`Erro na linha ${i}:`, e.message);
                skipped++;
            }
        }

        // SALVA EM BLOCOS (Batch)
        if (drawsToSave.length > 0) {
            const batchSize = 50;
            for (let i = 0; i < drawsToSave.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(drawsToSave.slice(i, i + batchSize));
            }
        }

        // RE-VALIDAÇÃO AUTOMÁTICA
        try {
            await base44.functions.invoke('validateSuggestions');
        } catch (valError) {
            console.warn('Erro na validação (não crítico):', valError.message);
        }

        return Response.json({ 
            success: true, 
            imported: drawsToSave.length,
            message: `Importados ${drawsToSave.length} sorteios para ${lotteryName}. (Ignorados: ${skipped})` 
        });

    } catch (error) {
        console.error('Erro na importação:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});