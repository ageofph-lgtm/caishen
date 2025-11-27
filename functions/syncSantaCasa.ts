import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC SANTA CASA - ÚLTIMOS 20 RESULTADOS ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        const results = [];

        for (const lottery of lotteries) {
            console.log(`\n--- Syncing ${lottery.name} (últimos 20) ---`);

            let lotteryInfo = '';
            if (lottery.name === 'EuroMilhões') {
                lotteryInfo = `EuroMilhões do site jogossantacasa.pt/web/SCCartazResult/euroMilhoes
                - Sorteios às terças e sextas-feiras
                - ${lottery.main_count} números principais (1-50)
                - ${lottery.extra_count} estrelas (1-12)`;
            } else if (lottery.name === 'Totoloto') {
                lotteryInfo = `Totoloto do site jogossantacasa.pt/web/SCCartazResult/totolotoNew
                - Sorteios às quartas e sábados
                - ${lottery.main_count} números principais (1-49)
                - ${lottery.extra_count} número da sorte (1-13)`;
            } else if (lottery.name === 'EuroDreams') {
                lotteryInfo = `EuroDreams do site jogossantacasa.pt/web/SCCartazResult/euroDreams
                - Sorteios às segundas e quintas
                - ${lottery.main_count} números principais (1-40)
                - ${lottery.extra_count} número Dream (1-5)`;
            } else {
                continue;
            }

            const prompt = `Busca os ÚLTIMOS 20 SORTEIOS do ${lotteryInfo}

TAREFA: Extrai os últimos 20 resultados oficiais desta loteria.

Para cada sorteio retorna:
- draw_date: Data no formato YYYY-MM-DD
- main_numbers: Array de ${lottery.main_count} números principais (inteiros)
- extra_numbers: Array de ${lottery.extra_count || 0} números extras

IMPORTANTE:
- Busca dados REAIS e OFICIAIS do site da Santa Casa
- Retorna exatamente 20 sorteios (ou menos se não houver tantos)
- Ordena do mais recente para o mais antigo
- Não inventes números, usa apenas dados reais`;

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

            console.log('AI Response draws count:', aiResponse?.draws?.length || 0);

            if (!aiResponse || !aiResponse.draws || aiResponse.draws.length === 0) {
                results.push({
                    lottery: lottery.name,
                    synced: 0,
                    message: 'Não foi possível obter dados'
                });
                continue;
            }

            // Get existing draws for this lottery
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });

            console.log('Existing draws:', existingDraws.length);

            let syncedCount = 0;
            const newDraws = [];

            for (const draw of aiResponse.draws) {
                // Validate draw data
                if (!draw.draw_date || !draw.main_numbers) continue;
                if (!Array.isArray(draw.main_numbers)) continue;
                if (draw.main_numbers.length !== lottery.main_count) continue;

                // Check if already exists (by date AND numbers)
                const isDuplicate = existingDraws.some(d => {
                    if (d.draw_date !== draw.draw_date) return false;
                    const existingMain = JSON.stringify([...d.main_numbers].sort());
                    const newMain = JSON.stringify([...draw.main_numbers].sort());
                    return existingMain === newMain;
                });

                if (!isDuplicate) {
                    newDraws.push({
                        lottery_id: lottery.id,
                        draw_date: draw.draw_date,
                        main_numbers: draw.main_numbers,
                        extra_numbers: draw.extra_numbers || []
                    });
                    syncedCount++;
                }
            }

            // Bulk create new draws
            if (newDraws.length > 0) {
                await base44.asServiceRole.entities.Draw.bulkCreate(newDraws);
                console.log(`Created ${newDraws.length} new draws`);
            }

            results.push({
                lottery: lottery.name,
                synced: syncedCount,
                total_found: aiResponse.draws.length,
                message: syncedCount > 0 
                    ? `${syncedCount} novo(s) sorteio(s) adicionado(s)`
                    : 'Todos os sorteios já existem'
            });

            // Auto-validate suggestions for new draws
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

                        console.log(`✓ Validated: ${matchesMain} main + ${matchesExtra} extra`);
                    }
                }
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