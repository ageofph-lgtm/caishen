import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        console.log('=== CLEANUP DUPLICATE DRAWS STARTED ===');

        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ is_active: true });

        // Deduplicate lotteries by name
        const uniqueLotteries = [];
        const seenNames = new Set();
        for (const l of lotteries) {
            if (!seenNames.has(l.name)) {
                seenNames.add(l.name);
                uniqueLotteries.push(l);
            }
        }

        const report = [];

        for (const lottery of uniqueLotteries) {
            console.log(`\n--- ${lottery.name} ---`);

            const allDraws = await base44.asServiceRole.entities.Draw.filter({ lottery_id: lottery.id });
            console.log(`Total draws in DB: ${allDraws.length}`);

            // Group by draw_date
            const byDate = {};
            for (const draw of allDraws) {
                if (!byDate[draw.draw_date]) byDate[draw.draw_date] = [];
                byDate[draw.draw_date].push(draw);
            }

            let deletedCount = 0;
            const duplicateDates = [];

            for (const [date, draws] of Object.entries(byDate)) {
                if (draws.length <= 1) continue;

                duplicateDates.push(date);
                console.log(`Date ${date} has ${draws.length} entries — keeping 1, deleting ${draws.length - 1}`);

                // Sort: prefer entries with non-empty extra_numbers, then by created_date (newest first)
                draws.sort((a, b) => {
                    const aExtra = (a.extra_numbers || []).length;
                    const bExtra = (b.extra_numbers || []).length;
                    if (bExtra !== aExtra) return bExtra - aExtra;
                    return new Date(b.created_date) - new Date(a.created_date);
                });

                // Keep draws[0], delete the rest
                for (let i = 1; i < draws.length; i++) {
                    await base44.asServiceRole.entities.Draw.delete(draws[i].id);
                    deletedCount++;
                    console.log(`  Deleted draw id=${draws[i].id} (date=${draws[i].draw_date}, main=${JSON.stringify(draws[i].main_numbers)})`);
                }

                console.log(`  Kept: id=${draws[0].id}, main=${JSON.stringify(draws[0].main_numbers)}, extra=${JSON.stringify(draws[0].extra_numbers)}`);
            }

            report.push({
                lottery: lottery.name,
                total_draws: allDraws.length,
                duplicate_dates: duplicateDates.length,
                deleted: deletedCount,
                remaining: allDraws.length - deletedCount
            });

            console.log(`Cleaned ${deletedCount} duplicates for ${lottery.name}`);
        }

        const totalDeleted = report.reduce((s, r) => s + r.deleted, 0);
        console.log(`\n=== CLEANUP COMPLETE — Total deleted: ${totalDeleted} ===`);

        return Response.json({
            success: true,
            message: `Limpeza concluída: ${totalDeleted} duplicado(s) removido(s)`,
            report
        });

    } catch (error) {
        console.error('CLEANUP ERROR:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});