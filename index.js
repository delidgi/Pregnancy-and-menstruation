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
            "кончил в неё", "кончил в нее",
            "кончив в неё", "кончив в нее",
            "кончив в нее без защиты",
            "излился в неё", "излился в нее",
            "излился внутрь", "излился в нее без защиты",
            "спустил внутрь", "семя внутри",
            "наполняет её", "наполняет ее",
            "наполнив её", "наполнив ее",
            "заливает внутрь", "заполняет её", "заполняет ее",
            "creampie", "came inside", "cum inside", "cums inside", "filling her", "finishing inside"
        ],
        vaginalKeywords: [
            "в неё", "в нее", "внутрь неё", "внутрь нее",
            "во влагалище", "в вагину", "в её лоно", "в ее лоно",
            "между ног", "глубоко в неё", "глубоко в нее",
            "in her pussy", "into her vagina", "between her legs", "deep inside"
        ],
        sexKeywords: [
            "занялись сексом", "занимается сексом", "совокупляются",
            "оральный секс", "анальный секс", "трахает", "трахается",
            "трахался", "трахались", "лижет", "сосёт", "сосет",
            "целует её", "целует ее", "ласкает её", "ласкает ее",
            "fuck", "fucks", "fucking", "having sex", "oral", "anal", "sucking", "licking"
        ],
        condomOnKeywords: [
            "надел презерватив", "надевает презерватив", "натянул презерватив",
            "раскатал презерватив", "надо надеть", "put on condom", "condom on"
        ],
        condomOffKeywords: [
            "снял презерватив", "снимает презерватив", "без презерватива",
            "сорвал презерватив", "removed condom", "no condom", "without condom"
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
            baseTwinChance: 3,
            baseTripletChance: 0.3,
            revealSexWeek: 12
        }
    },
    sti: {
        enabled: true,
        infected: [],
        lastTest: null
    },
    lastTriggerTime: 0,
    triggerCooldown: 5000
};

function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
        saveSettingsDebounced();
    }
    return extension_settings[extensionName];
}

function matchesAny(text, list) {
    if (!text || !list) return false;
    const lower = text.toLowerCase();
    return list.some(k => lower.includes(k.toLowerCase()));
}

function rollD100() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return (arr[0] % 100) + 1;
}

function addMessage(character, text, isUser = false) {
    try {
        const messageElement = document.createElement("div");
        messageElement.className = "message is_system";
        messageElement.innerHTML = `<div class="mes_block">${text}</div>`;
        const chatMessages = document.querySelector("#chat");
        if (chatMessages) {
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    } catch (e) {
        console.error("[ReproHealth] Failed to add message:", e);
    }
}

function renderPanel() {
    const settings = getSettings();

    let existing = document.getElementById("reprohealth-panel");
    if (!existing) {
        existing = document.createElement("div");
        existing.id = "reprohealth-panel";
        document.body.appendChild(existing);
    }

    const preg = settings.pregnancy;
    const fert = settings.fertility;
    const contra = settings.contraception;

    let pregnancyLine = preg.isPregnant ? `да, неделя ${preg.currentWeek}` : "нет";
    let fetusLine = preg.isPregnant ? `${preg.fetusCount}` : "-";
    let sexLine = "-";

    if (preg.isPregnant && preg.currentWeek >= preg.config.revealSexWeek) {
        const sexNames = preg.fetusSexes.map(sex => {
            if (sex === "male") return "👦";
            if (sex === "female") return "👧";
            return "❓";
        });
        sexLine = sexNames.join(" ");
    } else if (preg.isPregnant) {
        sexLine = "🔄 неизвестен";
    }

    let fertilityStatus = "норма";
    const cycleDay = fert.cycleDay;
    if (cycleDay >= 12 && cycleDay <= 16) {
        fertilityStatus = "🔥 ВЫСОКАЯ";
    } else if (cycleDay >= 1 && cycleDay <= 5) {
        fertilityStatus = "❄️ низкая";
    }

    const condomStatus = contra.condom ? "🟢 ВКЛ" : "🔴 ВЫКЛ";
    const pillStatus = contra.pill ? "🟢 ВКЛ" : "🔴 ВЫКЛ";

    existing.innerHTML = `
        <div style="position: fixed; right: 16px; bottom: 90px; width: 260px; background: rgba(255,107,157,0.25); border: 1px solid rgba(255,255,255,0.3); border-radius: 12px; padding: 12px; color: white; font-family: Arial, sans-serif; font-size: 12px; backdrop-filter: blur(10px); box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 10000; pointer-events: auto;">
            <div style="font-weight: bold; margin-bottom: 8px; display: flex; justify-content: space-between;">
                <span>🩺 Repro Health</span>
                <span style="font-size: 10px; opacity: 0.7;">Авто</span>
            </div>
            
            <div style="background: rgba(0,0,0,0.25); border-radius: 8px; padding: 8px; margin-bottom: 8px; font-size: 11px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span>День цикла:</span>
                    <span style="font-weight: bold;">${cycleDay}/28</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span>Фертильность:</span>
                    <span style="font-weight: bold;">${fertilityStatus}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span>Беременность:</span>
                    <span style="font-weight: bold;">${pregnancyLine}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span>Эмбрионов:</span>
                    <span style="font-weight: bold;">${fetusLine}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span>Пол:</span>
                    <span style="font-weight: bold;">${sexLine}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>ИППП:</span>
                    <span style="font-weight: bold;">${settings.sti.infected.length > 0 ? "⚠️ Заражена" : "✅ Чистая"}</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                <button id="repro-condom-btn" style="padding: 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); background: ${contra.condom ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.25)'}; color: white; cursor: pointer; font-size: 10px; font-weight: bold; font-family: Arial;">Презерватив<br/>${condomStatus}</button>
                <button id="repro-pill-btn" style="padding: 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); background: ${contra.pill ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.25)'}; color: white; cursor: pointer; font-size: 10px; font-weight: bold; font-family: Arial;">Таблетки<br/>${pillStatus}</button>
            </div>

            <div style="font-size: 9px; opacity: 0.7; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 4px;">⚡ Вагинал + без защиты = беременность. Любой секс = ИППП.</div>
        </div>
    `;

    setTimeout(() => {
        const condomBtn = document.getElementById("repro-condom-btn");
        const pillBtn = document.getElementById("repro-pill-btn");

        if (condomBtn) {
            condomBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                settings.contraception.condom = !settings.contraception.condom;
                saveSettingsDebounced();
                renderPanel();
                addMessage("System", `🩹 Презерватив ${settings.contraception.condom ? "надет" : "снят"}`);
            };
        }

        if (pillBtn) {
            pillBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                settings.contraception.pill = !settings.contraception.pill;
                saveSettingsDebounced();
                renderPanel();
                addMessage("System", `💊 Таблетки ${settings.contraception.pill ? "приняты" : "отменены"}`);
            };
        }
    }, 50);
}

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

    const sexDisplay = sexes.map(s => s === "male" ? "👦" : "👧").join(" ");
    addMessage("System", `🤰 <b>БРОСОК НА ЗАЧАТИЕ:</b> ✅ Зачатие произошло!\n<b>Эмбрионов:</b> ${fetusCount}\n<b>Пол:</b> ${sexDisplay}`);
}

