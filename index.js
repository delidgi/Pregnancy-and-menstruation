import { extension_settings, saveSettingsDebounced } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";

const extensionName = "reproductive-health";

const defaultSettings = {
    enabled: true,
    language: 'ru',
    
    contraception: {
        condom: false,
        pill: false,
        pillDaysTaken: 0,
        iud: false,
        implant: false
    },
    
    fertility: {
        baseFertility: 25,
        cycleDay: 1,
        cycleLength: 28,
        ovulationWindow: [12, 16]
    },
    
    menstruation: {
        isActive: false,
        duration: 5,
        intensity: 'normal',
        isPMS: false,
        symptoms: []
    },
    
    pregnancy: {
        isPregnant: false,
        conceptionDate: null,
        currentWeek: 0,
        trimester: 1,
        babies: [],
        complications: [],
        lastStatusDay: null
    },
    
    sti: {
        enabled: true,
        userInfections: [],
        partnerProfiles: {}
    },
    
    stats: {
        totalEncounters: 0,
        conceptionAttempts: 0,
        successfulConceptions: 0
    }
};

const i18n = {
    ru: {
        conception_roll: "🎲 БРОСОК НА ЗАЧАТИЕ",
        conception_success: "✅ ЗАЧАТИЕ!",
        conception_fail: "❌ Не в этот раз",
        pregnant: "беременна",
        not_pregnant: "не беременна",
        week: "неделя",
        trimester: "триместр",
        baby_boy: "👦 Мальчик",
        baby_girl: "👧 Девочка",
        twins: "Близнецы",
        triplets: "Тройня",
        single: "Один плод",
        period_started: "🩸 Месячные начались",
        period_day: "День месячных",
        pms: "ПМС",
        ovulation: "🔥 Овуляция!",
        safe_days: "Безопасные дни",
        condom_detected: "🩹 Презерватив",
        no_protection: "⚠️ Без защиты",
        pill_active: "💊 Таблетки",
        fertility_high: "ВЫСОКАЯ",
        fertility_low: "низкая",
        fertility_normal: "норма",
        sti_check: "🔬 Проверка ИППП",
        sti_infected: "⚠️ ЗАРАЖЕНИЕ",
        sti_safe: "✅ Чисто",
        visible_changes: "Симптомы"
    },
    en: {
        conception_roll: "🎲 CONCEPTION ROLL",
        conception_success: "✅ CONCEIVED!",
        conception_fail: "❌ Not this time",
        pregnant: "pregnant",
        not_pregnant: "not pregnant",
        week: "week",
        trimester: "trimester",
        baby_boy: "👦 Boy",
        baby_girl: "👧 Girl",
        twins: "Twins",
        triplets: "Triplets",
        single: "Single",
        period_started: "🩸 Period started",
        period_day: "Period day",
        pms: "PMS",
        ovulation: "🔥 Ovulation!",
        safe_days: "Safe days",
        condom_detected: "🩹 Condom",
        no_protection: "⚠️ No protection",
        pill_active: "💊 On the pill",
        fertility_high: "HIGH",
        fertility_low: "low",
        fertility_normal: "normal",
        sti_check: "🔬 STI Check",
        sti_infected: "⚠️ INFECTED",
        sti_safe: "✅ Clear",
        visible_changes: "Symptoms"
    }
};

const stiDatabase = {
    chlamydia: { name: { ru: 'Хламидиоз', en: 'Chlamydia' }, rate: 40, condomBlock: 80 },
    gonorrhea: { name: { ru: 'Гонорея', en: 'Gonorrhea' }, rate: 50, condomBlock: 80 },
    herpes: { name: { ru: 'Герпес', en: 'Herpes' }, rate: 10, condomBlock: 30 },
    hpv: { name: { ru: 'ВПЧ', en: 'HPV' }, rate: 20, condomBlock: 70 },
    hiv: { name: { ru: 'ВИЧ', en: 'HIV' }, rate: 0.1, condomBlock: 85 }
};

