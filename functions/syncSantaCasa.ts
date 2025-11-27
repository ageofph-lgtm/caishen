import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC SANTA CASA - CLEANUP & SYNC ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        const results = [];
        let totalDuplicatesRemoved = 0;

        for (const lottery of lotteries) {
            console.log(`\n=== Processing ${lottery.name} ===`);

            // STEP 1: Get ALL draws for this lottery
            const allDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            console.log(`Total draws in DB: ${allDraws.length}`);

            // STEP 2: Group by date and find duplicates
            const drawsByDate = {};
            for (const draw of allDraws) {
                const date = draw.draw_date;
                if (!drawsByDate[date]) {
                    drawsByDate[date] = [];
                }
                drawsByDate[date].push(draw);
            }

            // STEP 3: Delete ALL duplicates - keep only ONE per date
            let duplicatesDeleted = 0;
            for (const date in drawsByDate) {
                const draws = drawsByDate[date];
                if (draws.length > 1) {
                    console.log(`Found ${draws.length} duplicates for date ${date}`);
                    // Keep the first, delete all others
                    for (let i = 1; i < draws.length; i++) {
                        try {
                            await base44.asServiceRole.entities.Draw.delete(draws[i].id);
                            duplicatesDeleted++;
                            console.log(`Deleted duplicate ID: ${draws[i].id}`);
                        } catch (e) {
                            console.log(`Error deleting: ${e.message}`);
                        }
                    }
                }
            }
            
            totalDuplicatesRemoved += duplicatesDeleted;
            console.log(`Duplicates removed for ${lottery.name}: ${duplicatesDeleted}`);

            // STEP 4: Get current unique dates after cleanup
            const cleanDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            const existingDates = new Set(cleanDraws.map(d => d.draw_date));
            console.log(`Unique dates after cleanup: ${existingDates.size}`);

            // STEP 5: Fetch new data from Santa Casa
            let lotteryPrompt = '';
            if (lottery.name === 'EuroMilhões') {
                lotteryPrompt = `EuroMilhões Portugal - jogossantacasa.pt
Sorteios: Terças e Sextas. ${lottery.main_count} números (1-50) + ${lottery.extra_count} estrelas (1-12)`;
            } else if (lottery.name === 'Totoloto') {
                lotteryPrompt = `Totoloto Portugal - jogossantacasa.pt
Sorteios: Quartas e Sábados. ${lottery.main_count} números (1-49) + ${lottery.extra_count} nº sorte (1-13)`;
            } else if (lottery.name === 'EuroDreams') {
                lotteryPrompt = `EuroDreams Portugal - jogossantacasa.pt
Sorteios: Segundas e Quintas. ${lottery.main_count} números (1-40) + ${lottery.extra_count} dream (1-5)`;
            } else {
                results.push({ lottery: lottery.name, synced: 0, duplicatesRemoved: duplicatesDeleted });
                continue;
            }

            const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt: `Busca os ÚLTIMOS 20 RESULTADOS OFICIAIS do ${lotteryPrompt}

IMPORTANTE: Cada data tem números DIFERENTES. Retorna no formato:
- draw_date: YYYY-MM-DD
- main_numbers: array de inteiros
- extra_numbers: array de inteiros

Dados REAIS e OFICIAIS apenas.`,
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

            // STEP 6: Insert only NEW dates
            let syncedCount = 0;
            const newDraws = [];

            if (aiResponse?.draws) {
                for (const draw of aiResponse.draws) {
                    // Validate
                    if (!draw.draw_date || !Array.isArray(draw.main_numbers)) continue;
                    if (draw.main_numbers.length !== lottery.main_count) continue;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.draw_date)) continue;

                    // Skip if date exists
                    if (existingDates.has(draw.draw_date)) {
                        console.log(`Skipping existing date: ${draw.draw_date}`);
                        continue;
                    }

                    newDraws.push({
                        lottery_id: lottery.id,
                        draw_date: draw.draw_date,
                        main_numbers: draw.main_numbers.map(n => parseInt(n)),
                        extra_numbers: (draw.extra_numbers || []).map(n => parseInt(n))
                    });
                    existingDates.add(draw.draw_date);
                    syncedCount++;
                }

                if (newDraws.length > 0) {
                    await base44.asServiceRole.entities.Draw.bulkCreate(newDraws);
                    console.log(`Created ${newDraws.length} new draws`);
                }
            }

            results.push({
                lottery: lottery.name,
                synced: syncedCount,
                duplicatesRemoved: duplicatesDeleted
            });
        }

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);

        let message = '';
        if (totalDuplicatesRemoved > 0 && totalSynced > 0) {
            message = `✓ ${totalDuplicatesRemoved} duplicados removidos, ${totalSynced} novos adicionados`;
        } else if (totalDuplicatesRemoved > 0) {
            message = `✓ ${totalDuplicatesRemoved} duplicados removidos`;
        } else if (totalSynced > 0) {
            message = `✓ ${totalSynced} novos sorteios sincronizados`;
        } else {
            message = '✓ Base de dados já está atualizada';
        }

        return Response.json({
            success: true,
            message: message,
            total_synced: totalSynced,
            duplicates_removed: totalDuplicatesRemoved,
            results: results
        });

    } catch (error) {
        console.error('Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});