import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== REPOPULATING LOTTERY DRAWS ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        
        // Get unique lotteries by name
        const uniqueLotteries = [];
        const seenNames = new Set();
        for (const lottery of lotteries) {
            if (!seenNames.has(lottery.name)) {
                seenNames.add(lottery.name);
                uniqueLotteries.push(lottery);
            }
        }

        console.log('Unique lotteries:', uniqueLotteries.map(l => l.name));

        const results = [];

        for (const lottery of uniqueLotteries) {
            console.log(`\n--- Repopulating ${lottery.name} ---`);

            let lotteryInfo = '';
            let yearsToFetch = '';
            
            if (lottery.name === 'EuroMilhões') {
                lotteryInfo = `EuroMilhões - loteria europeia
                - Sorteios às terças e sextas-feiras (2x por semana = ~104 sorteios/ano)
                - ${lottery.main_count} números principais (1-50)
                - ${lottery.extra_count} estrelas (1-12)`;
                yearsToFetch = '2015 até novembro 2025';
            } else if (lottery.name === 'Totoloto') {
                lotteryInfo = `Totoloto - loteria portuguesa da Santa Casa
                - Sorteios às quartas e sábados (2x por semana = ~104 sorteios/ano)
                - ${lottery.main_count} números principais (1-49)
                - ${lottery.extra_count} número da sorte (1-13)`;
                yearsToFetch = '2015 até novembro 2025';
            } else if (lottery.name === 'EuroDreams') {
                lotteryInfo = `EuroDreams - loteria europeia mais recente
                - Sorteios às segundas e quintas (2x por semana)
                - ${lottery.main_count} números principais (1-40)
                - ${lottery.extra_count} número Dream (1-5)`;
                yearsToFetch = '2023 até novembro 2025 (começou em 2023)';
            } else {
                continue;
            }

            // Fetch historical data in batches by year
            const years = lottery.name === 'EuroDreams' 
                ? [2023, 2024, 2025]
                : [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

            let totalAdded = 0;

            for (const year of years) {
                console.log(`Fetching ${lottery.name} ${year}...`);

                const prompt = `Busca TODOS os sorteios do ${lotteryInfo} do ano ${year}.

TAREFA: Extrai TODOS os resultados oficiais de ${year}.

Para cada sorteio retorna:
- draw_date: Data no formato YYYY-MM-DD
- main_numbers: Array de ${lottery.main_count} números principais (inteiros)
- extra_numbers: Array de ${lottery.extra_count || 0} números extras

IMPORTANTE:
- Busca dados REAIS e OFICIAIS
- Retorna TODOS os sorteios do ano ${year}
- São aproximadamente 104 sorteios por ano (2 por semana)
- ${year === 2025 ? 'Para 2025, busca até 27 de novembro' : ''}
- Não inventes números, usa apenas dados reais
- Se não encontrar dados de um ano, retorna array vazio`;

                try {
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

                    if (aiResponse?.draws?.length > 0) {
                        // Get existing draws
                        const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                            lottery_id: lottery.id
                        });

                        const existingDates = new Set(existingDraws.map(d => d.draw_date));

                        const newDraws = [];
                        for (const draw of aiResponse.draws) {
                            if (!draw.draw_date || !draw.main_numbers) continue;
                            if (!Array.isArray(draw.main_numbers)) continue;
                            if (draw.main_numbers.length !== lottery.main_count) continue;
                            if (existingDates.has(draw.draw_date)) continue;

                            newDraws.push({
                                lottery_id: lottery.id,
                                draw_date: draw.draw_date,
                                main_numbers: draw.main_numbers,
                                extra_numbers: draw.extra_numbers || []
                            });
                            existingDates.add(draw.draw_date);
                        }

                        if (newDraws.length > 0) {
                            // Bulk create in batches of 50
                            for (let i = 0; i < newDraws.length; i += 50) {
                                const batch = newDraws.slice(i, i + 50);
                                await base44.asServiceRole.entities.Draw.bulkCreate(batch);
                            }
                            totalAdded += newDraws.length;
                            console.log(`Added ${newDraws.length} draws for ${year}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching ${year}:`, error.message);
                }
            }

            results.push({
                lottery: lottery.name,
                added: totalAdded
            });
        }

        const totalAdded = results.reduce((sum, r) => sum + r.added, 0);

        return Response.json({
            success: true,
            message: `✓ ${totalAdded} sorteios adicionados à base de dados`,
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