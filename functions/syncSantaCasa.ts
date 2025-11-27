import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC SANTA CASA ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        
        // Remove duplicate lotteries by name
        const uniqueLotteries = [];
        const seenNames = new Set();
        for (const lot of lotteries) {
            if (!seenNames.has(lot.name)) {
                seenNames.add(lot.name);
                uniqueLotteries.push(lot);
            }
        }

        const results = [];

        for (const lottery of uniqueLotteries) {
            console.log(`\n=== ${lottery.name} ===`);

            // Get existing draws
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            
            // Create set of existing dates
            const existingDates = new Set(existingDraws.map(d => d.draw_date));
            console.log(`Existing dates: ${existingDates.size}`);

            // Build prompt for each lottery
            let prompt = '';
            if (lottery.name === 'EuroMilhões') {
                prompt = `Busca os últimos 30 resultados OFICIAIS do EuroMilhões em Portugal.
Site oficial: jogossantacasa.pt
Sorteios às TERÇAS e SEXTAS.
Formato: 5 números (1-50) + 2 estrelas (1-12)
Retorna dados REAIS com datas corretas no formato YYYY-MM-DD.
CADA DATA TEM NÚMEROS DIFERENTES - verifica bem os resultados oficiais.`;
            } else if (lottery.name === 'Totoloto') {
                prompt = `Busca os últimos 30 resultados OFICIAIS do Totoloto em Portugal.
Site oficial: jogossantacasa.pt
Sorteios às QUARTAS e SÁBADOS.
Formato: 5 números (1-49) + 1 número da sorte (1-13)
Retorna dados REAIS com datas corretas no formato YYYY-MM-DD.
CADA DATA TEM NÚMEROS DIFERENTES - verifica bem os resultados oficiais.`;
            } else if (lottery.name === 'EuroDreams') {
                prompt = `Busca os últimos 30 resultados OFICIAIS do EuroDreams em Portugal.
Site oficial: jogossantacasa.pt
Sorteios às SEGUNDAS e QUINTAS.
Formato: 6 números (1-40) + 1 dream (1-5)
Retorna dados REAIS com datas corretas no formato YYYY-MM-DD.
CADA DATA TEM NÚMEROS DIFERENTES - verifica bem os resultados oficiais.`;
            } else {
                continue;
            }

            const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt: prompt,
                add_context_from_internet: true,
                response_json_schema: {
                    type: "object",
                    properties: {
                        draws: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    draw_date: { type: "string" },
                                    main_numbers: { type: "array", items: { type: "integer" } },
                                    extra_numbers: { type: "array", items: { type: "integer" } }
                                }
                            }
                        }
                    }
                }
            });

            if (!aiResponse?.draws || aiResponse.draws.length === 0) {
                results.push({ lottery: lottery.name, synced: 0, message: 'Sem dados' });
                continue;
            }

            console.log(`AI returned ${aiResponse.draws.length} draws`);

            // Filter and validate
            const newDraws = [];
            const addedDates = new Set();

            for (const draw of aiResponse.draws) {
                // Validate structure
                if (!draw.draw_date || !Array.isArray(draw.main_numbers)) continue;
                if (draw.main_numbers.length !== lottery.main_count) continue;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.draw_date)) continue;

                // Skip if already exists in DB
                if (existingDates.has(draw.draw_date)) {
                    console.log(`Skip existing: ${draw.draw_date}`);
                    continue;
                }

                // Skip if already added in this batch (prevent duplicates in same sync)
                if (addedDates.has(draw.draw_date)) {
                    console.log(`Skip duplicate in batch: ${draw.draw_date}`);
                    continue;
                }

                newDraws.push({
                    lottery_id: lottery.id,
                    draw_date: draw.draw_date,
                    main_numbers: draw.main_numbers.map(n => parseInt(n)),
                    extra_numbers: (draw.extra_numbers || []).map(n => parseInt(n))
                });
                addedDates.add(draw.draw_date);
                console.log(`Will add: ${draw.draw_date} - [${draw.main_numbers.join(', ')}]`);
            }

            if (newDraws.length > 0) {
                await base44.asServiceRole.entities.Draw.bulkCreate(newDraws);
                console.log(`Created ${newDraws.length} draws`);
            }

            results.push({
                lottery: lottery.name,
                synced: newDraws.length,
                total: existingDates.size + newDraws.length
            });
        }

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
        const message = totalSynced > 0 
            ? `✓ ${totalSynced} novo(s) sorteio(s) sincronizado(s)`
            : '✓ Base de dados já atualizada';

        return Response.json({
            success: true,
            message: message,
            total_synced: totalSynced,
            results: results
        });

    } catch (error) {
        console.error('Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});