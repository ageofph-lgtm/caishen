import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC SANTA CASA - SINCRONIZAÇÃO INTELIGENTE POR PERÍODOS ===');
        
        const base44 = createClientFromRequest(req);
        
        // Captura o parâmetro rebuild do corpo da requisição
        const body = await req.json().catch(() => ({}));
        const isFullRebuild = body.rebuild === true;
        
        console.log('Full Rebuild mode:', isFullRebuild);

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
            console.log(`\n--- Processando ${lottery.name} ---`);

            // 1. LIMPEZA AUTOMÁTICA: Se for rebuild, remove histórico antigo
            if (isFullRebuild) {
                console.log('🗑️ REBUILD MODE: Limpando histórico antigo...');
                try {
                    const oldDraws = await base44.asServiceRole.entities.Draw.filter({
                        lottery_id: lottery.id
                    });
                    console.log(`Encontrados ${oldDraws.length} sorteios para remover`);
                    
                    // Deleta em lote para evitar timeout
                    for (const oldDraw of oldDraws) {
                        await base44.asServiceRole.entities.Draw.delete(oldDraw.id);
                    }
                    console.log(`✓ Removidos ${oldDraws.length} sorteios antigos`);
                } catch (deleteError) {
                    console.error('Erro ao deletar:', deleteError.message);
                    // Continua mesmo se houver erro na deleção
                }
            }

            // 2. DEFINIÇÃO DO ALVO (Anos a procurar)
            const currentYear = new Date().getFullYear();
            const yearsToFetch = isFullRebuild 
                ? [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, 'anos anteriores']
                : [currentYear];
            
            console.log('Períodos a buscar:', yearsToFetch);

            let allNewDraws = [];

            for (const period of yearsToFetch) {
                console.log(`\n--- Buscando dados de ${lottery.name} para: ${period} ---`);
                let prompt = '';
                
                if (lottery.name === 'EuroMilhões') {
                    prompt = `Aceda ao site oficial jogossantacasa.pt. 
                Extraia os resultados REAIS do EuroMilhões referentes ao período: ${period}.

                O EuroMilhões tem sorteios às TERÇAS e SEXTAS.
                - 5 números principais de 1 a 50
                - 2 estrelas de 1 a 12

                FORMATO DE DATA OBRIGATÓRIO: YYYY-MM-DD (ex: 2026-01-28)

                Retorne JSON estrito com array 'draws' contendo CADA sorteio:
                {
                "draw_date": "YYYY-MM-DD",
                "main_numbers": [5 números inteiros de 1-50],
                "extra_numbers": [2 números inteiros de 1-12]
                }

                CRÍTICO: Apenas dados oficiais. Não invente resultados. JSON válido.`;

                } else if (lottery.name === 'Totoloto') {
                    prompt = `Aceda ao site oficial jogossantacasa.pt. 
                Extraia os resultados REAIS do Totoloto referentes ao período: ${period}.

                O Totoloto tem sorteios às QUARTAS e SÁBADOS.
                - 5 números principais de 1 a 49
                - 1 número da sorte de 1 a 13

                FORMATO DE DATA OBRIGATÓRIO: YYYY-MM-DD (ex: 2026-01-28)

                Retorne JSON estrito com array 'draws' contendo CADA sorteio:
                {
                "draw_date": "YYYY-MM-DD",
                "main_numbers": [5 números inteiros de 1-49],
                "extra_numbers": [1 número inteiro de 1-13]
                }

                CRÍTICO: Apenas dados oficiais. Não invente resultados. JSON válido.`;

                } else if (lottery.name === 'EuroDreams') {
                    prompt = `Aceda ao site oficial jogossantacasa.pt. 
                Extraia os resultados REAIS do EuroDreams referentes ao período: ${period}.

                O EuroDreams tem sorteios às SEGUNDAS e QUINTAS.
                - 6 números principais de 1 a 40
                - 1 número Dream de 1 a 5

                FORMATO DE DATA OBRIGATÓRIO: YYYY-MM-DD (ex: 2026-01-28)

                Retorne JSON estrito com array 'draws' contendo CADA sorteio:
                {
                "draw_date": "YYYY-MM-DD",
                "main_numbers": [6 números inteiros de 1-40],
                "extra_numbers": [1 número inteiro de 1-5]
                }

                CRÍTICO: Apenas dados oficiais. Não invente resultados. JSON válido.`;
                } else {
                    continue;
                }

                try {
                    console.log(`Buscando IA para período: ${period}`);

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

                    console.log(`Período ${period} retornou:`, aiResponse?.draws?.length || 0, 'sorteios');

                    if (aiResponse?.draws?.length > 0) {
                        for (const draw of aiResponse.draws) {
                            // Validação
                            if (!draw.draw_date || !draw.main_numbers) continue;
                            if (!Array.isArray(draw.main_numbers)) continue;
                            if (draw.main_numbers.length !== lottery.main_count) continue;

                            // Check all numbers are valid integers
                            const validNumbers = draw.main_numbers.every(n => 
                                Number.isInteger(n) && n >= lottery.main_min && n <= lottery.main_max
                            );
                            if (!validNumbers) continue;

                            // Check if already in our new draws list (evita duplicados dentro do mesmo rebuild)
                            const alreadyAdded = allNewDraws.some(d => d.draw_date === draw.draw_date);
                            if (alreadyAdded) continue;

                            allNewDraws.push({
                                lottery_id: lottery.id,
                                draw_date: draw.draw_date,
                                main_numbers: draw.main_numbers.sort((a, b) => a - b),
                                extra_numbers: (draw.extra_numbers || []).sort((a, b) => a - b)
                            });
                        }
                    }
                } catch (periodError) {
                    console.error(`Erro no período ${period}:`, periodError.message);
                }
                }

            // Bulk create new draws
            if (allNewDraws.length > 0) {
                // Sort by date descending
                allNewDraws.sort((a, b) => b.draw_date.localeCompare(a.draw_date));

                console.log(`📥 Inserindo ${allNewDraws.length} sorteios para ${lottery.name}...`);
                await base44.asServiceRole.entities.Draw.bulkCreate(allNewDraws);
                console.log(`✓ ${allNewDraws.length} sorteios inseridos com sucesso`);
            }

            results.push({
                lottery: lottery.name,
                synced: allNewDraws.length,
                message: allNewDraws.length > 0 
                    ? `${allNewDraws.length} novo(s) sorteio(s) importado(s)`
                    : isFullRebuild ? 'Reconstrução concluída' : 'Base já atualizada'
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

        // DISPARO AUTOMÁTICO: Valida todas as sugestões após sync/rebuild
        try {
            console.log('\n=== INICIANDO AUTO-VALIDAÇÃO ===');
            await base44.asServiceRole.functions.invoke('validateSuggestions', {});
            console.log('✓ Auto-validação concluída');
        } catch (valError) {
            console.error('Erro na auto-validação (não crítico):', valError.message);
        }

        return Response.json({
            success: true,
            message: isFullRebuild 
                ? `✓ Base reconstruída: ${totalSynced} sorteios importados por períodos`
                : totalSynced > 0 
                    ? `✓ ${totalSynced} novo(s) sorteio(s) sincronizado(s)`
                    : '✓ Base de dados já atualizada',
            total_synced: totalSynced,
            results: results,
            rebuild_mode: isFullRebuild
        });

        } catch (error) {
        console.error('=== ERRO CRÍTICO ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        return Response.json({ 
            success: false,
            error: error.message,
            details: error.stack 
        }, { status: 500 });
        }
        });