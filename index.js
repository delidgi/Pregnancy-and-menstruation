import { eventSource, event_types, saveSettingsDebounced, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const extensionName = 'reproductive-system';

const defaultSettings = {
    isEnabled: true,
    showNotifications: true,
    language: 'ru',
    contraception: 'none',
    isPregnant: false,
    conceptionDate: null,
    fetusCount: 1,
    fetusSex: [],
    cycleDay: 1,
    lastCycleUpdate: null,
    totalChecks: 0,
    totalConceptions: 0,
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

function parseAIStatus(text) {
    const s = getSettings();
    let updated = false;

    console.log('[Reproductive] Parsing AI status block...');

    const cycleDayMatch = text.match(/День\s+(\d+)|Day\s+(\d+)/i);
    if (cycleDayMatch) {
        const day = parseInt(cycleDayMatch[1] || cycleDayMatch[2]);
        if (day >= 1 && day <= 28 && day !== s.cycleDay) {
            console.log(`[Reproductive] Parsed cycle day: ${s.cycleDay} → ${day}`);
            s.cycleDay = day;
            s.lastCycleUpdate = Date.now();
            updated = true;
        }
    }

    const pregnancyMatch = text.match(/[Бб]еременна[^\n]{0,50}(\d+)\s*недел|[Pp]regnant[^\n]{0,50}(\d+)\s*week/i);
    if (pregnancyMatch) {
        const weeks = parseInt(pregnancyMatch[1] || pregnancyMatch[2]);
        console.log(`[Reproductive] Parsed pregnancy: ${weeks} weeks`);

        if (weeks > 0 && !s.isPregnant) {
            console.log('[Reproductive] AI says pregnant, but extension data is not. Setting pregnant...');
            s.isPregnant = true;

            const conceptionTime = Date.now() - (weeks * 7 * 24 * 60 * 60 * 1000);
            s.conceptionDate = new Date(conceptionTime).toISOString();

            const multiples = text.match(/[Дд]войн|[Тт]ройн|[Tt]wins|[Tt]riplets/i);
            if (multiples) {
                const str = multiples[0].toLowerCase();
                if (str.includes('тройн') || str.includes('triplet')) {
                    s.fetusCount = 3;
                } else if (str.includes('двойн') || str.includes('twin')) {
                    s.fetusCount = 2;
                }
            } else {
                s.fetusCount = 1;
            }

            if (s.fetusSex.length === 0) {
                for (let i = 0; i < s.fetusCount; i++) {
                    s.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
                }
            }

            updated = true;

            if (s.showNotifications) {
                showNotification(`🔄 Синхронизировано: беременность ${weeks} недель`, 'info');
            }
        } else if (weeks > 0 && s.isPregnant && s.conceptionDate) {
            const ourWeeks = Math.floor((Date.now() - new Date(s.conceptionDate).getTime()) / (7 * 24 * 60 * 60 * 1000));
            const diff = Math.abs(weeks - ourWeeks);

            if (diff > 1) {
                console.log(`[Reproductive] Pregnancy week mismatch: ours=${ourWeeks}, AI=${weeks}. Resyncing...`);
                const conceptionTime = Date.now() - (weeks * 7 * 24 * 60 * 60 * 1000);
                s.conceptionDate = new Date(conceptionTime).toISOString();
                updated = true;

                if (s.showNotifications) {
                    showNotification(`🔄 Срок обновлён: ${weeks} недель`, 'info');
                }
            }
        }
    }

    const notPregnantMatch = text.match(/[Нн]е\s+беременна|[Nn]ot\s+pregnant/i);
    if (notPregnantMatch && s.isPregnant) {
        console.log('[Reproductive] AI says not pregnant, but extension thinks she is. Clearing...');
        s.isPregnant = false;
        s.conceptionDate = null;
        s.fetusCount = 1;
        s.fetusSex = [];
        s.complications = [];
        s.healthStatus = 'normal';
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
        console.log('[Reproductive] Cycle timer initialized');
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
    from {
        transform: translateY(-100%);
        opacity: 0;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}

@keyframes slideOut {
    to {
        transform: translateY(-100%);
        opacity: 0;
    }
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

    if (!s.isEnabled) return null;
    if (s.isPregnant) {
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

    console.log(`[Reproductive] Check: roll=${conceptionRoll}, need<=${chance}, contraception=${s.contraception}, failed=${contraceptionFailed}, result=${success ? 'PREGNANT' : 'no'}`);

    const result = {
        roll: conceptionRoll,
        chance: chance,
        contraception: s.contraception,
        contraceptionFailed: contraceptionFailed,
        cycleDay: s.cycleDay,
        success: success
    };

    if (success) {
        s.isPregnant = true;
        s.conceptionDate = new Date().toISOString();
        s.totalConceptions++;

        const multiplesRoll = roll(1000) / 10;
        if (multiplesRoll <= CHANCES.triplets) {
            s.fetusCount = 3;
        } else if (multiplesRoll <= CHANCES.twins) {
            s.fetusCount = 2;
        } else {
            s.fetusCount = 1;
        }

        s.fetusSex = [];
        for (let i = 0; i < s.fetusCount; i++) {
            const sexRoll = roll(2);
            s.fetusSex.push(sexRoll === 1 ? 'M' : 'F');
        }

        if (s.showNotifications) {
            let msg = `✅ PREGNANT! День ${s.cycleDay}, roll ${conceptionRoll}/${chance}`;
            if (s.fetusCount > 1) msg += ` (${s.fetusCount === 2 ? 'двойня' : 'тройня'}!)`;
            showNotification(msg, 'success');
        }
    } else {
        if (s.showNotifications) {
            showNotification(`❌ NO. День ${s.cycleDay}, roll ${conceptionRoll}/${chance}`, 'info');
        }
    }

    saveSettingsDebounced();
    syncUI();

    return result;
}

function checkComplications() {
    const s = getSettings();
    if (!s.isPregnant || !s.conceptionDate) return;

    const now = Date.now();
    const conceptionTime = new Date(s.conceptionDate).getTime();
    const diffMs = now - conceptionTime;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(diffDays / 7);

    if (s.lastComplicationCheck) {
        const lastCheckDiff = now - s.lastComplicationCheck;
        const daysSinceCheck = Math.floor(lastCheckDiff / (1000 * 60 * 60 * 24));
        if (daysSinceCheck < 7) return;
    }

    s.lastComplicationCheck = now;

    let baseChance = 0;
    if (weeks <= 12) baseChance = 15;
    else if (weeks <= 27) baseChance = 5;
    else baseChance = 12;

    if (s.fetusCount >= 2) baseChance += 10;
    if (s.fetusCount >= 3) baseChance += 15;

    const complicationRoll = roll(100);

    if (complicationRoll <= baseChance) {
        const types = getComplicationTypes(weeks);
        const complication = types[Math.floor(Math.random() * types.length)];

        s.complications.push({
            week: weeks,
            type: complication.type,
            severity: complication.severity,
            description: complication.description,
            date: new Date().toISOString()
        });

        if (complication.severity === 'critical') {
            s.healthStatus = 'critical';
        } else if (complication.severity === 'warning' && s.healthStatus === 'normal') {
            s.healthStatus = 'warning';
        }

        saveSettingsDebounced();
        syncUI();

        if (s.showNotifications) {
            const emoji = complication.severity === 'critical' ? '🚨' : '⚠️';
            showNotification(`${emoji} ${complication.type}: ${complication.description}`, 
                           complication.severity === 'critical' ? 'warning' : 'info');
        }

        console.log(`[Reproductive] Complication at week ${weeks}:`, complication);
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
    const s = getSettings();
    s.isPregnant = false;
    s.conceptionDate = null;
    s.fetusCount = 1;
    s.fetusSex = [];
    s.complications = [];
    s.healthStatus = 'normal';
    s.lastComplicationCheck = null;
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
                console.log('[Reproductive] Cycle day from AI:', aiCycleDay);
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

    console.log('[Reproductive] getBasePrompt() called');
    console.log('[Reproductive] Current cycleDay:', s.cycleDay);

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

    prompt += `📅 ЦИКЛ: 1-5 менструация, 6-11 фолликулярная, 12-16 овуляция (высокое либидо!), 17-28 лютеиновая. День 28 → день 1.\n`;

    if (s.contraception === 'condom') {
        prompt += `🛡️ ПРЕЗЕРВАТИВ: {{char}} достаёт/надевает при сексе. Может порваться (~15%).\n`;
    }

    prompt += `\n🎲 ЗАЧАТИЕ: Если вагинальный секс + эякуляция внутрь`;
    if (s.contraception !== 'none') {
        prompt += ` + контрацепция ПОДВЕЛА`;
    }
    prompt += `, добавь В КОНЦЕ как скрытый HTML-комментарий:\n`;
    prompt += `<!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->\n`;
    prompt += `❌ НЕ добавляй при: оральном/анальном, прерванном акте, эякуляции снаружи`;
    if (s.contraception !== 'none') {
        prompt += `, успешной контрацепции`;
    }
    prompt += `.]`;

    console.log('[Reproductive] Generated prompt with day:', day);

    return prompt;
}

function getPregnancyPrompt() {
    const s = getSettings();
    if (!s.isPregnant) return '';

    let fetusText = s.fetusCount === 1 ? 'одним плодом' : 
                    s.fetusCount === 2 ? 'двойней!' :
                    'тройней! (о боже)';

    let prompt = `\n\n[OOC: {{user}} беременна ${fetusText}\n`;
    prompt += `Дата зачатия: ${s.conceptionDate}\n`;
    prompt += `⚠️ ДОБАВЬ В СТАТУС:\n`;
    prompt += `🤰 Беременна: ${fetusText}\n`;
    prompt += `📆 Срок: [X недель]\n`;
    prompt += `\n`;
    prompt += `СИМПТОМЫ ПО НЕДЕЛЯМ:\n`;
    prompt += `1-4 нед: Задержка, тошнота, усталость.\n`;
    prompt += `5-8 нед: Токсикоз, чувствительность груди.\n`;
    prompt += `9-12 нед: Живот округляется.\n`;
    prompt += `13-16 нед: Шевеления, либидо растёт.\n`;
    prompt += `17-20 нед: Живот заметен!\n`;
    prompt += `21-27 нед: Тяжесть, отёки, боли в спине.\n`;
    prompt += `28-36 нед: Усталость, одышка.\n`;
    prompt += `37-40 нед: Готовность к родам.\n`;
    prompt += `41+ нед: Перенашивание!]`;

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

        console.log('[Reproductive] Injecting prompt, length:', fullPrompt.length);
        console.log('[Reproductive] Day in prompt:', s.cycleDay);

        setTimeout(() => {
            setExtensionPrompt(
                extensionName,
                fullPrompt,
                extension_prompt_types.IN_CHAT,
                0
            );
            console.log('[Reproductive] Prompt injected');
        }, 50);

    } catch (error) {
        console.error('[Reproductive] updatePromptInjection error:', error);
    }
}

function injectConceptionResult(result) {
    const s = getSettings();

    const getPhase = (day) => {
        if (day <= 5) return '🔴 Менструация';
        if (day <= 11) return 'Фолликулярная';
        if (day <= 16) return '🔥 Овуляция';
        return 'Лютеиновая';
    };

    let codeBlock = '```\n';
    codeBlock += `🤰 ПРОВЕРКА ЗАЧАТИЯ (День ${result.cycleDay} — ${getPhase(result.cycleDay)})\n`;
    codeBlock += `🎲 Roll: ${result.roll} | Порог: ${result.chance}\n`;

    if (result.contraceptionFailed) {
        codeBlock += `⚠️ Контрацепция ПОДВЕЛА!\n`;
    }

    if (result.success) {
        codeBlock += `✅ PREGNANT\n`;
        codeBlock += `- Embryos: ${s.fetusCount}\n`;
        const sexes = s.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
        if (sexes) codeBlock += `- Sex: ${sexes}\n`;
    } else {
        codeBlock += `❌ NO CONCEPTION\n`;
    }

    codeBlock += '```';

    const oocPrompt = `[OOC: ОБЯЗАТЕЛЬНО выведи этот блок В НАЧАЛЕ своего ответа, БЕЗ изменений:\n${codeBlock}]`;

    setExtensionPrompt(
        extensionName + '-result',
        oocPrompt,
        extension_prompt_types.IN_CHAT,
        0
    );

    updatePromptInjection();

    setTimeout(() => {
        setExtensionPrompt(extensionName + '-result', '', extension_prompt_types.IN_CHAT, 0);
    }, 2000);
}

function syncUI() {
    const s = getSettings();

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

        if (day <= 5) {
            phase = 'Менструация';
            emoji = '🔴';
        } else if (day <= 11) {
            phase = 'Фолликулярная';
            emoji = '🌱';
        } else if (day <= 16) {
            phase = 'Овуляция';
            emoji = '🔥';
        } else {
            phase = 'Лютеиновая';
            emoji = '🌙';
        }

        currentCycle.innerHTML = `${emoji} <strong>${day}</strong>/28 — ${phase}`;
    }

    const status = document.getElementById('repro-status');
    if (status) {
        if (s.isPregnant) {
            status.innerHTML = `<span style="color: #ff9ff3;">🤰 ${L('pregnant')}</span>`;
        } else {
            status.innerHTML = `<span style="opacity: 0.7;">${L('notPregnant')}</span>`;
        }
    }

    const monitorBlock = document.getElementById('repro-pregnancy-monitor');
    const monitorContent = document.getElementById('repro-pregnancy-content');

    if (monitorBlock && monitorContent) {
        if (s.isPregnant && s.conceptionDate) {
            monitorBlock.style.display = 'block';

            const conceptionTime = new Date(s.conceptionDate).getTime();
            const now = Date.now();
            const diffMs = now - conceptionTime;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const weeks = Math.floor(diffDays / 7);
            const days = diffDays % 7;

            const dueDate = new Date(conceptionTime + (280 * 24 * 60 * 60 * 1000));
            const dueDateStr = dueDate.toLocaleDateString('ru-RU', { 
                day: 'numeric', 
                month: 'long', 
                year: 'numeric' 
            });

            const progressPercent = Math.min(100, Math.round((weeks / 40) * 100));

            const sexIcons = s.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');

            let fetusText = s.fetusCount === 1 ? 'Один плод' :
                           s.fetusCount === 2 ? 'Двойня' : 'Тройня';

            let symptoms = '';
            if (weeks <= 4) {
                symptoms = 'Задержка менструации, лёгкая тошнота по утрам, повышенная усталость.';
            } else if (weeks <= 8) {
                symptoms = 'Токсикоз, чувствительность и набухание груди, частое мочеиспускание.';
            } else if (weeks <= 12) {
                symptoms = 'Живот начинает округляться, токсикоз ослабевает, эмоциональные перепады.';
            } else if (weeks <= 16) {
                symptoms = 'Первые шевеления плода! Либидо может возрасти, энергия возвращается.';
            } else if (weeks <= 20) {
                symptoms = 'Живот заметно увеличен, учащённое сердцебиение, округление лица.';
            } else if (weeks <= 27) {
                symptoms = 'Тяжесть в животе, отёки ног, боли в пояснице, одышка при ходьбе.';
            } else if (weeks <= 36) {
                symptoms = 'Сильная усталость, частые походы в туалет, тренировочные схватки (Брэкстона-Хикса).';
            } else if (weeks <= 40) {
                symptoms = 'Живот опустился, готовность к родам. Возможны предвестники: отхождение пробки, схватки.';
            } else {
                symptoms = '⚠️ ПЕРЕНАШИВАНИЕ! Необходим контроль врача, возможна стимуляция родов.';
            }

            let recommendations = '';
            if (weeks <= 12) {
                recommendations = '✓ Приём фолиевой кислоты, избегать стрессов, встать на учёт в ЖК.';
            } else if (weeks <= 27) {
                recommendations = '✓ Регулярные прогулки, контроль веса, скрининг 2 триместра.';
            } else {
                recommendations = '✓ Подготовка к родам, сбор сумки в роддом, КТГ плода еженедельно.';
            }

            let healthIcon = '✅';
            let healthText = 'Норма';
            let healthColor = '#00ff88';

            if (s.healthStatus === 'warning') {
                healthIcon = '⚠️';
                healthText = 'Требует внимания';
                healthColor = '#ffaa00';
            } else if (s.healthStatus === 'critical') {
                healthIcon = '🚨';
                healthText = 'КРИТИЧЕСКОЕ';
                healthColor = '#ff4444';
            }

            let riskFactors = [];
            if (s.fetusCount >= 2) riskFactors.push('Многоплодная беременность');
            if (weeks >= 41) riskFactors.push('Перенашивание');
            if (s.complications.length > 2) riskFactors.push('Множественные осложнения');

            const riskHTML = riskFactors.length > 0 
                ? `<div class="pregnancy-info-row">
                       <span class="pregnancy-info-label">⚠️ Факторы риска:</span>
                       <span class="pregnancy-info-value" style="color: #ffaa00; font-size: 11px;">
                           ${riskFactors.join(', ')}
                       </span>
                   </div>`
                : '';

            let complicationsHTML = '';
            if (s.complications && s.complications.length > 0) {
                const recentComplications = s.complications.slice(-3).reverse();
                complicationsHTML = `
                    <div class="pregnancy-complications">
                        <div class="pregnancy-complications-title">📋 История осложнений:</div>
                        ${recentComplications.map(comp => {
                            const severityColor = comp.severity === 'critical' ? '#ff4444' : '#ffaa00';
                            const severityIcon = comp.severity === 'critical' ? '🚨' : '⚠️';
                            return `
                                <div class="complication-item">
                                    <div style="display: flex; align-items: center; gap: 5px;">
                                        <span style="color: ${severityColor};">${severityIcon}</span>
                                        <strong>${comp.type}</strong>
                                        <span style="opacity: 0.5; font-size: 10px;">(${comp.week} нед.)</span>
                                    </div>
                                    <div style="font-size: 11px; opacity: 0.7; margin-top: 3px;">
                                        ${comp.description}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }

            monitorContent.innerHTML = `
                <div class="pregnancy-info-row">
                    <span class="pregnancy-info-label">🩺 Здоровье:</span>
                    <span class="pregnancy-info-value" style="color: ${healthColor};">
                        ${healthIcon} ${healthText}
                    </span>
                </div>

                <div class="pregnancy-info-row">
                    <span class="pregnancy-info-label">📅 Дата зачатия:</span>
                    <span class="pregnancy-info-value">${new Date(s.conceptionDate).toLocaleDateString('ru-RU')}</span>
                </div>

                <div class="pregnancy-info-row">
                    <span class="pregnancy-info-label">⏱️ Срок:</span>
                    <span class="pregnancy-info-value">${weeks} нед. ${days} дн.</span>
                </div>

                <div class="pregnancy-info-row">
                    <span class="pregnancy-info-label">👶 Плоды:</span>
                    <span class="pregnancy-info-value">${fetusText} ${sexIcons}</span>
                </div>

                <div class="pregnancy-info-row">
                    <span class="pregnancy-info-label">🗓️ ПДР:</span>
                    <span class="pregnancy-info-value">${dueDateStr}</span>
                </div>

                ${riskHTML}

                <div class="pregnancy-progress-bar">
                    <div class="pregnancy-progress-fill" style="width: ${progressPercent}%"></div>
                </div>
                <div style="text-align: center; font-size: 11px; opacity: 0.7; margin-bottom: 10px;">
                    ${progressPercent}% до родов
                </div>

                <div class="pregnancy-symptoms">
                    <div class="pregnancy-symptoms-title">🩺 Текущие симптомы (${weeks} нед.):</div>
                    <div class="pregnancy-symptoms-text">${symptoms}</div>
                </div>

                <div class="pregnancy-recommendations">
                    <div class="pregnancy-recommendations-title">💡 Рекомендации:</div>
                    <div class="pregnancy-recommendations-text">${recommendations}</div>
                </div>

                ${complicationsHTML}
            `;
        } else {
            monitorBlock.style.display = 'none';
        }
    }

    const resetBtn = document.getElementById('repro-reset');
    if (resetBtn) {
        resetBtn.style.display = s.isPregnant ? 'block' : 'none';
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
                <label class="checkbox_label">
                    <input type="checkbox" id="repro-enabled">
                    <span>${L('enabled')}</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="repro-notify">
                    <span>${L('notifications')}</span>
                </label>
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
                <div id="repro-currentcycle" style="padding: 5px; background: var(--SmartThemeBlurTintColor); border-radius: 5px;">
                    <span>${s.cycleDay}</span>
                </div>
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
                <div id="repro-status">
                    <span style="opacity: 0.7;">${L('notPregnant')}</span>
                </div>
            </div>

            <details id="repro-pregnancy-monitor" style="display: none; margin-top: 15px;">
                <summary style="cursor: pointer; font-weight: 600; color: #ff9ff3; padding: 8px; background: rgba(255,159,243,0.1); border-radius: 8px; user-select: none;">
                    🤰 Мониторинг беременности
                </summary>
                <div id="repro-pregnancy-content" class="pregnancy-glass-panel">
                </div>
            </details>

            <div id="repro-manual-pregnancy" style="display: none; margin-top: 10px; padding: 10px; background: rgba(255,159,243,0.1); border-radius: 5px;">
                <label style="font-size: 12px; opacity: 0.8;">Ручная установка:</label>
                <div class="flex-container" style="gap: 5px; margin-top: 5px;">
                    <select id="repro-manual-count" class="text_pole" style="width: 80px;">
                        <option value="1">1 плод</option>
                        <option value="2">Двойня</option>
                        <option value="3">Тройня</option>
                    </select>
                    <button id="repro-setpregnant" class="menu_button" style="padding: 5px 10px; background: #ff9ff3;">🤰 Установить</button>
                </div>
            </div>

            <button id="repro-toggle-manual" class="menu_button" style="margin-top: 10px; opacity: 0.6; font-size: 11px;">
                Ручная беременность
            </button>

            <button id="repro-reset" class="menu_button redWarningBG" style="display: none; margin-top: 10px;">
                ${L('reset')}
            </button>

            <hr>
            <small id="repro-stats" style="opacity: 0.5;">0 / 0</small>
        </div>
    </div>
</div>

<style>
.reproductive-system-settings .inline-drawer-content {
    padding: 10px;
}
.reproductive-system-settings hr {
    margin: 10px 0;
    border-color: var(--SmartThemeBorderColor);
    opacity: 0.3;
}
.reproductive-system-settings select,
.reproductive-system-settings input[type="number"] {
    margin-top: 5px;
}

.pregnancy-glass-panel {
    margin-top: 10px;
    padding: 15px;
    background: rgba(255, 159, 243, 0.08);
    backdrop-filter: blur(15px);
    -webkit-backdrop-filter: blur(15px);
    border: 1px solid rgba(255, 159, 243, 0.2);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(255, 159, 243, 0.15);
}

.pregnancy-info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 159, 243, 0.1);
}

.pregnancy-info-row:last-child {
    border-bottom: none;
}

.pregnancy-info-label {
    font-size: 12px;
    opacity: 0.7;
}

.pregnancy-info-value {
    font-weight: 600;
    color: #ff9ff3;
}

.pregnancy-progress-bar {
    width: 100%;
    height: 8px;
    background: rgba(255, 159, 243, 0.15);
    border-radius: 10px;
    overflow: hidden;
    margin: 10px 0 5px 0;
}

.pregnancy-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #ff9ff3 0%, #ffc2d1 100%);
    transition: width 0.3s ease;
    border-radius: 10px;
}

.pregnancy-symptoms {
    margin-top: 10px;
    padding: 10px;
    background: rgba(255, 159, 243, 0.05);
    border-radius: 8px;
    border-left: 3px solid #ff9ff3;
}

.pregnancy-symptoms-title {
    font-size: 11px;
    font-weight: 600;
    color: #ff9ff3;
    margin-bottom: 5px;
}

.pregnancy-symptoms-text {
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.8;
}

.pregnancy-recommendations {
    margin-top: 10px;
    padding: 10px;
    background: rgba(0, 255, 136, 0.05);
    border-radius: 8px;
    border-left: 3px solid #00ff88;
}

.pregnancy-recommendations-title {
    font-size: 11px;
    font-weight: 600;
    color: #00ff88;
    margin-bottom: 5px;
}

.pregnancy-recommendations-text {
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.8;
}

.pregnancy-complications {
    margin-top: 10px;
    padding: 10px;
    background: rgba(255, 68, 68, 0.05);
    border-radius: 8px;
    border-left: 3px solid #ff4444;
}

.pregnancy-complications-title {
    font-size: 11px;
    font-weight: 600;
    color: #ff4444;
    margin-bottom: 8px;
}

.complication-item {
    padding: 8px;
    background: rgba(255, 68, 68, 0.05);
    border-radius: 6px;
    margin-bottom: 6px;
}

.complication-item:last-child {
    margin-bottom: 0;
}
</style>
`;

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
            const value = this.value;
            console.log('[Reproductive] Contraception changed to:', value);
            getSettings().contraception = value;
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });

        $('#repro-setcycle').on('click', function() {
            const input = document.getElementById('repro-cycleday');
            const value = parseInt(input.value) || 14;
            const clamped = Math.max(1, Math.min(28, value));
            input.value = clamped;

            const s = getSettings();
            s.cycleDay = clamped;
            s.lastCycleUpdate = Date.now();

            console.log('[Reproductive] Cycle day set to:', clamped);

            saveSettingsDebounced();

            setTimeout(() => {
                updatePromptInjection();
                syncUI();
                showNotification(`День цикла: ${clamped}`, 'info');
            }, 100);
        });

        $('#repro-toggle-manual').on('click', function() {
            const manualDiv = $('#repro-manual-pregnancy');
            if (manualDiv.is(':visible')) {
                manualDiv.slideUp(200);
            } else {
                manualDiv.slideDown(200);
            }
        });

        $('#repro-setpregnant').on('click', function() {
            const s = getSettings();
            const count = parseInt($('#repro-manual-count').val());

            s.isPregnant = true;
            s.conceptionDate = new Date().toISOString();
            s.fetusCount = count;
            s.fetusSex = [];

            for (let i = 0; i < count; i++) {
                const sexRoll = roll(2);
                s.fetusSex.push(sexRoll === 1 ? 'M' : 'F');
            }

            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();

            const sexText = s.fetusSex.map(sex => sex === 'M' ? '♂️' : '♀️').join(' ');
            showNotification(`🤰 Беременность установлена! Плодов: ${count}, пол: ${sexText}`, 'success');

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
            for (const key in defaultSettings) {
                if (extension_settings[extensionName][key] === undefined) {
                    extension_settings[extensionName][key] = defaultSettings[key];
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
                console.log('[Reproductive] CHAT_CHANGED - refreshing prompt');
                updatePromptInjection();
                syncUI();
            });
        }

        console.log('[Reproductive] System Ready! Auto-parsing enabled.');

    } catch (error) {
        console.error('[Reproductive] System FATAL ERROR:', error);
    }
});
