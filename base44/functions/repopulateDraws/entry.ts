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

            // Fetch in smaller batches (3 months at a time) to avoid JSON errors
            const periods = lottery.name === 'EuroDreams' 
                ? [
                    '2023-10-01 a 2023-12-31',
                    '2024-01-01 a 2024-03-31',
                    '2024-04-01 a 2024-06-30',
                    '2024-07-01 a 2024-09-30',
                    '2024-10-01 a 2024-12-10'
                  ]
                : [
                    '2015-01-01 a 2015-06-30', '2015-07-01 a 2015-12-31',
                    '2016-01-01 a 2016-06-30', '2016-07-01 a 2016-12-31',
                    '2017-01-01 a 2017-06-30', '2017-07-01 a 2017-12-31',
                    '2018-01-01 a 2018-06-30', '2018-07-01 a 2018-12-31',
                    '2019-01-01 a 2019-06-30', '2019-07-01 a 2019-12-31',
                    '2020-01-01 a 2020-06-30', '2020-07-01 a 2020-12-31',
                    '2021-01-01 a 2021-06-30', '2021-07-01 a 2021-12-31',
                    '2022-01-01 a 2022-06-30', '2022-07-01 a 2022-12-31',
                    '2023-01-01 a 2023-06-30', '2023-07-01 a 2023-12-31',
                    '2024-01-01 a 2024-06-30', '2024-07-01 a 2024-12-10'
                  ];

            // Get existing draws ONCE
            const existingDraws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: lottery.id
            });
            const existingDates = new Set(existingDraws.map(d => d.draw_date));

            let totalAdded = 0;

            for (const period of periods) {
                console.log(`Fetching ${lottery.name} ${period}...`);

                const prompt = `Busca TODOS os sorteios do ${lottery.name} do período ${period} no site oficial jogossantacasa.pt

Para cada sorteio retorna:
- draw_date: YYYY-MM-DD
- main_numbers: [${lottery.main_count} números inteiros]
- extra_numbers: [${lottery.extra_count || 0} números inteiros]

CRÍTICO:
- Dados REAIS do site oficial
- Aproximadamente 26 sorteios por semestre (2 por semana)
- Não inventa números`;

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
                                            main_numbers: { type: "array", items: { type: "integer" } },
                                            extra_numbers: { type: "array", items: { type: "integer" } }
                                        }
                                    }
                                }
                            }
                        }
                    });

                    if (aiResponse?.draws?.length > 0) {
                        const newDraws = [];
                        for (const draw of aiResponse.draws) {
                            if (!draw.draw_date || !draw.main_numbers) continue;
                            if (!Array.isArray(draw.main_numbers)) continue;
                            if (draw.main_numbers.length !== lottery.main_count) continue;
                            if (existingDates.has(draw.draw_date)) continue;

                            newDraws.push({
                                lottery_id: lottery.id,
                                draw_date: draw.draw_date,
                                main_numbers: draw.main_numbers.sort((a, b) => a - b),
                                extra_numbers: (draw.extra_numbers || []).sort((a, b) => a - b)
                            });
                            existingDates.add(draw.draw_date);
                        }

                        if (newDraws.length > 0) {
                            await base44.asServiceRole.entities.Draw.bulkCreate(newDraws);
                            totalAdded += newDraws.length;
                            console.log(`✓ Added ${newDraws.length} draws for ${period}`);
                        } else {
                            console.log(`No new draws for ${period}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error ${period}:`, error.message);
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