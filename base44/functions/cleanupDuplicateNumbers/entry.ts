import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });
        const uniqueLotteries = [];
        const seenNames = new Set();
        for (const l of lotteries) {
            if (!seenNames.has(l.name)) { seenNames.add(l.name); uniqueLotteries.push(l); }
        }

        const report = [];

        for (const lottery of uniqueLotteries) {
            console.log(`\n--- ${lottery.name} ---`);
            const allDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lottery.id });
            
            // Group by sorted main_numbers signature
            const numGroups = {};
            for (const draw of allDraws) {
                const sig = [...draw.main_numbers].sort((a,b)=>a-b).join(',');
                if (!numGroups[sig]) numGroups[sig] = [];
                numGroups[sig].push(draw);
            }

            let deleted = 0;
            for (const [sig, draws] of Object.entries(numGroups)) {
                if (draws.length > 1) {
                    console.log(`Number combo [${sig}] appears ${draws.length} times across dates: ${draws.map(d=>d.draw_date).join(', ')}`);
                    // Sort by draw_date ascending — keep the OLDEST (most likely real), delete the rest
                    draws.sort((a, b) => a.draw_date.localeCompare(b.draw_date));
                    console.log(`  Keeping: ${draws[0].draw_date}`);
                    for (let i = 1; i < draws.length; i++) {
                        await base44.asServiceRole.entities.Draw.delete(draws[i].id);
                        console.log(`  Deleted: ${draws[i].draw_date} (id=${draws[i].id})`);
                        deleted++;
                    }
                }
            }

            report.push({ lottery: lottery.name, deleted, remaining: allDraws.length - deleted });
        }

        const totalDeleted = report.reduce((s, r) => s + r.deleted, 0);
        return Response.json({
            success: true,
            message: `Limpeza concluída: ${totalDeleted} sorteio(s) com números repetidos removido(s)`,
            report
        });

    } catch (error) {
        console.error('ERROR:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});