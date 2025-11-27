import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('=== CLEAN ALL DUPLICATES ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get ALL draws from ALL lotteries
        const allDraws = await base44.asServiceRole.entities.Draw.list();
        console.log(`Total draws in database: ${allDraws.length}`);

        // Group by lottery_id + draw_date
        const grouped = {};
        for (const draw of allDraws) {
            const key = `${draw.lottery_id}_${draw.draw_date}`;
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(draw);
        }

        // Find and delete duplicates
        let totalDeleted = 0;
        const deletePromises = [];

        for (const key in grouped) {
            const draws = grouped[key];
            if (draws.length > 1) {
                console.log(`Found ${draws.length} entries for ${key}`);
                // Keep the first one (oldest), delete all others
                for (let i = 1; i < draws.length; i++) {
                    deletePromises.push(
                        base44.asServiceRole.entities.Draw.delete(draws[i].id)
                            .then(() => {
                                console.log(`Deleted: ${draws[i].id}`);
                                return 1;
                            })
                            .catch(e => {
                                console.log(`Error deleting ${draws[i].id}: ${e.message}`);
                                return 0;
                            })
                    );
                }
            }
        }

        // Execute all deletes
        const results = await Promise.all(deletePromises);
        totalDeleted = results.reduce((sum, r) => sum + r, 0);

        // Verify final count
        const remainingDraws = await base44.asServiceRole.entities.Draw.list();
        
        return Response.json({
            success: true,
            message: `✓ ${totalDeleted} duplicados removidos. Restam ${remainingDraws.length} registros únicos.`,
            deleted: totalDeleted,
            remaining: remainingDraws.length
        });

    } catch (error) {
        console.error('Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});