const pregnancyChanges = {
    ru: [
        [0, 'Пока ничего не заметно'],
        [4, 'Лёгкая тошнота по утрам, усталость'],
        [6, 'Грудь увеличилась и чувствительна'],
        [8, 'Частые походы в туалет, тошнота'],
        [12, 'Животик слегка округлился'],
        [16, 'Живот заметен, первые шевеления'],
        [20, 'Живот явно виден, активные шевеления'],
        [24, 'Большой живот, отёки ног'],
        [28, 'Тяжело дышать, частые пинки'],
        [32, 'Очень большой живот, бессонница'],
        [36, 'Живот опустился, скоро роды'],
        [40, 'Полный срок, роды в любой момент']
    ],
    en: [
        [0, 'Nothing noticeable yet'],
        [4, 'Morning sickness, fatigue'],
        [6, 'Breasts enlarged and tender'],
        [8, 'Frequent urination, nausea'],
        [12, 'Slight belly bump'],
        [16, 'Visible bump, first movements'],
        [20, 'Obvious belly, active kicks'],
        [24, 'Large belly, swollen feet'],
        [28, 'Shortness of breath, strong kicks'],
        [32, 'Very large belly, insomnia'],
        [36, 'Belly dropped, labor soon'],
        [40, 'Full term, labor imminent']
    ]
};

const pmsSymptoms = {
    ru: ['раздражительность', 'перепады настроения', 'усталость', 'вздутие', 'головная боль', 'тяга к сладкому', 'плаксивость'],
    en: ['irritability', 'mood swings', 'fatigue', 'bloating', 'headache', 'cravings', 'tearfulness']
};

// ==================== ЧЕСТНЫЙ РАНДОМ ====================

function trueRandom(min, max) {
    const range = max - min + 1;
    const bytesNeeded = Math.ceil(Math.log2(range) / 8) || 1;
    const maxValid = Math.floor(256 ** bytesNeeded / range) * range - 1;
    
    let randomValue;
    const arr = new Uint8Array(bytesNeeded);
    
    do {
        crypto.getRandomValues(arr);
        randomValue = arr.reduce((acc, val, i) => acc + val * (256 ** i), 0);
    } while (randomValue > maxValid);
    
    return min + (randomValue % range);
}

function rollD100() {
    return trueRandom(1, 100);
}

function rollDice(sides) {
    return trueRandom(1, sides);
}

// ==================== УТИЛИТЫ ====================

function t(key) {
    const lang = extension_settings.reproHealth?.language || 'ru';
    return i18n[lang]?.[key] || i18n.en[key] || key;
}

function getSettings() {
    return extension_settings.reproHealth;
}

function getISODate() {
    return new Date().toISOString().split('T')[0];
}

function daysDiff(d1, d2) {
    return Math.floor((new Date(d2) - new Date(d1)) / 86400000);
}

// ==================== ОПРЕДЕЛЕНИЕ КОНТЕКСТА ====================

const sexKeywords = {
    vaginal: [
        'вошёл в неё', 'вошел в нее', 'входит в неё', 'входит в нее',
        'проникает', 'проник в', 'внутри неё', 'внутри нее',
        'толкается в', 'двигается в ней', 'двигается внутри',
        'заполняет её', 'заполняет ее', 'растягивает её',
        'enters her', 'inside her', 'penetrates', 'thrusts into',
        'fills her', 'deep inside', 'pushes into her',
        'член внутри', 'член в ней', 'вагин', 'влагалищ',
        'киск', 'pussy', 'между ног', 'раздвинув ноги'
    ],
    creampie: [
        'кончил внутрь', 'кончает внутрь', 'излился внутрь',
        'изливается внутрь', 'спустил внутрь', 'наполнил её',
        'наполняет её', 'заполнил её тёплым', 'семя внутри',
        'сперма внутри', 'горячая струя внутри', 'пульсирует внутри',
        'creampie', 'came inside', 'cums inside', 'cum inside',
        'fills her with', 'seed inside', 'spills inside',
        'releasing inside', 'finishes inside', 'pumps into her',
        'глубоко внутрь', 'до самого конца'
    ],
    condomOn: [
        'надел презерватив', 'надевает презерватив', 'натянул презерватив',
        'достал презерватив', 'раскатал презерватив', 'в презервативе',
        'защищённый', 'с защитой', 'put on condom', 'puts on condom',
        'wearing condom', 'with protection', 'wrapped'
    ],
    condomOff: [
        'снял презерватив', 'снимает презерватив', 'без презерватива',
        'без защиты', 'незащищённый', 'removed condom', 'without condom',
        'no condom', 'raw', 'unprotected', 'bareback'
    ],
    pullOut: [
        'вытащил', 'успел вытащить', 'кончил снаружи', 'на живот',
        'на спину', 'на грудь', 'на лицо', 'pulled out', 'pulls out',
        'came on her', 'outside', 'withdrew'
    ]
};

