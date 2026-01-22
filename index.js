import { eventSource, event_types, saveSettingsDebounced, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

function getSeededRandomSymptoms(arr, count, seed) {
    function seededRandom(s) {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
    }
    const indexed = arr.map((item, idx) => ({ item, idx }));
    indexed.sort((a, b) => {
        return seededRandom(seed * 1000 + a.idx) - seededRandom(seed * 1000 + b.idx);
    });
    return indexed.slice(0, count).map(x => x.item).join(', ');
}

const extensionName = 'reproductive-system';

const defaultSettings = {
    isEnabled: true,
    showNotifications: true,
    language: 'ru',
    contraception: 'none',
    cycleDay: 1,
    lastCycleUpdate: null,
    totalChecks: 0,
    totalConceptions: 0,
    currentChatId: null,
    chatPregnancyData: {},
    lastCheckedMessageId: null
};

const defaultPregnancyData = {
    isPregnant: false,
    conceptionDate: null,
    pregnancyWeeks: 0,
    rpDate: null,
    fetusCount: 1,
    fetusSex: [],
    complications: [],
    healthStatus: 'normal',
    lastComplicationCheck: null,
    lastComplicationCheckRpDate: null,
    lastDoctorVisitRpDate: null
};

const CHANCES = {
    base: 20,
    cycleModifier: {
        '1-7': { low: 0.25 },
        '8-11': { medium: 0.5 },
        '12-16': { high: 1.65 },
        '17-28': { luteal: 0.25 }
    },
    contraception: {
        none: 0,
        condom: 85,
        pill: 91,
        iud: 99
    },
    twins: 3,
    triplets: 0.1
};

const LANG = {
    ru: {
        title: 'Репродуктивная Система',
        enabled: 'Включено',
        notifications: 'Уведомления',
        contraceptionTitle: 'Контрацепция',
        contraceptionTypes: {
            none: 'Нет защиты',
            condom: '🛡️ Презерватив (85%)',
            pill: '💊 Таблетки (91%)',
            iud: '🩹 ВМС (99%)'
        },
        cycleDay: 'День цикла',
        status: 'Статус',
        notPregnant: 'Не беременна',
        pregnant: 'Беременна',
        conceptionSuccess: '✨ ЗАЧАТИЕ ПРОИЗОШЛО!',
        conceptionFail: '❌ Зачатия не произошло',
        contraceptionFailed: '⚠️ Контрацепция ПОДВЕЛА!',
        stats: 'Проверок: {checks} | Зачатий: {conceptions}',
        reset: 'Сбросить беременность'
    },
    en: {
        title: 'Reproductive System',
        enabled: 'Enable',
        notifications: 'Notifications',
        contraceptionTitle: 'Contraception',
        contraceptionTypes: {
            none: 'None',
            condom: '🛡️ Condom (85%)',
            pill: '💊 Pill (91%)',
            iud: '🩹 IUD (99%)'
        },
        cycleDay: 'Cycle day',
        status: 'Status',
        notPregnant: 'Not pregnant',
        pregnant: 'Pregnant',
        conceptionSuccess: '✨ CONCEPTION!',
        conceptionFail: '❌ No conception',
        contraceptionFailed: '⚠️ Contraception failed!',
        stats: 'Checks: {checks} | Conceptions: {conceptions}',
        reset: 'Reset pregnancy'
    }
};

function getSettings() {
    return extension_settings[extensionName];
}

function getCurrentChatId() {
    try {
        const context = typeof SillyTavern?.getContext === 'function' 
            ? SillyTavern.getContext() 
            : window;
        return context?.chatId || context?.chat_metadata?.chat_id || null;
    } catch (e) {
        return null;
    }
}

function getPregnancyData() {
    const s = getSettings();
    const chatId = getCurrentChatId();
    
    if (!chatId) {
        if (!s._tempPregnancyData) {
            s._tempPregnancyData = structuredClone(defaultPregnancyData);
        }
        return s._tempPregnancyData;
    }

    if (!s.chatPregnancyData) {
        s.chatPregnancyData = {};
    }

    if (!s.chatPregnancyData[chatId]) {
        s.chatPregnancyData[chatId] = structuredClone(defaultPregnancyData);
    }
    
    return s.chatPregnancyData[chatId];
}

function L(key) {
    try {
        const s = getSettings();
        const lang = s?.language || 'ru';
        const keys = key.split('.');
        let result = LANG[lang];
        for (const k of keys) {
            result = result?.[k];
        }
        return result || key;
    } catch (e) {
        console.error('[Reproductive] L() error:', key, e);
        return key;
    }
}

function roll(max = 100) {
    return Math.floor(Math.random() * max) + 1;
}

function getCycleModifier(day) {
    if (day >= 12 && day <= 16) return CHANCES.cycleModifier['12-16'].high;
    if (day >= 8 && day <= 11) return CHANCES.cycleModifier['8-11'].medium;
    if (day >= 17) return CHANCES.cycleModifier['17-28'].luteal;
    return CHANCES.cycleModifier['1-7'].low;
}

function parseRpDate(text) {
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
   
    // Паттерн 3: "Дата: 21.10.2023" или "Дата: 21/10/2023"
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
    
    return parsedDate;
}

function calculateConceptionDate(rpDate, weeksPregnant) {
    if (!rpDate || weeksPregnant <= 0) return null;
    const conceptionTime = rpDate.getTime() - (weeksPregnant * 7 * 24 * 60 * 60 * 1000);
    return new Date(conceptionTime);
}

function calculateDueDate(conceptionDate) {
    if (conceptionDate) {
        const conception = new Date(conceptionDate);
        const dueDate = new Date(conception.getTime() + (40 * 7 * 24 * 60 * 60 * 1000));
        return dueDate;
    }
    return null;
}

function parseAIStatus(text) {
    const s = getSettings();
    const p = getPregnancyData();
    let updated = false;
    let rpDateChanged = false;

    console.log('[Reproductive] Parsing AI status block...');

    const rpDate = parseRpDate(text);
    if (rpDate) {
        const oldRpDate = p.rpDate;
        p.rpDate = rpDate.toISOString();
        if (oldRpDate !== p.rpDate) {
            console.log(`[Reproductive] RP date updated: ${p.rpDate}`);
            rpDateChanged = true;
            updated = true;
            
            // Если уже беременна и rpDate изменился - пересчитать conceptionDate
            if (p.isPregnant && p.pregnancyWeeks > 0) {
                const newConceptionDate = calculateConceptionDate(new Date(p.rpDate), p.pregnancyWeeks);
                if (newConceptionDate) {
                    p.conceptionDate = newConceptionDate.toISOString();
                    console.log(`[Reproductive] Recalculated conception date: ${p.conceptionDate}`);
                }
            }
        }
    }

    const cycleDayPatterns = [
        /[Дд]ень\s+(?:цикла[:\s]+)?(\d+)/i,
        /[Цц]икл[:\s]+(?:[Дд]ень\s+)?(\d+)/i,
        /[Dd]ay\s+(?:of\s+cycle[:\s]+)?(\d+)/i,
        /[Cc]ycle[:\s]+(?:[Dd]ay\s+)?(\d+)/i,
        /🩸.*?[Дд]ень\s+(\d+)/i,
        /🩸.*?[Dd]ay\s+(\d+)/i
    ];
    
    for (const pattern of cycleDayPatterns) {
        const match = text.match(pattern);
        if (match) {
            const day = parseInt(match[1]);
            if (day >= 1 && day <= 28 && day !== s.cycleDay) {
                console.log(`[Reproductive] Parsed cycle day: ${s.cycleDay} → ${day}`);
                s.cycleDay = day;
                s.lastCycleUpdate = Date.now();
                updated = true;
                break;
            }
        }
    }

    // Роды определяются через тег [BIRTH] в getPregnancyPrompt, не через паттерны

    const pregnancyPatterns = [
        /[Бб]еременност[ьи][^\n]{0,30}[\(:\s]+(\d+)\s*недел/i,
        /[Сс][Рр][Оо][Кк][:\s]+(\d+)\s*недел/i,
        /[Бб]еременна[^\n]{0,50}(\d+)\s*недел/i,
        /(\d+)\s*недел[ьяи][^\n]{0,30}беременност/i,
        /[Pp]regnant[^\n]{0,50}(\d+)\s*week/i,
        /[Pp]regnancy[^\n]{0,30}[\(:\s]+(\d+)\s*week/i,
        /(\d+)\s*weeks?\s*(?:of\s+)?pregnan/i,
        /🤰[^\n]{0,30}(\d+)\s*(?:недел|week)/i
    ];
    
    let weeks = null;
    for (const pattern of pregnancyPatterns) {
        const match = text.match(pattern);
        if (match) {
            weeks = parseInt(match[1]);
            console.log(`[Reproductive] Matched pregnancy pattern: ${pattern}, weeks: ${weeks}`);
            break;
        }
    }

    let detectedFetusCount = null;
    if (/[Дд]войн[яеи]|[Tt]wins?/i.test(text)) {
        detectedFetusCount = 2;
    } else if (/[Тт]ройн[яеи]|[Tt]riplets?/i.test(text)) {
        detectedFetusCount = 3;
    }
    
    if (weeks !== null && weeks > 0) {
        console.log(`[Reproductive] Parsed pregnancy: ${weeks} weeks`);

        if (!p.isPregnant) {
            console.log('[Reproductive] AI says pregnant, setting pregnant state...');
            p.isPregnant = true;
            p.pregnancyWeeks = weeks;
            
            if (p.rpDate) {
                const conceptionDate = calculateConceptionDate(new Date(p.rpDate), weeks);
                if (conceptionDate) {
                    p.conceptionDate = conceptionDate.toISOString();
                }
            } else {
                p.conceptionDate = new Date().toISOString();
            }

            p.fetusCount = detectedFetusCount || 1;
            p.fetusSex = [];
            for (let i = 0; i < p.fetusCount; i++) {
                p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
            }

            updated = true;

            if (s.showNotifications) {
                const sexIcons = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
                const fetusText = p.fetusCount === 1 ? '1 плод' : p.fetusCount === 2 ? 'Двойня' : 'Тройня';
                showNotification(`🔄 Синхронизировано: ${weeks} нед. | ${fetusText} | Пол: ${sexIcons}`, 'info');
            }
        } else {
            if (detectedFetusCount && detectedFetusCount !== p.fetusCount) {
                p.fetusCount = detectedFetusCount;
                while (p.fetusSex.length < p.fetusCount) {
                    p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
                }
                p.fetusSex = p.fetusSex.slice(0, p.fetusCount);
                updated = true;
            }
            
            if (weeks !== p.pregnancyWeeks) {
                console.log(`[Reproductive] Pregnancy week mismatch: ours=${p.pregnancyWeeks}, AI=${weeks}. Resyncing...`);
                p.pregnancyWeeks = weeks;
                
                // Пересчитываем conceptionDate на основе rpDate и новых недель
                if (p.rpDate) {
                    const conceptionDate = calculateConceptionDate(new Date(p.rpDate), weeks);
                    if (conceptionDate) {
                        p.conceptionDate = conceptionDate.toISOString();
                    }
                }
                
                updated = true;
                if (s.showNotifications) {
                    showNotification(`🔄 Срок обновлён: ${weeks} недель`, 'info');
                }
            }
        }
    }

    // УБРАНО: автоматический сброс по "не беременна" - слишком часто ложные срабатывания
    // Сброс беременности только через кнопку или роды на 36+ неделе

    if (updated) {
        saveSettingsDebounced();
        syncUI();
        updatePromptInjection();
    }

    return updated;
}

function updateCycleDay() {
    const s = getSettings();
    if (!s.isEnabled) return;

    const now = Date.now();

    if (!s.lastCycleUpdate) {
        s.lastCycleUpdate = now;
        saveSettingsDebounced();
        return;
    }

    const timeDiff = now - s.lastCycleUpdate;
    const daysPassed = Math.floor(timeDiff / 86400000);

    if (daysPassed > 0) {
        const oldDay = s.cycleDay;
        s.cycleDay += daysPassed;
        while (s.cycleDay > 28) {
            s.cycleDay -= 28;
        }
        s.lastCycleUpdate = now;

        console.log(`[Reproductive] Auto-update: ${oldDay} → ${s.cycleDay} (${daysPassed} days passed)`);
        saveSettingsDebounced();
        syncUI();
        updatePromptInjection();

        if (s.showNotifications) {
            showNotification(`📅 День цикла обновлён: ${s.cycleDay}`, 'info');
        }
    }
}

function initCustomNotifications() {
    if ($('#custom-notification-container').length > 0) return;

    $('body').append('<div id="custom-notification-container"></div>');

    $('head').append(`<style id="repro-notifications-style">
#custom-notification-container {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 999999;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
}

.custom-notification {
    min-width: 300px;
    max-width: 500px;
    padding: 16px 22px;
    border-radius: 15px;
    font-size: 14px;
    font-weight: 600;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    animation: slideIn 0.3s ease-out;
    pointer-events: all;
    position: relative;
    cursor: pointer;
}

.custom-notification.success {
    background: rgba(0, 255, 136, 0.15);
    border: 1px solid rgba(0, 255, 136, 0.3);
    color: #00ff88;
    box-shadow: 0 8px 32px rgba(0, 255, 136, 0.2);
}

.custom-notification.warning {
    background: rgba(255, 170, 0, 0.15);
    border: 1px solid rgba(255, 170, 0, 0.3);
    color: #ffaa00;
    box-shadow: 0 8px 32px rgba(255, 170, 0, 0.2);
}

.custom-notification.info {
    background: rgba(74, 158, 255, 0.15);
    border: 1px solid rgba(74, 158, 255, 0.3);
    color: #4a9eff;
    box-shadow: 0 8px 32px rgba(74, 158, 255, 0.2);
}

.custom-notification .close-btn {
    position: absolute;
    top: 10px;
    right: 12px;
    background: none;
    border: none;
    color: inherit;
    font-size: 18px;
    cursor: pointer;
    opacity: 0.7;
    line-height: 1;
}

.custom-notification .close-btn:hover {
    opacity: 1;
}

@keyframes slideIn {
    from { transform: translateY(-100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

@keyframes slideOut {
    to { transform: translateY(-100%); opacity: 0; }
}
</style>`);
}

function showNotification(message, type = 'info') {
    const s = getSettings();
    if (!s.showNotifications) return;

    initCustomNotifications();

    const container = $('#custom-notification-container');
    const notification = $(`
        <div class="custom-notification ${type}">
            <button class="close-btn">×</button>
            <div>${message}</div>
        </div>
    `);

    container.append(notification);

    notification.find('.close-btn').on('click', function() {
        notification.css('animation', 'slideOut 0.3s ease-in');
        setTimeout(() => notification.remove(), 300);
    });

    setTimeout(() => {
        notification.css('animation', 'slideOut 0.3s ease-in');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

function checkConception() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!s.isEnabled) return null;
    if (p.isPregnant) {
        console.log('[Reproductive] Already pregnant, skipping check');
        return null;
    }

    s.totalChecks++;

    const cycleModifier = getCycleModifier(s.cycleDay);
    let chance = Math.round(CHANCES.base * cycleModifier);

    const contraceptionEff = CHANCES.contraception[s.contraception];
    let contraceptionFailed = false;

    if (s.contraception !== 'none') {
        const failRoll = roll(100);
        if (failRoll > contraceptionEff) {
            contraceptionFailed = true;
            if (s.showNotifications) {
                showNotification(L('contraceptionFailed'), 'warning');
            }
        } else {
            chance = Math.round(chance * (1 - contraceptionEff / 100));
        }
    }

    const conceptionRoll = roll(100);
    const success = conceptionRoll <= chance;

    console.log(`[Reproductive] Check: roll=${conceptionRoll}, need<=${chance}, result=${success ? 'PREGNANT' : 'no'}`);

    const result = {
        roll: conceptionRoll,
        chance: chance,
        contraception: s.contraception,
        contraceptionFailed: contraceptionFailed,
        cycleDay: s.cycleDay,
        success: success
    };

    if (success) {
        p.isPregnant = true;

        if (p.rpDate) {
            p.conceptionDate = p.rpDate;
            console.log(`[Reproductive] Conception date set to RP date: ${p.conceptionDate}`);
        } else {
            p.conceptionDate = new Date().toISOString();
            console.log(`[Reproductive] Conception date set to Real time (fallback): ${p.conceptionDate}`);
        }


        p.pregnancyWeeks = 0;
        s.totalConceptions++;

        const multiplesRoll = roll(1000) / 10;
        if (multiplesRoll <= CHANCES.triplets) {
            p.fetusCount = 3;
        } else if (multiplesRoll <= CHANCES.twins) {
            p.fetusCount = 2;
        } else {
            p.fetusCount = 1;
        }

        p.fetusSex = [];
        for (let i = 0; i < p.fetusCount; i++) {
            p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        }

        if (s.showNotifications) {
            const sexIcons = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
            const fetusText = p.fetusCount === 1 ? '1 плод' : p.fetusCount === 2 ? 'Двойня!' : 'Тройня!';
            showNotification(`✅ Беременность! День ${s.cycleDay}, ${conceptionRoll}/${chance}\n${fetusText} | Пол: ${sexIcons}`, 'success');
        }
    } else {
        if (s.showNotifications) {
            showNotification(`❌ Не Беременна. День ${s.cycleDay}, ${conceptionRoll}/${chance}`, 'info');
        }
    }

    saveSettingsDebounced();
    syncUI();

    return result;
}

function checkComplications() {
    const s = getSettings();
    const p = getPregnancyData();
    
    if (!p.isPregnant) return;
    if (!p.rpDate) return;

    let weeks = p.pregnancyWeeks || 0;
    if (weeks === 0 && p.conceptionDate) {
        const diffMs = Date.now() - new Date(p.conceptionDate).getTime();
        weeks = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
    }

    const currentRpDate = new Date(p.rpDate);
    
    if (p.lastComplicationCheckRpDate) {
        const lastCheckRpDate = new Date(p.lastComplicationCheckRpDate);
        const daysSinceCheckRp = Math.floor((currentRpDate - lastCheckRpDate) / 86400000);
        
        if (daysSinceCheckRp < 7) {
            console.log(`[Reproductive] Complication check skipped: only ${daysSinceCheckRp} RP days since last check`);
            return;
        }
    }

    p.lastComplicationCheckRpDate = p.rpDate;

    if (s.showNotifications) {
        showNotification(`🩺 Проверка здоровья (${weeks} нед.)...`, 'info');
    }

    let baseChance = weeks <= 12 ? 15 : weeks <= 27 ? 5 : 12;
    if (p.fetusCount >= 2) baseChance += 10;
    if (p.fetusCount >= 3) baseChance += 15;
    
    // Накопление warning увеличивает шанс
    const warningCount = (p.complications || []).filter(c => c.severity === 'warning' && !c.resolved).length;
    if (warningCount >= 2) baseChance += 10;

    const complicationRoll = roll(100);
    console.log(`[Reproductive] Complication check: roll=${complicationRoll}, threshold=${baseChance}, warnings=${warningCount}`);

    if (complicationRoll <= baseChance) {
        const types = getComplicationTypes(weeks);
        const complication = types[Math.floor(Math.random() * types.length)];

        p.complications.push({
            week: weeks,
            type: complication.type,
            severity: complication.severity,
            description: complication.description,
            rpDate: p.rpDate,
            date: new Date().toISOString(),
            resolved: false
        });

        if (complication.severity === 'critical') {
            p.healthStatus = 'critical';
        } else if (complication.severity === 'warning' && p.healthStatus === 'normal') {
            p.healthStatus = 'warning';
        }

        saveSettingsDebounced();
        syncUI();

        if (s.showNotifications) {
            const emoji = complication.severity === 'critical' ? '🚨' : '⚠️';
            showNotification(`${emoji} ОСЛОЖНЕНИЕ: ${complication.type}\n${complication.description}`, 
                           complication.severity === 'critical' ? 'warning' : 'info');
        }
        
        // Реальные последствия
        handleComplicationConsequences(complication, weeks);
        
    } else {
        // Шанс на выздоровление
        if (warningCount > 0 && roll(100) <= 30) {
            const unresolvedWarning = p.complications.find(c => c.severity === 'warning' && !c.resolved);
            if (unresolvedWarning) {
                unresolvedWarning.resolved = true;
                if (s.showNotifications) {
                    showNotification(`💊 ${unresolvedWarning.type} — состояние улучшилось!`, 'success');
                }
                const hasUnresolvedCritical = p.complications.some(c => c.severity === 'critical' && !c.resolved);
                const hasUnresolvedWarning = p.complications.some(c => c.severity === 'warning' && !c.resolved);
                p.healthStatus = hasUnresolvedCritical ? 'critical' : hasUnresolvedWarning ? 'warning' : 'normal';
            }
        }
        
        if (s.showNotifications) {
            showNotification(`✅ Проверка пройдена: всё в норме!`, 'success');
        }
        saveSettingsDebounced();
        syncUI();
    }
}

function handleComplicationConsequences(complication, weeks) {
    const s = getSettings();
    const p = getPregnancyData();
    
    // === УГРОЗА ВЫКИДЫША (1 триместр) — 25% шанс потери ===
    if (complication.type === 'Угроза выкидыша') {
        const miscarriageRoll = roll(100);
        console.log(`[Reproductive] Miscarriage roll: ${miscarriageRoll} (need >25 to survive)`);
        
        if (miscarriageRoll <= 25) {
            if (s.showNotifications) {
                showNotification(`💔 ВЫКИДЫШ\nБеременность прервалась на ${weeks} неделе...`, 'warning');
            }
            setTimeout(() => {
                Object.assign(p, structuredClone(defaultPregnancyData));
                saveSettingsDebounced();
                syncUI();
                updatePromptInjection();
            }, 1000);
            return;
        } else {
            if (s.showNotifications) {
                showNotification(`🏥 Угроза миновала! Требуется покой.`, 'info');
            }
        }
    }
    
    // === ПРЕЖДЕВРЕМЕННЫЕ РОДЫ (3 триместр) — немедленные роды ===
    if (complication.type === 'Преждевременные роды') {
        const sexIcons = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
        const fetusText = p.fetusCount === 1 ? 'Малыш' : p.fetusCount === 2 ? 'Двойня' : 'Тройня';
        const statusText = weeks < 32 ? '⚠️ Недоношенный!' : weeks < 37 ? '⚠️ Ранний, но стабильный.' : '✅ Доношенный!';
        
        if (s.showNotifications) {
            showNotification(`👶 ПРЕЖДЕВРЕМЕННЫЕ РОДЫ (${weeks} нед.)\n${fetusText}: ${sexIcons}\n${statusText}`, 'warning');
        }
        setTimeout(() => {
            Object.assign(p, structuredClone(defaultPregnancyData));
            saveSettingsDebounced();
            syncUI();
            updatePromptInjection();
        }, 1000);
        return;
    }
    
    // === ГЕСТОЗ — 15% шанс экстренного кесарева ===
    if (complication.type === 'Гестоз') {
        const emergencyRoll = roll(100);
        console.log(`[Reproductive] Gestosis emergency roll: ${emergencyRoll} (need >15 to avoid)`);
        
        if (emergencyRoll <= 15) {
            const sexIcons = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
            if (s.showNotifications) {
                showNotification(`🚨 ЭКСТРЕННОЕ КЕСАРЕВО!\nГестоз угрожает жизни.\nМалыш: ${sexIcons}`, 'warning');
            }
            setTimeout(() => {
                Object.assign(p, structuredClone(defaultPregnancyData));
                saveSettingsDebounced();
                syncUI();
                updatePromptInjection();
            }, 1000);
            return;
        } else {
            if (s.showNotifications) {
                showNotification(`🏥 Гестоз под контролем. Постельный режим!`, 'info');
            }
        }
    }
    
    // === НАКОПЛЕНИЕ 3+ WARNING — риск потери ===
    const unresolvedWarnings = (p.complications || []).filter(c => c.severity === 'warning' && !c.resolved).length;
    if (unresolvedWarnings >= 3) {
        const criticalRoll = roll(100);
        console.log(`[Reproductive] Warning accumulation: ${unresolvedWarnings} warnings, roll=${criticalRoll}`);
        
        if (criticalRoll <= 20) {
            p.healthStatus = 'critical';
            
            if (weeks <= 12) {
                if (s.showNotifications) {
                    showNotification(`💔 Осложнения привели к потере беременности...`, 'warning');
                }
                setTimeout(() => {
                    Object.assign(p, structuredClone(defaultPregnancyData));
                    saveSettingsDebounced();
                    syncUI();
                    updatePromptInjection();
                }, 1000);
                return;
            } else {
                if (s.showNotifications) {
                    showNotification(`🚨 КРИТИЧЕСКОЕ СОСТОЯНИЕ!\nСрочно нужна медпомощь!`, 'warning');
                }
            }
            saveSettingsDebounced();
            syncUI();
        }
    }
}

function getComplicationTypes(weeks) {
    if (weeks <= 12) {
        return [
            { type: 'Токсикоз', severity: 'warning', description: 'Сильная тошнота, рвота до 5 раз в день' },
            { type: 'Угроза выкидыша', severity: 'critical', description: 'Тянущие боли внизу живота, кровянистые выделения' },
            { type: 'Анемия', severity: 'warning', description: 'Низкий гемоглобин, слабость, головокружение' }
        ];
    } else if (weeks <= 27) {
        return [
            { type: 'Предлежание плаценты', severity: 'critical', description: 'Плацента перекрывает выход из матки' },
            { type: 'Гестационный диабет', severity: 'warning', description: 'Повышенный сахар в крови, требуется диета' },
            { type: 'Отёки', severity: 'warning', description: 'Задержка жидкости, опухшие ноги и руки' }
        ];
    } else {
        return [
            { type: 'Гестоз', severity: 'critical', description: 'Высокое давление, белок в моче, сильные отёки' },
            { type: 'Преждевременные роды', severity: 'critical', description: 'Схватки до 37 недель, риск недоношенности' },
            { type: 'Маловодие', severity: 'warning', description: 'Недостаточное количество околоплодных вод' },
            { type: 'Симфизит', severity: 'warning', description: 'Расхождение лонного сочленения, боль при ходьбе' }
        ];
    }
}

function resetPregnancy() {
    const p = getPregnancyData();
    Object.assign(p, structuredClone(defaultPregnancyData));
    saveSettingsDebounced();
    syncUI();
    updatePromptInjection();
}

function visitDoctor() {
    const s = getSettings();
    const p = getPregnancyData();
    
    if (!p.isPregnant) return;
    
    // Проверяем кулдаун (3 RP-дня)
    if (p.lastDoctorVisitRpDate && p.rpDate) {
        const lastVisit = new Date(p.lastDoctorVisitRpDate);
        const currentRpDate = new Date(p.rpDate);
        const daysSinceVisit = Math.floor((currentRpDate - lastVisit) / 86400000);
        
        if (daysSinceVisit < 3) {
            if (s.showNotifications) {
                showNotification(`🏥 Следующий визит через ${3 - daysSinceVisit} RP-дн.`, 'info');
            }
            return;
        }
    }
    
    // Запоминаем дату визита
    p.lastDoctorVisitRpDate = p.rpDate || new Date().toISOString();
    
    // Ищем нерешённые осложнения
    const unresolvedComplications = p.complications.filter(c => !c.resolved);
    
    if (unresolvedComplications.length === 0) {
        if (s.showNotifications) {
            showNotification(`🏥 Врач: Всё в порядке, осложнений нет!`, 'success');
        }
        saveSettingsDebounced();
        return;
    }
    
    // Лечим осложнения
    let healed = 0;
    let failed = 0;
    
    for (const complication of unresolvedComplications) {
        // Шанс лечения зависит от severity
        const healChance = complication.severity === 'critical' ? 50 : 75;
        const healRoll = roll(100);
        
        console.log(`[Reproductive] Doctor treating ${complication.type}: roll=${healRoll}, need<=${healChance}`);
        
        if (healRoll <= healChance) {
            complication.resolved = true;
            healed++;
        } else {
            failed++;
        }
    }
    
    // Пересчитываем healthStatus
    const hasUnresolvedCritical = p.complications.some(c => c.severity === 'critical' && !c.resolved);
    const hasUnresolvedWarning = p.complications.some(c => c.severity === 'warning' && !c.resolved);
    p.healthStatus = hasUnresolvedCritical ? 'critical' : hasUnresolvedWarning ? 'warning' : 'normal';
    
    saveSettingsDebounced();
    syncUI();
    
    // Уведомление
    if (s.showNotifications) {
        if (healed > 0 && failed === 0) {
            showNotification(`🏥 Врач помог!\n✅ Вылечено: ${healed} осложнений`, 'success');
        } else if (healed > 0 && failed > 0) {
            showNotification(`🏥 Частичный успех\n✅ Вылечено: ${healed}\n⚠️ Требует наблюдения: ${failed}`, 'info');
        } else {
            showNotification(`🏥 Лечение не помогло\n⚠️ Требуется повторный визит`, 'warning');
        }
    }
}

function onMessageReceived() {
    const s = getSettings();
    if (!s.isEnabled) return;

    const chat = typeof SillyTavern?.getContext === 'function' 
        ? SillyTavern.getContext().chat 
        : window.chat;

    if (!chat || chat.length === 0) return;

    const lastMessage = chat[chat.length - 1];
    if (!lastMessage || lastMessage.is_user) return;

    const text = lastMessage.mes;
    
    // Уникальный ID сообщения для защиты от повторной обработки
    const messageId = lastMessage.mes_id || lastMessage.send_date || chat.length;

    console.log('[Reproductive] Checking message...');

    // ВАЖНО: Запоминаем состояние беременности ДО parseAIStatus
    const p = getPregnancyData();
    const wasPregnant = p.isPregnant;

    parseAIStatus(text);

    // === ПРОВЕРКА ТЕГА РОДОВ ===
    const hasBirthTag = text.includes('[BIRTH]') || 
                        (text.includes('<!--') && text.includes('BIRTH'));
    
    if (hasBirthTag && p.isPregnant && p.pregnancyWeeks >= 36) {
        console.log('[Reproductive] Birth tag detected! Delivering baby...');
        
        if (s.showNotifications) {
            const sexIcons = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
            const fetusText = p.fetusCount === 1 ? 'Малыш' : p.fetusCount === 2 ? 'Двойня' : 'Тройня';
            showNotification(`🎉 РОДЫ! ${fetusText}: ${sexIcons}\nПоздравляем!`, 'success');
        }
        
        Object.assign(p, structuredClone(defaultPregnancyData));
        saveSettingsDebounced();
        syncUI();
        updatePromptInjection();
        return;
    }

    // === ПРОВЕРКА ТЕГА ЗАЧАТИЯ ===
    const hasConceptionTag = text.includes('[CONCEPTION_CHECK]') || 
                             text.includes('[CONCEPTIONCHECK]') ||
                             (text.includes('<!--') && text.includes('CONCEPTION_CHECK'));

    if (hasConceptionTag) {
        // Если БЫЛА беременна до parseAIStatus - игнорируем тег!
        if (wasPregnant) {
            console.log('[Reproductive] Tag found but was pregnant before parsing - ignoring');
            return;
        }
        
        // Если сейчас беременна - тоже игнорируем
        if (p.isPregnant) {
            console.log('[Reproductive] Tag found but already pregnant - ignoring');
            return;
        }
        
        // Защита от повторной обработки одного сообщения
        if (s.lastCheckedMessageId === messageId) {
            console.log('[Reproductive] Message already processed - ignoring');
            return;
        }

        console.log('[Reproductive] Tag detected! Rolling conception check...');

        const cycleDayMatch = text.match(/\[CYCLE_DAY:(\d+)\]/);
        if (cycleDayMatch) {
            const aiCycleDay = parseInt(cycleDayMatch[1]);
            if (aiCycleDay >= 1 && aiCycleDay <= 28) {
                s.cycleDay = aiCycleDay;
                s.lastCycleUpdate = Date.now();
            }
        }

        const result = checkConception();
        if (result) {
            injectConceptionResult(result);
        }
        
        // Запоминаем что обработали это сообщение
        s.lastCheckedMessageId = messageId;
        saveSettingsDebounced();
        syncUI();
    }
}

function getBasePrompt() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!s.isEnabled) return '';

    const day = s.cycleDay;
    let phase = '';
    if (day <= 5) phase = '🔴 Менструация';
    else if (day <= 11) phase = 'Фолликулярная';
    else if (day <= 16) phase = '🔥 Овуляция';
    else phase = 'Лютеиновая';

    const contraEmoji = 
        s.contraception === 'condom' ? '🛡️ Презерватив' :
        s.contraception === 'pill' ? '💊 Таблетки' :
        s.contraception === 'iud' ? '🩹 ВМС' : '❌ Нет защиты';

    let prompt = `[OOC: 🩺 РЕПРОДУКТИВНАЯ СИСТЕМА — ACTIVE\n`;
    prompt += `⚠️ В статус-блок {{user}} ОБЯЗАТЕЛЬНО добавь:\n`;
    prompt += `🩸 Цикл: День ${day} | ${phase} | ${contraEmoji}\n\n`;
    prompt += `📅 ЦИКЛ: 1-5 менструация, 6-11 фолликулярная, 12-16 овуляция (высокое либидо!), 17-28 лютеиновая.\n`;

    if (s.contraception === 'condom') {
        prompt += `🛡️ ПРЕЗЕРВАТИВ: {{char}} достаёт/надевает при сексе. Может порваться (~15%).\n`;
    }

    // Если уже беременна - НЕ добавляем инструкцию про тег!
    if (p.isPregnant) {
        prompt += `🤰 {{user}} уже БЕРЕМЕННА — тег [CONCEPTION_CHECK] ЗАПРЕЩЁН!]`;
        return prompt;
    }

    // Только если НЕ беременна - инструкции про зачатие
    prompt += `\n⛔ ВАЖНО — тег [CONCEPTION_CHECK]:\n`;
    prompt += `ДОБАВЛЯЙ тег ТОЛЬКО если в ЭТОМ сообщении ЯВНО произошло ВСЁ:\n`;
    prompt += `1) Вагинальный секс (пенис во влагалище)\n`;
    prompt += `2) Эякуляция ВНУТРЬ (сперма попала в вагину)\n`;
    prompt += `3) БЕЗ контрацепции или она ПОДВЕЛА\n\n`;
    prompt += `❌ НЕ ДОБАВЛЯЙ тег если:\n`;
    prompt += `- Секса НЕ было\n`;
    prompt += `- Был оральный/анальный секс\n`;
    prompt += `- Эякуляция снаружи/на тело\n`;
    prompt += `- Прерванный акт\n`;
    prompt += `- Контрацепция сработала\n`;
    prompt += `- Просто романтика/флирт/поцелуи\n\n`;
    prompt += `Формат (в самом конце, скрыто): <!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->]`;

    return prompt;
}

function getPregnancyPrompt() {
    const s = getSettings();
    const p = getPregnancyData();
    
    if (!p.isPregnant) return '';

    let weeks = p.pregnancyWeeks || 0;
    if (weeks === 0 && p.conceptionDate) {
        const diffTime = Math.abs(new Date() - new Date(p.conceptionDate));
        weeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
    }

    let symptoms = '';
    let recommendations = '';
    
    if (weeks <= 4) {
        const early = ['задержка менструации', 'лёгкая тошнота по утрам', 'повышенная усталость', 'перепады настроения', 'обострение обоняния', 'покалывание в груди', 'сонливость днём', 'лёгкие спазмы внизу живота'];
        symptoms = getSeededRandomSymptoms(early, 3, weeks);
        recommendations = 'Фолиевая кислота 400 мкг/день, тест на ХГЧ, избегать алкоголя/курения';
    } else if (weeks <= 8) {
        const firstTrim = ['токсикоз (рвота 2-5 раз в день)', 'чувствительность груди', 'частое мочеиспускание', 'металлический привкус во рту', 'отвращение к запахам', 'головокружение', 'запоры', 'эмоциональная нестабильность'];
        symptoms = getSeededRandomSymptoms(firstTrim, 4, weeks);
        recommendations = 'Встать на учёт до 12 недель, первый скрининг УЗИ, дробное питание';
    } else if (weeks <= 12) {
        const earlySecond = ['живот начинает округляться', 'токсикоз ослабевает', 'эмоциональные перепады', 'пигментация кожи', 'венозная сетка на груди', 'повышенный аппетит', 'одышка при подъёме'];
        symptoms = getSeededRandomSymptoms(earlySecond, 4, weeks);
        recommendations = 'Контроль веса (+0.3-0.5 кг/неделю), кальций, избегать горячих ванн';
    } else if (weeks <= 16) {
        const midSecond = ['первые шевеления плода', 'либидо возрастает', 'энергия возвращается', 'грудь увеличивается', 'волосы гуще', 'судороги в икрах', 'заложенность носа'];
        symptoms = getSeededRandomSymptoms(midSecond, 4, weeks);
        recommendations = 'Второй скрининг определит пол, массаж от растяжек, витамин D3';
    } else if (weeks <= 20) {
        const lateSecond = ['живот заметно увеличен', 'учащённое сердцебиение', 'растяжки', 'молозиво из сосков', 'судороги в ногах', 'изжога', 'потемнение ареол'];
        symptoms = getSeededRandomSymptoms(lateSecond, 5, weeks);
        recommendations = 'Бандаж для живота, железосодержащие продукты, крем от растяжек';
    } else if (weeks <= 27) {
        const thirdStart = ['тяжесть в животе', 'отёки ног к вечеру', 'боли в пояснице', 'одышка при ходьбе', 'изжога', 'бессонница', 'активные толчки плода', 'варикоз'];
        symptoms = getSeededRandomSymptoms(thirdStart, 5, weeks);
        recommendations = 'Сон на левом боку, компрессионные чулки, КТГ';
    } else if (weeks <= 36) {
        const lateThird = ['сильная усталость', 'частые походы в туалет', 'тренировочные схватки', 'тяжело дышать', 'отёки', 'бессонница', 'боли в тазу', 'утиная походка'];
        symptoms = getSeededRandomSymptoms(lateThird, 6, weeks);
        recommendations = 'Сбор сумки в роддом, упражнения Кегеля, КТГ еженедельно';
    } else if (weeks <= 40) {
        const preBirth = ['живот опустился', 'отхождение пробки', 'схватки каждые 10-15 минут', 'подтекание вод', 'диарея', 'тянущие боли', 'синдром гнездования'];
        symptoms = getSeededRandomSymptoms(preBirth, 5, weeks);
        recommendations = 'НЕ УХОДИТЬ ДАЛЕКО! Телефон роддома под рукой';
    } else {
        symptoms = '⚠️ ПЕРЕНАШИВАНИЕ (>40 недель)! Риск гипоксии плода';
        recommendations = '⚠️ СРОЧНО К ВРАЧУ! Возможна стимуляция';
    }

    let conceptionDateStr = p.conceptionDate ? new Date(p.conceptionDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    
    let dueDateStr = '—';
    if (p.conceptionDate) {
        const dueDate = calculateDueDate(p.conceptionDate);
        if (dueDate) {
            dueDateStr = dueDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        }
    }

    let sexText = '';
    if (p.fetusSex && p.fetusSex.length > 0) {
        sexText = p.fetusSex.map(sex => sex === 'M' ? 'мальчик ♂️' : 'девочка ♀️').join(', ');
    }

    const fetusText = p.fetusCount === 1 ? 'одним плодом' : p.fetusCount === 2 ? 'двойней' : 'тройней';

    let prompt = `

[OOC: 🤰 БЕРЕМЕННОСТЬ — АКТИВНА]
━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Срок: ${weeks} недель из 40
👶 Беременна ${fetusText}
${sexText ? `⚤ Пол: ${sexText}` : ''}
📆 Зачатие: ${conceptionDateStr}
🗓️ ПДР: ${dueDateStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━

💊 СИМПТОМЫ (${weeks} нед.): ${symptoms}

✓ РЕКОМЕНДАЦИИ: ${recommendations}
`;

    // Инструкция про роды только на позднем сроке
    if (weeks >= 36) {
        prompt += `
👶 РОДЫ: Срок ${weeks} нед. — роды возможны в любой момент!
Если в сообщении {{user}} РОЖАЕТ (начались схватки, отошли воды, ребёнок появился на свет), добавь в конце:
<!-- [BIRTH] -->
❌ НЕ добавляй если: просто разговор о родах, "ещё не родился", подготовка к родам.
`;
    }

    return prompt;
}

function updatePromptInjection() {
    try {
        const s = getSettings();

        setExtensionPrompt(extensionName, '', extension_prompt_types.IN_CHAT, 0);

        if (!s.isEnabled) return;

        updateCycleDay();
        checkComplications();

        const fullPrompt = getBasePrompt() + getPregnancyPrompt();

        setTimeout(() => {
            setExtensionPrompt(extensionName, fullPrompt, extension_prompt_types.IN_CHAT, 0);
            console.log('[Reproductive] Prompt injected');
        }, 50);

    } catch (error) {
        console.error('[Reproductive] updatePromptInjection error:', error);
    }
}

function injectConceptionResult(result) {
    const s = getSettings();
    const p = getPregnancyData();

    const getPhase = (day) => {
        if (day <= 5) return '🔴 Менструация';
        if (day <= 11) return 'Фолликулярная';
        if (day <= 16) return '🔥 Овуляция';
        return 'Лютеиновая';
    };

    let codeBlock = '```\n';
    codeBlock += `🤰 ПРОВЕРКА ЗАЧАТИЯ\n━━━━━━━━━━━━━━━━━━━━\n`;
    codeBlock += `📅 День: ${result.cycleDay} (${getPhase(result.cycleDay)})\n`;
    codeBlock += `🎲 Бросок: ${result.roll} | Порог: ${result.chance}\n`;
    if (result.contraceptionFailed) codeBlock += `⚠️ Контрацепция ПОДВЕЛА!\n`;
    codeBlock += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (result.success) {
        const sexes = p.fetusSex.map(sex => sex === 'M' ? '♂️ мальчик' : '♀️ девочка').join(', ');
        const fetusText = p.fetusCount === 1 ? '1 плод' : p.fetusCount === 2 ? 'Двойня!' : 'Тройня!';
        codeBlock += `✅ БЕРЕМЕННОСТЬ!\n👶 ${fetusText}\n⚤ Пол: ${sexes}\n`;
    } else {
        codeBlock += `❌ ЗАЧАТИЯ НЕ ПРОИЗОШЛО\n`;
    }
    codeBlock += '```';

    const oocPrompt = `[OOC: Выведи этот блок В НАЧАЛЕ ответа:\n${codeBlock}]`;

    setExtensionPrompt(extensionName + '-result', oocPrompt, extension_prompt_types.IN_CHAT, 0);
    updatePromptInjection();

    setTimeout(() => {
        setExtensionPrompt(extensionName + '-result', '', extension_prompt_types.IN_CHAT, 0);
    }, 2000);
}

function syncUI() {
    const s = getSettings();
    const p = getPregnancyData();

    const enabled = document.getElementById('repro-enabled');
    const notify = document.getElementById('repro-notify');
    if (enabled) enabled.checked = s.isEnabled;
    if (notify) notify.checked = s.showNotifications;

    const contraSelect = document.getElementById('repro-contraception');
    if (contraSelect) contraSelect.value = s.contraception;

    const cycleInput = document.getElementById('repro-cycleday');
    const currentCycle = document.getElementById('repro-currentcycle');

    if (cycleInput) cycleInput.value = s.cycleDay;

    if (currentCycle) {
        const day = s.cycleDay;
        let phase, emoji;
        if (day <= 5) { phase = 'Менструация'; emoji = '🔴'; }
        else if (day <= 11) { phase = 'Фолликулярная'; emoji = '🌱'; }
        else if (day <= 16) { phase = 'Овуляция'; emoji = '🔥'; }
        else { phase = 'Лютеиновая'; emoji = '🌙'; }
        currentCycle.innerHTML = `${emoji} <strong>${day}</strong>/28 — ${phase}`;
    }

    const status = document.getElementById('repro-status');
    if (status) {
        if (p.isPregnant) {
            status.innerHTML = `<span style="color: #ff9ff3;">🤰 ${L('pregnant')}</span>`;
        } else {
            status.innerHTML = `<span style="opacity: 0.7;">${L('notPregnant')}</span>`;
        }
    }

    const monitorBlock = document.getElementById('repro-pregnancy-monitor');
    const monitorContent = document.getElementById('repro-pregnancy-content');

    if (monitorBlock && monitorContent) {
        if (p.isPregnant && (p.pregnancyWeeks > 0 || p.conceptionDate)) {
            monitorBlock.style.display = 'block';

            let weeks = p.pregnancyWeeks || 0;
            let days = 0;
            if (weeks === 0 && p.conceptionDate) {
                const diffMs = Date.now() - new Date(p.conceptionDate).getTime();
                const diffDays = Math.floor(diffMs / 86400000);
                weeks = Math.floor(diffDays / 7);
                days = diffDays % 7;
            }

            let dueDateStr = '—';
            if (p.conceptionDate) {
                const dueDate = calculateDueDate(p.conceptionDate);
                if (dueDate) {
                    dueDateStr = dueDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                }
            }

            const progressPercent = Math.min(100, Math.round((weeks / 40) * 100));
            const sexIcons = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
            let fetusText = p.fetusCount === 1 ? 'Один плод' : p.fetusCount === 2 ? 'Двойня' : 'Тройня';

            let symptoms = '';
            let recommendations = '';

            if (weeks <= 4) {
                const early = ['задержка менструации', 'лёгкая тошнота', 'усталость', 'перепады настроения', 'обострение обоняния', 'покалывание в груди', 'сонливость'];
                symptoms = getSeededRandomSymptoms(early, 3, weeks);
                recommendations = '✓ Фолиевая кислота, тест на ХГЧ, избегать алкоголя.';
            } else if (weeks <= 8) {
                const firstTrim = ['токсикоз', 'чувствительность груди', 'частое мочеиспускание', 'металлический привкус', 'отвращение к запахам', 'головокружение', 'запоры'];
                symptoms = getSeededRandomSymptoms(firstTrim, 4, weeks);
                recommendations = '✓ Встать на учёт, первое УЗИ, дробное питание.';
            } else if (weeks <= 12) {
                const earlySecond = ['живот округляется', 'токсикоз ослабевает', 'эмоциональные перепады', 'пигментация', 'повышенный аппетит'];
                symptoms = getSeededRandomSymptoms(earlySecond, 4, weeks);
                recommendations = '✓ Контроль веса, кальций, избегать горячих ванн.';
            } else if (weeks <= 16) {
                const midSecond = ['первые шевеления', 'либидо возрастает', 'энергия', 'грудь увеличивается', 'волосы гуще', 'судороги'];
                symptoms = getSeededRandomSymptoms(midSecond, 4, weeks);
                recommendations = '✓ Второй скрининг, массаж от растяжек, витамин D3.';
            } else if (weeks <= 20) {
                const lateSecond = ['живот увеличен', 'сердцебиение', 'растяжки', 'молозиво', 'судороги', 'изжога'];
                symptoms = getSeededRandomSymptoms(lateSecond, 5, weeks);
                recommendations = '✓ Бандаж, железо, крем от растяжек.';
            } else if (weeks <= 27) {
                const thirdStart = ['тяжесть', 'отёки', 'боли в пояснице', 'одышка', 'изжога', 'бессонница', 'толчки плода'];
                symptoms = getSeededRandomSymptoms(thirdStart, 5, weeks);
                recommendations = '✓ Сон на левом боку, компрессионные чулки, КТГ.';
            } else if (weeks <= 36) {
                const lateThird = ['усталость', 'частый туалет', 'тренировочные схватки', 'тяжело дышать', 'отёки', 'боли в тазу'];
                symptoms = getSeededRandomSymptoms(lateThird, 6, weeks);
                recommendations = '✓ Сумка в роддом, упражнения Кегеля, КТГ еженедельно.';
            } else if (weeks <= 40) {
                const preBirth = ['живот опустился', 'пробка', 'схватки', 'подтекание вод', 'тянущие боли', 'гнездование'];
                symptoms = getSeededRandomSymptoms(preBirth, 5, weeks);
                recommendations = '✓ НЕ УХОДИТЬ ДАЛЕКО! Телефон роддома под рукой.';
            } else {
                symptoms = '⚠️ ПЕРЕНАШИВАНИЕ!';
                recommendations = '⚠️ СРОЧНО К ВРАЧУ!';
            }

            let healthIcon = '✅', healthText = 'Норма', healthColor = '#00ff88';
            if (p.healthStatus === 'warning') {
                healthIcon = '⚠️'; healthText = 'Требует внимания'; healthColor = '#ffaa00';
            } else if (p.healthStatus === 'critical') {
                healthIcon = '🚨'; healthText = 'КРИТИЧЕСКОЕ'; healthColor = '#ff4444';
            }

            let riskFactors = [];
            if (p.fetusCount >= 2) riskFactors.push('Многоплодная');
            if (weeks >= 41) riskFactors.push('Перенашивание');
            if (p.complications.length > 2) riskFactors.push('Множественные осложнения');

            const riskHTML = riskFactors.length > 0 
                ? `<div class="pregnancy-info-row"><span class="pregnancy-info-label">⚠️ Риски:</span><span class="pregnancy-info-value" style="color: #ffaa00; font-size: 11px;">${riskFactors.join(', ')}</span></div>`
                : '';

            let complicationsHTML = '';
            const unresolvedCount = p.complications ? p.complications.filter(c => !c.resolved).length : 0;
            
            if (p.complications && p.complications.length > 0) {
                const recent = p.complications.slice(-3).reverse();
                complicationsHTML = `<div class="pregnancy-complications"><div class="pregnancy-complications-title">📋 Осложнения:</div>${recent.map(c => {
                    const col = c.resolved ? '#888' : (c.severity === 'critical' ? '#ff4444' : '#ffaa00');
                    const ico = c.resolved ? '✅' : (c.severity === 'critical' ? '🚨' : '⚠️');
                    const resolvedStyle = c.resolved ? 'text-decoration: line-through; opacity: 0.5;' : '';
                    return `<div class="complication-item" style="${resolvedStyle}"><span style="color: ${col};">${ico}</span> <strong>${c.type}</strong> <span style="opacity: 0.5; font-size: 10px;">(${c.week} нед.)${c.resolved ? ' — вылечено' : ''}</span><div style="font-size: 11px; opacity: 0.7;">${c.description}</div></div>`;
                }).join('')}`;
                
                // Кнопка "К врачу" если есть нерешённые осложнения
                if (unresolvedCount > 0) {
                    complicationsHTML += `<button id="repro-doctor-btn" class="menu_button" style="margin-top: 10px; width: 100%; background: linear-gradient(135deg, #4dabf7 0%, #228be6 100%);">🏥 К врачу (${unresolvedCount} осложн.)</button>`;
                }
                
                complicationsHTML += `</div>`;
            }

            monitorContent.innerHTML = `
                <div class="pregnancy-info-row"><span class="pregnancy-info-label">🩺 Здоровье:</span><span class="pregnancy-info-value" style="color: ${healthColor};">${healthIcon} ${healthText}</span></div>
                <div class="pregnancy-info-row"><span class="pregnancy-info-label">📅 Зачатие:</span><span class="pregnancy-info-value">${p.conceptionDate ? new Date(p.conceptionDate).toLocaleDateString('ru-RU') : '—'}</span></div>
                <div class="pregnancy-info-row"><span class="pregnancy-info-label">🗓️ РП-дата:</span><span class="pregnancy-info-value" style="font-size: 10px; opacity: 0.7;">${p.rpDate ? new Date(p.rpDate).toLocaleDateString('ru-RU') : '—'}</span></div>
                <div class="pregnancy-info-row"><span class="pregnancy-info-label">⏱️ Срок:</span><span class="pregnancy-info-value">${weeks} нед. ${days} дн.</span></div>
                <div class="pregnancy-info-row"><span class="pregnancy-info-label">👶 Плоды:</span><span class="pregnancy-info-value">${fetusText} ${sexIcons}</span></div>
                <div class="pregnancy-info-row"><span class="pregnancy-info-label">🗓️ ПДР:</span><span class="pregnancy-info-value">${dueDateStr}</span></div>
                ${riskHTML}
                <div class="pregnancy-progress-bar"><div class="pregnancy-progress-fill" style="width: ${progressPercent}%"></div></div>
                <div style="text-align: center; font-size: 11px; opacity: 0.7; margin-bottom: 10px;">${progressPercent}% до родов</div>
                <div class="pregnancy-symptoms"><div class="pregnancy-symptoms-title">🩺 Симптомы:</div><div class="pregnancy-symptoms-text">${symptoms}</div></div>
                <div class="pregnancy-recommendations"><div class="pregnancy-recommendations-title">💡 Рекомендации:</div><div class="pregnancy-recommendations-text">${recommendations}</div></div>
                ${complicationsHTML}
            `;
            
            // Привязываем обработчик для кнопки "К врачу"
            setTimeout(() => {
                const doctorBtn = document.getElementById('repro-doctor-btn');
                if (doctorBtn) {
                    doctorBtn.onclick = visitDoctor;
                }
            }, 10);
        } else {
            monitorBlock.style.display = 'none';
        }
    }

    const resetBtn = document.getElementById('repro-reset');
    if (resetBtn) {
        resetBtn.style.display = p.isPregnant ? 'block' : 'none';
    }

    const stats = document.getElementById('repro-stats');
    if (stats) {
        stats.textContent = `${L('stats').replace('{checks}', s.totalChecks).replace('{conceptions}', s.totalConceptions)}`;
    }
}

function setupUI() {
    try {
        const s = getSettings();

        const settingsHtml = `
<div class="reproductive-system-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>${L('title')}</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="flex-container">
                <label class="checkbox_label"><input type="checkbox" id="repro-enabled"><span>${L('enabled')}</span></label>
                <label class="checkbox_label"><input type="checkbox" id="repro-notify"><span>${L('notifications')}</span></label>
            </div>
            <hr>
            <div class="flex-container flexFlowColumn">
                <label><strong>${L('contraceptionTitle')}</strong></label>
                <select id="repro-contraception" class="text_pole">
                    <option value="none">${L('contraceptionTypes.none')}</option>
                    <option value="condom">${L('contraceptionTypes.condom')}</option>
                    <option value="pill">${L('contraceptionTypes.pill')}</option>
                    <option value="iud">${L('contraceptionTypes.iud')}</option>
                </select>
            </div>
            <hr>
            <div class="flex-container flexFlowColumn">
                <label><strong>${L('cycleDay')}</strong></label>
                <div id="repro-currentcycle" style="padding: 5px; background: var(--SmartThemeBlurTintColor); border-radius: 5px;"><span>${s.cycleDay}</span></div>
            </div>
            <div class="flex-container flexFlowColumn" style="margin-top: 10px;">
                <div class="flex-container" style="gap: 5px; align-items: center;">
                    <input type="number" id="repro-cycleday" min="1" max="28" value="${s.cycleDay}" class="text_pole" style="width: 60px;">
                    <button id="repro-setcycle" class="menu_button" style="padding: 5px 10px;">✓</button>
                </div>
            </div>
            <hr>
            <div class="flex-container flexFlowColumn">
                <label><strong>${L('status')}</strong></label>
                <div id="repro-status"><span style="opacity: 0.7;">${L('notPregnant')}</span></div>
            </div>
            <details id="repro-pregnancy-monitor" style="display: none; margin-top: 15px;">
                <summary style="cursor: pointer; font-weight: 600; color: #ff9ff3; padding: 8px; background: rgba(255,159,243,0.1); border-radius: 8px;">🤰 Мониторинг беременности</summary>
                <div id="repro-pregnancy-content" class="pregnancy-glass-panel"></div>
            </details>
            <div id="repro-manual-pregnancy" style="display: none; margin-top: 10px; padding: 10px; background: rgba(255,159,243,0.1); border-radius: 5px;">
                <label style="font-size: 12px; opacity: 0.8;">Ручная установка:</label>
                <div class="flex-container" style="gap: 5px; margin-top: 5px; flex-wrap: wrap;">
                    <select id="repro-manual-count" class="text_pole" style="width: 80px;">
                        <option value="1">1 плод</option>
                        <option value="2">Двойня</option>
                        <option value="3">Тройня</option>
                    </select>
                    <input id="repro-manual-weeks" type="number" class="text_pole" value="1" min="0" max="42" style="width: 60px;">
                    <span style="font-size: 11px; opacity: 0.7; align-self: center;">нед.</span>
                </div>
                <div class="flex-container" style="gap: 5px; margin-top: 8px; flex-wrap: wrap; align-items: center;">
                    <label style="font-size: 11px; opacity: 0.7;">РП-дата:</label>
                    <input id="repro-manual-rpdate" type="date" class="text_pole" style="width: 140px;">
                    <button id="repro-setpregnant" class="menu_button" style="padding: 5px 10px; background: #ff9ff3;">🤰 Установить</button>
                </div>
            </div>
            <button id="repro-toggle-manual" class="menu_button" style="margin-top: 10px; opacity: 0.6; font-size: 11px;">Ручная беременность</button>
            <button id="repro-reset" class="menu_button redWarningBG" style="display: none; margin-top: 10px;">${L('reset')}</button>
            <hr>
            <small id="repro-stats" style="opacity: 0.5;">0 / 0</small>
        </div>
    </div>
</div>
<style>
.reproductive-system-settings .inline-drawer-content { padding: 10px; }
.reproductive-system-settings hr { margin: 10px 0; border-color: var(--SmartThemeBorderColor); opacity: 0.3; }
.reproductive-system-settings select, .reproductive-system-settings input[type="number"] { margin-top: 5px; }
.pregnancy-glass-panel { margin-top: 10px; padding: 15px; background: rgba(255,159,243,0.08); backdrop-filter: blur(15px); border: 1px solid rgba(255,159,243,0.2); border-radius: 12px; box-shadow: 0 8px 32px rgba(255,159,243,0.15); }
.pregnancy-info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,159,243,0.1); }
.pregnancy-info-row:last-child { border-bottom: none; }
.pregnancy-info-label { font-size: 12px; opacity: 0.7; }
.pregnancy-info-value { font-weight: 600; color: #ff9ff3; }
.pregnancy-progress-bar { width: 100%; height: 8px; background: rgba(255,159,243,0.15); border-radius: 10px; overflow: hidden; margin: 10px 0 5px 0; }
.pregnancy-progress-fill { height: 100%; background: linear-gradient(90deg, #ff9ff3 0%, #ffc2d1 100%); transition: width 0.3s; border-radius: 10px; }
.pregnancy-symptoms { margin-top: 10px; padding: 10px; background: rgba(255,159,243,0.05); border-radius: 8px; border-left: 3px solid #ff9ff3; }
.pregnancy-symptoms-title { font-size: 11px; font-weight: 600; color: #ff9ff3; margin-bottom: 5px; }
.pregnancy-symptoms-text { font-size: 11px; line-height: 1.5; opacity: 0.8; }
.pregnancy-recommendations { margin-top: 10px; padding: 10px; background: rgba(0,255,136,0.05); border-radius: 8px; border-left: 3px solid #00ff88; }
.pregnancy-recommendations-title { font-size: 11px; font-weight: 600; color: #00ff88; margin-bottom: 5px; }
.pregnancy-recommendations-text { font-size: 11px; line-height: 1.5; opacity: 0.8; }
.pregnancy-complications { margin-top: 10px; padding: 10px; background: rgba(255,68,68,0.05); border-radius: 8px; border-left: 3px solid #ff4444; }
.pregnancy-complications-title { font-size: 11px; font-weight: 600; color: #ff4444; margin-bottom: 8px; }
.complication-item { padding: 8px; background: rgba(255,68,68,0.05); border-radius: 6px; margin-bottom: 6px; }
.complication-item:last-child { margin-bottom: 0; }
</style>`;

        $('#extensions_settings2').append(settingsHtml);

        $('#repro-enabled').on('change', function() {
            getSettings().isEnabled = this.checked;
            saveSettingsDebounced();
            updatePromptInjection();
        });

        $('#repro-notify').on('change', function() {
            getSettings().showNotifications = this.checked;
            saveSettingsDebounced();
        });

        $('#repro-contraception').on('change', function() {
            getSettings().contraception = this.value;
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });

        $('#repro-setcycle').on('click', function() {
            const input = document.getElementById('repro-cycleday');
            const value = Math.max(1, Math.min(28, parseInt(input.value) || 14));
            input.value = value;
            const s = getSettings();
            s.cycleDay = value;
            s.lastCycleUpdate = Date.now();
            saveSettingsDebounced();
            setTimeout(() => {
                updatePromptInjection();
                syncUI();
                showNotification(`День цикла: ${value}`, 'info');
            }, 100);
        });

        $('#repro-toggle-manual').on('click', function() {
            const manualDiv = $('#repro-manual-pregnancy');
            manualDiv.is(':visible') ? manualDiv.slideUp(200) : manualDiv.slideDown(200);
        });

        $('#repro-setpregnant').on('click', function() {
            const s = getSettings();
            const p = getPregnancyData();
            const count = parseInt($('#repro-manual-count').val());
            const weeks = Math.max(0, Math.min(42, parseInt($('#repro-manual-weeks').val()) || 1));
            const rpDateInput = $('#repro-manual-rpdate').val();

            p.isPregnant = true;
            p.pregnancyWeeks = weeks;
            p.fetusCount = count;
            p.fetusSex = [];

            if (rpDateInput) {
                p.rpDate = new Date(rpDateInput).toISOString();
                const conceptionDate = calculateConceptionDate(new Date(p.rpDate), weeks);
                p.conceptionDate = conceptionDate ? conceptionDate.toISOString() : new Date().toISOString();
            } else {
                p.rpDate = new Date().toISOString();
                p.conceptionDate = new Date().toISOString();
            }

            for (let i = 0; i < count; i++) {
                p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
            }

            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();

            const sexText = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
            const fetusText = count === 1 ? '1 плод' : count === 2 ? 'Двойня' : 'Тройня';
            showNotification(`🤰 Беременность установлена!\n${weeks} нед. | ${fetusText} | Пол: ${sexText}`, 'success');

            $('#repro-manual-pregnancy').slideUp(200);
        });

        $('#repro-reset').on('click', function() {
            if (confirm('Сбросить беременность?')) {
                resetPregnancy();
                showNotification('Беременность сброшена', 'info');
            }
        });

        syncUI();

    } catch (error) {
        console.error('[Reproductive] setupUI error:', error);
    }
}

function loadSettings() {
    try {
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = structuredClone(defaultSettings);
        } else {
            const s = extension_settings[extensionName];

            if (s.isPregnant !== undefined && !s.chatPregnancyData) {
                console.log('[Reproductive] Migrating old pregnancy data to per-chat structure...');
                s.chatPregnancyData = {};

                if (s.isPregnant) {
                    const chatId = getCurrentChatId();
                    if (chatId) {
                        s.chatPregnancyData[chatId] = {
                            isPregnant: s.isPregnant,
                            conceptionDate: s.conceptionDate,
                            pregnancyWeeks: s.pregnancyWeeks,
                            rpDate: s.rpDate,
                            fetusCount: s.fetusCount,
                            fetusSex: s.fetusSex,
                            complications: s.complications || [],
                            healthStatus: s.healthStatus || 'normal',
                            lastComplicationCheck: s.lastComplicationCheck
                        };
                    }
                }

                delete s.isPregnant;
                delete s.conceptionDate;
                delete s.pregnancyWeeks;
                delete s.rpDate;
                delete s.fetusCount;
                delete s.fetusSex;
                delete s.complications;
                delete s.healthStatus;
                delete s.lastComplicationCheck;
            }

            for (const key in defaultSettings) {
                if (s[key] === undefined) {
                    s[key] = defaultSettings[key];
                }
            }
        }
        console.log('[Reproductive] Settings loaded:', extension_settings[extensionName]);
    } catch (error) {
        console.error('[Reproductive] Error loading settings:', error);
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
}

jQuery(async () => {
    try {
        console.log('[Reproductive] System Loading...');

        loadSettings();
        console.log('[Reproductive] Settings OK');

        initCustomNotifications();
        console.log('[Reproductive] Notifications OK');

        setupUI();
        console.log('[Reproductive] UI OK');

        updatePromptInjection();
        console.log('[Reproductive] Initial prompt injection OK');

        eventSource.on(event_types.MESSAGE_SENT, () => {
            console.log('[Reproductive] MESSAGE_SENT - refreshing prompt');
            updatePromptInjection();
        });

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

        if (event_types.CHAT_CHANGED) { 
            eventSource.on(event_types.CHAT_CHANGED, () => {
                console.log('[Reproductive] CHAT_CHANGED - switching to chat-specific data');
                const s = getSettings();
                const chatId = getCurrentChatId();
                console.log('[Reproductive] Current chat ID:', chatId);
                
                // Сбрасываем ID последнего проверенного сообщения при смене чата
                s.lastCheckedMessageId = null;

                syncUI();
                updatePromptInjection();
            }); 
        }

        console.log('[Reproductive] System Ready!');

    } catch (error) {
        console.error('[Reproductive] System FATAL ERROR:', error);
    }
});
