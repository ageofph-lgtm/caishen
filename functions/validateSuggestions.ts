import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        console.log('=== VALIDATE SUGGESTIONS STARTED ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            console.log('ERROR: Unauthorized');
            return Response.json({ 
                success: false,
                error: 'Unauthorized' 
            }, { status: 401 });
        }

        // Get all suggestions that haven't been validated yet
        const allSuggestions = await base44.asServiceRole.entities.Suggestion.list();
        const suggestions = allSuggestions.filter(s => !s.was_validated && s.draw_date);

        console.log('Total suggestions in DB:', allSuggestions.length);
        console.log('Unvalidated suggestions with date:', suggestions.length);

        // Check for suggestions without draw_date
        const invalidSuggestions = allSuggestions.filter(s => !s.draw_date);
        if (invalidSuggestions.length > 0) {
            console.log('WARNING: Found', invalidSuggestions.length, 'suggestions without draw_date');
            console.log('Deleting invalid suggestions...');
            
            for (const s of invalidSuggestions) {
                await base44.asServiceRole.entities.Suggestion.delete(s.id);
                console.log('Deleted suggestion', s.id);
            }
        }

        let validatedCount = 0;
        let totalMatches = 0;

        for (const suggestion of suggestions) {
            console.log(`\nProcessing suggestion ${suggestion.id}`);
            console.log('Lottery ID:', suggestion.lottery_id);
            console.log('Draw date:', suggestion.draw_date);

            // Find the actual draw for this suggestion's date
            const allDraws = await base44.asServiceRole.entities.Draw.list();
            const draws = allDraws.filter(d => 
                d.lottery_id === suggestion.lottery_id && 
                d.draw_date === suggestion.draw_date
            );

            console.log('Matching draws found:', draws.length);

            if (draws.length === 0) {
                console.log(`No draw found yet for ${suggestion.lottery_id} on ${suggestion.draw_date}`);
                continue;
            }

            const actualDraw = draws[0];
            console.log('Actual draw numbers:', actualDraw.main_numbers);
            console.log('Suggested numbers:', suggestion.main_numbers);

            // Calculate matches
            const matchesMain = suggestion.main_numbers.filter(num => 
                actualDraw.main_numbers.includes(num)
            ).length;

            const matchesExtra = (suggestion.extra_numbers || []).filter(num => 
                (actualDraw.extra_numbers || []).includes(num)
            ).length;

            console.log('Matches main:', matchesMain);
            console.log('Matches extra:', matchesExtra);

            totalMatches += matchesMain + matchesExtra;

            // Update suggestion with results
            await base44.asServiceRole.entities.Suggestion.update(suggestion.id, {
                actual_main_numbers: actualDraw.main_numbers,
                actual_extra_numbers: actualDraw.extra_numbers || [],
                matches_main: matchesMain,
                matches_extra: matchesExtra,
                was_validated: true
            });

            validatedCount++;
            console.log(`✓ Validated suggestion for ${suggestion.draw_date}: ${matchesMain} main + ${matchesExtra} extra matches`);
        }

        console.log('=== VALIDATION COMPLETED ===');
        console.log('Validated:', validatedCount);
        console.log('Total matches:', totalMatches);

        return Response.json({
            success: true,
            message: validatedCount > 0 
                ? `${validatedCount} sugestão(ões) validada(s) com ${totalMatches} acertos totais`
                : 'Nenhuma sugestão com resultado disponível',
            validated: validatedCount,
            total_matches: totalMatches,
            deleted_invalid: invalidSuggestions.length
        });

    } catch (error) {
        console.error('=== VALIDATION ERROR ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        
        return Response.json({ 
            success: false,
            error: 'Erro ao validar sugestões',
            message: error.message
        }, { status: 500 });
    }
});