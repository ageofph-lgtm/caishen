import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== SYNC SANTA CASA STARTED ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        const results = [];

        for (const lottery of lotteries) {
            console.log(`\n--- Syncing ${lottery.name} ---`);

            let url = '';
            if (lottery.name === 'EuroMilhões') {
                url = 'https://www.jogossantacasa.pt/web/SCCartazResult/euroMilhoes';
            } else if (lottery.name === 'Totoloto') {
                url = 'https://www.jogossantacasa.pt/web/SCCartazResult/totolotoNew';
            } else if (lottery.name === 'EuroDreams') {
                url = 'https://www.jogossantacasa.pt/web/SCCartazResult/euroDreams';
            } else {
                continue;
            }

            // Use AI to extract data from Santa Casa website
            const prompt = `Acede ao site da Santa Casa: ${url}
            
Extrai o ÚLTIMO resultado do sorteio de ${lottery.name}.

FORMATO DE RESPOSTA OBRIGATÓRIO:
- draw_date: Data no formato YYYY-MM-DD
- main_numbers: Array de ${lottery.main_count} números principais (inteiros)
- extra_numbers: Array de ${lottery.extra_count || 0} números extras (${lottery.extra_name || 'extras'})

Procura a chave do último sorteio no site. Os números aparecem normalmente no formato "X X X X X + Y Y" onde os primeiros são principais e depois do + são os extras.

IMPORTANTE: Retorna APENAS dados reais do site, não inventes números.`;

            const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt: prompt,
                add_context_from_internet: true,
                response_json_schema: {
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
                        },
                        contest_number: { type: "string" }
                    }
                }
            });

            console.log('AI Response:', JSON.stringify(aiResponse));

            if (!aiResponse || !aiResponse.draw_date || !aiResponse.main_numbers) {
                results.push({
                    lottery: lottery.name,
                    synced: 0,
                    message: 'Não foi possível obter dados'
                });
                continue;
            }

            // Validate numbers
            if (aiResponse.main_numbers.length !== lottery.main_count) {
                results.push({
                    lottery: lottery.name,
                    synced: 0,
                    message: `Números inválidos: esperava ${lottery.main_count}, recebeu ${aiResponse.main_numbers.length}`
                });
                continue;
            }

            // Check if draw already exists
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });

            const isDuplicate = existingDraws.some(d => {
                if (d.draw_date !== aiResponse.draw_date) return false;
                const existingMain = JSON.stringify([...d.main_numbers].sort());
                const newMain = JSON.stringify([...aiResponse.main_numbers].sort());
                return existingMain === newMain;
            });

            if (isDuplicate) {
                results.push({
                    lottery: lottery.name,
                    synced: 0,
                    message: 'Sorteio já existe na base de dados'
                });
                continue;
            }

            // Create new draw
            await base44.asServiceRole.entities.Draw.create({
                lottery_id: lottery.id,
                draw_date: aiResponse.draw_date,
                main_numbers: aiResponse.main_numbers,
                extra_numbers: aiResponse.extra_numbers || []
            });

            results.push({
                lottery: lottery.name,
                synced: 1,
                message: `Sorteio ${aiResponse.contest_number || aiResponse.draw_date} sincronizado`,
                numbers: aiResponse.main_numbers,
                extras: aiResponse.extra_numbers
            });

            // Auto-validate suggestions
            const suggestions = await base44.asServiceRole.entities.Suggestion.list();
            const toValidate = suggestions.filter(s => 
                s.lottery_id === lottery.id && 
                s.draw_date === aiResponse.draw_date && 
                !s.was_validated
            );

            for (const sugg of toValidate) {
                const matchesMain = sugg.main_numbers.filter(n => 
                    aiResponse.main_numbers.includes(n)
                ).length;

                const matchesExtra = (sugg.extra_numbers || []).filter(n => 
                    (aiResponse.extra_numbers || []).includes(n)
                ).length;

                await base44.asServiceRole.entities.Suggestion.update(sugg.id, {
                    actual_main_numbers: aiResponse.main_numbers,
                    actual_extra_numbers: aiResponse.extra_numbers || [],
                    matches_main: matchesMain,
                    matches_extra: matchesExtra,
                    was_validated: true
                });

                console.log(`✓ Validated suggestion: ${matchesMain} main + ${matchesExtra} extra matches`);
            }
        }

        const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);

        return Response.json({
            success: true,
            message: totalSynced > 0 
                ? `✓ ${totalSynced} sorteio(s) sincronizado(s) da Santa Casa`
                : '✓ Todos os sorteios já estão atualizados',
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