import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        console.log('=== IMPORT STARTED ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { lottery_id, file_url } = body;

        if (!lottery_id || !file_url) {
            return Response.json({ error: 'lottery_id e file_url são obrigatórios' }, { status: 400 });
        }

        console.log('Importing for lottery:', lottery_id);
        console.log('File URL:', file_url);

        // Get lottery details
        const allLotteries = await base44.asServiceRole.entities.Lottery.list();
        const lottery = allLotteries.find(l => l.id === lottery_id);
        
        if (!lottery) {
            return Response.json({ error: 'Loteria não encontrada' }, { status: 404 });
        }

        console.log('Lottery:', lottery.name);

        // Extract data from file using AI
        const extractResult = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
            file_url: file_url,
            json_schema: {
                type: "object",
                properties: {
                    draw_date: { type: "string", description: "Data do sorteio YYYY-MM-DD" },
                    main_numbers: { 
                        type: "array", 
                        items: { type: "integer" },
                        description: `${lottery.main_count} números principais`
                    },
                    extra_numbers: { 
                        type: "array", 
                        items: { type: "integer" },
                        description: `${lottery.extra_count || 0} números extras`
                    }
                }
            }
        });

        console.log('Extract status:', extractResult.status);

        if (extractResult.status !== 'success' || !extractResult.output) {
            return Response.json({ 
                error: 'Falha ao extrair dados',
                details: extractResult.details
            }, { status: 500 });
        }

        const rawDraws = Array.isArray(extractResult.output) ? extractResult.output : [extractResult.output];
        console.log('Extracted draws:', rawDraws.length);

        // Validate and prepare draws
        const validDraws = [];
        for (const draw of rawDraws) {
            if (!draw.draw_date || !draw.main_numbers) continue;
            if (!Array.isArray(draw.main_numbers)) continue;
            if (draw.main_numbers.length !== lottery.main_count) continue;

            validDraws.push({
                lottery_id: lottery_id,
                draw_date: draw.draw_date,
                main_numbers: draw.main_numbers,
                extra_numbers: draw.extra_numbers || []
            });
        }

        console.log('Valid draws:', validDraws.length);

        if (validDraws.length === 0) {
            return Response.json({ 
                error: 'Nenhum sorteio válido no arquivo'
            }, { status: 500 });
        }

        // Check existing draws
        const existingDraws = await base44.asServiceRole.entities.Draw.list();
        const existingDates = new Set(
            existingDraws
                .filter(d => d.lottery_id === lottery_id)
                .map(d => d.draw_date)
        );

        // Filter new draws
        const newDraws = validDraws.filter(d => !existingDates.has(d.draw_date));

        console.log('New draws to insert:', newDraws.length);

        if (newDraws.length === 0) {
            return Response.json({
                success: true,
                message: 'Todos os sorteios já existem',
                imported: 0,
                total: validDraws.length
            });
        }

        // Insert in batches
        const batchSize = 50;
        for (let i = 0; i < newDraws.length; i += batchSize) {
            const batch = newDraws.slice(i, i + batchSize);
            await base44.asServiceRole.entities.Draw.bulkCreate(batch);
            console.log(`Inserted batch ${i / batchSize + 1}`);
        }

        console.log('=== IMPORT COMPLETED ===');

        return Response.json({
            success: true,
            message: `${newDraws.length} sorteio(s) importado(s)`,
            imported: newDraws.length,
            total: validDraws.length
        });

    } catch (error) {
        console.error('=== IMPORT ERROR ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        
        return Response.json({ 
            error: 'Erro ao importar',
            message: error.message
        }, { status: 500 });
    }
});