import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Remove caracteres invisíveis (BOM) e espaços
function cleanString(str: string): string {
    return str.replace(/^\uFEFF/, '').trim();
}

// Deteta se uma string parece uma data válida
function isValidDate(dateStr: string): boolean {
    if (!dateStr) return false;
    const clean = dateStr.replace(/["']/g, '').trim();
    // Aceita YYYY-MM-DD ou DD/MM/YYYY ou DD-MM-YYYY
    return /^\d{4}-\d{2}-\d{2}$/.test(clean) || 
           /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(clean);
}

// Converte qualquer formato de data para YYYY-MM-DD
function normalizeDate(dateStr: string): string | null {
    const clean = dateStr.replace(/["']/g, '').trim();
    
    // Já é YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    
    // Converte DD/MM/YYYY
    const parts = clean.split(/[\/\-]/);
    if (parts.length === 3) {
        // Assume dia-mês-ano (padrão europeu/brasileiro)
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        return `${year}-${month}-${day}`;
    }
    return null;
}

// Limpa e valida números
function extractNumbers(cols: string[]): number[] {
    return cols
        .map(c => parseInt(c.replace(/[^0-9]/g, '')))
        .filter(n => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileContent, fileName } = await req.json();

        if (!fileContent) throw new Error("Ficheiro vazio.");

        console.log(`[Importador] A analisar: ${fileName}`);
        
        // 1. Identificação da Lotaria (Prioridade EuroDreams)
        let lotteryName = "";
        if (fileName.toLowerCase().includes("eurodreams")) lotteryName = "EuroDreams";
        else if (fileName.toLowerCase().includes("euromil")) lotteryName = "EuroMilhões";
        else if (fileName.toLowerCase().includes("toto")) lotteryName = "Totoloto";
        else throw new Error("Lotaria não reconhecida. O nome do ficheiro deve conter 'EuroDreams', 'EuroMilhões' ou 'Totoloto'.");

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lotteryName });
        if (lotteries.length === 0) throw new Error(`Lotaria ${lotteryName} não encontrada no sistema.`);
        const lotteryId = lotteries[0].id;

        // 2. Preparação do Conteúdo
        // Remove BOM e divide em linhas
        const rawContent = cleanString(fileContent);
        const lines = rawContent.split(/\r\n|\n|\r/);

        // 3. Deteção INTELIGENTE de Separador
        // Procura a primeira linha que começa com uma data para definir o padrão
        let delimiter = ','; // Padrão
        let headerSkipped = false;
        
        // Percorre as primeiras 20 linhas para achar o padrão
        for (const line of lines.slice(0, 20)) {
            if (!line.trim()) continue;
            
            // Testa separadores comuns
            if (line.includes(';') && isValidDate(line.split(';')[0])) {
                delimiter = ';';
                break;
            }
            if (line.includes(',') && isValidDate(line.split(',')[0])) {
                delimiter = ',';
                break;
            }
        }
        console.log(`[Importador] Separador detetado: '${delimiter}'`);

        const drawsToSave = [];
        let skippedCount = 0;

        // 4. Processamento Linha a Linha
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(delimiter).map(c => c.trim());
            const rawDate = cols[0];

            // Ignora cabeçalhos ou lixo (se a primeira coluna não for data)
            if (!isValidDate(rawDate)) {
                skippedCount++;
                continue;
            }

            const drawDate = normalizeDate(rawDate);
            let mainNumbers: number[] = [];
            let extraNumbers: number[] = [];

            try {
                // Estratégia de Colunas Flexível
                // Pega todos os números disponíveis nas colunas seguintes
                const allNumbers = extractNumbers(cols.slice(1));

                if (lotteryName === "EuroDreams") {
                    // Esperado: 6 Principais + 1 Sonho
                    // Se tivermos 7 números, o último é o sonho
                    if (allNumbers.length === 7) {
                        mainNumbers = allNumbers.slice(0, 6);
                        extraNumbers = allNumbers.slice(6);
                    } else if (allNumbers.length > 7) {
                         // Caso haja colunas extras de prémios, assume-se os primeiros 7
                        mainNumbers = allNumbers.slice(0, 6);
                        extraNumbers = allNumbers.slice(6, 7);
                    } else {
                        throw new Error(`Números insuficientes: encontrei ${allNumbers.length}, preciso de 7.`);
                    }
                } 
                else if (lotteryName === "EuroMilhões") {
                    // Esperado: 5 Principais + 2 Estrelas
                    if (allNumbers.length >= 7) {
                        mainNumbers = allNumbers.slice(0, 5);
                        // Estrelas são os 2 seguintes, ou os 2 últimos?
                        // Lotoideas costuma pôr estrelas no fim. 
                        // Se tivermos exatamente 7, são os 2 últimos.
                        extraNumbers = allNumbers.slice(5, 7);
                    }
                }
                else if (lotteryName === "Totoloto") {
                     // Esperado: 5 Principais + 1 Número da Sorte
                    if (allNumbers.length >= 6) {
                        mainNumbers = allNumbers.slice(0, 5);
                        extraNumbers = allNumbers.slice(5, 6);
                    }
                }

                if (drawDate && mainNumbers.length > 0) {
                    drawsToSave.push({
                        lottery_id: lotteryId,
                        draw_date: drawDate,
                        main_numbers: mainNumbers,
                        extra_numbers: extraNumbers
                    });
                }
            } catch (err) {
                console.warn(`[Linha ${i}] Ignorada: ${err.message}`);
                skippedCount++;
            }
        }

        // 5. Salvar no Banco de Dados (com prevenção de duplicados na memória)
        if (drawsToSave.length > 0) {
            // Remove duplicados pelo draw_date (mantém o primeiro encontrado)
            const uniqueMap = new Map();
            drawsToSave.forEach(d => {
                if (!uniqueMap.has(d.draw_date)) uniqueMap.set(d.draw_date, d);
            });
            const uniqueDraws = Array.from(uniqueMap.values());

            // Bulk Insert em lotes de 50
            const batchSize = 50;
            for (let i = 0; i < uniqueDraws.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(uniqueDraws.slice(i, i + batchSize));
            }

            await base44.functions.invoke('validateSuggestions');

            return Response.json({ 
                success: true, 
                message: `✅ Sucesso! ${uniqueDraws.length} sorteios importados para ${lotteryName}. (${skippedCount} linhas ignoradas)` 
            });
        } else {
            return Response.json({ 
                success: false, 
                error: `Nenhum sorteio válido encontrado. Verifique se o ficheiro tem datas na primeira coluna (ex: 2024-01-01).` 
            });
        }

    } catch (error) {
        console.error(error);
        return Response.json({ success: false, error: `Erro Fatal: ${error.message}` }, { status: 500 });
    }
});