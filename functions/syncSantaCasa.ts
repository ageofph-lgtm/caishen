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
        const results = [];

        for (const lottery of lotteries) {
            console.log(`\n=== ${lottery.name} ===`);

            // Get existing dates for this lottery
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            const existingDates = new Set(existingDraws.map(d => d.draw_date));
            console.log(`Existing: ${existingDates.size} draws`);

            // Build prompt based on lottery
            let lotteryInfo = '';
            if (lottery.name === 'EuroMilhões') {
                lotteryInfo = `EuroMilhões Portugal (jogossantacasa.pt) - Terças e Sextas - ${lottery.main_count} números (1-50) + ${lottery.extra_count} estrelas (1-12)`;
            } else if (lottery.name === 'Totoloto') {
                lotteryInfo = `Totoloto Portugal (jogossantacasa.pt) - Quartas e Sábados - ${lottery.main_count} números (1-49) + ${lottery.extra_count} nº sorte (1-13)`;
            } else if (lottery.name === 'EuroDreams') {
                lotteryInfo = `EuroDreams Portugal (jogossantacasa.pt) - Segundas e Quintas - ${lottery.main_count} números (1-40) + ${lottery.extra_count} dream (1-5)`;
            } else {
                continue;
            }

            const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt: `Busca os ÚLTIMOS 20 RESULTADOS OFICIAIS do ${lotteryInfo}. 
                
IMPORTANTE: Cada sorteio tem data única e números únicos. Formato: draw_date (YYYY-MM-DD), main_numbers (array), extra_numbers (array).`,
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

            let syncedCount = 0;
            const newDraws = [];

            if (aiResponse?.draws) {
                for (const draw of aiResponse.draws) {
                    // Validate
                    if (!draw.draw_date || !Array.isArray(draw.main_numbers)) continue;
                    if (draw.main_numbers.length !== lottery.main_count) continue;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.draw_date)) continue;

                    // Skip existing
                    if (existingDates.has(draw.draw_date)) continue;

                    newDraws.push({
                        lottery_id: lottery.id,
                        draw_date: draw.draw_date,
                        main_numbers: draw.main_numbers.map(n => parseInt(n)),
                        extra_numbers: (draw.extra_numbers || []).map(n => parseInt(n))
                    });
                    existingDates.add(draw.draw_date); // Prevent batch duplicates
                    syncedCount++;
                }

                if (newDraws.length > 0) {
                    await base44.asServiceRole.entities.Draw.bulkCreate(newDraws);
                }
            }

            results.push({ lottery: lottery.name, synced: syncedCount });
        }

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);

        return Response.json({
            success: true,
            message: totalSynced > 0 
                ? `✓ ${totalSynced} sorteios sincronizados` 
                : '✓ Base já atualizada',
            total_synced: totalSynced,
            results
        });

    } catch (error) {
        console.error('Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});