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

// Глобальные настройки (общие для всех чатов)
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
    // Per-chat данные беременности: { chatId: pregnancyData }
    chatPregnancyData: {}
};

// Данные беременности для конкретного чата
const defaultPregnancyData = {
    isPregnant: false,
    conceptionDate: null,
    pregnancyWeeks: 0,
    rpDate: null,
    fetusCount: 1,
    fetusSex: [],
    complications: [],
    healthStatus: 'normal',
    lastComplicationCheck: null
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

// Получение ID текущего чата
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

// Получение данных беременности для текущего чата
function getPregnancyData() {
    const s = getSettings();
    const chatId = getCurrentChatId();
    
    if (!chatId) {
        // Нет активного чата - возвращаем временные данные
        if (!s._tempPregnancyData) {
            s._tempPregnancyData = structuredClone(defaultPregnancyData);
        }
        return s._tempPregnancyData;
    }
    
    // Инициализируем хранилище если нет
    if (!s.chatPregnancyData) {
        s.chatPregnancyData = {};
    }
    
    // Инициализируем данные для этого чата если нет
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

// Парсинг РП-даты с поддержкой множества форматов
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
    
    // Формат: "Дата: Вторник, Февраль 20, 2024" или "Date: Tuesday, February 20, 2024"
    const longFormatMatch = text.match(/(?:[Дд]ата|[Dd]ate)[:\s]+[А-Яа-яA-Za-z]+,?\s*([А-Яа-яA-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/i);
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
            console.log(`[Reproductive] Parsed RP date (long format): ${parsedDate.toISOString()}`);
        }
    }
    
    // Формат DD.MM.YYYY или DD/MM/YYYY
    if (!parsedDate) {
        const shortFormatMatch = text.match(/(?:[Дд]ата|[Dd]ate)[:\s]+(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})/i);
        if (shortFormatMatch) {
            const day = parseInt(shortFormatMatch[1]);
            const month = parseInt(shortFormatMatch[2]) - 1;
            const year = parseInt(shortFormatMatch[3]);
            
            if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
                parsedDate = new Date(year, month, day);
                console.log(`[Reproductive] Parsed RP date (short format DD.MM.YYYY): ${parsedDate.toISOString()}`);
            }
        }
    }
    
    // Формат ISO: 2024-02-20
    if (!parsedDate) {
        const isoFormatMatch = text.match(/(?:[Дд]ата|[Dd]ate)[:\s]+(\d{4})-(\d{2})-(\d{2})/i);
        if (isoFormatMatch) {
            const year = parseInt(isoFormatMatch[1]);
            const month = parseInt(isoFormatMatch[2]) - 1;
            const day = parseInt(isoFormatMatch[3]);
            
            if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
                parsedDate = new Date(year, month, day);
                console.log(`[Reproductive] Parsed RP date (ISO format): ${parsedDate.toISOString()}`);
            }
        }
    }
    
    // Формат: "20 февраля 2024" или "20th February 2024"
    if (!parsedDate) {
        const dateOnlyMatch = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([А-Яа-яA-Za-z]+)\s+(\d{4})/);
        if (dateOnlyMatch) {
            const day = parseInt(dateOnlyMatch[1]);
            const monthStr = dateOnlyMatch[2].toLowerCase();
            const year = parseInt(dateOnlyMatch[3]);
            
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
                console.log(`[Reproductive] Parsed RP date (date only): ${parsedDate.toISOString()}`);
            }
        }
    }
    
    // Формат: "February 20, 2024"
    if (!parsedDate) {
        const monthFirstMatch = text.match(/([А-Яа-яA-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/);
        if (monthFirstMatch) {
            const monthStr = monthFirstMatch[1].toLowerCase();
            const day = parseInt(monthFirstMatch[2]);
            const year = parseInt(monthFirstMatch[3]);
            
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
                console.log(`[Reproductive] Parsed RP date (month first): ${parsedDate.toISOString()}`);
            }
        }
    }
    
    return parsedDate;
}