function analyzeMessage(text) {
    const lower = text.toLowerCase();
    
    let isVaginalSex = false;
    let isCreampie = false;
    let hasCondom = null;
    let isPullOut = false;
    
    for (const kw of sexKeywords.vaginal) {
        if (lower.includes(kw)) { isVaginalSex = true; break; }
    }
    
    for (const kw of sexKeywords.creampie) {
        if (lower.includes(kw)) { isCreampie = true; break; }
    }
    
    for (const kw of sexKeywords.condomOn) {
        if (lower.includes(kw)) { hasCondom = true; break; }
    }
    
    for (const kw of sexKeywords.condomOff) {
        if (lower.includes(kw)) { hasCondom = false; break; }
    }
    
    for (const kw of sexKeywords.pullOut) {
        if (lower.includes(kw)) { isPullOut = true; break; }
    }
    
    return { isVaginalSex, isCreampie, hasCondom, isPullOut };
}

// ==================== ЦИКЛ И ФЕРТИЛЬНОСТЬ ====================

function updateCycle() {
    const s = getSettings();
    if (s.pregnancy.isPregnant) {
        s.menstruation.isActive = false;
        s.menstruation.isPMS = false;
        return;
    }
    
    const day = s.fertility.cycleDay;
    const dur = s.menstruation.duration;
    
    // Месячные: дни 1-5
    if (day >= 1 && day <= dur) {
        s.menstruation.isActive = true;
        s.menstruation.isPMS = false;
        const pd = day;
        s.menstruation.intensity = pd <= 2 ? 'heavy' : pd >= dur - 1 ? 'light' : 'normal';
    } else {
        s.menstruation.isActive = false;
        // ПМС: дни 25-28
        if (day >= 25) {
            s.menstruation.isPMS = true;
            const lang = s.language;
            const syms = pmsSymptoms[lang] || pmsSymptoms.en;
            s.menstruation.symptoms = [...syms].sort(() => Math.random() - 0.5).slice(0, trueRandom(2, 4));
        } else {
            s.menstruation.isPMS = false;
            s.menstruation.symptoms = [];
        }
    }
    
    saveSettingsDebounced();
}

function getFertilityModifier() {
    const s = getSettings();
    const day = s.fertility.cycleDay;
    const [ovS, ovE] = s.fertility.ovulationWindow;
    
    if (s.menstruation.isActive) return 0.05;
    if (day >= ovS && day <= ovE) return 3.0;
    if (day >= ovS - 2 && day <= ovE + 1) return 1.8;
    if (day <= 7 || day >= 24) return 0.15;
    return 0.4;
}

function advanceCycle(days = 1) {
    const s = getSettings();
    if (s.pregnancy.isPregnant) return;
    
    for (let i = 0; i < days; i++) {
        s.fertility.cycleDay = (s.fertility.cycleDay % s.fertility.cycleLength) + 1;
        if (s.contraception.pill) s.contraception.pillDaysTaken++;
    }
    updateCycle();
    saveSettingsDebounced();
}

// ==================== КОНТРАЦЕПЦИЯ ====================

function getContraceptionEffect() {
    const c = getSettings().contraception;
    let protection = 0;
    let methods = [];
    let condomBroke = false;
    
    if (c.iud) {
        protection = Math.max(protection, 99);
        methods.push('IUD');
    }
    
    if (c.implant) {
        protection = Math.max(protection, 99);
        methods.push('Implant');
    }
    
    if (c.pill) {
        let eff = 91;
        if (c.pillDaysTaken < 7) eff = 50;
        else if (c.pillDaysTaken < 21) eff = 75;
        protection = Math.max(protection, eff);
        methods.push('Pill');
    }
    
    if (c.condom) {
        // 2% шанс что порвётся
        if (rollD100() <= 2) {
            condomBroke = true;
        } else {
            protection = Math.max(protection, 85);
            methods.push('Condom');
        }
    }
    
    return {
        multiplier: (100 - protection) / 100,
        methods,
        condomBroke
    };
}

