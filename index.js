import { 
    eventSource, 
    event_types,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
    getContext
} from '../../../../script.js';
import { 
    extension_settings
} from '../../../extensions.js';

const extensionName = "reproductive_system";

// ==================== НАСТРОЙКИ ПО УМОЛЧАНИЮ ====================
const defaultSettings = {
    isEnabled: true,
    showNotifications: true,
    language: 'ru',
    
    // Контрацепция
    contraception: 'none', // none, condom, pill, iud
    
    // Состояние
    isPregnant: false,
    conceptionDate: null,
    fetusCount: 1,
    fetusSex: [],
    
    // Цикл (упрощённый — AI ведёт сам, но мы храним для модификатора шанса)
    cycleDay: 14, // По умолчанию середина — можно менять
    
    // Статистика
    totalChecks: 0,
    totalConceptions: 0
};

// ==================== ШАНСЫ ====================
const CHANCES = {
    // Базовый шанс зачатия
    base: 20,
    
    // Модификатор по дню цикла (множитель)
    cycleModifier: {
        // Дни 1-7: менструация, низкий шанс
        low: 0.25,      // 5%
        // Дни 8-11: фолликулярная, средний
        medium: 0.5,    // 10%
        // Дни 12-16: овуляция, высокий
        high: 1.65,     // 33%
        // Дни 17-28: лютеиновая, низкий
        luteal: 0.25    // 5%
    },
    
    // Эффективность контрацепции (% защиты)
    contraception: {
        none: 0,
        condom: 85,
        pill: 91,
        iud: 99
    },
    
    // Шанс многоплодной
    twins: 3,
    triplets: 0.1
};

