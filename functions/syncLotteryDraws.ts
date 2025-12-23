import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC ALL LOTTERIES STARTED ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            console.log('ERROR: Unauthorized');
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Calculate start of this week (Monday)
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const dayOfWeek = today.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        const startOfWeek = monday.toISOString().split('T')[0];

        console.log('Today:', todayStr, '- Day of week:', dayOfWeek);
        console.log('Start of this week:', startOfWeek);

        // Get all active lotteries
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        console.log('Found lotteries:', lotteries.length);

        const results = [];

        for (const lottery of lotteries) {
            console.log(`\n--- Syncing ${lottery.name} ---`);

            try {
                // Get existing draws from this week only
                const existingDraws = await base44.asServiceRole.entities.Draw.filter(
                    { lottery_id: lottery.id }
                );

                const thisWeekDraws = existingDraws.filter(d => d.draw_date >= startOfWeek);
                console.log('Existing draws this week:', thisWeekDraws.length);

                // Build prompt based on lottery
                let prompt = '';
                let drawDays = '';
                
                if (lottery.name === 'EuroMilhões') {
                    drawDays = 'TERÇAS e SEXTAS-FEIRAS';
                    prompt = `HOJE É ${todayStr} (${dayOfWeek === 2 ? 'TERÇA' : dayOfWeek === 5 ? 'SEXTA' : dayOfWeek === 1 ? 'SEGUNDA' : dayOfWeek === 3 ? 'QUARTA' : dayOfWeek === 4 ? 'QUINTA' : dayOfWeek === 6 ? 'SÁBADO' : 'DOMINGO'}).

SEMANA ATUAL: de ${startOfWeek} até ${todayStr}

O EuroMilhões tem sorteios às ${drawDays}.

TAREFA: Busque TODOS os sorteios do EuroMilhões desta semana (${startOfWeek} até ${todayStr}).

Procure em:
- jogossantacasa.pt/web/SCCartazResult/
- Sites oficiais

IMPORTANTE:
- Retorne TODOS os sorteios desta semana
- Formato de data: YYYY-MM-DD
- 5 números principais (1 a 50)
- 2 estrelas (1 a 12)`;
                } else if (lottery.name === 'Totoloto') {
                    drawDays = 'QUARTAS e SÁBADOS';
                    prompt = `HOJE É ${todayStr} (${dayOfWeek === 2 ? 'TERÇA' : dayOfWeek === 5 ? 'SEXTA' : dayOfWeek === 1 ? 'SEGUNDA' : dayOfWeek === 3 ? 'QUARTA' : dayOfWeek === 4 ? 'QUINTA' : dayOfWeek === 6 ? 'SÁBADO' : 'DOMINGO'}).

SEMANA ATUAL: de ${startOfWeek} até ${todayStr}

O Totoloto tem sorteios às ${drawDays}.

TAREFA: Busque TODOS os sorteios do Totoloto desta semana (${startOfWeek} até ${todayStr}).

Procure em:
- jogossantacasa.pt/web/SCCartazResult/
- Sites oficiais

IMPORTANTE:
- Retorne TODOS os sorteios desta semana
- Formato de data: YYYY-MM-DD
- 5 números principais (1 a 49)
- 1 número da sorte (1 a 13)`;
                } else if (lottery.name === 'EuroDreams') {
                    drawDays = 'SEGUNDAS e QUINTAS-FEIRAS';
                    prompt = `HOJE É ${todayStr} (${dayOfWeek === 2 ? 'TERÇA' : dayOfWeek === 5 ? 'SEXTA' : dayOfWeek === 1 ? 'SEGUNDA' : dayOfWeek === 3 ? 'QUARTA' : dayOfWeek === 4 ? 'QUINTA' : dayOfWeek === 6 ? 'SÁBADO' : 'DOMINGO'}).

SEMANA ATUAL: de ${startOfWeek} até ${todayStr}

O EuroDreams tem sorteios às ${drawDays}.

TAREFA: Busque TODOS os sorteios do EuroDreams desta semana (${startOfWeek} até ${todayStr}).

Procure em:
- Sites oficiais de loterias europeias
- jogossantacasa.pt

IMPORTANTE:
- Retorne TODOS os sorteios desta semana
- Formato de data: YYYY-MM-DD
- 6 números principais (1 a 40)
- 1 número Dream (1 a 5)`;
                }

                console.log('Calling AI for this week results...');

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

                console.log('AI Response received');
                console.log('Draws found:', aiResponse?.draws?.length || 0);

                if (!aiResponse || !aiResponse.draws || aiResponse.draws.length === 0) {
                    results.push({
                        lottery: lottery.name,
                        synced: 0,
                        message: 'Nenhum sorteio encontrado'
                    });
                    continue;
                }

                // Validate draws
                const validDraws = [];
                for (const draw of aiResponse.draws) {
                    if (!draw.draw_date || !draw.main_numbers) continue;
                    if (!Array.isArray(draw.main_numbers)) continue;
                    if (draw.main_numbers.length !== lottery.main_count) continue;
                    
                    // Only accept draws from this week
                    if (draw.draw_date < startOfWeek || draw.draw_date > todayStr) {
                        console.log('Skipping draw outside this week:', draw.draw_date);
                        continue;
                    }

                    const allIntegers = draw.main_numbers.every(n => Number.isInteger(n));
                    if (!allIntegers) continue;

                    // Check if this exact draw already exists
                    const isDuplicate = thisWeekDraws.some(existing => {
                        if (existing.draw_date !== draw.draw_date) return false;
                        
                        const existingMain = JSON.stringify([...existing.main_numbers].sort());
                        const newMain = JSON.stringify([...draw.main_numbers].sort());
                        
                        return existingMain === newMain;
                    });

                    if (isDuplicate) {
                        console.log('Skipping duplicate draw from', draw.draw_date);
                        continue;
                    }

                    validDraws.push({
                        lottery_id: lottery.id,
                        draw_date: draw.draw_date,
                        main_numbers: draw.main_numbers,
                        extra_numbers: draw.extra_numbers || []
                    });
                }

                console.log('Valid new draws:', validDraws.length);

                if (validDraws.length > 0) {
                    await base44.asServiceRole.entities.Draw.bulkCreate(validDraws);
                    results.push({
                        lottery: lottery.name,
                        synced: validDraws.length,
                        message: `${validDraws.length} novo(s) sorteio(s)`
                    });
                } else {
                    results.push({
                        lottery: lottery.name,
                        synced: 0,
                        message: 'Nenhum sorteio novo'
                    });
                }

            } catch (error) {
                console.error(`Error syncing ${lottery.name}:`, error.message);
                results.push({
                    lottery: lottery.name,
                    synced: 0,
                    message: 'Erro: ' + error.message
                });
            }
        }

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);

        console.log('=== SYNC ALL COMPLETED ===');
        console.log('Total synced:', totalSynced);

        // AUTOMATICALLY VALIDATE ALL SUGGESTIONS (not just new ones)
        console.log('\n=== AUTO-VALIDATING ALL SUGGESTIONS ===');
        let validationResult = { validated: 0, total_matches: 0 };
        
        try {
            // Get ALL suggestions and ALL draws
            const allSuggestions = await base44.asServiceRole.entities.Suggestion.list();
            const allDraws = await base44.asServiceRole.entities.Draw.list();
            
            console.log('Total suggestions:', allSuggestions.length);
            console.log('Total draws:', allDraws.length);

            for (const suggestion of allSuggestions) {
                // Skip if already validated
                if (suggestion.was_validated) continue;
                
                // Find matching draw by lottery_id AND draw_date
                const matchingDraw = allDraws.find(d => 
                    d.lottery_id === suggestion.lottery_id && 
                    d.draw_date === suggestion.draw_date
                );

                if (!matchingDraw) {
                    console.log(`No draw found for suggestion ${suggestion.draw_date}`);
                    continue;
                }

                const matchesMain = suggestion.main_numbers.filter(num => 
                    matchingDraw.main_numbers.includes(num)
                ).length;

                const matchesExtra = (suggestion.extra_numbers || []).filter(num => 
                    (matchingDraw.extra_numbers || []).includes(num)
                ).length;

                await base44.asServiceRole.entities.Suggestion.update(suggestion.id, {
                    actual_main_numbers: matchingDraw.main_numbers,
                    actual_extra_numbers: matchingDraw.extra_numbers || [],
                    matches_main: matchesMain,
                    matches_extra: matchesExtra,
                    was_validated: true
                });

                validationResult.validated++;
                validationResult.total_matches += matchesMain + matchesExtra;

                console.log(`✓ ${suggestion.draw_date}: ${matchesMain} main + ${matchesExtra} extra`);
            }

            console.log('=== VALIDATION COMPLETED ===');
            console.log('Validated:', validationResult.validated);
            console.log('Total matches:', validationResult.total_matches);

        } catch (validationError) {
            console.error('Validation error:', validationError.message);
        }

        const message = totalSynced > 0 
            ? `✓ ${totalSynced} novo(s) sorteio(s) sincronizado(s)${validationResult.validated > 0 ? ` • ${validationResult.validated} sugestões validadas com ${validationResult.total_matches} acertos` : ''}` 
            : `✓ Todos os sorteios da semana já estão na base`;

        return Response.json({
            success: true,
            message: message,
            total_synced: totalSynced,
            validation: validationResult,
            results: results
        });

    } catch (error) {
        console.error('=== SYNC ERROR ===');
        console.error('Error:', error.message);
        
        return Response.json({ 
            success: false,
            error: 'Erro ao sincronizar',
            message: error.message
        }, { status: 500 });
    }
});