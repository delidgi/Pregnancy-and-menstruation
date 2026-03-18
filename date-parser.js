// ═══════════════════════════════════════════
// DATE-PARSER — парсинг RP-дат из текста
// ═══════════════════════════════════════════

import { getSettings } from './state.js';

export function parseRpDate(text) {
    const monthsRu = {
        'январ': 0, 'феврал': 1, 'март': 2, 'апрел': 3, 'ма': 4, 'июн': 5,
        'июл': 6, 'август': 7, 'сентябр': 8, 'октябр': 9, 'ноябр': 10, 'декабр': 11
    };
    const monthsEn = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };
    
    let parsedDate = null;

    // Паттерн 1: "Дата: 21 октября 2023" или "Date: 21 October 2023"
    const dayMonthYearMatch = text.match(/(?:[Дд]ата|[Dd]ate).*?(\d{1,2})\s+([А-Яа-яA-Za-z]+),?\s+(\d{4})/i);
    
    if (dayMonthYearMatch) {
        const day = parseInt(dayMonthYearMatch[1]);
        const monthStr = dayMonthYearMatch[2].toLowerCase();
        const year = parseInt(dayMonthYearMatch[3]);
        
        let month = -1;
        for (const [key, val] of Object.entries(monthsRu)) {
            if (monthStr.startsWith(key)) { month = val; break; }
        }
        if (month === -1) {
            for (const [key, val] of Object.entries(monthsEn)) {
                if (monthStr.startsWith(key)) { month = val; break; }
            }
        }
        
        if (month !== -1 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (Day Month Year): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }

    // Паттерн 2: "Дата: Октябрь 21, 2023"
    const longFormatMatch = text.match(/(?:[Дд]ата|[Dd]ate)[:\s]+(?:[А-Яа-яA-Za-z]+,?\s*)?([А-Яа-яA-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/i);
    if (longFormatMatch) {
        const monthStr = longFormatMatch[1].toLowerCase();
        const day = parseInt(longFormatMatch[2]);
        const year = parseInt(longFormatMatch[3]);
        
        let month = -1;
        for (const [key, val] of Object.entries(monthsRu)) {
            if (monthStr.startsWith(key)) { month = val; break; }
        }
        if (month === -1) {
            for (const [key, val] of Object.entries(monthsEn)) {
                if (monthStr.startsWith(key)) { month = val; break; }
            }
        }
        
        if (month !== -1 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (Month Day Year): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }
   
    // Паттерн 3: "Дата: 21.10.2023" или "Дата: 21/10/2023" (4-значный год)
    const shortFormatMatch = text.match(/(?:[Дд]ата|[Dd]ate).*?(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})/i);
    if (shortFormatMatch) {
        const day = parseInt(shortFormatMatch[1]);
        const month = parseInt(shortFormatMatch[2]) - 1;
        const year = parseInt(shortFormatMatch[3]);
        
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (short format): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }

    // Паттерн 3.5: "Дата: 21.10.23" или "Дата: 21/10/23" (2-значный год)
    const shortFormat2DigitMatch = text.match(/(?:[Дд]ата|[Dd]ate).*?(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2})(?!\d)/i);
    if (shortFormat2DigitMatch) {
        const day = parseInt(shortFormat2DigitMatch[1]);
        const month = parseInt(shortFormat2DigitMatch[2]) - 1;
        let year = parseInt(shortFormat2DigitMatch[3]);
        // Преобразуем 2-значный год: 00-50 → 2000-2050, 51-99 → 1951-1999
        year = year <= 50 ? 2000 + year : 1900 + year;
        
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (short format 2-digit year): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }

    // Паттерн 4: "Дата: 2023-10-21" (ISO)
    const isoFormatMatch = text.match(/(?:[Дд]ата|[Dd]ate)[:\s]+(\d{4})-(\d{2})-(\d{2})/i);
    if (isoFormatMatch) {
        const year = parseInt(isoFormatMatch[1]);
        const month = parseInt(isoFormatMatch[2]) - 1;
        const day = parseInt(isoFormatMatch[3]);
        
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (ISO format): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }
    
    // === ПАТТЕРНЫ БЕЗ СЛОВА "ДАТА" ===
    
    // Паттерн 4.5: "📅 13/10/23" или "📅 13.10.2023" (с эмодзи календаря)
    const emojiDateMatch = text.match(/📅\s*(?:[А-Яа-яA-Za-z]+,?\s*)?(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})/);
    if (emojiDateMatch) {
        const day = parseInt(emojiDateMatch[1]);
        const month = parseInt(emojiDateMatch[2]) - 1;
        let year = parseInt(emojiDateMatch[3]);
        // Если 2-значный год
        if (year < 100) {
            year = year <= 50 ? 2000 + year : 1900 + year;
        }
        
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (emoji format): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }
    
    // Паттерн 5: "Пятница, 21.10.2023" или просто "21.10.2023" (в начале строки или после запятой)
    const standaloneShortMatch = text.match(/(?:^|[,\s])(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})(?:\s|,|$)/m);
    if (standaloneShortMatch) {
        const day = parseInt(standaloneShortMatch[1]);
        const month = parseInt(standaloneShortMatch[2]) - 1;
        const year = parseInt(standaloneShortMatch[3]);
        
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (standalone short): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }
    
    // Паттерн 5.5: "Пятница, 21.10.23" или "21/10/23" (2-значный год)
    const standaloneShort2DigitMatch = text.match(/(?:^|[,\s])(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2})(?!\d)(?:\s|,|$)/m);
    if (standaloneShort2DigitMatch) {
        const day = parseInt(standaloneShort2DigitMatch[1]);
        const month = parseInt(standaloneShort2DigitMatch[2]) - 1;
        let year = parseInt(standaloneShort2DigitMatch[3]);
        // Преобразуем 2-значный год: 00-50 → 2000-2050, 51-99 → 1951-1999
        year = year <= 50 ? 2000 + year : 1900 + year;
        
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (standalone short 2-digit year): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }
    
    // Паттерн 6: "21 октября 2023" без слова "Дата"
    const standaloneFullMatch = text.match(/(\d{1,2})\s+([А-Яа-яA-Za-z]+)\s+(\d{4})/);
    if (standaloneFullMatch) {
        const day = parseInt(standaloneFullMatch[1]);
        const monthStr = standaloneFullMatch[2].toLowerCase();
        const year = parseInt(standaloneFullMatch[3]);
        
        let month = -1;
        for (const [key, val] of Object.entries(monthsRu)) {
            if (monthStr.startsWith(key)) { month = val; break; }
        }
        if (month === -1) {
            for (const [key, val] of Object.entries(monthsEn)) {
                if (monthStr.startsWith(key)) { month = val; break; }
            }
        }
        
        if (month !== -1 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (standalone full): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }
    
    // Паттерн 7: JSON формат date:{"output":"21.10.2023"} или date:{'output':'21/10/23'}
    const jsonDateMatch = text.match(/date[:\s]*[{]["']?output["']?[:\s]*["'](\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})["'][}]/i);
    if (jsonDateMatch) {
        const day = parseInt(jsonDateMatch[1]);
        const month = parseInt(jsonDateMatch[2]) - 1;
        let year = parseInt(jsonDateMatch[3]);
        if (year < 100) {
            year = year <= 50 ? 2000 + year : 1900 + year;
        }
        
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            parsedDate = new Date(year, month, day);
            console.log(`[Reproductive] Parsed RP date (JSON format): ${parsedDate.toISOString()}`);
            return parsedDate;
        }
    }
    
    return parsedDate;
}

export function calculateConceptionDate(rpDate, weeksPregnant) {
    if (!rpDate || weeksPregnant <= 0) return null;
    const conceptionTime = rpDate.getTime() - (weeksPregnant * 7 * 24 * 60 * 60 * 1000);
    return new Date(conceptionTime);
}

export function calculateDueDate(conceptionDate) {
    if (conceptionDate) {
        const s = getSettings();
        const duration = s.pregnancyDuration || 40; // недели из настроек расы
        const conception = new Date(conceptionDate);
        const dueDate = new Date(conception.getTime() + (duration * 7 * 24 * 60 * 60 * 1000));
        return dueDate;
    }
    return null;
}

