import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Targeted sync: fetch draws for a specific lottery + date range
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        // Allow override via payload, defaults to last 60 days
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const lookback = new Date(today);
        lookback.setDate(today.getDate() - (body.days || 60));
        const startDate = body.startDate || lookback.toISOString().split('T')[0];
        const endDate = body.endDate || todayStr;

        console.log(`=== SYNC MISSING DRAWS: ${startDate} → ${endDate} ===`);

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        const uniqueLotteries = [];
        const seenNames = new Set();
        for (const l of lotteries) {
            if (!seenNames.has(l.name)) { seenNames.add(l.name); uniqueLotteries.push(l); }
        }

        const results = [];

        for (const lottery of uniqueLotteries) {
            // Filter to specific lottery if requested
            if (body.lotteryName && lottery.name !== body.lotteryName) continue;

            console.log(`\n--- ${lottery.name} ---`);

            let config = {};
            if (lottery.name === 'EuroMilhões') {
                config = {
                    drawDays: 'terças-feiras e sextas-feiras',
                    mainCount: 5, mainMin: 1, mainMax: 50,
                    extraCount: 2, extraMin: 1, extraMax: 12,
                    extraName: 'estrelas',
                    source: 'jogossantacasa.pt/euromilhoes'
                };
            } else if (lottery.name === 'Totoloto') {
                config = {
                    drawDays: 'quartas-feiras e sábados',
                    mainCount: 5, mainMin: 1, mainMax: 49,
                    extraCount: 1, extraMin: 1, extraMax: 13,
                    extraName: 'número da sorte',
                    source: 'jogossantacasa.pt/totoloto'
                };
            } else if (lottery.name === 'EuroDreams') {
                config = {
                    drawDays: 'segundas-feiras e quintas-feiras',
                    mainCount: 6, mainMin: 1, mainMax: 40,
                    extraCount: 1, extraMin: 1, extraMax: 5,
                    extraName: 'número Dream',
                    source: 'jogossantacasa.pt/eurodreams ou eurodreams.com'
                };
            } else continue;

            const allDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lottery.id });
            const existingDates = new Set(allDraws.map(d => d.draw_date));
            const existingInRange = allDraws.filter(d => d.draw_date >= startDate && d.draw_date <= endDate).map(d => d.draw_date).sort().join(', ') || 'nenhuma';

            console.log(`Dates already in DB for range: ${existingInRange}`);

            const prompt = `
Preciso dos resultados OFICIAIS e VERIFICADOS da loteria ${lottery.name} (Portugal).

A ${lottery.name} realiza sorteios APENAS às ${config.drawDays}.

PERÍODO: De ${startDate} até ${endDate}.

Já tenho os resultados das seguintes datas nesse período (NÃO me dês estas): ${existingInRange}

REGRAS OBRIGATÓRIAS:
- Retorna APENAS sorteios que aconteceram em ${config.drawDays} nesse período.
- Cada sorteio: EXATAMENTE ${config.mainCount} números principais ÚNICOS entre ${config.mainMin} e ${config.mainMax}.
- Cada sorteio: EXATAMENTE ${config.extraCount} ${config.extraName} entre ${config.extraMin} e ${config.extraMax}.
- Números 100% REAIS e verificados. NÃO inventes números.
- Formato data: YYYY-MM-DD.
- Se não tiveres dados verificados, NÃO incluas essa data.
- Fonte: ${config.source}
`.trim();

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
                                    draw_date: { type: 'string' },
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
                if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.draw_date)) { console.log(`Bad date: ${draw.draw_date}`); continue; }
                if (draw.draw_date < startDate || draw.draw_date > endDate) { console.log(`Out of range: ${draw.draw_date}`); continue; }
                if (existingDates.has(draw.draw_date)) { console.log(`Already exists: ${draw.draw_date}`); continue; }

                const mainNums = draw.main_numbers.map(n => parseInt(n)).filter(n => !isNaN(n));
                if (mainNums.length !== config.mainCount) { console.log(`Wrong count ${draw.draw_date}: ${mainNums.length}`); continue; }
                if (mainNums.some(n => n < config.mainMin || n > config.mainMax)) { console.log(`Out of range nums ${draw.draw_date}`); continue; }
                if (new Set(mainNums).size !== mainNums.length) { console.log(`Dup nums ${draw.draw_date}`); continue; }

                const extraNums = (draw.extra_numbers || []).map(n => parseInt(n)).filter(n => !isNaN(n));
                if (config.extraCount > 0 && extraNums.length !== config.extraCount) { console.log(`Wrong extra ${draw.draw_date}: ${extraNums.length}`); continue; }
                if (extraNums.some(n => n < config.extraMin || n > config.extraMax)) { console.log(`Extra out of range ${draw.draw_date}`); continue; }

                console.log(`✓ ${draw.draw_date} | ${mainNums} | extra: ${extraNums}`);
                existingDates.add(draw.draw_date);
                toInsert.push({ lottery_id: lottery.id, draw_date: draw.draw_date, main_numbers: mainNums.sort((a,b)=>a-b), extra_numbers: extraNums.sort((a,b)=>a-b) });
            }

            if (toInsert.length > 0) {
                await base44.asServiceRole.entities.Draw.bulkCreate(toInsert);
            }
            console.log(`Inserted ${toInsert.length} for ${lottery.name}`);
            results.push({ lottery: lottery.name, synced: toInsert.length });
        }

        const total = results.reduce((s, r) => s + r.synced, 0);
        return Response.json({ success: true, message: `${total} sorteio(s) inserido(s)`, results });

    } catch (error) {
        console.error('ERROR:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});