import { extension_settings, saveSettingsDebounced } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";

const extensionName = "reproductive-health";

const defaultSettings = {
    enabled: true,
    language: "ru",
    automation: {
        autoConception: true,
        autoSTICheck: true,
    },
    triggers: {
        conceptionKeywords: [
            "кончил внутрь", "кончила внутрь", "кончает внутрь",
            "излился внутрь", "изливается внутрь",
            "спустил внутрь", "семя внутри",
            "creampie", "came inside", "cum inside", "cums inside", "finishing inside"
        ],
        vaginalKeywords: [
            "во влагалище", "в вагину", "между ног", "внутрь неё", "внутрь нее",
            "in her pussy", "into her vagina", "between her legs"
        ],
        sexKeywords: [
            "занялись сексом", "занимается сексом", "совокупляются",
            "оральный секс", "анальный секс", "лижет", "сосёт", "сосет",
            "трахает", "трахался", "трахались",
            "fuck", "fucks", "fucking", "having sex", "oral", "anal"
        ]
    },
    contraception: {
        condom: false,
        pill: false
    },
    fertility: {
        baseFertility: 25,
        cycleDay: 1,
        cycleLength: 28
    },
    pregnancy: {
        isPregnant: false,
        conceptionDate: null,
        currentWeek: 0,
        fetusCount: 1,
        fetusSexes: [],
        complications: [],
        outcome: null,
        lastStatusShown: null,
        config: {
            baseTwinChance: 3,      // %
            baseTripletChance: 0.3, // %
            revealSexWeek: 12
        }
    },
    sti: {
        enabled: true,
        infected: [],
        lastTest: null
    }
};

function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    return extension_settings[extensionName];
}

function matchesAny(text, list) {
    const lower = text.toLowerCase();
    return list.some(k => lower.includes(k));
}

function rollD100() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return (arr[0] % 100) + 1;
}

// ---------- ПАНЕЛЬ UI ----------

function renderPanel() {
    const settings = getSettings();

    let panel = document.getElementById("reprohealth-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "reprohealth-panel";
        document.body.appendChild(panel);
    }

    const preg = settings.pregnancy;
    const fert = settings.fertility;

    let pregnancyLine = preg.isPregnant ? `да, неделя ${preg.currentWeek}` : "нет";
    let fetusLine = preg.isPregnant ? `${preg.fetusCount}` : "-";
    let sexLine = "-";

    if (preg.isPregnant && preg.currentWeek >= preg.config.revealSexWeek) {
        const sexNames = preg.fetusSexes.map(sex => {
            if (sex === "male") return "мальчик";
            if (sex === "female") return "девочка";
            return "неизвестно";
        });
        sexLine = sexNames.join(", ");
    } else if (preg.isPregnant) {
        sexLine = "пока неизвестен";
    }

    panel.innerHTML = `
        <div class="reprohealth-header">
            <span class="reprohealth-title">Repro Health</span>
            <span class="reprohealth-tag">${settings.language === "ru" ? "авто‑система" : "auto"}</span>
        </div>

        <div class="reprohealth-status">
            <div class="reprohealth-status-row">
                <span class="reprohealth-label">День цикла</span>
                <span class="reprohealth-value">${fert.cycleDay}</span>
            </div>
            <div class="reprohealth-status-row">
                <span class="reprohealth-label">Беременность</span>
                <span class="reprohealth-value">${pregnancyLine}</span>
            </div>
            <div class="reprohealth-status-row">
                <span class="reprohealth-label">Эмбрионов</span>
                <span class="reprohealth-value">${fetusLine}</span>
            </div>
            <div class="reprohealth-status-row">
                <span class="reprohealth-label">Пол</span>
                <span class="reprohealth-value">${sexLine}</span>
            </div>
        </div>

        <div class="reprohealth-toggles">
            <button id="repro-condom-toggle"
                    class="repro-toggle ${settings.contraception.condom ? "on" : "off"}">
                <span class="repro-toggle-label">Презерватив</span>
                <span class="repro-toggle-state">${settings.contraception.condom ? "ON" : "OFF"}</span>
            </button>
            <button id="repro-pill-toggle"
                    class="repro-toggle ${settings.contraception.pill ? "on" : "off"}">
                <span class="repro-toggle-label">Таблетки</span>
                <span class="repro-toggle-state">${settings.contraception.pill ? "ON" : "OFF"}</span>
            </button>
        </div>

        <div class="reprohealth-note">
            Беременность: только вагинал с эякуляцией внутрь. ИППП: любой секс.
        </div>
    `;

    panel.querySelector("#repro-condom-toggle").addEventListener("click", () => {
        settings.contraception.condom = !settings.contraception.condom;
        saveSettingsDebounced();
        renderPanel();
    });

    panel.querySelector("#repro-pill-toggle").addEventListener("click", () => {
        settings.contraception.pill = !settings.contraception.pill;
        saveSettingsDebounced();
        renderPanel();
    });
}

