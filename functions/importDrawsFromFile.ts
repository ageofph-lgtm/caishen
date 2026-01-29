import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Função robusta de limpeza de data
function parseDate(dateStr: string): string | null {
    if (!dateStr) return null;
    // Remove aspas e espaços
    const cleanStr = dateStr.replace(/["']/g, '').trim();
    
    // Tenta YYYY-MM-DD
    if (cleanStr.match(/^\d{4}-\d{2}-\d{2}$/)) return cleanStr;
    
    // Tenta DD/MM/YYYY ou DD-MM-YYYY
    const parts = cleanStr.split(/[\/\-]/);
    if (parts.length === 3) {
        // Assume dia/mês/ano se o primeiro número for > 1900 (ano)
        if (parseInt(parts[0]) > 1900) return `${parts[0]}-${parts[1]}-${parts[2]}`; // Já é YYYY-MM-DD
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`; // Converte DD-MM-YYYY
    }
    return null;
}

// Limpa números
function cleanNumbers(nums: any[]): number[] {
    return nums
        .map(n => parseInt(String(n).replace(/[^0-9]/g, ''))) // Remove caracteres não numéricos
        .filter(n => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileContent, fileName } = await req.json();

        if (!fileContent) throw new Error("O ficheiro está vazio.");

        console.log(`=== IMPORTADOR CAISHEN: ${fileName} ===`);
        
        // 1. Identificação da Lotaria
        let lotteryName = "";
        if (fileName.toLowerCase().includes("eurodreams")) lotteryName = "EuroDreams";
        else if (fileName.toLowerCase().includes("euromillones") || fileName.toLowerCase().includes("euromilhoes")) lotteryName = "EuroMilhões";
        else if (fileName.toLowerCase().includes("toto")) lotteryName = "Totoloto";
        
        if (!lotteryName) throw new Error("Nome do ficheiro não reconhecido. Use 'EuroDreams', 'EuroMilhões' ou 'Totoloto' no nome.");

        // Busca ID
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lotteryName });
        if (lotteries.length === 0) throw new Error(`Lotaria ${lotteryName} não configurada no sistema.`);
        const lotteryId = lotteries[0].id;

        // 2. Normalização de Quebras de Linha (Windows/Mac/Linux)
        const lines = fileContent.split(/\r\n|\n|\r/);
        
        // 3. Deteção Automática de Separador (Vírgula ou Ponto e Vírgula)
        // Procura a primeira linha que parece ter dados (contém números e separadores)
        const sampleLine = lines.find(l => l.match(/\d/) && (l.includes(',') || l.includes(';'))) || "";
        const delimiter = sampleLine.includes(';') ? ';' : ',';
        console.log(`Separador detetado: '${delimiter}'`);

        const drawsToSave = [];
        let skippedCount = 0;
        let successCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(delimiter).map(c => c.trim());

            // Debug das primeiras linhas
            if (i < 3) {
                console.log(`Linha ${i}: [${cols.join(' | ')}]`);
            }

            // Tenta encontrar a data na primeira coluna
            const drawDate = parseDate(cols[0]);

            if (!drawDate) {
                if (i < 3) console.log(`Linha ${i}: Data inválida ou cabeçalho - "${cols[0]}"`);
                skippedCount++; // Cabeçalho ou lixo
                continue;
            }

            if (i < 3) console.log(`Linha ${i}: Data parseada como ${drawDate}`);

            let mainNumbers: number[] = [];
            let extraNumbers: number[] = [];

            try {
                if (lotteryName === "EuroDreams") {
                    // EuroDreams: 6 Principais + 1 Sonho
                    // Formato comum: DATA, COMB. GANADORA (vazio), N1, N2, N3, N4, N5, N6, SUEÑO
                    
                    // Detecta se cols[1] é número ou texto/vazio (coluna COMB. GANADORA)
                    let startIdx = 1;
                    if (cols[1] && isNaN(parseInt(cols[1]))) {
                        // cols[1] não é número, pula para cols[2]
                        startIdx = 2;
                        console.log(`Linha ${i+1}: Coluna "COMB. GANADORA" detectada, usando índice ${startIdx}`);
                    }
                    
                    // Pega 6 números principais a partir de startIdx
                    mainNumbers = cleanNumbers(cols.slice(startIdx, startIdx + 6));
                    
                    // Pega o Sueño (1 número extra)
                    extraNumbers = cleanNumbers([cols[startIdx + 6]]);
                    
                    // Validação Estrita
                    if (mainNumbers.length !== 6 || extraNumbers.length !== 1) {
                        throw new Error(`EuroDreams precisa 6 números + 1 Sueño. Encontrados: ${mainNumbers.length}+${extraNumbers.length}`);
                    }
                } 
                else if (lotteryName === "EuroMilhões") {
                    mainNumbers = cleanNumbers(cols.slice(1, 6));
                    // EuroMilhões tem 2 estrelas. Ajusta se houver coluna vazia no meio (comum no lotoideas)
                    const potentialExtras = cleanNumbers(cols.slice(6));
                    if (potentialExtras.length === 2) extraNumbers = potentialExtras;
                    else extraNumbers = cleanNumbers(cols.slice(7, 9));
                }
                else if (lotteryName === "Totoloto") {
                    mainNumbers = cleanNumbers(cols.slice(1, 6));
                    if (cols[6]) extraNumbers = cleanNumbers([cols[6]]);
                }

                if (drawDate && mainNumbers.length > 0) {
                    drawsToSave.push({
                        lottery_id: lotteryId,
                        draw_date: drawDate,
                        main_numbers: mainNumbers,
                        extra_numbers: extraNumbers
                    });
                    successCount++;
                }
            } catch (err) {
                console.warn(`Linha ${i+1} ignorada: ${err.message}`);
                skippedCount++;
            }
        }

        // SALVA EM BLOCOS (Batch)
        if (drawsToSave.length > 0) {
            // Remove duplicados da importação atual (mesma data)
            const uniqueDraws = Array.from(new Map(drawsToSave.map(item => [item.draw_date, item])).values());
            
            const batchSize = 50;
            for (let i = 0; i < uniqueDraws.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(uniqueDraws.slice(i, i + batchSize));
            }
            
            // Revalida sugestões
            await base44.functions.invoke('validateSuggestions');

            return Response.json({ 
                success: true, 
                message: `✅ Sucesso! Importados ${uniqueDraws.length} sorteios para ${lotteryName}. (Ignorados: ${skippedCount})` 
            });
        } else {
            return Response.json({ 
                success: false, 
                error: "Nenhum sorteio válido encontrado. Verifique se o ficheiro tem datas na primeira coluna." 
            });
        }

    } catch (error) {
        console.error(error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});