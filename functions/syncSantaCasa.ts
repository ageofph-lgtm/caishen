import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC SANTA CASA - MASTER SYNC ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        const results = [];

        for (const lottery of lotteries) {
            console.log(`\n=== Processing ${lottery.name} ===`);

            // Step 1: Get ALL existing draws for this lottery
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            console.log(`Existing draws in DB: ${existingDraws.length}`);

            // Create a map of existing draws by date for quick lookup
            const existingByDate = {};
            existingDraws.forEach(d => {
                if (!existingByDate[d.draw_date]) {
                    existingByDate[d.draw_date] = [];
                }
                existingByDate[d.draw_date].push(d);
            });

            // Step 2: Find and delete duplicates (same date, same numbers)
            let duplicatesDeleted = 0;
            for (const date in existingByDate) {
                const drawsOnDate = existingByDate[date];
                if (drawsOnDate.length > 1) {
                    // Keep only the first one, delete the rest
                    const toDelete = drawsOnDate.slice(1);
                    for (const dup of toDelete) {
                        console.log(`Deleting duplicate: ${date}`);
                        await base44.asServiceRole.entities.Draw.delete(dup.id);
                        duplicatesDeleted++;
                    }
                }
            }
            console.log(`Duplicates deleted: ${duplicatesDeleted}`);

            // Step 3: Fetch new results from Santa Casa
            let lotteryInfo = '';
            if (lottery.name === 'EuroMilhões') {
                lotteryInfo = `EuroMilhões - site oficial jogossantacasa.pt
                Sorteios: TERÇAS e SEXTAS-FEIRAS
                ${lottery.main_count} números principais (1-50)
                ${lottery.extra_count} estrelas (1-12)`;
            } else if (lottery.name === 'Totoloto') {
                lotteryInfo = `Totoloto - site oficial jogossantacasa.pt
                Sorteios: QUARTAS e SÁBADOS
                ${lottery.main_count} números principais (1-49)
                ${lottery.extra_count} número da sorte (1-13)`;
            } else if (lottery.name === 'EuroDreams') {
                lotteryInfo = `EuroDreams - site oficial jogossantacasa.pt
                Sorteios: SEGUNDAS e QUINTAS-FEIRAS
                ${lottery.main_count} números principais (1-40)
                ${lottery.extra_count} número Dream (1-5)`;
            } else {
                continue;
            }

            const prompt = `TAREFA: Buscar os ÚLTIMOS 20 RESULTADOS OFICIAIS do ${lotteryInfo}

REGRAS CRÍTICAS:
1. Cada sorteio tem uma DATA ÚNICA - não pode haver 2 sorteios no mesmo dia
2. Os números de cada sorteio são ÚNICOS para aquela data
3. Busca dados REAIS do site oficial da Santa Casa
4. Formato de data: YYYY-MM-DD
5. Retorna EXATAMENTE os números que saíram em cada data

EXEMPLO de formato esperado:
- 2025-11-26: números [2, 4, 9, 38, 49] + extras [10]
- 2025-11-23: números [X, X, X, X, X] + extras [X]
(cada data com seus números DIFERENTES)

NÃO repitas os mesmos números em datas diferentes a menos que realmente tenham saído iguais (muito raro).`;

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

            console.log('AI returned draws:', aiResponse?.draws?.length || 0);

            if (!aiResponse || !aiResponse.draws || aiResponse.draws.length === 0) {
                results.push({
                    lottery: lottery.name,
                    synced: 0,
                    duplicatesRemoved: duplicatesDeleted,
                    message: 'Não foi possível obter novos dados'
                });
                continue;
            }

            // Step 4: Validate and insert only NEW draws
            // Refresh existing draws after cleanup
            const currentDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            const currentDates = new Set(currentDraws.map(d => d.draw_date));

            let syncedCount = 0;
            const newDraws = [];

            for (const draw of aiResponse.draws) {
                // Validate structure
                if (!draw.draw_date || !draw.main_numbers) {
                    console.log('Skipping invalid draw - missing data');
                    continue;
                }
                
                if (!Array.isArray(draw.main_numbers)) {
                    console.log('Skipping invalid draw - main_numbers not array');
                    continue;
                }
                
                if (draw.main_numbers.length !== lottery.main_count) {
                    console.log(`Skipping draw ${draw.draw_date} - wrong count: ${draw.main_numbers.length} vs ${lottery.main_count}`);
                    continue;
                }

                // Validate date format (YYYY-MM-DD)
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (!dateRegex.test(draw.draw_date)) {
                    console.log(`Skipping draw - invalid date format: ${draw.draw_date}`);
                    continue;
                }

                // Check if date already exists
                if (currentDates.has(draw.draw_date)) {
                    console.log(`Date ${draw.draw_date} already exists - skipping`);
                    continue;
                }

                // All validations passed - add to new draws
                newDraws.push({
                    lottery_id: lottery.id,
                    draw_date: draw.draw_date,
                    main_numbers: draw.main_numbers.map(n => parseInt(n)),
                    extra_numbers: (draw.extra_numbers || []).map(n => parseInt(n))
                });
                currentDates.add(draw.draw_date); // Prevent duplicates in same batch
                syncedCount++;
                console.log(`Will add: ${draw.draw_date} - ${draw.main_numbers.join(', ')}`);
            }

            // Bulk create new draws
            if (newDraws.length > 0) {
                await base44.asServiceRole.entities.Draw.bulkCreate(newDraws);
                console.log(`Created ${newDraws.length} new draws`);
            }

            results.push({
                lottery: lottery.name,
                synced: syncedCount,
                duplicatesRemoved: duplicatesDeleted,
                message: syncedCount > 0 
                    ? `${syncedCount} novo(s), ${duplicatesDeleted} duplicado(s) removido(s)`
                    : duplicatesDeleted > 0 
                        ? `${duplicatesDeleted} duplicado(s) removido(s)`
                        : 'Base atualizada'
            });

            // Step 5: Auto-validate suggestions
            if (syncedCount > 0) {
                const suggestions = await base44.asServiceRole.entities.Suggestion.list();
                
                for (const draw of newDraws) {
                    const toValidate = suggestions.filter(s => 
                        s.lottery_id === lottery.id && 
                        s.draw_date === draw.draw_date && 
                        !s.was_validated
                    );

                    for (const sugg of toValidate) {
                        const matchesMain = sugg.main_numbers.filter(n => 
                            draw.main_numbers.includes(n)
                        ).length;

                        const matchesExtra = (sugg.extra_numbers || []).filter(n => 
                            (draw.extra_numbers || []).includes(n)
                        ).length;

                        await base44.asServiceRole.entities.Suggestion.update(sugg.id, {
                            actual_main_numbers: draw.main_numbers,
                            actual_extra_numbers: draw.extra_numbers || [],
                            matches_main: matchesMain,
                            matches_extra: matchesExtra,
                            was_validated: true
                        });
                    }
                }
            }
        }

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
        const totalDuplicates = results.reduce((sum, r) => sum + (r.duplicatesRemoved || 0), 0);

        let message = '';
        if (totalSynced > 0 && totalDuplicates > 0) {
            message = `✓ ${totalSynced} novo(s) + ${totalDuplicates} duplicado(s) removido(s)`;
        } else if (totalSynced > 0) {
            message = `✓ ${totalSynced} novo(s) sorteio(s) sincronizado(s)`;
        } else if (totalDuplicates > 0) {
            message = `✓ ${totalDuplicates} duplicado(s) removido(s)`;
        } else {
            message = '✓ Base de dados já atualizada';
        }

        return Response.json({
            success: true,
            message: message,
            total_synced: totalSynced,
            duplicates_removed: totalDuplicates,
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