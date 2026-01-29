import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Função auxiliar para validar e converter datas
function parseDate(dateStr: string): string | null {
    if (!dateStr) return null;
    const cleanStr = dateStr.trim();
    
    // Formato YYYY-MM-DD (Padrão do ficheiro Lotoideas EuroDreams)
    if (cleanStr.match(/^\d{4}-\d{2}-\d{2}$/)) return cleanStr;
    
    // Formato DD/MM/YYYY (Caso apareça noutros ficheiros)
    const parts = cleanStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    
    return null;
}

// Limpa arrays de números, removendo vazios e ordenando
function cleanNumbers(nums: any[]): number[] {
    return nums
        .map(n => parseInt(String(n).trim()))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileContent, fileName } = await req.json();

        if (!fileContent) throw new Error("Conteúdo do arquivo vazio.");

        console.log(`A processar ficheiro: ${fileName}`);
        
        // Identificação exclusiva para EuroDreams (como solicitado)
        let lotteryName = "";
        if (fileName.toLowerCase().includes("eurodreams")) {
            lotteryName = "EuroDreams";
        } else {
            // Mantém suporte básico a outros se necessário, ou lança erro
             if (fileName.toLowerCase().includes("euromillones") || fileName.toLowerCase().includes("euromilhoes")) lotteryName = "EuroMilhões";
             else if (fileName.toLowerCase().includes("toto")) lotteryName = "Totoloto";
        }

        if (!lotteryName) throw new Error("Lotaria não identificada. Este script foi otimizado para EuroDreams.");

        // Busca o ID da lotaria
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lotteryName });
        if (lotteries.length === 0) throw new Error(`Lotaria '${lotteryName}' não encontrada no sistema.`);
        const lotteryId = lotteries[0].id;

        const lines = fileContent.split('\n');
        const drawsToSave = [];
        let skipped = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Remove aspas que o CSV possa ter
            const cleanLine = line.replace(/"/g, ''); 
            const cols = cleanLine.split(',').map(c => c.trim());

            // 1. Tenta encontrar uma data válida na primeira coluna
            // Isto filtra automaticamente cabeçalhos como "FECHA,COMB..." ou "www.lotoideas..."
            const drawDate = parseDate(cols[0]);

            if (!drawDate) {
                skipped++;
                continue; // Se não começa com data, é lixo ou cabeçalho
            }

            let mainNumbers: number[] = [];
            let extraNumbers: number[] = [];

            try {
                // LÓGICA ESPECÍFICA EURODREAMS
                // Formato Lotoideas: DATA(0), N1(1), N2(2), N3(3), N4(4), N5(5), N6(6), Sueño(7)
                if (lotteryName === "EuroDreams") {
                    // Pega exatamente 6 números principais (colunas 1 a 6)
                    mainNumbers = cleanNumbers(cols.slice(1, 7));
                    
                    // Pega o número "Sueño" (coluna 7)
                    if (cols[7]) {
                        extraNumbers = cleanNumbers([cols[7]]);
                    }
                } 
                // Lógica de fallback para outras lotarias (se o ficheiro for outro)
                else if (lotteryName === "EuroMilhões") {
                    mainNumbers = cleanNumbers(cols.slice(1, 6)); // 5 números
                    const startExtra = cols[6] === '' ? 7 : 6;
                    extraNumbers = cleanNumbers(cols.slice(startExtra, startExtra + 2));
                }
                else if (lotteryName === "Totoloto") {
                    mainNumbers = cleanNumbers(cols.slice(1, 6)); // 5 números
                    if (cols[6]) extraNumbers = cleanNumbers([cols[6]]);
                }

                // Validação final de consistência
                // EuroDreams deve ter 6 principais e 1 extra
                if (lotteryName === "EuroDreams" && (mainNumbers.length !== 6 || extraNumbers.length !== 1)) {
                    console.warn(`Linha ${i} ignorada: contagem incorreta de números EuroDreams (${mainNumbers.length}+${extraNumbers.length})`);
                    skipped++;
                    continue;
                }

                if (mainNumbers.length > 0) {
                    drawsToSave.push({
                        lottery_id: lotteryId,
                        draw_date: drawDate,
                        main_numbers: mainNumbers,
                        extra_numbers: extraNumbers
                    });
                }

            } catch (e) {
                console.warn(`Erro de processamento na linha ${i}:`, e.message);
                skipped++;
            }
        }

        // Salva em blocos (Batch) para eficiência
        if (drawsToSave.length > 0) {
            const batchSize = 50;
            for (let i = 0; i < drawsToSave.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(drawsToSave.slice(i, i + batchSize));
            }
        }

        // Validação automática após importar
        await base44.functions.invoke('validateSuggestions');

        return Response.json({ 
            success: true, 
            message: `Processado com sucesso! Importados ${drawsToSave.length} sorteios para ${lotteryName}. (Linhas ignoradas/cabeçalhos: ${skipped})` 
        });

    } catch (error) {
        console.error(error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});