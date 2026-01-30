import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log("🧹 Iniciando limpeza de duplicados...");
        
        // Pega TODOS os draws
        const allDraws = await base44.asServiceRole.entities.Draw.list();
        console.log(`Total de draws: ${allDraws.length}`);
        
        // Agrupa por lottery_id + draw_date
        const uniqueDraws = new Map();
        const toDelete = [];
        
        for (const draw of allDraws) {
            const key = `${draw.lottery_id}-${draw.draw_date}`;
            
            if (!uniqueDraws.has(key)) {
                // Primeiro encontrado - mantém
                uniqueDraws.set(key, draw);
            } else {
                // Duplicado - marca para deletar
                toDelete.push(draw.id);
            }
        }
        
        console.log(`Draws únicos: ${uniqueDraws.size}`);
        console.log(`Duplicados a apagar: ${toDelete.length}`);
        
        // Deleta os duplicados em lotes pequenos com pausa
        const batchSize = 10;
        for (let i = 0; i < toDelete.length; i += batchSize) {
            const batch = toDelete.slice(i, i + batchSize);
            
            for (const id of batch) {
                await base44.asServiceRole.entities.Draw.delete(id);
            }
            
            console.log(`Deletados ${Math.min(i + batchSize, toDelete.length)}/${toDelete.length}`);
            
            // Pausa de 2 segundos entre lotes
            if (i + batchSize < toDelete.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Remove duplicata da loteria EuroDreams
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: "EuroDreams" });
        if (lotteries.length > 1) {
            console.log(`Encontradas ${lotteries.length} loterias EuroDreams, a remover duplicatas...`);
            
            // Mantém apenas a mais recente
            const sortedLotteries = lotteries.sort((a, b) => 
                new Date(b.created_date) - new Date(a.created_date)
            );
            
            for (let i = 1; i < sortedLotteries.length; i++) {
                await base44.asServiceRole.entities.Lottery.delete(sortedLotteries[i].id);
                console.log(`Deletada loteria duplicada: ${sortedLotteries[i].id}`);
            }
        }
        
        console.log("✅ Limpeza concluída!");
        
        return Response.json({ 
            success: true, 
            message: `Limpeza completa! ${toDelete.length} draws duplicados removidos. ${uniqueDraws.size} draws únicos mantidos.`,
            stats: {
                total: allDraws.length,
                unique: uniqueDraws.size,
                deleted: toDelete.length
            }
        });
        
    } catch (error) {
        console.error('Erro:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});