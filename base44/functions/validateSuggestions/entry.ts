import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        console.log('=== INICIANDO VALIDAÇÃO DE SUGESTÕES ===');
        
        // 1. Obter todas as sugestões não validadas
        const allSuggestions = await base44.asServiceRole.entities.Suggestion.list();
        const pending = allSuggestions.filter(s => !s.was_validated && s.draw_date);

        console.log('Total suggestions:', allSuggestions.length);
        console.log('Pending validation:', pending.length);

        // 2. Limpeza de registros inválidos (sem data)
        const invalid = allSuggestions.filter(s => !s.draw_date);
        console.log('Invalid suggestions (no date):', invalid.length);
        
        for (const inv of invalid) {
            await base44.asServiceRole.entities.Suggestion.delete(inv.id);
            console.log('Deleted invalid suggestion:', inv.id);
        }

        let validatedCount = 0;
        let totalMatches = 0;

        for (const suggestion of pending) {
            console.log(`\n--- Validating suggestion ${suggestion.id} ---`);
            console.log('Lottery:', suggestion.lottery_id);
            console.log('Date:', suggestion.draw_date);

            // Procurar o sorteio real para esta data e lotaria (comparação estrita de strings)
            const draws = await base44.asServiceRole.entities.Draw.filter({
                lottery_id: suggestion.lottery_id,
                draw_date: suggestion.draw_date
            });

            if (draws.length === 0) {
                console.log(`⏳ No draw found yet for ${suggestion.draw_date}`);
                continue;
            }

            const actual = draws[0];
            console.log('Actual numbers:', actual.main_numbers);
            console.log('Suggested numbers:', suggestion.main_numbers);
            
            // Cálculo de acertos (Matches)
            const matchesMain = suggestion.main_numbers.filter(n => 
                actual.main_numbers.includes(n)
            ).length;

            const matchesExtra = (suggestion.extra_numbers || []).filter(n => 
                (actual.extra_numbers || []).includes(n)
            ).length;

            console.log('Matches:', matchesMain, 'main +', matchesExtra, 'extra');
            totalMatches += matchesMain + matchesExtra;

            // Atualização com os dados REAIS da fonte
            await base44.asServiceRole.entities.Suggestion.update(suggestion.id, {
                actual_main_numbers: actual.main_numbers,
                actual_extra_numbers: actual.extra_numbers || [],
                matches_main: matchesMain,
                matches_extra: matchesExtra,
                was_validated: true
            });

            validatedCount++;
            console.log(`✓ Validated: ${matchesMain} main + ${matchesExtra} extra`);
        }

        console.log('\n=== VALIDAÇÃO CONCLUÍDA ===');
        console.log('Validated:', validatedCount);
        console.log('Total matches:', totalMatches);
        console.log('Cleaned invalid:', invalid.length);

        return Response.json({ 
            success: true, 
            message: validatedCount > 0 
                ? `${validatedCount} sugestão(ões) validada(s) com ${totalMatches} acertos`
                : 'Nenhuma sugestão com resultado disponível',
            validated: validatedCount,
            total_matches: totalMatches,
            cleaned: invalid.length 
        });
    } catch (error) {
        console.error('=== ERRO NA VALIDAÇÃO ===');
        console.error('Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});