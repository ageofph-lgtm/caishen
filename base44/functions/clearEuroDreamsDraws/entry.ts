import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Busca a loteria EuroDreams
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: "EuroDreams" });
        
        if (lotteries.length === 0) {
            return Response.json({ 
                success: false, 
                error: "EuroDreams não encontrado" 
            }, { status: 404 });
        }
        
        const euroDreamsId = lotteries[0].id;
        
        // Busca todos os sorteios da EuroDreams
        const draws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: euroDreamsId });
        
        console.log(`Encontrados ${draws.length} sorteios da EuroDreams para deletar`);
        
        // Deleta todos os sorteios
        for (const draw of draws) {
            await base44.asServiceRole.entities.Draw.delete(draw.id);
        }
        
        console.log(`✓ ${draws.length} sorteios da EuroDreams deletados`);
        
        return Response.json({ 
            success: true, 
            message: `${draws.length} sorteios da EuroDreams foram deletados. Sugestões mantidas.`,
            deleted: draws.length
        });
        
    } catch (error) {
        console.error('Erro:', error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});