// ==================== ЗАЧАТИЕ ====================

function attemptConception(useContraception = true) {
    const s = getSettings();
    
    if (s.pregnancy.isPregnant) {
        return { attempted: false, reason: 'already_pregnant' };
    }
    
    s.stats.conceptionAttempts++;
    
    // Базовый шанс
    let chance = s.fertility.baseFertility;
    
    // Модификатор цикла
    const fertMod = getFertilityModifier();
    chance *= fertMod;
    
    // Контрацепция
    let contraResult = { multiplier: 1, methods: [], condomBroke: false };
    if (useContraception) {
        contraResult = getContraceptionEffect();
        chance *= contraResult.multiplier;
    }
    
    // Ограничения
    chance = Math.max(0.5, Math.min(85, chance));
    
    // ЧЕСТНЫЙ БРОСОК
    const roll = rollD100();
    const success = roll <= chance;
    
    const result = {
        attempted: true,
        roll,
        chance: chance.toFixed(1),
        success,
        fertMod,
        contraception: contraResult,
        cycleDay: s.fertility.cycleDay,
        duringPeriod: s.menstruation.isActive
    };
    
    if (success) {
        s.stats.successfulConceptions++;
        s.pregnancy.isPregnant = true;
        s.pregnancy.conceptionDate = getISODate();
        s.pregnancy.currentWeek = 0;
        s.pregnancy.trimester = 1;
        s.pregnancy.complications = [];
        s.menstruation.isActive = false;
        s.menstruation.isPMS = false;
        
        // Определяем количество эмбрионов
        const multipleRoll = rollD100();
        let babyCount = 1;
        if (multipleRoll <= 2) babyCount = 3; // 2% тройня
        else if (multipleRoll <= 5) babyCount = 2; // 3% близнецы
        
        // Определяем пол каждого
        s.pregnancy.babies = [];
        for (let i = 0; i < babyCount; i++) {
            const genderRoll = rollD100();
            s.pregnancy.babies.push({
                gender: genderRoll <= 50 ? 'boy' : 'girl',
                genderRoll
            });
        }
        
        result.babies = s.pregnancy.babies;
    }
    
    saveSettingsDebounced();
    return result;
}

// ==================== ИППП ====================

function getPartnerRisk(name) {
    const s = getSettings();
    
    if (!s.sti.partnerProfiles[name]) {
        const riskRoll = rollD100();
        let risk = 'safe';
        let infections = [];
        
        if (riskRoll <= 60) {
            risk = 'safe';
        } else if (riskRoll <= 80) {
            risk = 'low';
            if (rollD100() <= 15) {
                infections.push(['chlamydia', 'gonorrhea'][trueRandom(0, 1)]);
            }
        } else if (riskRoll <= 95) {
            risk = 'medium';
            if (rollD100() <= 30) {
                infections.push(['chlamydia', 'gonorrhea', 'herpes', 'hpv'][trueRandom(0, 3)]);
            }
        } else {
            risk = 'high';
            if (rollD100() <= 50) {
                const possible = Object.keys(stiDatabase);
                infections.push(possible[trueRandom(0, possible.length - 1)]);
            }
        }
        
        s.sti.partnerProfiles[name] = { risk, infections };
        saveSettingsDebounced();
    }
    
    return s.sti.partnerProfiles[name];
}

function checkSTI(partnerName, usedCondom) {
    const s = getSettings();
    const partner = getPartnerRisk(partnerName);
    const results = { checked: [], newInfections: [] };
    
    for (const sti of partner.infections) {
        if (s.sti.userInfections.includes(sti)) continue;
        
        const info = stiDatabase[sti];
        let chance = info.rate;
        if (usedCondom) chance *= (100 - info.condomBlock) / 100;
        
        const roll = rollD100();
        const infected = roll <= chance;
        
        results.checked.push({ sti, roll, chance: chance.toFixed(2), infected });
        
        if (infected) {
            results.newInfections.push(sti);
            s.sti.userInfections.push(sti);
        }
    }
    
    saveSettingsDebounced();
    return results;
}

