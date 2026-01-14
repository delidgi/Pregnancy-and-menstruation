import { 
    eventSource, 
    event_types,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types
} from '../../../../script.js';
import { 
    extension_settings
} from '../../../extensions.js';

const extensionName = "reproductive_system";

// ==================== НАСТРОЙКИ ПО УМОЛЧАНИЮ ====================
const defaultSettings = {
    isEnabled: true,
    showNotifications: true,
    injectToChat: true,
    language: 'ru', // ru / en
    
    // Цикл
    cycleDay: 1,
    cycleLength: 28,
    ovulationDay: 14,
    
    // Контрацепция
    contraception: 'none', // none, condom, pill, iud
    
    // Беременность
    isPregnant: false,
    conceptionDay: 0,
    pregnancyDay: 0,
    fetusCount: 1,
    fetusSex: [], // ['male'], ['female'], ['male', 'female']
    complications: [],
    
    // Счётчик дней
    currentDay: 1,
    
    // История событий
    eventLog: []
};

// ==================== ШАНСЫ И МОДИФИКАТОРЫ ====================
const CHANCES = {
    // Базовые шансы зачатия по фазе цикла (%)
    conception: {
        ovulation: 33,      // День овуляции (пик)
        fertile: 20,        // Фертильное окно (±3 дня от овуляции)
        luteal: 5,          // Лютеиновая фаза
        menstrual: 2,       // Менструация
        safe: 3             // "Безопасные" дни
    },
    
    // Эффективность контрацепции (снижение шанса в %)
    contraception: {
        none: 0,
        condom: 85,         // 85% эффективность (15% шанс провала)
        pill: 91,           // 91% эффективность
        iud: 99             // 99% эффективность
    },
    
    // Шансы осложнений по триместрам (%)
    complications: {
        trimester1: {
            miscarriage: 15,        // Выкидыш
            ectopic: 2,             // Внематочная
            molar: 0.5,             // Пузырный занос
            bleeding: 10,           // Кровотечение
            hyperemesis: 3          // Сильный токсикоз
        },
        trimester2: {
            miscarriage: 3,
            preterm_risk: 5,        // Риск преждевременных
            gestational_diabetes: 6,
            preeclampsia_early: 2,
            cervical_insufficiency: 1,
            placenta_previa: 0.5
        },
        trimester3: {
            preterm_labor: 10,      // Преждевременные роды
            preeclampsia: 5,        // Преэклампсия
            placental_abruption: 1, // Отслойка плаценты
            stillbirth: 0.5,        // Мертворождение
            cord_issues: 2,         // Проблемы с пуповиной
            breech: 4               // Тазовое предлежание
        },
        labor: {
            prolonged: 8,           // Затяжные роды
            emergency_csection: 5,  // Экстренное кесарево
            hemorrhage: 3,          // Кровотечение
            cord_prolapse: 0.5,     // Выпадение пуповины
            shoulder_dystocia: 1,   // Дистоция плечиков
            uterine_rupture: 0.1    // Разрыв матки
        }
    },
    
    // Шанс многоплодной беременности
    multiples: {
        twins: 3,
        triplets: 0.1
    }
};

