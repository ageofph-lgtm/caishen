import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC STARTED ===');

        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const lookback = new Date(today);
        lookback.setDate(today.getDate() - 30);
        const startDate = lookback.toISOString().split('T')[0];

        console.log(`Window: ${startDate} → ${todayStr}`);

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });

        // Deduplicate lotteries by name (keep one per name)
        const uniqueLotteries = [];
        const seenNames = new Set();
        for (const l of lotteries) {
            if (!seenNames.has(l.name)) {
                seenNames.add(l.name);
                uniqueLotteries.push(l);
            }
        }
        console.log(`Processing ${uniqueLotteries.length} unique lotteries`);

        const results = [];

        for (const lottery of uniqueLotteries) {
            console.log(`\n--- ${lottery.name} ---`);

            // 1. CLEANUP: Remove duplicate draws (same lottery_id + draw_date, keep newest)
            const allExistingDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lottery.id });
            const dateGroups = {};
            for (const draw of allExistingDraws) {
                if (!dateGroups[draw.draw_date]) dateGroups[draw.draw_date] = [];
                dateGroups[draw.draw_date].push(draw);
            }
            let cleanedCount = 0;
            for (const [date, draws] of Object.entries(dateGroups)) {
                if (draws.length > 1) {
                    // Keep the one with the most recent created_date, delete the rest
                    draws.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
                    for (let i = 1; i < draws.length; i++) {
                        await base44.asServiceRole.entities.Draw.delete(draws[i].id);
                        cleanedCount++;
                    }
                    console.log(`Cleaned ${draws.length - 1} duplicate(s) for date ${date}`);
                }
            }
            if (cleanedCount > 0) console.log(`Total cleaned: ${cleanedCount} duplicates`);

            // 2. Build set of dates already in DB for this lottery
            const freshDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lottery.id });
            const existingDates = new Set(freshDraws.map(d => d.draw_date));
            const recentExisting = freshDraws.filter(d => d.draw_date >= startDate);
            console.log(`Existing dates in DB: ${existingDates.size} total, ${recentExisting.length} in window`);

            // 3. Build lottery-specific config
            let config = {};
            if (lottery.name === 'EuroMilhões') {
                config = {
                    drawDays: 'terças-feiras e sextas-feiras',
                    mainCount: 5, mainMin: 1, mainMax: 50,
                    extraCount: 2, extraMin: 1, extraMax: 12,
                    extraName: 'estrelas',
                    source: 'jogossantacasa.pt EuroMilhões'
                };
            } else if (lottery.name === 'Totoloto') {
                config = {
                    drawDays: 'quartas-feiras e sábados',
                    mainCount: 5, mainMin: 1, mainMax: 49,
                    extraCount: 1, extraMin: 1, extraMax: 13,
                    extraName: 'número da sorte',
                    source: 'jogossantacasa.pt Totoloto'
                };
            } else if (lottery.name === 'EuroDreams') {
                config = {
                    drawDays: 'segundas-feiras e quintas-feiras',
                    mainCount: 6, mainMin: 1, mainMax: 40,
                    extraCount: 1, extraMin: 1, extraMax: 5,
                    extraName: 'número Dream',
                    source: 'eurodreams.com ou loteriasyapuestas.com/eurodreams'
                };
            } else {
                console.log(`Unknown lottery: ${lottery.name}, skipping`);
                continue;
            }

            // 4. Already-existing dates in window (to tell the LLM which ones we DON'T need)
            const existingInWindow = recentExisting.map(d => d.draw_date).join(', ') || 'nenhuma';

            const prompt = `
Hoje é ${todayStr}. Preciso dos resultados OFICIAIS, REAIS e VERIFICADOS da loteria ${lottery.name}.

A ${lottery.name} realiza sorteios APENAS às ${config.drawDays}. NÃO inventes sorteios em dias que não sejam esses.

JANELA DE PESQUISA: De ${startDate} até ${todayStr}.

Já tenho os resultados das seguintes datas (NÃO me dês estas): ${existingInWindow}

REGRAS ABSOLUTAS:
- APENAS datas que correspondam a ${config.drawDays}.
- Cada sorteio tem EXATAMENTE ${config.mainCount} números principais DIFERENTES entre ${config.mainMin} e ${config.mainMax}.
- Cada sorteio tem EXATAMENTE ${config.extraCount} ${config.extraName} entre ${config.extraMin} e ${config.extraMax}.
- Os números devem ser os REAIS verificados em fontes oficiais. NÃO REPITAS combinações de sorteios anteriores.
- Formato de data: YYYY-MM-DD.
- Se não tiveres dados verificados para uma data, NÃO a incluas.
- Fonte de referência: ${config.source}
- Se não houver sorteios novos verificados, retorna array vazio.
`.trim();

            console.log('Querying LLM with internet for:', lottery.name);

            const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt,
                add_context_from_internet: true,
                model: 'gemini_3_flash',
                response_json_schema: {
                    type: 'object',
                    properties: {
                        draws: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    draw_date: { type: 'string', description: 'YYYY-MM-DD' },
                                    main_numbers: { type: 'array', items: { type: 'integer' } },
                                    extra_numbers: { type: 'array', items: { type: 'integer' } }
                                },
                                required: ['draw_date', 'main_numbers']
                            }
                        }
                    }
                }
            });

            const rawDraws = aiResponse?.draws || [];
            console.log(`LLM returned ${rawDraws.length} draw(s)`);

            const toInsert = [];

            for (const draw of rawDraws) {
                if (!draw.draw_date || !draw.main_numbers) continue;

                // Validate date format
                if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.draw_date)) {
                    console.log(`Invalid date format: ${draw.draw_date}`);
                    continue;
                }

                // Only accept draws in our window and not in the future
                if (draw.draw_date < startDate || draw.draw_date > todayStr) {
                    console.log(`Out of window: ${draw.draw_date}`);
                    continue;
                }

                // Skip if date already exists
                if (existingDates.has(draw.draw_date)) {
                    console.log(`Date already exists, skipping: ${draw.draw_date}`);
                    continue;
                }

                // Validate main numbers
                const mainNums = draw.main_numbers.map(n => parseInt(n)).filter(n => !isNaN(n));
                if (mainNums.length !== config.mainCount) {
                    console.log(`Wrong main count for ${draw.draw_date}: ${mainNums.length} (expected ${config.mainCount})`);
                    continue;
                }
                if (mainNums.some(n => n < config.mainMin || n > config.mainMax)) {
                    console.log(`Main numbers out of range for ${draw.draw_date}: ${mainNums}`);
                    continue;
                }
                if (new Set(mainNums).size !== mainNums.length) {
                    console.log(`Duplicate main numbers for ${draw.draw_date}`);
                    continue;
                }

                // Validate extra numbers
                const extraNums = (draw.extra_numbers || []).map(n => parseInt(n)).filter(n => !isNaN(n));
                if (config.extraCount > 0 && extraNums.length !== config.extraCount) {
                    console.log(`Wrong extra count for ${draw.draw_date}: ${extraNums.length} (expected ${config.extraCount})`);
                    continue;
                }
                if (extraNums.some(n => n < config.extraMin || n > config.extraMax)) {
                    console.log(`Extra numbers out of range for ${draw.draw_date}: ${extraNums}`);
                    continue;
                }

                console.log(`✓ Valid draw: ${draw.draw_date} | main: ${mainNums} | extra: ${extraNums}`);
                toInsert.push({ lottery_id: lottery.id, draw_date: draw.draw_date, main_numbers: mainNums.sort((a,b)=>a-b), extra_numbers: extraNums.sort((a,b)=>a-b) });
                existingDates.add(draw.draw_date); // prevent double-insert within same batch
            }

            if (toInsert.length > 0) {
                await base44.asServiceRole.entities.Draw.bulkCreate(toInsert);
                console.log(`Inserted ${toInsert.length} draw(s) for ${lottery.name}`);
            }

            results.push({
                lottery: lottery.name,
                synced: toInsert.length,
                cleaned: cleanedCount,
                message: toInsert.length > 0
                    ? `${toInsert.length} novo(s) sorteio(s) inserido(s)`
                    : 'Sem novos sorteios'
            });
        }

        // 5. AUTO-VALIDATE PENDING SUGGESTIONS
        console.log('\n=== AUTO-VALIDATING SUGGESTIONS ===');
        let validated = 0;
        let totalMatches = 0;

        const allSuggestions = await base44.asServiceRole.entities.Suggestion.list();
        const allDrawsForValidation = await base44.asServiceRole.entities.Draw.list();

        for (const suggestion of allSuggestions) {
            if (suggestion.was_validated) continue;
            if (!suggestion.draw_date) continue;

            // Exact match OR find the closest draw on/after the suggestion date (within 7 days)
            const lotteryDraws = allDrawsForValidation
                .filter(d => d.lottery_id === suggestion.lottery_id && d.draw_date >= suggestion.draw_date)
                .sort((a, b) => a.draw_date.localeCompare(b.draw_date));

            let matchingDraw = lotteryDraws[0];
            // Only validate if the draw is within 7 days of the suggestion date
            if (matchingDraw) {
                const diffDays = (new Date(matchingDraw.draw_date) - new Date(suggestion.draw_date)) / (1000 * 60 * 60 * 24);
                if (diffDays > 7) matchingDraw = null;
            }

            if (!matchingDraw) continue;

            const matchesMain = suggestion.main_numbers.filter(n =>
                matchingDraw.main_numbers.includes(n)
            ).length;

            const matchesExtra = (suggestion.extra_numbers || []).filter(n =>
                (matchingDraw.extra_numbers || []).includes(n)
            ).length;

            await base44.asServiceRole.entities.Suggestion.update(suggestion.id, {
                actual_main_numbers: matchingDraw.main_numbers,
                actual_extra_numbers: matchingDraw.extra_numbers || [],
                matches_main: matchesMain,
                matches_extra: matchesExtra,
                was_validated: true
            });

            validated++;
            totalMatches += matchesMain + matchesExtra;
            console.log(`✓ Validated suggestion ${suggestion.draw_date}: ${matchesMain}+${matchesExtra} hits`);
        }

        console.log(`Validated: ${validated}, Total hits: ${totalMatches}`);
        console.log('=== SYNC COMPLETE ===');

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
        const totalCleaned = results.reduce((sum, r) => sum + (r.cleaned || 0), 0);

        return Response.json({
            success: true,
            message: `✓ ${totalSynced} sorteio(s) sincronizado(s)${totalCleaned > 0 ? ` • ${totalCleaned} duplicado(s) removido(s)` : ''}${validated > 0 ? ` • ${validated} sugestão(ões) validada(s)` : ''}`,
            total_synced: totalSynced,
            total_cleaned: totalCleaned,
            validation: { validated, total_matches: totalMatches },
            results
        });

    } catch (error) {
        console.error('SYNC ERROR:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});