// ==================== БЕРЕМЕННОСТЬ ====================

function getPregnancyStatus() {
    const s = getSettings();
    if (!s.pregnancy.isPregnant) return null;
    
    const days = daysDiff(s.pregnancy.conceptionDate, getISODate());
    const weeks = Math.floor(days / 7);
    s.pregnancy.currentWeek = weeks;
    
    let tri = 1;
    if (weeks >= 12) tri = 2;
    if (weeks >= 28) tri = 3;
    s.pregnancy.trimester = tri;
    
    const lang = s.language;
    const changes = pregnancyChanges[lang];
    let symptoms = changes[0][1];
    for (const [w, desc] of changes) {
        if (weeks >= w) symptoms = desc;
    }
    
    saveSettingsDebounced();
    
    return {
        weeks,
        trimester: tri,
        symptoms,
        babies: s.pregnancy.babies,
        dueIn: 40 - weeks
    };
}

// ==================== ФОРМАТИРОВАНИЕ ====================

function formatConceptionResult(r) {
    const s = getSettings();
    const lang = s.language;
    
    if (!r.attempted) {
        return `<div class="reprohealth-block info">🤰 ${lang === 'ru' ? 'Уже беременна' : 'Already pregnant'}</div>`;
    }
    
    const fertLabel = r.fertMod >= 1.5 ? t('fertility_high') : r.fertMod >= 0.4 ? t('fertility_normal') : t('fertility_low');
    const fertClass = r.fertMod >= 1.5 ? 'danger' : r.fertMod >= 0.4 ? 'warning' : 'success';
    
    let html = `<div class="reprohealth-block conception ${r.success ? 'success' : 'fail'}">
<div class="reprohealth-block-header">${t('conception_roll')}</div>
<div class="reprohealth-roll">
<span class="reprohealth-roll-dice">🎲</span>
<span class="reprohealth-roll-result">${r.roll}</span>
<span class="reprohealth-roll-target">/ ${r.chance}%</span>
</div>
<div class="reprohealth-block-row">
<span class="reprohealth-block-label">${t('cycle_day') || 'День цикла'}</span>
<span class="reprohealth-block-value">${r.cycleDay} <span class="reprohealth-badge ${fertClass}">${fertLabel}</span></span>
</div>`;
    
    if (r.contraception.methods.length > 0) {
        html += `<div class="reprohealth-block-row"><span class="reprohealth-badge success">${r.contraception.methods.join(', ')}</span></div>`;
    } else {
        html += `<div class="reprohealth-block-row"><span class="reprohealth-badge danger">${t('no_protection')}</span></div>`;
    }
    
    if (r.contraception.condomBroke) {
        html += `<div class="reprohealth-badge danger">⚠️ ${lang === 'ru' ? 'Презерватив порвался!' : 'Condom broke!'}</div>`;
    }
    
    if (r.duringPeriod) {
        html += `<div class="reprohealth-badge info">🩸 ${lang === 'ru' ? 'Во время месячных' : 'During period'}</div>`;
    }
    
    html += `<div class="reprohealth-result ${r.success ? 'success' : 'fail'}">${r.success ? t('conception_success') : t('conception_fail')}</div>`;
    
    if (r.success && r.babies) {
        const babyCount = r.babies.length;
        let babyText = babyCount === 1 ? t('single') : babyCount === 2 ? t('twins') : t('triplets');
        let genders = r.babies.map(b => b.gender === 'boy' ? t('baby_boy') : t('baby_girl')).join(', ');
        
        html += `<div class="reprohealth-babies">
<div class="reprohealth-badge info">${babyText}</div>
<div>${genders}</div>
</div>`;
    }
    
    html += `</div>`;
    return html;
}