function tryConception(messageText) {
    const settings = getSettings();
    if (!settings.automation.autoConception) return;
    if (!messageText) return;

    const lower = messageText.toLowerCase();
    const isInside = matchesAny(lower, settings.triggers.conceptionKeywords);
    const isVaginal = matchesAny(lower, settings.triggers.vaginalKeywords);

    if (!isInside || !isVaginal) return;
    if (settings.pregnancy.isPregnant) return;

    const now = Date.now();
    if (now - settings.lastTriggerTime < settings.triggerCooldown) return;
    settings.lastTriggerTime = now;

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
    } else {
        addMessage("System", `🤰 <b>БРОСОК НА ЗАЧАТИЕ:</b> ❌ На этот раз беременность не наступила. (Шанс был: ${chance.toFixed(1)}%)`);
    }

    saveSettingsDebounced();
}

function trySTICheck(messageText) {
    const settings = getSettings();
    if (!settings.automation.autoSTICheck || !settings.sti.enabled) return;
    if (!messageText) return;

    const lower = messageText.toLowerCase();
    const isSex = matchesAny(lower, settings.triggers.sexKeywords);

    if (!isSex) return;

    const now = Date.now();
    if (now - settings.lastTriggerTime < settings.triggerCooldown) return;

    const roll = rollD100();
    let risk = 10;

    if (settings.contraception.condom) {
        risk = Math.max(risk * 0.3, 2);
    }

    if (roll <= risk) {
        const stiTypes = ["Хламидиоз", "Гонорея", "Герпес", "ВПЧ"];
        const randomSTI = stiTypes[Math.floor(Math.random() * stiTypes.length)];
        settings.sti.infected = [randomSTI];
        saveSettingsDebounced();
        addMessage("System", `🔬 <b>ПРОВЕРКА ИППП:</b> ⚠️ Возможное заражение!\n<b>Заболевание:</b> ${randomSTI}\n<b>Наблюдайте симптомы...</b>`);
    } else {
        addMessage("System", `🔬 <b>ПРОВЕРКА ИППП:</b> ✅ Признаков заражения не обнаружено.`);
    }

    saveSettingsDebounced();
}

function onMessage(data) {
    if (!data) return;

    const messageText = data.message || data.mes || "";
    if (!messageText || messageText.length < 5) return;

    tryConception(messageText);
    trySTICheck(messageText);
}

function initialize() {
    console.log("[ReproHealth] ✅ Initializing...");
    getSettings();

    renderPanel();

    setTimeout(() => {
        const panel = document.getElementById("reprohealth-panel");
        if (!panel) {
            console.log("[ReproHealth] Panel not found, re-rendering...");
            renderPanel();
        }
    }, 500);

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
    eventSource.on(event_types.MESSAGE_SENT, onMessage);

    console.log("[ReproHealth] ✅ Ready!");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
} else {
    initialize();
}

if (eventSource) {
    eventSource.on(event_types.APP_READY, () => {
        console.log("[ReproHealth] APP_READY event");
        setTimeout(() => {
            renderPanel();
        }, 500);
    });
}

window.ReproHealth = {
    getSettings,
    renderPanel,
    rollD100,
    initiatePregnancy,
    tryConception,
    trySTICheck,
    initialize
};

console.log("[ReproHealth] ✅ Script loaded. ReproHealth object exported.");
