import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Remove BOM e espaços nas extremidades
function cleanContent(str: string): string {
    return str.replace(/^\uFEFF/, '').trim();
}

// Converte string de números (ex: "1, 5, 10" ou "1; 5; 10") para array
function parseNumbers(str: string): number[] {
    if (!str) return [];
    // Remove aspas, troca ponto e vírgula por vírgula (just in case)
    return str.replace(/["']/g, '')
              .replace(/;/g, ',')
              .split(',')
              .map(n => parseInt(n.trim()))
              .filter(n => !isNaN(n) && n > 0)
              .sort((a, b) => a - b);
}

// Normaliza data para YYYY-MM-DD
function parseDate(dateStr: string): string | null {
    if (!dateStr) return null;
    const clean = dateStr.replace(/["']/g, '').trim();
    
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    
    // DD/MM/YYYY ou DD-MM-YYYY
    const parts = clean.split(/[\/\-]/);
    if (parts.length === 3) {
        // Assume formato europeu: Dia-Mês-Ano
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileContent, fileName } = await req.json();

        if (!fileContent) throw new Error("O ficheiro está vazio (0 bytes).");

        console.log(`[Importador Blindado] A processar: ${fileName}`);

        // 1. Identificar Lotaria
        let lotteryName = "";
        const lowerName = fileName.toLowerCase();
        if (lowerName.includes("eurodreams")) lotteryName = "EuroDreams";
        else if (lowerName.includes("euromillones") || lowerName.includes("euromilhoes")) lotteryName = "EuroMilhões";
        else if (lowerName.includes("toto")) lotteryName = "Totoloto";
        else throw new Error("Nome do ficheiro inválido. Deve conter: 'EuroDreams', 'EuroMilhões' ou 'Totoloto'.");

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lotteryName });
        if (lotteries.length === 0) throw new Error(`A lotaria '${lotteryName}' não existe na base de dados.`);
        const lotteryId = lotteries[0].id;

        // 2. Processamento Universal
        const lines = cleanContent(fileContent).split(/\r\n|\n|\r/);
        const drawsToSave = [];
        let successCount = 0;
        let skippedCount = 0;
        let lastError = "";

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Variáveis para os dados extraídos
            let datePart = "";
            let mainPart = "";
            let extraPart = "";

            // TENTATIVA 1: Formato "Universal" (Agrupado com aspas)
            // Regex ajustada para permitir espaços opcionais (\s*) entre vírgulas
            const groupedRegex = /^([^,]+),\s*"([^"]+)",\s*"([^"]*)"/; 
            const quotedMatch = line.match(groupedRegex);

            if (quotedMatch) {
                // Formato: 2026-01-26, "15,23,28...", "3"
                datePart = quotedMatch[1];
                mainPart = quotedMatch[2];
                extraPart = quotedMatch[3];
            } else {
                // TENTATIVA 2: Formato "Flat" (CSV Simples)
                // Formato: 2026-01-26, 15, 23, 28, 33, 34, 37, 3
                const cols = line.replace(/"/g, '').split(/[;,]/); // Aceita , ou ;
                datePart = cols[0];
                
                // Pega todos os números restantes
                const allNums = cols.slice(1);
                
                if (lotteryName === "EuroDreams") { // 6 + 1
                    mainPart = allNums.slice(0, 6).join(',');
                    extraPart = allNums.slice(6).join(',');
                } else if (lotteryName === "EuroMilhões") { // 5 + 2
                    mainPart = allNums.slice(0, 5).join(',');
                    extraPart = allNums.slice(5).join(',');
                } else if (lotteryName === "Totoloto") { // 5 + 1
                    mainPart = allNums.slice(0, 5).join(',');
                    extraPart = allNums.slice(5).join(',');
                }
            }

            const drawDate = parseDate(datePart);
            const mainNumbers = parseNumbers(mainPart);
            const extraNumbers = parseNumbers(extraPart);

            // Validação Final
            if (drawDate && mainNumbers.length > 0) {
                drawsToSave.push({
                    lottery_id: lotteryId,
                    draw_date: drawDate,
                    main_numbers: mainNumbers,
                    extra_numbers: extraNumbers
                });
                successCount++;
            } else {
                skippedCount++;
                if (skippedCount <= 3) {
                     lastError = `Linha ${i+1} inválida: Data='${datePart}', Nums='${mainPart}'`;
                     console.warn(lastError);
                }
            }
        }

        // 3. Salvar (com prevenção de duplicados)
        if (drawsToSave.length > 0) {
            // Filtra duplicados dentro do próprio ficheiro
            const uniqueDraws = Array.from(new Map(drawsToSave.map(item => [item.draw_date, item])).values());

            // Verifica quais draws já existem na base de dados
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lotteryId });
            const existingDates = new Set(existingDraws.map(d => d.draw_date));

            // Filtra apenas draws novos
            const newDraws = uniqueDraws.filter(d => !existingDates.has(d.draw_date));

            if (newDraws.length === 0) {
                return Response.json({ 
                    success: false, 
                    error: "Todos os sorteios já existem na base de dados." 
                });
            }

            const batchSize = 50;
            for (let i = 0; i < newDraws.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(newDraws.slice(i, i + batchSize));
            }

            // Atualiza estatísticas
            await base44.functions.invoke('validateSuggestions');

            return Response.json({ 
                success: true, 
                message: `Sucesso! ${newDraws.length} sorteios novos importados em ${lotteryName}.` 
            });
        }

        return Response.json({ 
            success: false, 
            error: `Nenhum dado válido encontrado. Erro de exemplo: ${lastError || "Formato irreconhecível"}` 
        });

    } catch (error) {
        console.error(error);
        return Response.json({ success: false, error: `Erro Interno: ${error.message}` }, { status: 500 });
    }
});