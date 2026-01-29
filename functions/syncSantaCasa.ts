import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log("🗑️ Iniciando limpeza de todos os sorteios...");
        
        // Limpa TODOS os sorteios da base de dados
        const allDraws = await base44.asServiceRole.entities.Draw.list();
        
        console.log(`Encontrados ${allDraws.length} sorteios para deletar`);
        
        for (const draw of allDraws) {
            await base44.asServiceRole.entities.Draw.delete(draw.id);
        }
        
        console.log(`✓ ${allDraws.length} sorteios deletados com sucesso`);
        console.log("✓ Sugestões mantidas intactas");

        return Response.json({ 
            success: true, 
            message: `${allDraws.length} sorteios deletados. Sugestões mantidas.`
        });
    } catch (error) {
        console.error('Erro:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});