// ==================== ЛОКАЛИЗАЦИЯ ====================
const LANG = {
    ru: {
        title: "🩺 Репродуктивная система",
        enabled: "Включить систему",
        notifications: "Показывать уведомления",
        injectChat: "Инжект в чат",
        
        // Цикл
        cycleTitle: "🩸 Менструальный цикл",
        cycleDay: "День цикла",
        cycleLength: "Длина цикла",
        ovulationDay: "День овуляции",
        phase: "Фаза",
        
        phases: {
            menstrual: "Менструация",
            follicular: "Фолликулярная",
            ovulation: "Овуляция",
            luteal: "Лютеиновая"
        },
        
        // Контрацепция
        contraceptionTitle: "🛡️ Контрацепция",
        contraceptionTypes: {
            none: "Без защиты",
            condom: "Презерватив",
            pill: "Таблетки (КОК)",
            iud: "Спираль (ВМС)"
        },
        
        // Кнопки
        checkConception: "🎲 Проверить зачатие",
        advanceDay: "⏭️ +1 день",
        advanceWeek: "⏭️ +7 дней",
        checkComplications: "⚠️ Проверить осложнения",
        labor: "👶 Начать роды",
        reset: "🔄 Сбросить всё",
        
        // Беременность
        pregnancyTitle: "🤰 Беременность",
        notPregnant: "Не беременна",
        pregnant: "Беременна",
        week: "Неделя",
        trimester: "Триместр",
        fetusCount: "Плодов",
        fetusSex: "Пол",
        sexMale: "♂ Мальчик",
        sexFemale: "♀ Девочка",
        sexUnknown: "Неизвестен (до 12 нед)",
        
        // Стадии
        stages: {
            implantation: "Имплантация",
            embryo: "Эмбрион",
            fetus_early: "Ранний плод",
            fetus_mid: "Плод (шевеления)",
            fetus_late: "Поздний плод",
            term: "Доношенный",
            overdue: "Переношенный"
        },
        
        // Уведомления
        conceptionSuccess: "✅ ЗАЧАТИЕ ПРОИЗОШЛО!",
        conceptionFail: "❌ Зачатие не произошло",
        contraceptionFail: "⚠️ Контрацепция подвела!",
        complicationDetected: "🚨 ОСЛОЖНЕНИЕ:",
        laborStarted: "👶 РОДЫ НАЧАЛИСЬ!",
        
        // Осложнения
        complications: {
            miscarriage: "Выкидыш",
            ectopic: "Внематочная беременность",
            molar: "Пузырный занос",
            bleeding: "Кровотечение",
            hyperemesis: "Тяжёлый токсикоз",
            preterm_risk: "Угроза преждевременных родов",
            gestational_diabetes: "Гестационный диабет",
            preeclampsia_early: "Ранняя преэклампсия",
            preeclampsia: "Преэклампсия",
            cervical_insufficiency: "Истмико-цервикальная недостаточность",
            placenta_previa: "Предлежание плаценты",
            preterm_labor: "Преждевременные роды",
            placental_abruption: "Отслойка плаценты",
            stillbirth: "Мертворождение",
            cord_issues: "Обвитие пуповиной",
            breech: "Тазовое предлежание",
            prolonged: "Затяжные роды",
            emergency_csection: "Экстренное кесарево сечение",
            hemorrhage: "Послеродовое кровотечение",
            cord_prolapse: "Выпадение пуповины",
            shoulder_dystocia: "Дистоция плечиков",
            uterine_rupture: "Разрыв матки"
        },
        
        // Симптомы по неделям
        symptoms: {
            week4: "Задержка менструации",
            week6: "Тошнота, усталость, чувствительность груди",
            week8: "Токсикоз, частое мочеиспускание",
            week12: "Токсикоз отступает, живот начинает расти",
            week16: "Первые шевеления (повторнородящие)",
            week20: "Отчётливые шевеления, виден пол на УЗИ",
            week24: "Живот заметен, боли в спине",
            week28: "Отёки, одышка, частые шевеления",
            week32: "Тренировочные схватки, усталость",
            week36: "Опущение живота, давление на таз",
            week40: "Срок родов, предвестники"
        }
    },
    en: {
        title: "🩺 Reproductive System",
        enabled: "Enable system",
        notifications: "Show notifications",
        injectChat: "Inject to chat",
        
        cycleTitle: "🩸 Menstrual Cycle",
        cycleDay: "Cycle day",
        cycleLength: "Cycle length",
        ovulationDay: "Ovulation day",
        phase: "Phase",
        
        phases: {
            menstrual: "Menstrual",
            follicular: "Follicular",
            ovulation: "Ovulation",
            luteal: "Luteal"
        },
        
        contraceptionTitle: "🛡️ Contraception",
        contraceptionTypes: {
            none: "None",
            condom: "Condom",
            pill: "Birth control pill",
            iud: "IUD"
        },
        
        checkConception: "🎲 Check conception",
        advanceDay: "⏭️ +1 day",
        advanceWeek: "⏭️ +7 days",
        checkComplications: "⚠️ Check complications",
        labor: "👶 Start labor",
        reset: "🔄 Reset all",
        
        pregnancyTitle: "🤰 Pregnancy",
        notPregnant: "Not pregnant",
        pregnant: "Pregnant",
        week: "Week",
        trimester: "Trimester",
        fetusCount: "Fetuses",
        fetusSex: "Sex",
        sexMale: "♂ Boy",
        sexFemale: "♀ Girl",
        sexUnknown: "Unknown (before 12w)",
        
        stages: {
            implantation: "Implantation",
            embryo: "Embryo",
            fetus_early: "Early fetus",
            fetus_mid: "Fetus (movement)",
            fetus_late: "Late fetus",
            term: "Full term",
            overdue: "Overdue"
        },
        
        conceptionSuccess: "✅ CONCEPTION OCCURRED!",
        conceptionFail: "❌ No conception",
        contraceptionFail: "⚠️ Contraception failed!",
        complicationDetected: "🚨 COMPLICATION:",
        laborStarted: "👶 LABOR STARTED!",
        
        complications: {
            miscarriage: "Miscarriage",
            ectopic: "Ectopic pregnancy",
            molar: "Molar pregnancy",
            bleeding: "Bleeding",
            hyperemesis: "Severe morning sickness",
            preterm_risk: "Preterm labor risk",
            gestational_diabetes: "Gestational diabetes",
            preeclampsia_early: "Early preeclampsia",
            preeclampsia: "Preeclampsia",
            cervical_insufficiency: "Cervical insufficiency",
            placenta_previa: "Placenta previa",
            preterm_labor: "Preterm labor",
            placental_abruption: "Placental abruption",
            stillbirth: "Stillbirth",
            cord_issues: "Cord entanglement",
            breech: "Breech presentation",
            prolonged: "Prolonged labor",
            emergency_csection: "Emergency C-section",
            hemorrhage: "Postpartum hemorrhage",
            cord_prolapse: "Cord prolapse",
            shoulder_dystocia: "Shoulder dystocia",
            uterine_rupture: "Uterine rupture"
        },
        
        symptoms: {
            week4: "Missed period",
            week6: "Nausea, fatigue, breast tenderness",
            week8: "Morning sickness, frequent urination",
            week12: "Nausea subsiding, belly starting to show",
            week16: "First movements (experienced mothers)",
            week20: "Clear movements, sex visible on ultrasound",
            week24: "Visible belly, back pain",
            week28: "Swelling, shortness of breath, frequent movements",
            week32: "Braxton Hicks, fatigue",
            week36: "Baby dropping, pelvic pressure",
            week40: "Due date, labor signs"
        }
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function getSettings() {
    return extension_settings[extensionName];
}

function L(key) {
    const s = getSettings();
    const lang = s.language || 'ru';
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

function rollChance(percent) {
    return roll(100) <= percent;
}

// ==================== ЛОГИКА ЦИКЛА ====================

function getCyclePhase() {
    const s = getSettings();
    const day = s.cycleDay;
    const ovDay = s.ovulationDay;
    
    if (day <= 5) return 'menstrual';
    if (day >= ovDay - 1 && day <= ovDay + 1) return 'ovulation';
    if (day < ovDay) return 'follicular';
    return 'luteal';
}

function getFertilityWindow() {
    const s = getSettings();
    const ovDay = s.ovulationDay;
    return {
        start: ovDay - 5,
        peak: ovDay,
        end: ovDay + 1
    };
}

function isInFertileWindow() {
    const s = getSettings();
    const day = s.cycleDay;
    const window = getFertilityWindow();
    return day >= window.start && day <= window.end;
}

function getBaseConceptionChance() {
    const phase = getCyclePhase();
    if (phase === 'ovulation') return CHANCES.conception.ovulation;
    if (isInFertileWindow()) return CHANCES.conception.fertile;
    if (phase === 'luteal') return CHANCES.conception.luteal;
    if (phase === 'menstrual') return CHANCES.conception.menstrual;
    return CHANCES.conception.safe;
}

function advanceCycle(days = 1) {
    const s = getSettings();
    
    for (let i = 0; i < days; i++) {
        s.cycleDay++;
        s.currentDay++;
        
        // Сброс цикла
        if (s.cycleDay > s.cycleLength) {
            s.cycleDay = 1;
        }
        
        // Продвижение беременности
        if (s.isPregnant) {
            s.pregnancyDay++;
        }
    }
    
    saveSettingsDebounced();
    syncUI();
    injectStatusToChat();
}

// ==================== ЛОГИКА ЗАЧАТИЯ ====================

function checkConception() {
    const s = getSettings();
    
    if (s.isPregnant) {
        showNotification("⚠️ Уже беременна!", "warning");
        return null;
    }
    
    const baseChance = getBaseConceptionChance();
    const contraceptionEff = CHANCES.contraception[s.contraception];
    
    // Проверка провала контрацепции
    let contraceptionFailed = false;
    let finalChance = baseChance;
    
    if (s.contraception !== 'none') {
        const failRoll = roll(100);
        if (failRoll > contraceptionEff) {
            // Контрацепция подвела!
            contraceptionFailed = true;
            showNotification(L('contraceptionFail'), "warning");
        } else {
            // Контрацепция сработала
            finalChance = Math.round(baseChance * (1 - contraceptionEff / 100));
        }
    }
    
    const conceptionRoll = roll(100);
    const success = conceptionRoll <= finalChance;
    
    const result = {
        phase: getCyclePhase(),
        cycleDay: s.cycleDay,
        baseChance,
        contraception: s.contraception,
        contraceptionFailed,
        finalChance,
        roll: conceptionRoll,
        success
    };
    
    if (success) {
        // Зачатие произошло!
        s.isPregnant = true;
        s.conceptionDay = s.currentDay;
        s.pregnancyDay = 0;
        s.complications = [];
        
        // Определяем количество плодов
        const multiplesRoll = roll(100);
        if (multiplesRoll <= CHANCES.multiples.triplets) {
            s.fetusCount = 3;
        } else if (multiplesRoll <= CHANCES.multiples.twins) {
            s.fetusCount = 2;
        } else {
            s.fetusCount = 1;
        }
        
        // Пол определим позже (после 12 недель)
        s.fetusSex = [];
        
        showNotification(L('conceptionSuccess'), "success");
        logEvent('conception', result);
    } else {
        showNotification(L('conceptionFail'), "info");
    }
    
    saveSettingsDebounced();
    syncUI();
    injectStatusToChat();
    
    return result;
}

// ==================== ЛОГИКА БЕРЕМЕННОСТИ ====================

function getPregnancyWeek() {
    const s = getSettings();
    // +2 недели т.к. отсчёт от последней менструации
    return Math.floor(s.pregnancyDay / 7) + 2;
}

function getTrimester() {
    const week = getPregnancyWeek();
    if (week <= 12) return 1;
    if (week <= 27) return 2;
    return 3;
}

function getPregnancyStage() {
    const week = getPregnancyWeek();
    if (week <= 4) return 'implantation';
    if (week <= 8) return 'embryo';
    if (week <= 12) return 'fetus_early';
    if (week <= 20) return 'fetus_mid';
    if (week <= 36) return 'fetus_late';
    if (week <= 42) return 'term';
    return 'overdue';
}

function getSymptoms() {
    const week = getPregnancyWeek();
    const s = getSettings();
    const lang = s.language || 'ru';
    
    if (week < 4) return "";
    if (week < 6) return LANG[lang].symptoms.week4;
    if (week < 8) return LANG[lang].symptoms.week6;
    if (week < 12) return LANG[lang].symptoms.week8;
    if (week < 16) return LANG[lang].symptoms.week12;
    if (week < 20) return LANG[lang].symptoms.week16;
    if (week < 24) return LANG[lang].symptoms.week20;
    if (week < 28) return LANG[lang].symptoms.week24;
    if (week < 32) return LANG[lang].symptoms.week28;
    if (week < 36) return LANG[lang].symptoms.week32;
    if (week < 40) return LANG[lang].symptoms.week36;
    return LANG[lang].symptoms.week40;
}

function determineSex() {
    const s = getSettings();
    if (s.fetusSex.length === 0 && getPregnancyWeek() >= 12) {
        s.fetusSex = [];
        for (let i = 0; i < s.fetusCount; i++) {
            s.fetusSex.push(rollChance(50) ? 'male' : 'female');
        }
        saveSettingsDebounced();
    }
    return s.fetusSex;
}

// ==================== ЛОГИКА ОСЛОЖНЕНИЙ ====================

function checkComplications() {
    const s = getSettings();
    if (!s.isPregnant) return null;
    
    const trimester = getTrimester();
    const week = getPregnancyWeek();
    let complicationPool;
    
    if (week >= 40) {
        complicationPool = CHANCES.complications.labor;
    } else if (trimester === 1) {
        complicationPool = CHANCES.complications.trimester1;
    } else if (trimester === 2) {
        complicationPool = CHANCES.complications.trimester2;
    } else {
        complicationPool = CHANCES.complications.trimester3;
    }
    
    const results = [];
    
    for (const [complication, chance] of Object.entries(complicationPool)) {
        const complicationRoll = roll(1000) / 10; // Точность 0.1%
        if (complicationRoll <= chance) {
            results.push({
                type: complication,
                chance,
                roll: complicationRoll,
                week,
                trimester
            });
            
            s.complications.push({
                type: complication,
                detectedWeek: week,
                detectedDay: s.currentDay
            });
            
            showNotification(`${L('complicationDetected')} ${L('complications.' + complication)}`, "error");
            
            // Критические осложнения прерывают беременность
            if (['miscarriage', 'ectopic', 'molar', 'stillbirth', 'uterine_rupture'].includes(complication)) {
                endPregnancy(complication);
                break;
            }
        }
    }
    
    if (results.length === 0) {
        showNotification("✅ Осложнений не выявлено", "success");
    }
    
    saveSettingsDebounced();
    syncUI();
    injectStatusToChat();
    logEvent('complication_check', results);
    
    return results;
}

function endPregnancy(reason) {
    const s = getSettings();
    s.isPregnant = false;
    
    logEvent('pregnancy_end', {
        reason,
        week: getPregnancyWeek(),
        day: s.pregnancyDay
    });
    
    // Сброс данных беременности
    s.pregnancyDay = 0;
    s.fetusCount = 1;
    s.fetusSex = [];
    
    saveSettingsDebounced();
    syncUI();
}

function startLabor() {
    const s = getSettings();
    if (!s.isPregnant) return null;
    
    const week = getPregnancyWeek();
    if (week < 24) {
        showNotification("⚠️ Слишком ранний срок для родов", "warning");
        return null;
    }
    
    showNotification(L('laborStarted'), "success");
    
    // Проверяем осложнения родов
    const laborComplications = checkComplications();
    
    const result = {
        week,
        fetusCount: s.fetusCount,
        fetusSex: s.fetusSex,
        complications: laborComplications,
        preterm: week < 37,
        outcome: determineLaborOutcome(week, laborComplications)
    };
    
    logEvent('labor', result);
    endPregnancy('birth');
    
    return result;
}

function determineLaborOutcome(week, complications) {
    const hasSerious = complications?.some(c => 
        ['emergency_csection', 'hemorrhage', 'cord_prolapse', 'shoulder_dystocia', 'uterine_rupture'].includes(c.type)
    );
    
    if (week < 28) return 'critical';
    if (week < 32) return hasSerious ? 'critical' : 'serious';
    if (week < 37) return hasSerious ? 'serious' : 'preterm';
    return hasSerious ? 'complicated' : 'normal';
}

// ==================== ЛОГИРОВАНИЕ ====================

function logEvent(type, data) {
    const s = getSettings();
    s.eventLog.push({
        type,
        data,
        day: s.currentDay,
        timestamp: Date.now()
    });
    
    // Ограничиваем размер лога
    if (s.eventLog.length > 100) {
        s.eventLog = s.eventLog.slice(-100);
    }
    
    saveSettingsDebounced();
}

// ==================== UI ====================

function showNotification(message, type = "info") {
    const s = getSettings();
    if (!s.showNotifications) return;
    
    if (typeof toastr !== 'undefined') {
        const options = {
            timeOut: 5000,
            positionClass: 'toast-top-center',
            closeButton: true
        };
        
        switch(type) {
            case 'success': toastr.success(message, '', options); break;
            case 'warning': toastr.warning(message, '', options); break;
            case 'error': toastr.error(message, '', options); break;
            default: toastr.info(message, '', options);
        }
    } else {
        console.log(`[Reproductive System] ${type}: ${message}`);
    }
}

function syncUI() {
    const s = getSettings();
    
    // Основные чекбоксы
    const enabled = document.getElementById('repro_enabled');
    const notify = document.getElementById('repro_notify');
    const inject = document.getElementById('repro_inject');
    
    if (enabled) enabled.checked = s.isEnabled;
    if (notify) notify.checked = s.showNotifications;
    if (inject) inject.checked = s.injectToChat;
    
    // Цикл
    const cycleDay = document.getElementById('repro_cycle_day');
    const cyclePhase = document.getElementById('repro_cycle_phase');
    
    if (cycleDay) cycleDay.textContent = `${s.cycleDay}/${s.cycleLength}`;
    if (cyclePhase) cyclePhase.textContent = L('phases.' + getCyclePhase());
    
    // Контрацепция
    const contraSelect = document.getElementById('repro_contraception');
    if (contraSelect) contraSelect.value = s.contraception;
    
    // Статус беременности
    const pregStatus = document.getElementById('repro_pregnancy_status');
    if (pregStatus) {
        if (s.isPregnant) {
            const week = getPregnancyWeek();
            const trimester = getTrimester();
            const stage = getPregnancyStage();
            determineSex();
            
            let sexText = s.fetusSex.length > 0 
                ? s.fetusSex.map(sex => sex === 'male' ? L('sexMale') : L('sexFemale')).join(', ')
                : L('sexUnknown');
            
            pregStatus.innerHTML = `
                <div class="repro-pregnant-info">
                    <div><strong>${L('week')}:</strong> ${week}</div>
                    <div><strong>${L('trimester')}:</strong> ${trimester}</div>
                    <div><strong>Стадия:</strong> ${L('stages.' + stage)}</div>
                    <div><strong>${L('fetusCount')}:</strong> ${s.fetusCount}</div>
                    <div><strong>${L('fetusSex')}:</strong> ${sexText}</div>
                    <div class="repro-symptoms"><em>${getSymptoms()}</em></div>
                    ${s.complications.length > 0 ? `
                        <div class="repro-complications">
                            <strong>⚠️ Осложнения:</strong>
                            ${s.complications.map(c => L('complications.' + c.type)).join(', ')}
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            pregStatus.innerHTML = `<em>${L('notPregnant')}</em>`;
        }
    }
    
    // Текущий день
    const dayCounter = document.getElementById('repro_day_counter');
    if (dayCounter) dayCounter.textContent = s.currentDay;
}

function setupUI() {
    const settingsHtml = `
        <div class="repro_system_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>${L('title')}</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    
                    <!-- Основные настройки -->
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="repro_enabled">
                            <span>${L('enabled')}</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="repro_notify">
                            <span>${L('notifications')}</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="repro_inject">
                            <span>${L('injectChat')}</span>
                        </label>
                    </div>
                    
                    <hr>
                    
                    <!-- Счётчик дней -->
                    <div class="flex-container flexFlowColumn">
                        <label><strong>📅 Игровой день:</strong> <span id="repro_day_counter">1</span></label>
                        <div class="flex-container">
                            <button id="repro_advance_day" class="menu_button">${L('advanceDay')}</button>
                            <button id="repro_advance_week" class="menu_button">${L('advanceWeek')}</button>
                        </div>
                    </div>
                    
                    <hr>
                    
                    <!-- Цикл -->
                    <div class="flex-container flexFlowColumn">
                        <label><strong>${L('cycleTitle')}</strong></label>
                        <div>${L('cycleDay')}: <span id="repro_cycle_day">1/28</span></div>
                        <div>${L('phase')}: <span id="repro_cycle_phase">-</span></div>
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
                    
                    <!-- Кнопка зачатия -->
                    <div class="flex-container">
                        <button id="repro_check_conception" class="menu_button menu_button_icon">
                            ${L('checkConception')}
                        </button>
                    </div>
                    
                    <hr>
                    
                    <!-- Статус беременности -->
                    <div class="flex-container flexFlowColumn">
                        <label><strong>${L('pregnancyTitle')}</strong></label>
                        <div id="repro_pregnancy_status">
                            <em>${L('notPregnant')}</em>
                        </div>
                    </div>
                    
                    <!-- Кнопки беременности -->
                    <div class="flex-container" id="repro_pregnancy_buttons" style="display: none;">
                        <button id="repro_check_complications" class="menu_button">
                            ${L('checkComplications')}
                        </button>
                        <button id="repro_labor" class="menu_button">
                            ${L('labor')}
                        </button>
                    </div>
                    
                    <hr>
                    
                    <!-- Сброс -->
                    <div class="flex-container">
                        <button id="repro_reset" class="menu_button redWarningBG">
                            ${L('reset')}
                        </button>
                    </div>
                    
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
            }
            .repro_system_settings .menu_button {
                margin: 2px;
            }
            .repro-pregnant-info {
                background: var(--SmartThemeBlurTintColor);
                padding: 10px;
                border-radius: 5px;
                margin-top: 5px;
            }
            .repro-pregnant-info div {
                margin: 3px 0;
            }
            .repro-symptoms {
                color: var(--SmartThemeQuoteColor);
                margin-top: 8px !important;
            }
            .repro-complications {
                color: #ff6b6b;
                margin-top: 8px !important;
            }
        </style>
    `;
    
    $('#extensions_settings').append(settingsHtml);
    
    // Обработчики
    $('#repro_enabled').on('change', function() {
        getSettings().isEnabled = this.checked;
        saveSettingsDebounced();
    });
    
    $('#repro_notify').on('change', function() {
        getSettings().showNotifications = this.checked;
        saveSettingsDebounced();
    });
    
    $('#repro_inject').on('change', function() {
        getSettings().injectToChat = this.checked;
        saveSettingsDebounced();
        injectStatusToChat();
    });
    
    $('#repro_contraception').on('change', function() {
        getSettings().contraception = this.value;
        saveSettingsDebounced();
    });
    
    $('#repro_advance_day').on('click', () => advanceCycle(1));
    $('#repro_advance_week').on('click', () => advanceCycle(7));
    
    $('#repro_check_conception').on('click', () => {
        const result = checkConception();
        if (result) {
            injectConceptionResult(result);
        }
    });
    
    $('#repro_check_complications').on('click', () => {
        checkComplications();
    });
    
    $('#repro_labor').on('click', () => {
        if (confirm('Начать роды? Это действие нельзя отменить.')) {
            const result = startLabor();
            if (result) {
                injectLaborResult(result);
            }
        }
    });
    
    $('#repro_reset').on('click', () => {
        if (confirm('Сбросить все данные репродуктивной системы?')) {
            extension_settings[extensionName] = structuredClone(defaultSettings);
            saveSettingsDebounced();
            syncUI();
            injectStatusToChat();
            showNotification("Данные сброшены", "info");
        }
    });
    
    syncUI();
    
    // Следим за состоянием беременности для показа/скрытия кнопок
    const observer = new MutationObserver(() => {
        const s = getSettings();
        const buttons = document.getElementById('repro_pregnancy_buttons');
        if (buttons) {
            buttons.style.display = s.isPregnant ? 'flex' : 'none';
        }
    });
    
    const statusEl = document.getElementById('repro_pregnancy_status');
    if (statusEl) {
        observer.observe(statusEl, { childList: true, subtree: true });
    }
}

// ==================== ИНЖЕКТ В ЧАТ ====================

function generateStatusBlock() {
    const s = getSettings();
    const lang = s.language || 'ru';
    
    let status = '';
    
    // Цикл
    const phase = getCyclePhase();
    const fertility = isInFertileWindow() ? '🔴 ФЕРТИЛЬНОЕ ОКНО' : '';
    
    status += `## 🩺 РЕПРОДУКТИВНЫЙ СТАТУС\n`;
    status += `📅 День: ${s.currentDay} | Цикл: ${s.cycleDay}/${s.cycleLength}\n`;
    status += `🩸 Фаза: ${L('phases.' + phase)} ${fertility}\n`;
    status += `🛡️ Контрацепция: ${L('contraceptionTypes.' + s.contraception)}\n`;
    
    if (s.isPregnant) {
        const week = getPregnancyWeek();
        const trimester = getTrimester();
        const stage = getPregnancyStage();
        determineSex();
        
        let sexText = s.fetusSex.length > 0 
            ? s.fetusSex.map(sex => sex === 'male' ? '♂' : '♀').join(' ')
            : '?';
        
        status += `\n### 🤰 БЕРЕМЕННОСТЬ\n`;
        status += `Неделя: ${week} | Триместр: ${trimester}\n`;
        status += `Стадия: ${L('stages.' + stage)}\n`;
        status += `Плодов: ${s.fetusCount} | Пол: ${sexText}\n`;
        status += `Симптомы: ${getSymptoms()}\n`;
        
        if (s.complications.length > 0) {
            status += `⚠️ ОСЛОЖНЕНИЯ: ${s.complications.map(c => L('complications.' + c.type)).join(', ')}\n`;
        }
    } else {
        status += `🤰 Беременность: Нет\n`;
    }
    
    return status;
}

function injectStatusToChat() {
    const s = getSettings();
    
    if (!s.isEnabled || !s.injectToChat) {
        setExtensionPrompt(extensionName, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }
    
    const status = generateStatusBlock();
    const prompt = `[OOC: Текущий статус персонажа для отслеживания. Учитывай это в описаниях и реакциях, но не упоминай явно числа/статистику:\n\`\`\`\n${status}\n\`\`\`]`;
    
    setExtensionPrompt(
        extensionName,
        prompt,
        extension_prompt_types.IN_CHAT,
        0
    );
}

function injectConceptionResult(result) {
    const s = getSettings();
    if (!s.injectToChat) return;
    
    let message = `[OOC: ПРОВЕРКА ЗАЧАТИЯ\n`;
    message += `День цикла: ${result.cycleDay} (${L('phases.' + result.phase)})\n`;
    message += `Базовый шанс: ${result.baseChance}%\n`;
    message += `Контрацепция: ${L('contraceptionTypes.' + result.contraception)}`;
    if (result.contraceptionFailed) message += ` (ПОДВЕЛА!)`;
    message += `\nИтоговый шанс: ${result.finalChance}%\n`;
    message += `Бросок: ${result.roll}\n`;
    message += `РЕЗУЛЬТАТ: ${result.success ? '✅ ЗАЧАТИЕ!' : '❌ Нет зачатия'}\n`;
    
    if (result.success) {
        message += `Плодов: ${s.fetusCount}`;
    }
    message += `]`;
    
    // Временный инжект результата
    setExtensionPrompt(
        extensionName + '_result',
        message,
        extension_prompt_types.IN_CHAT,
        1
    );
    
    // Очистим через некоторое время
    setTimeout(() => {
        setExtensionPrompt(extensionName + '_result', '', extension_prompt_types.IN_CHAT, 1);
    }, 100);
}

function injectLaborResult(result) {
    const s = getSettings();
    if (!s.injectToChat) return;
    
    let message = `[OOC: РОДЫ\n`;
    message += `Неделя: ${result.week}${result.preterm ? ' (ПРЕЖДЕВРЕМЕННЫЕ)' : ''}\n`;
    message += `Детей: ${result.fetusCount}\n`;
    message += `Пол: ${result.fetusSex.map(sex => sex === 'male' ? '♂ Мальчик' : '♀ Девочка').join(', ')}\n`;
    message += `Исход: ${result.outcome}\n`;
    
    if (result.complications && result.complications.length > 0) {
        message += `⚠️ Осложнения: ${result.complications.map(c => L('complications.' + c.type)).join(', ')}\n`;
    }
    message += `]`;
    
    setExtensionPrompt(
        extensionName + '_result',
        message,
        extension_prompt_types.IN_CHAT,
        1
    );
    
    setTimeout(() => {
        setExtensionPrompt(extensionName + '_result', '', extension_prompt_types.IN_CHAT, 1);
    }, 100);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    
    // Добавляем недостающие поля
    for (const key in defaultSettings) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
}

jQuery(async () => {
    console.log('[Reproductive System] Loading...');
    
    loadSettings();
    setupUI();
    
    // Инжектим статус при загрузке
    injectStatusToChat();
    
    // Обновляем статус при отправке сообщения
    eventSource.on(event_types.MESSAGE_SENT, () => {
        injectStatusToChat();
    });
    
    console.log('[Reproductive System] Ready!');
});