// ---------- ЛОГИКА БЕРЕМЕННОСТИ ----------

function initiatePregnancy() {
    const settings = getSettings();
    const preg = settings.pregnancy;

    preg.isPregnant = true;
    preg.conceptionDate = new Date().toISOString();
    preg.currentWeek = 1;
    preg.complications = [];
    preg.outcome = null;

    const twinRoll = rollD100();
    let fetusCount = 1;

    if (twinRoll <= preg.config.baseTripletChance) {
        fetusCount = 3;
    } else if (twinRoll <= preg.config.baseTripletChance + preg.config.baseTwinChance) {
        fetusCount = 2;
    }

    preg.fetusCount = fetusCount;

    const sexes = [];
    for (let i = 0; i < fetusCount; i++) {
        const sexRoll = rollD100();
        sexes.push(sexRoll <= 50 ? "female" : "male");
    }
    preg.fetusSexes = sexes;

    saveSettingsDebounced();
    renderPanel();
}

function tryConception(messageText) {
    const settings = getSettings();
    if (!settings.automation.autoConception) return;

    const lower = messageText.toLowerCase();
    const isInside = matchesAny(lower, settings.triggers.conceptionKeywords);
    const isVaginal = matchesAny(lower, settings.triggers.vaginalKeywords);

    if (!isInside || !isVaginal) return;

    const fertileRoll = rollD100();
    let chance = settings.fertility.baseFertility;

    if (settings.contraception.condom) {
        chance *= 0.15;
    }
    if (settings.contraception.pill) {
        chance *= 0.1;
    }

    if (fertileRoll <= chance) {
        initiatePregnancy();
        sendSystemMessage("🤰 БРОСОК НА ЗАЧАТИЕ: зачатие произошло.");
    } else {
        sendSystemMessage("🤰 БРОСОК НА ЗАЧАТИЕ: в этот раз беременность не наступила.");
    }
}

// ---------- ЛОГИКА ИППП (очень упрощённо) ----------

function trySTICheck(messageText) {
    const settings = getSettings();
    if (!settings.automation.autoSTICheck || !settings.sti.enabled) return;

    const lower = messageText.toLowerCase();
    const isSex = matchesAny(lower, settings.triggers.sexKeywords);

    if (!isSex) return;

    const roll = rollD100();
    let risk = 10;

    if (settings.contraception.condom) {
        risk *= 0.3;
    }

    if (roll <= risk) {
        settings.sti.infected = ["generic"];
        saveSettingsDebounced();
        sendSystemMessage("🔬 ПРОВЕРКА ИППП: возможное заражение, наблюдайте симптомы.");
    } else {
        sendSystemMessage("🔬 ПРОВЕРКА ИППП: признаков заражения нет.");
    }
}

// ---------- ВСПОМОГАТЕЛЬНОЕ: отправка системных сообщений ----------

function sendSystemMessage(text) {
    // SillyTavern даёт API для добавления сообщений — тут надо использовать тот, что есть у тебя в старом index.js.
    // В простом варианте делаем console.log, чтобы не ломать ничего.
    console.log("[ReproHealth]", text);
}

// ---------- ОБРАБОТКА НОВЫХ СООБЩЕНИЙ ----------

function onMessage(data) {
    if (!data || !data.message) return;
    const text = data.message;

    tryConception(text);
    trySTICheck(text);
}

eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
eventSource.on(event_types.MESSAGE_SENT, onMessage);

// ---------- ИНИЦИАЛИЗАЦИЯ ----------

(function init() {
    getSettings();
    renderPanel();
    console.log("[ReproHealth] initialized");
})();
