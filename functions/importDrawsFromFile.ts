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
        .sort((a, b) => a - b); // Ordena sempre para evitar confusão
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileContent, fileName } = await req.json();

        if (!fileContent) throw new Error("Conteúdo do arquivo vazio.");

        console.log(`A processar ficheiro: ${fileName}`);
        
        // Deteta a lotaria pelo nome do ficheiro ou cabeçalho
        let lotteryName = "";
        if (fileName.toLowerCase().includes("eurodreams")) lotteryName = "EuroDreams";
        else if (fileName.toLowerCase().includes("euromillones") || fileName.toLowerCase().includes("euromilhoes")) lotteryName = "EuroMilhões";
        else if (fileName.toLowerCase().includes("toto")) lotteryName = "Totoloto";
        else throw new Error("Não foi possível identificar a lotaria pelo nome do ficheiro.");

        // Busca o ID da lotaria
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lotteryName });
        if (lotteries.length === 0) throw new Error(`Lotaria '${lotteryName}' não encontrada no sistema.`);
        const lotteryId = lotteries[0].id;

        // Processa as linhas do CSV
        const lines = fileContent.split('\n');
        const drawsToSave = [];
        let skipped = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || i === 0) continue; // Pula cabeçalho e linhas vazias (Assumindo cabeçalho na linha 1)

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
                    // Números principais (índices 1 a 5)
                    mainNumbers = cleanNumbers(cols.slice(1, 6));
                    // Estrelas (índices 7 a 8 - pula o 6 que costuma ser vazio no lotoideas)
                    // Se a coluna 6 tiver dados, usamos ela, senão pulamos
                    const startExtra = cols[6] === '' ? 7 : 6;
                    extraNumbers = cleanNumbers(cols.slice(startExtra, startExtra + 2));
                } 
                
                // CASO 2: Totoloto (toto..csv)
                // Formato: DATA, N1, N2, N3, N4, N5, NS (e lixo depois)
                else if (lotteryName === "Totoloto") {
                    drawDate = formatDate(cols[0]);
                    mainNumbers = cleanNumbers(cols.slice(1, 6));
                    // O último número válido da linha costuma ser o Número da Sorte
                    // Mas vamos pegar o índice 6 com segurança
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
                        lottery_id: lotteryId,
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

        // LIMPEZA ANTES DE IMPORTAR (Opcional: descomente se quiser apagar o histórico antigo dessa lotaria)
        // const oldDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lotteryId });
        // for (const d of oldDraws) await base44.asServiceRole.entities.Draw.delete(d.id);

        // SALVA EM BLOCOS (Batch)
        if (drawsToSave.length > 0) {
            // Base44 pode ter limite de payload, salvamos em blocos de 50
            const batchSize = 50;
            for (let i = 0; i < drawsToSave.length; i += batchSize) {
                await base44.asServiceRole.entities.Draw.bulkCreate(drawsToSave.slice(i, i + batchSize));
            }
        }

        // RE-VALIDAÇÃO AUTOMÁTICA
        await base44.functions.invoke('validateSuggestions');

        return Response.json({ 
            success: true, 
            message: `Importados ${drawsToSave.length} sorteios para ${lotteryName}. (Ignorados: ${skipped})` 
        });

    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});