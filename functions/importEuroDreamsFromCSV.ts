import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { fileUrl } = await req.json();

        if (!fileUrl) {
            return Response.json({ success: false, error: "URL do ficheiro não fornecido" }, { status: 400 });
        }

        console.log('📥 Importando EuroDreams de:', fileUrl);

        // Buscar a loteria EuroDreams
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: "EuroDreams" });
        if (lotteries.length === 0) {
            return Response.json({ success: false, error: "Loteria EuroDreams não encontrada" }, { status: 404 });
        }
        const lotteryId = lotteries[0].id;

        // Ler o ficheiro CSV
        const response = await fetch(fileUrl);
        const csvContent = await response.text();

        // Processar linhas
        const lines = csvContent.trim().split(/\r\n|\n/);
        const drawsToImport = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            // Formato: "2026-01-26,""15,23,28,33,34,37"",""3"""
            // Remove aspas externas e divide
            const cleaned = line.replace(/^"|"$/g, '');
            const parts = cleaned.split(',');

            if (parts.length < 2) continue;

            const drawDate = parts[0];
            
            // Extrai números principais (remove aspas duplas)
            const mainNumbersStr = parts.slice(1, parts.length - 1).join(',').replace(/"/g, '');
            const mainNumbers = mainNumbersStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));

            // Extrai número extra (último elemento, remove aspas)
            const extraStr = parts[parts.length - 1].replace(/"/g, '').trim();
            const extraNumber = parseInt(extraStr);

            // Validação
            if (!drawDate || mainNumbers.length !== 6 || isNaN(extraNumber)) {
                console.warn('Linha inválida:', line);
                continue;
            }

            drawsToImport.push({
                lottery_id: lotteryId,
                draw_date: drawDate,
                main_numbers: mainNumbers.sort((a, b) => a - b),
                extra_numbers: [extraNumber]
            });
        }

        console.log(`✓ ${drawsToImport.length} sorteios processados`);

        // Verificar duplicados
        const existingDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lotteryId });
        const existingDates = new Set(existingDraws.map(d => d.draw_date));

        const newDraws = drawsToImport.filter(d => !existingDates.has(d.draw_date));

        if (newDraws.length === 0) {
            return Response.json({ 
                success: true, 
                message: "Todos os sorteios já existem na base de dados",
                imported: 0,
                total: drawsToImport.length
            });
        }

        // Importar em lotes
        const batchSize = 50;
        for (let i = 0; i < newDraws.length; i += batchSize) {
            const batch = newDraws.slice(i, i + batchSize);
            await base44.asServiceRole.entities.Draw.bulkCreate(batch);
            console.log(`✓ Importados ${i + batch.length}/${newDraws.length}`);
        }

        return Response.json({ 
            success: true, 
            message: `✓ ${newDraws.length} sorteios EuroDreams importados com sucesso`,
            imported: newDraws.length,
            total: drawsToImport.length
        });

    } catch (error) {
        console.error('Erro na importação:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});