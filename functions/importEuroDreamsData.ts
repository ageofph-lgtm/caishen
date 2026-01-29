import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const csvData = `2026-01-26,"15,23,28,33,34,37","3"
2026-01-22,"4,7,10,17,25,39","3"
2026-01-19,"8,9,20,24,32,40","1"
2026-01-15,"1,5,9,10,30,35","2"
2026-01-12,"9,15,18,23,27,31","1"
2026-01-08,"5,15,24,26,31,34","1"
2026-01-05,"11,20,21,28,34,38","4"
2026-01-01,"2,6,14,20,24,27","2"
2025-12-29,"5,8,16,19,24,39","2"
2025-12-25,"8,9,11,13,37,39","4"
2025-12-22,"4,11,24,27,34,35","5"
2025-12-18,"10,12,19,21,25,27","1"
2025-12-15,"8,22,23,31,39,40","4"
2025-12-11,"4,6,21,23,32,37","1"
2025-12-08,"3,8,12,18,19,27","3"
2025-12-04,"14,15,27,32,37,38","3"
2025-12-01,"12,15,19,23,33,38","3"
2025-11-27,"10,11,20,30,32,33","4"
2025-11-24,"6,13,17,22,25,36","4"
2025-11-20,"7,17,20,28,30,31","4"
2025-11-17,"4,8,13,18,28,38","4"
2025-11-13,"7,15,18,19,24,32","2"
2025-11-10,"1,8,10,19,21,37","2"
2025-11-06,"11,13,15,31,33,34","3"
2025-11-03,"2,10,12,20,21,26","2"
2025-10-30,"9,14,18,22,33,39","2"
2025-10-27,"18,19,21,23,30,35","1"
2025-10-23,"8,17,20,21,24,31","5"
2025-10-20,"8,18,21,25,32,33","1"
2025-10-16,"1,4,6,10,34,38","5"
2025-10-13,"1,5,12,20,22,25","1"
2025-10-09,"1,3,4,8,20,30","3"
2025-10-06,"18,26,30,31,36,40","4"
2025-10-02,"4,7,18,19,22,29","1"
2025-09-29,"9,10,25,33,35,40","2"
2025-09-25,"5,9,11,14,28,30","2"
2025-09-22,"2,5,9,22,26,38","5"
2025-09-18,"11,17,26,32,36,37","1"
2025-09-15,"4,7,15,21,33,35","1"
2025-09-11,"1,9,15,17,19,37","2"
2025-09-08,"1,3,5,11,20,31","5"
2025-09-04,"10,14,21,22,37,40","4"
2025-09-01,"6,22,30,31,32,33","4"
2025-08-28,"6,7,11,15,16,35","5"
2025-08-25,"5,6,19,32,35,37","1"
2025-08-21,"4,16,17,25,29,39","3"
2025-08-18,"1,31,33,35,36,40","4"
2025-08-14,"14,15,21,22,32,38","1"
2025-08-11,"10,11,15,20,27,38","3"
2025-08-07,"3,14,23,28,33,34","1"`;
        
        // Get EuroDreams lottery ID
        const lotteries = await base44.asServiceRole.entities.Lottery.filter({ name: "EuroDreams" });
        if (lotteries.length === 0) {
            return Response.json({ success: false, error: "EuroDreams não encontrado" });
        }
        const lotteryId = lotteries[0].id;
        
        // Parse CSV
        const lines = csvData.trim().split('\n');
        const draws = [];
        
        for (const line of lines) {
            const match = line.match(/^([^,]+),"([^"]+)","([^"]+)"/);
            if (match) {
                const date = match[1];
                const mainNums = match[2].split(',').map(n => parseInt(n));
                const extraNum = parseInt(match[3]);
                
                draws.push({
                    lottery_id: lotteryId,
                    draw_date: date,
                    main_numbers: mainNums,
                    extra_numbers: [extraNum]
                });
            }
        }
        
        // Bulk insert
        const batchSize = 50;
        for (let i = 0; i < draws.length; i += batchSize) {
            await base44.asServiceRole.entities.Draw.bulkCreate(draws.slice(i, i + batchSize));
        }
        
        return Response.json({ 
            success: true, 
            message: `${draws.length} sorteios EuroDreams importados!` 
        });
        
    } catch (error) {
        console.error(error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});