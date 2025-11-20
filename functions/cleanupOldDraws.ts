import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        console.log('=== CLEANUP STARTED ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Calculate start of this week (Monday)
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust when day is Sunday
        const monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        const startOfWeek = monday.toISOString().split('T')[0];

        console.log('Today:', today.toISOString().split('T')[0]);
        console.log('Start of this week:', startOfWeek);

        // Get all draws
        const allDraws = await base44.asServiceRole.entities.Draw.list();
        console.log('Total draws in DB:', allDraws.length);

        // Find draws to delete (before this week OR duplicates)
        const toDelete = [];
        const seen = new Map(); // Map to track duplicates by lottery_id + draw_date

        for (const draw of allDraws) {
            // Delete if before this week
            if (draw.draw_date < startOfWeek) {
                toDelete.push(draw.id);
                console.log(`Marking for deletion (old): ${draw.draw_date}`);
                continue;
            }

            // Check for duplicates
            const key = `${draw.lottery_id}_${draw.draw_date}`;
            if (seen.has(key)) {
                // This is a duplicate
                toDelete.push(draw.id);
                console.log(`Marking for deletion (duplicate): ${draw.draw_date}`);
            } else {
                seen.set(key, draw.id);
            }
        }

        console.log('Draws to delete:', toDelete.length);

        // Delete in batches
        if (toDelete.length > 0) {
            for (const id of toDelete) {
                await base44.asServiceRole.entities.Draw.delete(id);
            }
        }

        const remaining = allDraws.length - toDelete.length;

        console.log('=== CLEANUP COMPLETED ===');
        console.log('Deleted:', toDelete.length);
        console.log('Remaining:', remaining);

        return Response.json({
            success: true,
            message: `✓ Limpeza concluída: ${toDelete.length} sorteios removidos`,
            deleted: toDelete.length,
            remaining: remaining,
            week_start: startOfWeek
        });

    } catch (error) {
        console.error('=== CLEANUP ERROR ===');
        console.error('Error:', error.message);
        
        return Response.json({ 
            success: false,
            error: 'Erro na limpeza',
            message: error.message
        }, { status: 500 });
    }
});