// ==================== ЛОКАЛИЗАЦИЯ ====================
const LANG = {
    ru: {
        title: "🩺 Репродуктивная система",
        enabled: "Включить",
        notifications: "Уведомления",
        
        contraceptionTitle: "Контрацепция:",
        contraceptionTypes: {
            none: "❌ Без защиты",
            condom: "🎈 Презерватив (85%)",
            pill: "💊 Таблетки (91%)",
            iud: "🔷 Спираль (99%)"
        },
        
        cycleDay: "День цикла:",
        cycleDays: {
            fertile: "🔴 Фертильные дни (12-16)",
            safe: "🟢 Безопасные дни"
        },
        
        status: "Статус:",
        notPregnant: "Не беременна",
        pregnant: "🤰 Беременна",
        
        conceptionSuccess: "✅ ЗАЧАТИЕ ПРОИЗОШЛО!",
        conceptionFail: "❌ Зачатие не произошло",
        contraceptionFailed: "⚠️ Контрацепция подвела!",
        
        stats: "Проверок: {checks} | Зачатий: {conceptions}",
        
        reset: "Сбросить беременность"
    },
    en: {
        title: "🩺 Reproductive System",
        enabled: "Enable",
        notifications: "Notifications",
        
        contraceptionTitle: "Contraception:",
        contraceptionTypes: {
            none: "❌ None",
            condom: "🎈 Condom (85%)",
            pill: "💊 Pill (91%)",
            iud: "🔷 IUD (99%)"
        },
        
        cycleDay: "Cycle day:",
        cycleDays: {
            fertile: "🔴 Fertile days (12-16)",
            safe: "🟢 Safe days"
        },
        
        status: "Status:",
        notPregnant: "Not pregnant",
        pregnant: "🤰 Pregnant",
        
        conceptionSuccess: "✅ CONCEPTION OCCURRED!",
        conceptionFail: "❌ No conception",
        contraceptionFailed: "⚠️ Contraception failed!",
        
        stats: "Checks: {checks} | Conceptions: {conceptions}",
        
        reset: "Reset pregnancy"
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function getSettings() {
    return extension_settings[extensionName];
}

function L(key) {
    const s = getSettings();
    const lang = s?.language || 'ru';
    const keys = key.split('.');
    let result = LANG[lang];
    for (const k of keys) {
        result = result?.[k];
    }
    return result || key;
}

function roll(max = 100) {
    return Math.floor(Math.random() * max) + 1;
}

function getCycleModifier(day) {
    if (day >= 12 && day <= 16) return CHANCES.cycleModifier.high;
    if (day >= 8 && day <= 11) return CHANCES.cycleModifier.medium;
    if (day >= 17) return CHANCES.cycleModifier.luteal;
    return CHANCES.cycleModifier.low;
}

// ==================== ОСНОВНАЯ ЛОГИКА ====================

function checkConception() {
    const s = getSettings();
    
    if (!s.isEnabled) return null;
    
    if (s.isPregnant) {
        console.log('[Reproductive] Already pregnant, skipping check');
        return null;
    }
    
    s.totalChecks++;
    
    // Базовый шанс с модификатором цикла
    const cycleModifier = getCycleModifier(s.cycleDay);
    let chance = Math.round(CHANCES.base * cycleModifier);
    
    // Контрацепция
    const contraceptionEff = CHANCES.contraception[s.contraception];
    let contraceptionFailed = false;
    
    if (s.contraception !== 'none') {
        const failRoll = roll(100);
        if (failRoll > contraceptionEff) {
            // Контрацепция подвела!
            contraceptionFailed = true;
            if (s.showNotifications) {
                showNotification(L('contraceptionFailed'), 'warning');
            }
        } else {
            // Контрацепция сработала — шанс почти 0
            chance = Math.round(chance * (1 - contraceptionEff / 100));
        }
    }
    
    const conceptionRoll = roll(100);
    const success = conceptionRoll <= chance;
    
    console.log(`[Reproductive] Check: roll=${conceptionRoll}, need≤${chance}, contraception=${s.contraception}, failed=${contraceptionFailed}, result=${success ? 'PREGNANT' : 'no'}`);
    
    const result = {
        roll: conceptionRoll,
        chance: chance,
        contraception: s.contraception,
        contraceptionFailed: contraceptionFailed,
        cycleDay: s.cycleDay,
        success: success
    };
    
    if (success) {
        // Зачатие!
        s.isPregnant = true;
        s.conceptionDate = new Date().toISOString();
        s.totalConceptions++;
        
        // Количество плодов
        const multiplesRoll = roll(1000) / 10;
        if (multiplesRoll <= CHANCES.triplets) {
            s.fetusCount = 3;
        } else if (multiplesRoll <= CHANCES.twins) {
            s.fetusCount = 2;
        } else {
            s.fetusCount = 1;
        }
        
        // Пол определится позже (AI сам)
        s.fetusSex = [];
        
        if (s.showNotifications) {
            showNotification(L('conceptionSuccess'), 'success');
        }
    } else {
        if (s.showNotifications) {
            showNotification(L('conceptionFail'), 'info');
        }
    }
    
    saveSettingsDebounced();
    syncUI();
    
    return result;
}

function resetPregnancy() {
    const s = getSettings();
    s.isPregnant = false;
    s.conceptionDate = null;
    s.fetusCount = 1;
    s.fetusSex = [];
    saveSettingsDebounced();
    syncUI();
    updatePromptInjection();
}

// ==================== ДЕТЕКЦИЯ ТЕГА ====================

function onMessageReceived() {
    const s = getSettings();
    if (!s.isEnabled) return;
    
    const context = getContext();
    const lastMessage = context.chat?.[context.chat.length - 1];
    
    if (!lastMessage || lastMessage.is_user) return;
    
    const text = lastMessage.mes || '';
    
    // Ищем тег проверки зачатия
    if (text.includes('[CONCEPTION_CHECK]') || text.includes('[ПРОВЕРКА_ЗАЧАТИЯ]')) {
        console.log('[Reproductive] Tag detected! Rolling conception check...');
        
        const result = checkConception();
        
        if (result) {
            // Инжектим результат для следующего сообщения
            injectConceptionResult(result);
        }
    }
}

// ==================== ИНЖЕКТЫ ====================

function getBasePrompt() {
    const s = getSettings();
    
    if (!s.isEnabled) return '';
    
    const contraceptionText = {
        'none': 'Контрацепция НЕ используется.',
        'condom': 'Используется презерватив.',
        'pill': 'Принимает противозачаточные таблетки.',
        'iud': 'Установлена внутриматочная спираль.'
    };
    
    let prompt = `[OOC: REPRODUCTIVE SYSTEM ACTIVE
${contraceptionText[s.contraception]}

ВАЖНО: Когда в сцене происходит ВАГИНАЛЬНЫЙ СЕКС с ЭЯКУЛЯЦИЕЙ ВНУТРЬ (незащищённый или с провалом контрацепции), ты ОБЯЗАТЕЛЬНО добавляешь в КОНЦЕ своего ответа тег:
[CONCEPTION_CHECK]

Добавляй тег ТОЛЬКО при вагинальной эякуляции внутрь. НЕ добавляй при: оральном сексе, анальном, мастурбации, прерванном акте, эякуляции снаружи.
]`;
    
    return prompt;
}

function getPregnancyPrompt() {
    const s = getSettings();
    
    if (!s.isPregnant) return '';
    
    let fetusText = s.fetusCount > 1 ? `Многоплодная беременность: ${s.fetusCount} плода.` : '';
    
    let prompt = `

[OOC: 🤰 БЕРЕМЕННОСТЬ АКТИВНА
Дата зачатия: ${s.conceptionDate}
${fetusText}

REALISTIC PREGNANCY SYSTEM — ВСЕ УВЕДОМЛЕНИЯ НА ЯЗЫКЕ ПЕРСОНАЖА

Веди отсчёт беременности автоматически. В НАЧАЛЕ КАЖДОГО ответа показывай статус:
\`\`\`
🤰 СТАТУС БЕРЕМЕННОСТИ
Неделя: [рассчитай от даты зачатия]
Триместр: [1/2/3]
Стадия: [Ранняя/Видимая/Поздняя/Роды]
Симптомы: [текущие симптомы по неделе]
\`\`\`

ПРОВЕРКА ОСЛОЖНЕНИЙ — делай бросок каждый триместр (недели 13, 27, 40):
\`\`\`
⚠️ ПРОВЕРКА ОСЛОЖНЕНИЙ — Триместр [#]
Бросок: [1-100]
1-10: ТЯЖЁЛОЕ ОСЛОЖНЕНИЕ | 11-20: УМЕРЕННОЕ | 21-100: НОРМА
\`\`\`

Возможные осложнения: выкидыш, преждевременные роды, преэклампсия, гестационный диабет, предлежание плаценты, отслойка, кровотечение, и др.

Персонажи НЕ знают о беременности до появления симптомов или теста!
]`;
    
    return prompt;
}

function updatePromptInjection() {
    const s = getSettings();
    
    if (!s.isEnabled) {
        setExtensionPrompt(extensionName, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }
    
    const fullPrompt = getBasePrompt() + getPregnancyPrompt();
    
    setExtensionPrompt(
        extensionName,
        fullPrompt,
        extension_prompt_types.IN_CHAT,
        0
    );
}

function injectConceptionResult(result) {
    let resultText = `
[OOC: 🎲 РЕЗУЛЬТАТ ПРОВЕРКИ ЗАЧАТИЯ
День цикла: ${result.cycleDay}
Контрацепция: ${L('contraceptionTypes.' + result.contraception)}${result.contraceptionFailed ? ' — ПОДВЕЛА!' : ''}
Шанс: ${result.chance}%
Бросок: ${result.roll}
РЕЗУЛЬТАТ: ${result.success ? '✅ ЗАЧАТИЕ ПРОИЗОШЛО!' : '❌ Зачатие не произошло'}
${result.success && getSettings().fetusCount > 1 ? `Плодов: ${getSettings().fetusCount}` : ''}
]`;
    
    // Инжектим результат
    setExtensionPrompt(
        extensionName + '_result',
        resultText,
        extension_prompt_types.IN_CHAT,
        1
    );
    
    // Обновляем основной промпт (добавится инструкция по беременности если зачатие)
    updatePromptInjection();
    
    // Очищаем результат через небольшую задержку
    setTimeout(() => {
        setExtensionPrompt(extensionName + '_result', '', extension_prompt_types.IN_CHAT, 1);
    }, 500);
}

// ==================== UI ====================

function showNotification(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        const options = {
            timeOut: 4000,
            positionClass: 'toast-top-center',
            closeButton: true
        };
        
        switch(type) {
            case 'success': toastr.success(message, '🩺', options); break;
            case 'warning': toastr.warning(message, '🩺', options); break;
            case 'error': toastr.error(message, '🩺', options); break;
            default: toastr.info(message, '🩺', options);
        }
    }
}

function syncUI() {
    const s = getSettings();
    
    // Чекбоксы
    const enabled = document.getElementById('repro_enabled');
    const notify = document.getElementById('repro_notify');
    if (enabled) enabled.checked = s.isEnabled;
    if (notify) notify.checked = s.showNotifications;
    
    // Контрацепция
    const contraSelect = document.getElementById('repro_contraception');
    if (contraSelect) contraSelect.value = s.contraception;
    
    // День цикла
    const cycleSlider = document.getElementById('repro_cycle_day');
    const cycleValue = document.getElementById('repro_cycle_value');
    if (cycleSlider) cycleSlider.value = s.cycleDay;
    if (cycleValue) {
        const isFertile = s.cycleDay >= 12 && s.cycleDay <= 16;
        cycleValue.textContent = `${s.cycleDay} ${isFertile ? '🔴' : '🟢'}`;
    }
    
    // Статус
    const status = document.getElementById('repro_status');
    if (status) {
        if (s.isPregnant) {
            status.innerHTML = `<span style="color: #ff9ff3;">🤰 Беременна</span>`;
        } else {
            status.innerHTML = `<span style="opacity: 0.7;">Не беременна</span>`;
        }
    }
    
    // Кнопка сброса
    const resetBtn = document.getElementById('repro_reset');
    if (resetBtn) {
        resetBtn.style.display = s.isPregnant ? 'block' : 'none';
    }
    
    // Статистика
    const stats = document.getElementById('repro_stats');
    if (stats) {
        stats.textContent = `Проверок: ${s.totalChecks} | Зачатий: ${s.totalConceptions}`;
    }
}

function setupUI() {
    const s = getSettings();
    
    const settingsHtml = `
        <div class="repro_system_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>${L('title')}</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="repro_enabled">
                            <span>${L('enabled')}</span>
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="repro_notify">
                            <span>${L('notifications')}</span>
                        </label>
                    </div>
                    
                    <hr>
                    
                    <!-- Контрацепция -->
                    <div class="flex-container flexFlowColumn">
                        <label><strong>${L('contraceptionTitle')}</strong></label>
                        <select id="repro_contraception" class="text_pole">
                            <option value="none">${L('contraceptionTypes.none')}</option>
                            <option value="condom">${L('contraceptionTypes.condom')}</option>
                            <option value="pill">${L('contraceptionTypes.pill')}</option>
                            <option value="iud">${L('contraceptionTypes.iud')}</option>
                        </select>
                    </div>
                    
                    <hr>
                    
                    <!-- День цикла -->
                    <div class="flex-container flexFlowColumn">
                        <label>
                            <strong>${L('cycleDay')}</strong>
                            <span id="repro_cycle_value">${s.cycleDay}</span>
                        </label>
                        <input type="range" id="repro_cycle_day" min="1" max="28" value="${s.cycleDay}" class="neo-range-slider">
                        <small style="opacity: 0.7;">🔴 12-16 = фертильные дни (высокий шанс)</small>
                    </div>
                    
                    <hr>
                    
                    <!-- Статус -->
                    <div class="flex-container flexFlowColumn">
                        <label><strong>${L('status')}</strong></label>
                        <div id="repro_status">
                            <span style="opacity: 0.7;">${L('notPregnant')}</span>
                        </div>
                    </div>
                    
                    <button id="repro_reset" class="menu_button redWarningBG" style="display: none; margin-top: 10px;">
                        ${L('reset')}
                    </button>
                    
                    <hr>
                    
                    <small id="repro_stats" style="opacity: 0.5;">Проверок: 0 | Зачатий: 0</small>
                    
                </div>
            </div>
        </div>
        
        <style>
            .repro_system_settings .inline-drawer-content {
                padding: 10px;
            }
            .repro_system_settings hr {
                margin: 10px 0;
                border-color: var(--SmartThemeBorderColor);
                opacity: 0.3;
            }
            .repro_system_settings select {
                width: 100%;
                margin-top: 5px;
            }
            .repro_system_settings .neo-range-slider {
                width: 100%;
                margin-top: 5px;
            }
        </style>
    `;
    
    $('#extensions_settings').append(settingsHtml);
    
    // Обработчики
    $('#repro_enabled').on('change', function() {
        getSettings().isEnabled = this.checked;
        saveSettingsDebounced();
        updatePromptInjection();
    });
    
    $('#repro_notify').on('change', function() {
        getSettings().showNotifications = this.checked;
        saveSettingsDebounced();
    });
    
    $('#repro_contraception').on('change', function() {
        const value = this.value;
        console.log('[Reproductive] Contraception changed to:', value);
        getSettings().contraception = value;
        saveSettingsDebounced();
        updatePromptInjection();
        syncUI();
    });
    
    $('#repro_cycle_day').on('input', function() {
        const value = parseInt(this.value);
        getSettings().cycleDay = value;
        const isFertile = value >= 12 && value <= 16;
        document.getElementById('repro_cycle_value').textContent = `${value} ${isFertile ? '🔴' : '🟢'}`;
        saveSettingsDebounced();
    });
    
    $('#repro_reset').on('click', function() {
        if (confirm('Сбросить беременность?')) {
            resetPregnancy();
            showNotification('Беременность сброшена', 'info');
        }
    });
    
    syncUI();
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    
    for (const key in defaultSettings) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
    
    console.log('[Reproductive] Settings loaded:', extension_settings[extensionName]);
}

jQuery(async () => {
    console.log('[Reproductive System] Loading...');
    
    loadSettings();
    setupUI();
    updatePromptInjection();
    
    // Слушаем сообщения от AI
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    
    console.log('[Reproductive System] Ready! AI will trigger [CONCEPTION_CHECK] tag.');
});
