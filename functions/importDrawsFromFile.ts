import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';
import * as XLSX from 'npm:xlsx@0.18.5';

Deno.serve(async (req) => {
    try {
        console.log('=== IMPORT STARTED ===');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ 
                success: false,
                error: 'Não autorizado' 
            }, { status: 401 });
        }

        const body = await req.json();
        const { lottery_id, file_url } = body;

        if (!lottery_id || !file_url) {
            return Response.json({ 
                success: false,
                error: 'lottery_id e file_url são obrigatórios' 
            }, { status: 400 });
        }

        console.log('Importing for lottery:', lottery_id);

        // Get lottery
        const allLotteries = await base44.asServiceRole.entities.Lottery.list();
        const lottery = allLotteries.find(l => l.id === lottery_id);
        
        if (!lottery) {
            return Response.json({ 
                success: false,
                error: 'Loteria não encontrada' 
            }, { status: 404 });
        }

        console.log('Lottery:', lottery.name);

        // Download file
        const fileResponse = await fetch(file_url);
        if (!fileResponse.ok) {
            return Response.json({ 
                success: false,
                error: 'Erro ao baixar ficheiro' 
            }, { status: 500 });
        }

        const arrayBuffer = await fileResponse.arrayBuffer();
        console.log('File downloaded, size:', arrayBuffer.byteLength);

        let extractedDraws = [];

        // Parse Excel/CSV
        try {
            if (file_url.toLowerCase().endsWith('.csv')) {
                // CSV
                const text = new TextDecoder().decode(arrayBuffer);
                const lines = text.split('\n').filter(line => line.trim());
                
                extractedDraws = lines.slice(1).map(line => {
                    const parts = line.split(/[,;]/).map(p => p.trim());
                    
                    // First column: main numbers (can be comma-separated string or individual)
                    let mainNumbers = [];
                    if (parts[0] && parts[0].includes(',')) {
                        mainNumbers = parts[0].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                    } else {
                        for (let i = 0; i < lottery.main_count && i < parts.length; i++) {
                            const num = parseInt(parts[i]);
                            if (!isNaN(num)) mainNumbers.push(num);
                        }
                    }
                    
                    // Extra numbers
                    let extraNumbers = [];
                    const extraIdx = mainNumbers.length === lottery.main_count ? lottery.main_count : 1;
                    const extraStr = parts[extraIdx];
                    if (extraStr) {
                        const nums = extraStr.split(/[\s,]+/).map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                        extraNumbers = nums.slice(0, lottery.extra_count);
                    }
                    
                    // Date from last column
                    const dateStr = parts[parts.length - 1];
                    
                    return { mainNumbers, extraNumbers, dateStr };
                });
            } else {
                // Excel
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                extractedDraws = data.slice(1).map(row => {
                    if (!row || row.length < 2) return null;
                    
                    // Parse main numbers
                    let mainNumbers = [];
                    const firstCol = row[0];
                    
                    if (typeof firstCol === 'string' && firstCol.includes(',')) {
                        // Format: "1, 2, 3, 4, 5"
                        mainNumbers = firstCol.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                    } else if (typeof firstCol === 'string' && firstCol.includes(' ')) {
                        // Format: "1 2 3 4 5"
                        mainNumbers = firstCol.split(/\s+/).map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                    } else {
                        // Separate columns
                        for (let i = 0; i < lottery.main_count && i < row.length; i++) {
                            const num = parseInt(row[i]);
                            if (!isNaN(num)) mainNumbers.push(num);
                        }
                    }
                    
                    // Parse extra numbers (second-to-last column usually)
                    let extraNumbers = [];
                    const extraCol = row[row.length - 2];
                    
                    if (extraCol !== undefined && extraCol !== null && extraCol !== '') {
                        if (typeof extraCol === 'string') {
                            const nums = extraCol.split(/[\s,]+/).map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                            extraNumbers = nums.slice(0, lottery.extra_count);
                        } else {
                            const num = parseInt(extraCol);
                            if (!isNaN(num)) extraNumbers.push(num);
                        }
                    }
                    
                    // Date from last column
                    const dateStr = row[row.length - 1];
                    
                    return { mainNumbers, extraNumbers, dateStr };
                }).filter(r => r !== null);
            }
        } catch (parseError) {
            console.error('Parse error:', parseError);
            return Response.json({ 
                success: false,
                error: 'Erro ao processar ficheiro: ' + parseError.message
            }, { status: 500 });
        }

        console.log('Extracted rows:', extractedDraws.length);

        // Validate and format draws
        const validDraws = [];
        
        for (const item of extractedDraws) {
            // Validate main numbers
            if (!item.mainNumbers || item.mainNumbers.length !== lottery.main_count) {
                console.log('Invalid main numbers count:', item.mainNumbers?.length);
                continue;
            }

            // Parse date
            let drawDate = item.dateStr;
            
            if (typeof drawDate === 'number') {
                // Excel date
                const excelEpoch = new Date(1899, 11, 30);
                const date = new Date(excelEpoch.getTime() + drawDate * 86400000);
                drawDate = date.toISOString().split('T')[0];
            } else if (typeof drawDate === 'string') {
                drawDate = drawDate.trim();
                
                // Try different formats
                if (drawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    // Already YYYY-MM-DD
                } else if (drawDate.match(/^\d{2}[-/]\d{2}[-/]\d{4}$/)) {
                    // DD-MM-YYYY or DD/MM/YYYY
                    const parts = drawDate.split(/[-/]/);
                    drawDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                } else if (drawDate.match(/^\d{2}[-/]\d{2}[-/]\d{2}$/)) {
                    // DD-MM-YY or DD/MM/YY
                    const parts = drawDate.split(/[-/]/);
                    const year = parseInt(parts[2]) > 50 ? `19${parts[2]}` : `20${parts[2]}`;
                    drawDate = `${year}-${parts[1]}-${parts[0]}`;
                } else {
                    // Try to parse as date string
                    try {
                        const parsed = new Date(drawDate);
                        if (!isNaN(parsed.getTime())) {
                            drawDate = parsed.toISOString().split('T')[0];
                        } else {
                            console.log('Could not parse date:', drawDate);
                            continue;
                        }
                    } catch {
                        console.log('Failed to parse date:', drawDate);
                        continue;
                    }
                }
            } else {
                console.log('Invalid date type:', typeof drawDate);
                continue;
            }

            // Final validation
            if (!/^\d{4}-\d{2}-\d{2}$/.test(drawDate)) {
                console.log('Final date format invalid:', drawDate);
                continue;
            }

            validDraws.push({
                lottery_id: lottery_id,
                draw_date: drawDate,
                main_numbers: item.mainNumbers,
                extra_numbers: item.extraNumbers || []
            });
        }

        console.log('Valid draws after parsing:', validDraws.length);

        if (validDraws.length === 0) {
            return Response.json({ 
                success: false,
                error: 'Nenhum sorteio válido. Verifique se o ficheiro tem as colunas corretas: Números Principais, Números Extras, Data'
            }, { status: 400 });
        }

        // Remove duplicates by date
        const uniqueDraws = [];
        const seenDates = new Set();
        validDraws.forEach(draw => {
            if (!seenDates.has(draw.draw_date)) {
                seenDates.add(draw.draw_date);
                uniqueDraws.push(draw);
            }
        });

        console.log('Unique draws:', uniqueDraws.length);

        // Filter out existing
        const existingDraws = await base44.asServiceRole.entities.Draw.list();
        const existingDates = new Set(
            existingDraws
                .filter(d => d.lottery_id === lottery_id)
                .map(d => d.draw_date)
        );

        const newDraws = uniqueDraws.filter(d => !existingDates.has(d.draw_date));

        console.log('New draws to insert:', newDraws.length);

        if (newDraws.length === 0) {
            return Response.json({
                success: true,
                message: 'Todos os sorteios já existem na base',
                imported: 0,
                total: uniqueDraws.length
            });
        }

        // Insert in batches
        const batchSize = 100;
        for (let i = 0; i < newDraws.length; i += batchSize) {
            const batch = newDraws.slice(i, i + batchSize);
            await base44.asServiceRole.entities.Draw.bulkCreate(batch);
            console.log(`Batch ${Math.floor(i / batchSize) + 1} inserted`);
        }

        console.log('=== IMPORT SUCCESS ===');

        return Response.json({
            success: true,
            message: `${newDraws.length} sorteios importados!`,
            imported: newDraws.length,
            total: uniqueDraws.length
        });

    } catch (error) {
        console.error('=== IMPORT ERROR ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        
        return Response.json({ 
            success: false,
            error: error.message || 'Erro ao importar'
        }, { status: 500 });
    }
});