function formatPregnancyStatus(status, compact = false) {
    if (!status) return '';
    
    const s = getSettings();
    const lang = s.language;
    
    const babyCount = status.babies.length;
    const babyText = babyCount === 1 ? '' : babyCount === 2 ? ` (${t('twins')})` : ` (${t('triplets')})`;
    const genders = status.babies.map(b => b.gender === 'boy' ? '👦' : '👧').join('');
    
    if (compact) {
        return `<div class="reprohealth-block pregnancy compact">
🤰 ${t('week')} ${status.weeks} | ${t('trimester')} ${status.trimester}${babyText} ${genders} | ${status.symptoms}
</div>`;
    }
    
    const pct = Math.min(100, Math.round(status.weeks / 40 * 100));
    
    return `<div class="reprohealth-block pregnancy">
<div class="reprohealth-block-header">🤰 ${t('pregnant').toUpperCase()}${babyText}</div>
<div class="reprohealth-progress"><div class="reprohealth-progress-fill" style="width:${pct}%"></div></div>
<div class="reprohealth-block-row"><span class="reprohealth-block-label">${t('week')}</span><span class="reprohealth-block-value">${status.weeks}/40 ${genders}</span></div>
<div class="reprohealth-block-row"><span class="reprohealth-block-label">${t('trimester')}</span><span class="reprohealth-block-value">${status.trimester}</span></div>
<div class="reprohealth-block-row"><span class="reprohealth-block-label">${t('visible_changes')}</span><span class="reprohealth-block-value">${status.symptoms}</span></div>
</div>`;
}

function formatSTIResult(r) {
    if (r.checked.length === 0) return '';
    
    const lang = getSettings().language;
    let html = `<div class="reprohealth-block sti ${r.newInfections.length ? 'danger' : ''}">
<div class="reprohealth-block-header">${t('sti_check')}</div>`;
    
    for (const check of r.checked) {
        const name = stiDatabase[check.sti].name[lang];
        html += `<div class="reprohealth-block-row">
<span class="reprohealth-block-label">${name}</span>
<span class="reprohealth-block-value">${check.roll}/${check.chance}% 
<span class="reprohealth-badge ${check.infected ? 'danger' : 'success'}">${check.infected ? t('sti_infected') : t('sti_safe')}</span>
</span></div>`;
    }
    
    html += `</div>`;
    return html;
}

// ==================== АВТОМАТИЧЕСКАЯ ОБРАБОТКА ====================

function injectToChat(html) {
    if (!html) return;
    
    const chat = document.querySelector('#chat');
    if (!chat) return;
    
    const lastMsg = chat.querySelector('.mes:last-child .mes_text');
    if (!lastMsg) return;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'reprohealth-auto-result';
    wrapper.innerHTML = html;
    lastMsg.appendChild(wrapper);
}

function processMessage(text, charName) {
    const s = getSettings();
    if (!s.enabled) return;
    
    const analysis = analyzeMessage(text);
    let output = '';
    
    // Обновляем статус презерватива из контекста
    if (analysis.hasCondom === true) {
        s.contraception.condom = true;
        saveSettingsDebounced();
    } else if (analysis.hasCondom === false) {
        s.contraception.condom = false;
        saveSettingsDebounced();
    }
    
    // Проверяем вагинальный секс с кончанием внутрь
    if (analysis.isVaginalSex && analysis.isCreampie && !analysis.isPullOut) {
        s.stats.totalEncounters++;
        
        // Бросок на зачатие
        const conception = attemptConception(true);
        output += formatConceptionResult(conception);
        
        // Проверка ИППП
        if (s.sti.enabled) {
            const stiResult = checkSTI(charName, s.contraception.condom);
            output += formatSTIResult(stiResult);
        }
    }
    
    // Показываем статус беременности раз в день
    if (s.pregnancy.isPregnant) {
        const today = getISODate();
        if (s.pregnancy.lastStatusDay !== today) {
            const status = getPregnancyStatus();
            output = formatPregnancyStatus(status, true) + output;
            s.pregnancy.lastStatusDay = today;
            saveSettingsDebounced();
        }
    }
    
    if (output) {
        setTimeout(() => injectToChat(output), 150);
    }
    
    updateStatusPanel();
}

function onChatMessage(messageIndex) {
    try {
        const context = window.SillyTavern?.getContext?.();
        if (!context?.chat) return;
        
        const msg = context.chat[messageIndex];
        if (!msg || msg.is_user) return;
        
        const charName = context.name2 || 'Partner';
        processMessage(msg.mes || '', charName);
    } catch (e) {
        console.error('[ReproHealth] Error:', e);
    }
}

