import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Remove BOM e limpa espaços
function cleanContent(str: string): string {
    return str.replace(/^\uFEFF/, '').trim();
}

// Limpa e converte string de números (ex: "1, 5, 10") para array [1, 5, 10]
function parseNumbers(str: string): number[] {
    if (!str) return [];
    // Remove aspas que possam ter sobrado e quebra por vírgula
    return str.replace(/["']/g, '')
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
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileContent, fileName } = await req.json();

        if (!fileContent) throw new Error("Ficheiro vazio.");

        console.log(`[Universal Import] A ler: ${fileName}`);

        // 1. Identificar Lotaria
        let lotteryName = "";
        if (fileName.toLowerCase().includes("eurodreams")) lotteryName = "EuroDreams";
        else if (fileName.toLowerCase().includes("euromillones") || fileName.toLowerCase().includes("euromilhoes")) lotteryName = "EuroMilhões";
        else if (fileName.toLowerCase().includes("toto")) lotteryName = "Totoloto";
        else throw new Error("Nome do ficheiro deve conter: 'EuroDreams', 'EuroMilhões' ou 'Totoloto'.");

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lotteryName });
        if (lotteries.length === 0) throw new Error(`Lotaria ${lotteryName} não encontrada.`);
        const lotteryId = lotteries[0].id;

        // 2. Processamento Universal
        const lines = cleanContent(fileContent).split(/\r\n|\n|\r/);
        const drawsToSave = [];
        let skipped = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            console.log(`[Linha ${i}] Raw: ${line.substring(0, 100)}`);

            // Lógica Inteligente para o "Formato Universal" (Data, "Nums", "Extras")
            // Usamos Regex para capturar grupos entre aspas, se existirem
            // Ex: 2026-01-26,"15,23...","3"
            
            let datePart = "";
            let mainPart = "";
            let extraPart = "";

            // Tenta capturar o formato de 3 colunas com aspas
            const quotedMatch = line.match(/^([^,]+),"([^"]+)","([^"]+)"/);

            if (quotedMatch) {
                console.log(`[Linha ${i}] Formato com aspas detectado`);
                // FORMATO PADRONIZADO (O que você acabou de gerar)
                datePart = quotedMatch[1];
                mainPart = quotedMatch[2];
                extraPart = quotedMatch[3];
            } else {
                console.log(`[Linha ${i}] Formato flat detectado`);
                // FORMATO LEGADO/FLAT (Caso o usuário suba um CSV simples sem aspas)
                // Remove aspas globais e divide tudo por vírgula
                const cols = line.replace(/"/g, '').split(',');
                console.log(`[Linha ${i}] Colunas: ${cols.length}, Primeira: ${cols[0]}`);
                datePart = cols[0];
                
                // Distribuição baseada nas regras da lotaria
                const allNums = cols.slice(1);
                console.log(`[Linha ${i}] Números encontrados: ${allNums.length}`);
                
                if (lotteryName === "EuroDreams") { // 6 + 1
                    mainPart = allNums.slice(0, 6).join(',');
                    extraPart = allNums.slice(6).join(',');
                } else if (lotteryName === "EuroMilhões") { // 5 + 2
                    mainPart = allNums.slice(0, 5).join(',');
                    extraPart = allNums.slice(5, 7).join(',');
                } else if (lotteryName === "Totoloto") { // 5 + 1
                    mainPart = allNums.slice(0, 5).join(',');
                    extraPart = allNums.slice(5).join(',');
                }
            }

            console.log(`[Linha ${i}] Date: ${datePart}, Main: ${mainPart}, Extra: ${extraPart}`);

            const drawDate = parseDate(datePart);
            const mainNumbers = parseNumbers(mainPart);
            const extraNumbers = parseNumbers(extraPart);

            console.log(`[Linha ${i}] Parsed - Date: ${drawDate}, Main: [${mainNumbers}], Extra: [${extraNumbers}]`);

            // Validação Final
            if (drawDate && mainNumbers.length > 0) {
                drawsToSave.push({
                    lottery_id: lotteryId,
                    draw_date: drawDate,
                    main_numbers: mainNumbers,
                    extra_numbers: extraNumbers
                });
                console.log(`[Linha ${i}] ✓ Adicionado`);
            } else {
                console.log(`[Linha ${i}] ✗ Ignorado`);
                skipped++;
            }
        }

        // 3. Salvar (Remove duplicados da importação atual)
        if (drawsToSave.length > 0) {
            // Filtra datas duplicadas no ficheiro
            const uniqueDraws = Array.from(new Map(drawsToSave.map(item => [item.draw_date, item])).values());

            const batchSize = 50;
            for (let i = 0; i < uniqueDraws.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(uniqueDraws.slice(i, i + batchSize));
            }

            // Atualiza validações
            await base44.functions.invoke('validateSuggestions');

            return Response.json({ 
                success: true, 
                message: `Importação Universal: ${uniqueDraws.length} sorteios guardados em ${lotteryName}.` 
            });
        }

        return Response.json({ success: false, error: "Nenhum dado válido encontrado." });

    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});