import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC SANTA CASA - ÚLTIMOS 50 RESULTADOS ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        
        // Get unique lotteries
        const uniqueLotteries = [];
        const seenNames = new Set();
        for (const lottery of lotteries) {
            if (!seenNames.has(lottery.name)) {
                seenNames.add(lottery.name);
                uniqueLotteries.push(lottery);
            }
        }

        const results = [];

        for (const lottery of uniqueLotteries) {
            console.log(`\n--- Syncing ${lottery.name} ---`);

            // Get existing draws for this lottery
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            const existingDatesSet = new Set(existingDraws.map(d => d.draw_date));
            console.log('Existing draws:', existingDraws.length);

            let allNewDraws = [];

            // Fetch in 3 batches of ~17 draws each for better reliability
            const batches = [
                { label: 'últimos 17', count: 17 },
                { label: '18-34', count: 17, offset: 17 },
                { label: '35-50', count: 16, offset: 34 }
            ];

            for (const batch of batches) {
                let prompt = '';
                
                if (lottery.name === 'EuroMilhões') {
                    prompt = `Busca resultados REAIS do EuroMilhões em jogossantacasa.pt

DADOS NECESSÁRIOS: ${batch.count} sorteios ${batch.offset ? `(do ${batch.offset + 1}º ao ${batch.offset + batch.count}º mais recente)` : 'mais recentes'}

O EuroMilhões tem sorteios às TERÇAS e SEXTAS.
- 5 números principais de 1 a 50
- 2 estrelas de 1 a 12

Formato de resposta para CADA sorteio:
- draw_date: YYYY-MM-DD
- main_numbers: [5 números inteiros]
- extra_numbers: [2 números inteiros]

CRÍTICO: Retorna dados REAIS do site oficial. Não invente nenhum número.`;

                } else if (lottery.name === 'Totoloto') {
                    prompt = `Busca resultados REAIS do Totoloto em jogossantacasa.pt

DADOS NECESSÁRIOS: ${batch.count} sorteios ${batch.offset ? `(do ${batch.offset + 1}º ao ${batch.offset + batch.count}º mais recente)` : 'mais recentes'}

O Totoloto tem sorteios às QUARTAS e SÁBADOS.
- 5 números principais de 1 a 49
- 1 número da sorte de 1 a 13

Formato de resposta para CADA sorteio:
- draw_date: YYYY-MM-DD
- main_numbers: [5 números inteiros]
- extra_numbers: [1 número inteiro]

CRÍTICO: Retorna dados REAIS do site oficial. Não invente nenhum número.`;

                } else if (lottery.name === 'EuroDreams') {
                    prompt = `Busca resultados REAIS do EuroDreams em jogossantacasa.pt

DADOS NECESSÁRIOS: ${batch.count} sorteios ${batch.offset ? `(do ${batch.offset + 1}º ao ${batch.offset + batch.count}º mais recente)` : 'mais recentes'}

O EuroDreams tem sorteios às SEGUNDAS e QUINTAS.
- 6 números principais de 1 a 40
- 1 número Dream de 1 a 5

Formato de resposta para CADA sorteio:
- draw_date: YYYY-MM-DD
- main_numbers: [6 números inteiros]
- extra_numbers: [1 número inteiro]

CRÍTICO: Retorna dados REAIS do site oficial. Não invente nenhum número.`;
                } else {
                    continue;
                }

                try {
                    console.log(`Fetching batch: ${batch.label}`);
                    
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
                                            main_numbers: {
                                                type: "array",
                                                items: { type: "integer" }
                                            },
                                            extra_numbers: {
                                                type: "array",
                                                items: { type: "integer" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });

                    console.log(`Batch ${batch.label} returned:`, aiResponse?.draws?.length || 0, 'draws');

                    if (aiResponse?.draws?.length > 0) {
                        for (const draw of aiResponse.draws) {
                            // Validate
                            if (!draw.draw_date || !draw.main_numbers) continue;
                            if (!Array.isArray(draw.main_numbers)) continue;
                            if (draw.main_numbers.length !== lottery.main_count) continue;
                            
                            // Check all numbers are valid integers
                            const validNumbers = draw.main_numbers.every(n => 
                                Number.isInteger(n) && n >= lottery.main_min && n <= lottery.main_max
                            );
                            if (!validNumbers) continue;

                            // Check if already exists by date
                            if (existingDatesSet.has(draw.draw_date)) continue;

                            // Check if already in our new draws list
                            const alreadyAdded = allNewDraws.some(d => d.draw_date === draw.draw_date);
                            if (alreadyAdded) continue;

                            allNewDraws.push({
                                lottery_id: lottery.id,
                                draw_date: draw.draw_date,
                                main_numbers: draw.main_numbers.sort((a, b) => a - b),
                                extra_numbers: (draw.extra_numbers || []).sort((a, b) => a - b)
                            });
                            
                            existingDatesSet.add(draw.draw_date);
                        }
                    }
                } catch (batchError) {
                    console.error(`Error in batch ${batch.label}:`, batchError.message);
                }
            }

            // Bulk create new draws
            if (allNewDraws.length > 0) {
                // Sort by date descending
                allNewDraws.sort((a, b) => b.draw_date.localeCompare(a.draw_date));
                
                await base44.asServiceRole.entities.Draw.bulkCreate(allNewDraws);
                console.log(`Created ${allNewDraws.length} new draws for ${lottery.name}`);
            }

            results.push({
                lottery: lottery.name,
                synced: allNewDraws.length,
                existing: existingDraws.length,
                message: allNewDraws.length > 0 
                    ? `${allNewDraws.length} novo(s) sorteio(s)`
                    : 'Base já atualizada'
            });

            // AUTO-VALIDATE SUGGESTIONS - Now checks ALL suggestions for this lottery
            try {
                console.log(`Checking suggestions for ${lottery.name}...`);
                const allSuggestions = await base44.asServiceRole.entities.Suggestion.filter({
                    lottery_id: lottery.id
                });

                console.log(`Found ${allSuggestions.length} suggestions for ${lottery.name}`);

                // Get ALL draws for this lottery (not just new ones)
                const allDrawsForLottery = await base44.asServiceRole.entities.Draw.filter({
                    lottery_id: lottery.id
                });

                let validatedCount = 0;

                for (const sugg of allSuggestions) {
                    // Find matching draw by date
                    const matchingDraw = allDrawsForLottery.find(d => d.draw_date === sugg.draw_date);

                    if (matchingDraw && !sugg.was_validated) {
                        const matchesMain = sugg.main_numbers.filter(n => 
                            matchingDraw.main_numbers.includes(n)
                        ).length;

                        const matchesExtra = (sugg.extra_numbers || []).filter(n => 
                            (matchingDraw.extra_numbers || []).includes(n)
                        ).length;

                        await base44.asServiceRole.entities.Suggestion.update(sugg.id, {
                            actual_main_numbers: matchingDraw.main_numbers,
                            actual_extra_numbers: matchingDraw.extra_numbers,
                            matches_main: matchesMain,
                            matches_extra: matchesExtra,
                            was_validated: true
                        });

                        validatedCount++;
                        console.log(`✓ Validated suggestion ${sugg.draw_date}: ${matchesMain} main + ${matchesExtra} extra`);
                    }
                }

                console.log(`Total validated: ${validatedCount} suggestions for ${lottery.name}`);
            } catch (valError) {
                console.error('Validation error:', valError.message);
            }
        }

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);

        return Response.json({
            success: true,
            message: totalSynced > 0 
                ? `✓ ${totalSynced} novo(s) sorteio(s) sincronizado(s)`
                : '✓ Base de dados já atualizada',
            total_synced: totalSynced,
            results: results
        });

    } catch (error) {
        console.error('Error:', error.message);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});