// Вычисление даты зачатия: РП-дата минус срок в неделях
function calculateConceptionDate(rpDate, weeksPregnant) {
    if (!rpDate || weeksPregnant <= 0) return null;
    const conceptionTime = rpDate.getTime() - (weeksPregnant * 7 * 24 * 60 * 60 * 1000);
    return new Date(conceptionTime);
}

// Правильный расчёт ПДР: дата зачатия + 40 недель
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

    console.log('[Reproductive] Parsing AI status block...');

    // Парсим РП-дату
    const rpDate = parseRpDate(text);
    if (rpDate) {
        const oldRpDate = p.rpDate;
        p.rpDate = rpDate.toISOString();
        if (oldRpDate !== p.rpDate) {
            console.log(`[Reproductive] RP date updated: ${p.rpDate}`);
            updated = true;
        }
    }

    // Парсим день цикла
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

    // Детекция родов
    const birthPatterns = [
        /[Рр]од(?:ы|ила|ился|ились)|[Рр]ождени[еяю]/i,
        /[Pp]ush(?:ing|ed)|[Dd]eliver(?:y|ed|ing)|[Gg]ave\s+birth|[Bb]irth/i,
        /[Мм]алыш\s+родился|[Рр]ебён?ок\s+(?:родился|появился)/i,
        /[Пп]осле\s+родов/i,
        /[Aa]fter\s+(?:the\s+)?birth/i
    ];
    
    for (const pattern of birthPatterns) {
        if (pattern.test(text) && p.isPregnant && p.pregnancyWeeks >= 36) {
            console.log('[Reproductive] Birth detected! Resetting pregnancy...');
            
            if (s.showNotifications) {
                const sexIcons = p.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
                showNotification(`🎉 Роды состоялись! ${p.fetusCount > 1 ? p.fetusCount + ' малышей' : 'Малыш'}: ${sexIcons}`, 'success');
            }
            
            // Сброс беременности после родов
            Object.assign(p, structuredClone(defaultPregnancyData));
            updated = true;
            
            saveSettingsDebounced();
            syncUI();
            updatePromptInjection();
            return updated;
        }
    }

    // Парсим срок беременности
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
    
    // Парсим количество плодов
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
            // Уже беременна - обновляем срок если отличается
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

    // Проверка "не беременна"
    if (/[Нн]е\s+беременна|[Nn]ot\s+pregnant/i.test(text) && p.isPregnant) {
        console.log('[Reproductive] AI says not pregnant. Clearing...');
        Object.assign(p, structuredClone(defaultPregnancyData));
        updated = true;
        if (s.showNotifications) {
            showNotification('🔄 Статус синхронизирован: не беременна', 'info');
        }
    }

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
        p.conceptionDate = new Date().toISOString();
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

    let weeks = p.pregnancyWeeks || 0;
    if (weeks === 0 && p.conceptionDate) {
        const diffMs = Date.now() - new Date(p.conceptionDate).getTime();
        weeks = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
    }

    const now = Date.now();
    if (p.lastComplicationCheck) {
        const daysSinceCheck = Math.floor((now - p.lastComplicationCheck) / 86400000);
        if (daysSinceCheck < 7) return;
    }

    p.lastComplicationCheck = now;

    if (s.showNotifications) {
        showNotification(`🩺 Проверка здоровья (${weeks} нед.)...`, 'info');
    }

    let baseChance = weeks <= 12 ? 15 : weeks <= 27 ? 5 : 12;
    if (p.fetusCount >= 2) baseChance += 10;
    if (p.fetusCount >= 3) baseChance += 15;

    const complicationRoll = roll(100);

    if (complicationRoll <= baseChance) {
        const types = getComplicationTypes(weeks);
        const complication = types[Math.floor(Math.random() * types.length)];

        p.complications.push({
            week: weeks,
            type: complication.type,
            severity: complication.severity,
            description: complication.description,
            date: new Date().toISOString()
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
    } else {
        if (s.showNotifications) {
            showNotification(`✅ Проверка пройдена: всё в норме!`, 'success');
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

    console.log('[Reproductive] Checking message...');

    parseAIStatus(text);

    const hasTag = text.includes('[CONCEPTION_CHECK]') || 
                   text.includes('[CONCEPTIONCHECK]') ||
                   (text.includes('<!--') && text.includes('CONCEPTION_CHECK'));

    if (hasTag) {
        console.log('[Reproductive] Tag detected! Rolling conception check...');

        const cycleDayMatch = text.match(/\[CYCLE_DAY:(\d+)\]/);
        if (cycleDayMatch) {
            const aiCycleDay = parseInt(cycleDayMatch[1]);
            if (aiCycleDay >= 1 && aiCycleDay <= 28) {
                s.cycleDay = aiCycleDay;
                s.lastCycleUpdate = Date.now();
                saveSettingsDebounced();
                syncUI();
            }
        }

        const result = checkConception();
        if (result) {
            injectConceptionResult(result);
        }
    }
}

function getBasePrompt() {
    const s = getSettings();

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
    prompt += `⚠️ В статус-блок {{user}} добавь:\n`;
    prompt += `🩸 Цикл: День ${day} | ${phase} | ${contraEmoji}\n\n`;
    prompt += `📅 ЦИКЛ: 1-5 менструация, 6-11 фолликулярная, 12-16 овуляция (высокое либидо!), 17-28 лютеиновая.\n`;

    if (s.contraception === 'condom') {
        prompt += `🛡️ ПРЕЗЕРВАТИВ: {{char}} достаёт/надевает при сексе. Может порваться (~15%).\n`;
    }

    prompt += `\n🎲 ЗАЧАТИЕ: СТРОГО при вагинальном сексе и эякуляции внутрь`;
    if (s.contraception !== 'none') prompt += ` + контрацепция ПОДВЕЛА`;
    prompt += `, добавь В КОНЦЕ:\n<!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->\n`;
    prompt += `❌ НЕ добавляй при: оральном/анальном, прерванном акте, эякуляции снаружи`;
    if (s.contraception !== 'none') prompt += `, успешной контрацепции`;
    prompt += `.]`;

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
            if (p.complications && p.complications.length > 0) {
                const recent = p.complications.slice(-3).reverse();
                complicationsHTML = `<div class="pregnancy-complications"><div class="pregnancy-complications-title">📋 Осложнения:</div>${recent.map(c => {
                    const col = c.severity === 'critical' ? '#ff4444' : '#ffaa00';
                    const ico = c.severity === 'critical' ? '🚨' : '⚠️';
                    return `<div class="complication-item"><span style="color: ${col};">${ico}</span> <strong>${c.type}</strong> <span style="opacity: 0.5; font-size: 10px;">(${c.week} нед.)</span><div style="font-size: 11px; opacity: 0.7;">${c.description}</div></div>`;
                }).join('')}</div>`;
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
            // Миграция старых настроек в новую структуру
            const s = extension_settings[extensionName];
            
            // Если есть старые данные беременности в корне - мигрируем
            if (s.isPregnant !== undefined && !s.chatPregnancyData) {
                console.log('[Reproductive] Migrating old pregnancy data to per-chat structure...');
                s.chatPregnancyData = {};
                
                // Если была беременность - пытаемся сохранить для текущего чата
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
                
                // Удаляем старые поля из корня
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
            
            // Добавляем недостающие поля
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

        // При смене чата - просто обновляем UI для нового чата (данные хранятся per-chat)
        if (event_types.CHAT_CHANGED) { 
            eventSource.on(event_types.CHAT_CHANGED, () => {
                console.log('[Reproductive] CHAT_CHANGED - switching to chat-specific data');
                const chatId = getCurrentChatId();
                console.log('[Reproductive] Current chat ID:', chatId);
                
                // Просто обновляем UI - данные автоматически подтянутся из chatPregnancyData
                syncUI();
                updatePromptInjection();
            }); 
        }

        console.log('[Reproductive] System Ready!');

    } catch (error) {
        console.error('[Reproductive] System FATAL ERROR:', error);
    }
});