// ==================== UI ПАНЕЛЬ ====================

function createSettingsPanel() {
    const html = `
<div id="reprohealth-settings" class="extension_settings">
<div class="inline-drawer">
<div class="inline-drawer-toggle inline-drawer-header">
<b>🤰 Reproductive Health</b>
<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
</div>
<div class="inline-drawer-content">

<div class="reprohealth-setting">
<label class="checkbox_label"><input type="checkbox" id="rh-enabled"><span>Включить систему</span></label>
</div>

<div class="reprohealth-setting">
<label>Язык</label>
<select id="rh-lang"><option value="ru">Русский</option><option value="en">English</option></select>
</div>

<hr><h4>💊 Контрацепция</h4>
<p class="reprohealth-hint">Можно выбрать или оставить пустым — система определит из текста</p>
<div class="reprohealth-setting"><label class="checkbox_label"><input type="checkbox" id="rh-condom"><span>🩹 Презерватив (85%)</span></label></div>
<div class="reprohealth-setting"><label class="checkbox_label"><input type="checkbox" id="rh-pill"><span>💊 Таблетки (91%)</span></label></div>
<div class="reprohealth-setting"><label class="checkbox_label"><input type="checkbox" id="rh-iud"><span>🔗 Спираль IUD (99%)</span></label></div>
<div class="reprohealth-setting"><label class="checkbox_label"><input type="checkbox" id="rh-implant"><span>💉 Имплант (99%)</span></label></div>

<hr><h4>🌡️ Цикл</h4>
<div class="reprohealth-setting">
<label>День цикла (1-28)</label>
<input type="number" id="rh-cycle-day" min="1" max="28" value="1">
</div>
<div class="reprohealth-setting">
<label>Базовый шанс зачатия %</label>
<input type="number" id="rh-base-fert" min="5" max="50" value="25">
</div>

<hr><h4>🔬 ИППП</h4>
<div class="reprohealth-setting">
<label class="checkbox_label"><input type="checkbox" id="rh-sti"><span>Включить проверку ИППП</span></label>
</div>

<hr>
<div id="rh-status" class="reprohealth-status"></div>

<div class="reprohealth-buttons">
<button id="rh-advance-day" class="menu_button">+1 день</button>
<button id="rh-reset-preg" class="menu_button">Сброс беременности</button>
<button id="rh-reset-all" class="menu_button redWarningBG">Сброс всего</button>
</div>

<hr>
<div class="reprohealth-stats" id="rh-stats"></div>

</div>
</div>
</div>`;
    
    $('#extensions_settings2').append(html);
    bindEvents();
    loadUI();
}

function bindEvents() {
    const s = () => getSettings();
    
    $('#rh-enabled').on('change', function() { s().enabled = this.checked; saveSettingsDebounced(); });
    $('#rh-lang').on('change', function() { s().language = this.value; saveSettingsDebounced(); updateStatusPanel(); });
    
    $('#rh-condom').on('change', function() { s().contraception.condom = this.checked; saveSettingsDebounced(); updateStatusPanel(); });
    $('#rh-pill').on('change', function() { s().contraception.pill = this.checked; if (!this.checked) s().contraception.pillDaysTaken = 0; saveSettingsDebounced(); });
    $('#rh-iud').on('change', function() { s().contraception.iud = this.checked; saveSettingsDebounced(); });
    $('#rh-implant').on('change', function() { s().contraception.implant = this.checked; saveSettingsDebounced(); });
    
    $('#rh-cycle-day').on('change', function() { 
        s().fertility.cycleDay = parseInt(this.value) || 1; 
        updateCycle();
        saveSettingsDebounced(); 
        updateStatusPanel(); 
    });
    
    $('#rh-base-fert').on('change', function() { s().fertility.baseFertility = parseInt(this.value) || 25; saveSettingsDebounced(); });
    $('#rh-sti').on('change', function() { s().sti.enabled = this.checked; saveSettingsDebounced(); });
    
    $('#rh-advance-day').on('click', () => { advanceCycle(1); updateStatusPanel(); loadUI(); });
    
    $('#rh-reset-preg').on('click', () => {
        if (confirm('Сбросить беременность?')) {
            const s = getSettings();
            s.pregnancy = { ...defaultSettings.pregnancy };
            saveSettingsDebounced();
            updateStatusPanel();
        }
    });
    
    $('#rh-reset-all').on('click', () => {
        if (confirm('Сбросить ВСЁ?')) {
            extension_settings.reproHealth = JSON.parse(JSON.stringify(defaultSettings));
            saveSettingsDebounced();
            loadUI();
            updateStatusPanel();
        }
    });
}

