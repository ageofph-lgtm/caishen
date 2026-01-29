import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Remove BOM e limpa espaços extras
function cleanContent(str: string): string {
    return str.replace(/^\uFEFF/, '').trim();
}

// Verifica se a string começa com um ano (ex: 2023, 2024...)
// O seu ficheiro tem formato YYYY-MM-DD
function startsWithYear(str: string): boolean {
    if (!str) return false;
    const clean = str.replace(/["']/g, '').trim();
    return /^20\d{2}-/.test(clean); // Começa com 20XX-
}

// Extrai apenas números de uma lista de strings
function extractNumbers(cols: string[]): number[] {
    return cols
        .map(c => parseInt(c.replace(/[^0-9]/g, ''))) // Remove tudo que não for número
        .filter(n => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileContent, fileName } = await req.json();

        if (!fileContent) throw new Error("O ficheiro está vazio.");

        console.log(`[Importador V3] A processar: ${fileName}`);

        // 1. Identificar Lotaria
        let lotteryName = "";
        if (fileName.toLowerCase().includes("eurodreams")) lotteryName = "EuroDreams";
        else if (fileName.toLowerCase().includes("euromillones") || fileName.toLowerCase().includes("euromilhoes")) lotteryName = "EuroMilhões";
        else if (fileName.toLowerCase().includes("toto")) lotteryName = "Totoloto";
        else throw new Error("Lotaria não detetada. O nome do ficheiro deve ter 'EuroDreams', 'EuroMilhões' ou 'Totoloto'.");

        // Obter ID
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lotteryName });
        if (lotteries.length === 0) throw new Error(`Lotaria ${lotteryName} não existe no sistema.`);
        const lotteryId = lotteries[0].id;

        // 2. Preparar Linhas
        const rawLines = cleanContent(fileContent).split(/\r\n|\n|\r/);
        
        const drawsToSave = [];
        let successCount = 0;
        let skippedCount = 0;

        // 3. Processamento Linha a Linha (Sem adivinhar cabeçalhos)
        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i].trim();
            if (!line) continue;

            // Determina separador por linha (mais seguro)
            // Se a linha tiver vírgulas, usa vírgula. Se tiver ponto e vírgula, usa esse.
            const delimiter = line.includes(';') ? ';' : ',';
            const cols = line.split(delimiter).map(c => c.trim());

            // GATILHO: Só processa se a primeira coluna for uma Data YYYY-MM-DD
            if (!startsWithYear(cols[0])) {
                skippedCount++; // Ignora cabeçalhos ("FECHA..."), lixo ("www...") e rodapés
                continue;
            }

            const drawDate = cols[0]; // Já sabemos que é YYYY-MM-DD
            let mainNumbers: number[] = [];
            let extraNumbers: number[] = [];

            try {
                // Extrai TODOS os números encontrados após a data
                const allNumbers = extractNumbers(cols.slice(1));

                if (lotteryName === "EuroDreams") {
                    // EuroDreams: Precisa de 6 números + 1 sonho (Total 7)
                    if (allNumbers.length === 7) {
                        mainNumbers = allNumbers.slice(0, 6);
                        extraNumbers = allNumbers.slice(6);
                    } else if (allNumbers.length > 7) {
                        // Se tiver colunas extras de prémios, pegamos os primeiros 7
                        mainNumbers = allNumbers.slice(0, 6);
                        extraNumbers = allNumbers.slice(6, 7);
                    } else {
                        // Se tiver menos de 7, algo está errado nesta linha
                        console.warn(`[Linha ${i+1}] Ignorada: Encontrados apenas ${allNumbers.length} números (esperado 7). Conteúdo: ${line}`);
                        skippedCount++;
                        continue;
                    }
                } 
                else if (lotteryName === "EuroMilhões") {
                    // EuroMilhões: 5 números + 2 estrelas (Total 7)
                    if (allNumbers.length >= 7) {
                        mainNumbers = allNumbers.slice(0, 5);
                        // Assume que os 2 últimos são as estrelas (padrão comum)
                        // OU se o ficheiro tiver ordem fixa, ajustamos. 
                        // O seu csv Euromillones parecia ter estrelas no fim.
                        extraNumbers = allNumbers.slice(5, 7); 
                    }
                }
                else if (lotteryName === "Totoloto") {
                    // Totoloto: 5 números + 1 extra (Total 6)
                    if (allNumbers.length >= 6) {
                        mainNumbers = allNumbers.slice(0, 5);
                        extraNumbers = allNumbers.slice(5, 6);
                    }
                }

                // Adiciona para salvar
                drawsToSave.push({
                    lottery_id: lotteryId,
                    draw_date: drawDate,
                    main_numbers: mainNumbers,
                    extra_numbers: extraNumbers
                });
                successCount++;

            } catch (err) {
                console.warn(`Erro na linha ${i+1}: ${err.message}`);
                skippedCount++;
            }
        }

        // 4. Salvar no Banco de Dados
        if (drawsToSave.length > 0) {
            // Remove duplicados de data na própria importação (caso haja linhas repetidas)
            const uniqueDraws = Array.from(new Map(drawsToSave.map(item => [item.draw_date, item])).values());

            // Bulk Create em lotes
            const batchSize = 50;
            for (let i = 0; i < uniqueDraws.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(uniqueDraws.slice(i, i + batchSize));
            }

            // Validar sugestões antigas com estes novos dados
            await base44.functions.invoke('validateSuggestions');

            return Response.json({ 
                success: true, 
                message: `✅ Importação concluída! ${uniqueDraws.length} sorteios processados. (${skippedCount} linhas ignoradas)` 
            });
        } else {
            return Response.json({ 
                success: false, 
                error: "Nenhum sorteio encontrado. O ficheiro deve ter datas no formato AAAA-MM-DD na primeira coluna." 
            });
        }

    } catch (error) {
        console.error(error);
        return Response.json({ success: false, error: `Erro Interno: ${error.message}` }, { status: 500 });
    }
});