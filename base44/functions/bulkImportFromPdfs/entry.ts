import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { pdf_urls, lottery_name } = await req.json();

        console.log('Starting bulk import for:', lottery_name);

        // Get lottery
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: lottery_name });
        
        if (!lotteries || lotteries.length === 0) {
            return Response.json({ error: 'Loteria não encontrada' }, { status: 404 });
        }

        const lottery = lotteries[0];
        console.log('Lottery found:', lottery.name);

        // Build specific prompt based on lottery
        let extractionPrompt = '';
        
        if (lottery_name === 'EuroMilhões') {
            extractionPrompt = `Este PDF contém resultados históricos do EuroMilhões.
Cada linha tem: Data (YYYY-MM-DD), 5 números principais (1-50), 2 estrelas (1-12).
Extraia TODOS os sorteios no formato especificado.`;
        } else if (lottery_name === 'Totoloto') {
            extractionPrompt = `Este PDF contém resultados históricos do Totoloto.
Cada linha tem: 5 números principais separados por vírgulas (1-49), 1 número da sorte (1-13), Data (YYYY-MM-DD).
Formato da coluna Sequencia_Principal: "1, 11, 12, 13, 2" significa números [1, 11, 12, 13, 2].
Extra é o número da sorte.
Extraia TODOS os sorteios no formato especificado.`;
        } else if (lottery_name === 'EuroDreams') {
            extractionPrompt = `Este PDF contém resultados históricos do EuroDreams.
Cada linha tem: 6 números principais separados por vírgulas (1-40), 1 número Dream (1-5), Data (YYYY-MM-DD).
Formato da coluna Sequencia_Principal: "10, 13, 14, 25, 30, 35" significa números [10, 13, 14, 25, 30, 35].
Extra é o número Dream.
Extraia TODOS os sorteios no formato especificado.`;
        }

        // Process all PDFs
        let allDraws = [];

        for (const pdf_url of pdf_urls) {
            console.log('Processing PDF:', pdf_url);

            const extractResult = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
                file_url: pdf_url,
                json_schema: {
                    type: "object",
                    properties: {
                        draw_date: { 
                            type: "string",
                            description: "Data do sorteio no formato YYYY-MM-DD"
                        },
                        main_numbers: { 
                            type: "array",
                            items: { type: "integer" },
                            description: `${lottery.main_count} números principais entre ${lottery.main_min} e ${lottery.main_max}. ${extractionPrompt}`
                        },
                        extra_numbers: { 
                            type: "array",
                            items: { type: "integer" },
                            description: `${lottery.extra_count} número(s) extra(s) entre ${lottery.extra_min} e ${lottery.extra_max}`
                        }
                    },
                    required: ["draw_date", "main_numbers"]
                }
            });

            console.log('Extract result:', extractResult.status);

            if (extractResult.status === 'success' && extractResult.output) {
                const draws = Array.isArray(extractResult.output) ? extractResult.output : [extractResult.output];
                console.log('Draws extracted from PDF:', draws.length);
                
                draws.forEach(draw => {
                    if (draw.draw_date && draw.main_numbers) {
                        // Validate main numbers count
                        if (Array.isArray(draw.main_numbers) && draw.main_numbers.length === lottery.main_count) {
                            allDraws.push({
                                lottery_id: lottery.id,
                                draw_date: draw.draw_date,
                                main_numbers: draw.main_numbers.map(n => parseInt(n)),
                                extra_numbers: (draw.extra_numbers || []).map(n => parseInt(n))
                            });
                        }
                    }
                });
            }
        }

        console.log('Total draws extracted:', allDraws.length);

        if (allDraws.length === 0) {
            return Response.json({ 
                error: 'Nenhum sorteio extraído dos PDFs',
                details: 'Verifique se os PDFs estão no formato correto'
            }, { status: 500 });
        }

        // Remove duplicates by date
        const uniqueDraws = [];
        const seenDates = new Set();

        allDraws.forEach(draw => {
            if (!seenDates.has(draw.draw_date)) {
                seenDates.add(draw.draw_date);
                uniqueDraws.push(draw);
            }
        });

        console.log('Unique draws:', uniqueDraws.length);

        // Check existing
        const existing = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lottery.id });
        const existingDates = new Set(existing.map(d => d.draw_date));

        const newDraws = uniqueDraws.filter(d => !existingDates.has(d.draw_date));

        console.log('New draws to insert:', newDraws.length);

        if (newDraws.length === 0) {
            return Response.json({
                success: true,
                message: 'Todos os sorteios já existem na base',
                imported: 0,
                total: uniqueDraws.length
            });
        }

        // Insert in batches
        const batchSize = 100;
        for (let i = 0; i < newDraws.length; i += batchSize) {
            const batch = newDraws.slice(i, i + batchSize);
            await base44.asServiceRole.entities.Draw.bulkCreate(batch);
            console.log(`Batch ${Math.floor(i / batchSize) + 1} inserted`);
        }

        return Response.json({
            success: true,
            message: `${newDraws.length} sorteios importados com sucesso`,
            imported: newDraws.length,
            total: uniqueDraws.length
        });

    } catch (error) {
        console.error('Import error:', error);
        return Response.json({ 
            error: 'Erro ao importar',
            message: error.message
        }, { status: 500 });
    }
});