function loadUI() {
    const s = getSettings();
    $('#rh-enabled').prop('checked', s.enabled);
    $('#rh-lang').val(s.language);
    $('#rh-condom').prop('checked', s.contraception.condom);
    $('#rh-pill').prop('checked', s.contraception.pill);
    $('#rh-iud').prop('checked', s.contraception.iud);
    $('#rh-implant').prop('checked', s.contraception.implant);
    $('#rh-cycle-day').val(s.fertility.cycleDay);
    $('#rh-base-fert').val(s.fertility.baseFertility);
    $('#rh-sti').prop('checked', s.sti.enabled);
    updateStatusPanel();
}

function updateStatusPanel() {
    const s = getSettings();
    const lang = s.language;
    const fert = getFertilityModifier();
    
    let html = '<div class="reprohealth-status-grid">';
    
    // Беременность
    if (s.pregnancy.isPregnant) {
        const ps = getPregnancyStatus();
        const genders = ps.babies.map(b => b.gender === 'boy' ? '👦' : '👧').join('');
        html += `<div class="status-item pregnant">🤰 ${ps.weeks} ${lang === 'ru' ? 'нед.' : 'wk'} ${genders}</div>`;
    } else {
        html += `<div class="status-item">🤰 ${lang === 'ru' ? 'Не беременна' : 'Not pregnant'}</div>`;
    }
    
    // Цикл
    const cycleIcon = s.menstruation.isActive ? '🩸' : s.menstruation.isPMS ? '😤' : '📅';
    const fertLevel = fert >= 1.5 ? '🔥' : fert >= 0.4 ? '•' : '❄️';
    html += `<div class="status-item">${cycleIcon} ${lang === 'ru' ? 'День' : 'Day'} ${s.fertility.cycleDay} ${fertLevel}</div>`;
    
    // Контрацепция
    const contra = [];
    if (s.contraception.condom) contra.push('🩹');
    if (s.contraception.pill) contra.push('💊');
    if (s.contraception.iud) contra.push('🔗');
    if (s.contraception.implant) contra.push('💉');
    if (contra.length) {
        html += `<div class="status-item protection">${contra.join(' ')}</div>`;
    }
    
    // ИППП
    if (s.sti.userInfections.length > 0) {
        html += `<div class="status-item infected">🔬 ${s.sti.userInfections.length}</div>`;
    }
    
    html += '</div>';
    
    $('#rh-status').html(html);
    
    // Статистика
    $('#rh-stats').html(`
        <small>
        ${lang === 'ru' ? 'Попыток' : 'Attempts'}: ${s.stats.conceptionAttempts} | 
        ${lang === 'ru' ? 'Зачатий' : 'Conceptions'}: ${s.stats.successfulConceptions}
        </small>
    `);
}

// ==================== ЭКСПОРТ ====================

window.ReproHealth = {
    rollD100, trueRandom, attemptConception, getPregnancyStatus,
    checkSTI, advanceCycle, getFertilityModifier, analyzeMessage
};

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

jQuery(async () => {
    if (!extension_settings.reproHealth) {
        extension_settings.reproHealth = JSON.parse(JSON.stringify(defaultSettings));
    } else {
        extension_settings.reproHealth = { 
            ...JSON.parse(JSON.stringify(defaultSettings)), 
            ...extension_settings.reproHealth,
            automation: { ...defaultSettings.automation, ...extension_settings.reproHealth?.automation },
            triggers: { ...defaultSettings.triggers, ...extension_settings.reproHealth?.triggers }
        };
    }
    
    saveSettingsDebounced();
    createSettingsPanel();
    updateCycle();
    
    // Подписка на сообщения
    eventSource.on(event_types.MESSAGE_RECEIVED, onChatMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onChatMessage);
    
    console.log('[ReproHealth] Fully automatic system loaded!');
});
