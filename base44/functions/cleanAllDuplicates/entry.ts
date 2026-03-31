import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        console.log('🧹 Limpeza Profunda Iniciada');

        // 1. Limpar Loterias Duplicadas
        console.log('\n=== LIMPANDO LOTERIAS DUPLICADAS ===');
        const allLotteries = await base44.asServiceRole.entities.Lottery.list();
        console.log('Total de loterias:', allLotteries.length);

        const lotteryMap = new Map();
        const lotteriesToDelete = [];

        allLotteries.forEach(lottery => {
            const existing = lotteryMap.get(lottery.name);
            if (existing) {
                // Mantém a mais recente
                if (lottery.created_date > existing.created_date) {
                    lotteriesToDelete.push(existing.id);
                    lotteryMap.set(lottery.name, lottery);
                } else {
                    lotteriesToDelete.push(lottery.id);
                }
            } else {
                lotteryMap.set(lottery.name, lottery);
            }
        });

        console.log('Loterias a deletar:', lotteriesToDelete.length);
        for (const id of lotteriesToDelete) {
            await base44.asServiceRole.entities.Lottery.delete(id);
        }
        console.log('✓ Loterias duplicadas removidas');

        // 2. Limpar Sorteios Duplicados (BULK DELETE)
        console.log('\n=== LIMPANDO SORTEIOS DUPLICADOS ===');
        const allDraws = await base44.asServiceRole.entities.Draw.list();
        console.log('Total de sorteios:', allDraws.length);

        // Agrupar sorteios por lottery_id + draw_date + números
        const drawMap = new Map();
        const drawsToDelete = [];

        allDraws.forEach(draw => {
            const key = `${draw.lottery_id}|${draw.draw_date}|${JSON.stringify([...draw.main_numbers].sort())}`;
            const existing = drawMap.get(key);
            
            if (existing) {
                // Mantém o mais recente
                if (draw.created_date > existing.created_date) {
                    drawsToDelete.push(existing.id);
                    drawMap.set(key, draw);
                } else {
                    drawsToDelete.push(draw.id);
                }
            } else {
                drawMap.set(key, draw);
            }
        });

        console.log('Sorteios duplicados encontrados:', drawsToDelete.length);
        console.log('Sorteios únicos:', drawMap.size);

        // Delete em lotes de 100 (mais rápido, ignora erros)
        const batchSize = 100;
        let deletedCount = 0;
        for (let i = 0; i < drawsToDelete.length; i += batchSize) {
            const batch = drawsToDelete.slice(i, i + batchSize);
            const results = await Promise.allSettled(
                batch.map(id => base44.asServiceRole.entities.Draw.delete(id))
            );
            deletedCount += results.filter(r => r.status === 'fulfilled').length;
            console.log(`✓ Deletados ${deletedCount}/${drawsToDelete.length}`);
        }
        console.log(`Total removido com sucesso: ${deletedCount}`);

        console.log('✓ Limpeza concluída');
        return Response.json({ 
            success: true, 
            message: `✓ ${lotteriesToDelete.length} loterias duplicadas e ${drawsToDelete.length} sorteios duplicados removidos`,
            lotteries_removed: lotteriesToDelete.length,
            draws_removed: drawsToDelete.length,
            unique_draws: drawMap.size
        });

    } catch (error) {
        console.error('Erro:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});