import { extension_settings, saveSettingsDebounced } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";

const extensionName = "reproductive-health";

const defaultSettings = {
    enabled: true,
    automation: { autoConception: true, autoSTICheck: true },
    triggers: {
        conceptionKeywords: ["кончил внутрь", "кончила внутрь", "кончает внутрь", "кончил в неё", "кончил в нее", "кончив в неё", "кончив в нее", "кончив в нее без защиты", "излился в неё", "излился в нее", "излился внутрь", "излился в нее без защиты", "спустил внутрь", "семя внутри", "наполняет её", "наполняет ее", "наполнив её", "наполнив ее", "заливает внутрь", "заполняет её", "заполняет ее", "creampie", "came inside", "cum inside", "cums inside", "filling her", "finishing inside"],
        vaginalKeywords: ["в неё", "в нее", "внутрь неё", "внутрь нее", "во влагалище", "в вагину", "в её лоно", "в ее лоно", "между ног", "глубоко в неё", "глубоко в нее", "in her pussy", "into her vagina", "between her legs", "deep inside"],
        sexKeywords: ["занялись сексом", "занимается сексом", "совокупляются", "оральный секс", "анальный секс", "трахает", "трахается", "трахался", "трахались", "лижет", "сосёт", "сосет", "целует её", "целует ее", "ласкает её", "ласкает ее", "fuck", "fucks", "fucking", "having sex", "oral", "anal", "sucking", "licking"]
    },
    contraception: { condom: false, pill: false },
    fertility: { baseFertility: 25, cycleDay: 1, cycleLength: 28 },
    pregnancy: {
        isPregnant: false,
        conceptionDate: null,
        currentWeek: 0,
        fetusCount: 1,
        fetusSexes: [],
        config: { baseTwinChance: 3, baseTripletChance: 0.3, revealSexWeek: 12 }
    },
    sti: { enabled: true, infected: [], lastTest: null },
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

function addMessage(text) {
    try {
        const msg = document.createElement("div");
        msg.className = "message is_system";
        msg.innerHTML = `<div class="mes_block">${text}</div>`;
        const chat = document.querySelector("#chat");
        if (chat) {
            chat.appendChild(msg);
            chat.scrollTop = chat.scrollHeight;
        }
    } catch (e) {
        console.error("[ReproHealth]", e);
    }
}

function renderPanel() {
    const s = getSettings();
    const p = s.pregnancy;
    const f = s.fertility;
    const c = s.contraception;

    let pLine = p.isPregnant ? `да, неделя ${p.currentWeek}` : "нет";
    let fLine = p.isPregnant ? `${p.fetusCount}` : "-";
    let sLine = p.isPregnant && p.currentWeek >= p.config.revealSexWeek ? p.fetusSexes.map(x => x === "male" ? "👦" : "👧").join(" ") : p.isPregnant ? "🔄" : "-";

    let fStat = "норма";
    if (f.cycleDay >= 12 && f.cycleDay <= 16) fStat = "🔥 ВЫСОКАЯ";
    else if (f.cycleDay >= 1 && f.cycleDay <= 5) fStat = "❄️ низкая";

    const cStat = c.condom ? "🟢 ON" : "🔴 OFF";
    const pStat = c.pill ? "🟢 ON" : "🔴 OFF";

    let panel = document.getElementById("reprohealth-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "reprohealth-panel";
        document.body.appendChild(panel);
    }

    panel.innerHTML = `
        <div style="background: rgba(255,107,157,0.25); border: 1px solid rgba(255,255,255,0.3); border-radius: 12px; padding: 12px; width: 260px; color: white; font-family: Arial; font-size: 12px; backdrop-filter: blur(10px); box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 10000; position: fixed; right: 16px; bottom: 90px;">
            <div style="font-weight: bold; margin-bottom: 8px; display: flex; justify-content: space-between;">
                <span>🩺 Repro Health</span>
                <span style="font-size: 10px; opacity: 0.7;">Auto</span>
            </div>
            <div style="background: rgba(0,0,0,0.25); border-radius: 8px; padding: 8px; margin-bottom: 8px; font-size: 11px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;"><span>День цикла:</span><span style="font-weight: bold;">${f.cycleDay}/28</span></div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;"><span>Фертильность:</span><span style="font-weight: bold;">${fStat}</span></div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;"><span>Беременность:</span><span style="font-weight: bold;">${pLine}</span></div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;"><span>Эмбрионов:</span><span style="font-weight: bold;">${fLine}</span></div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;"><span>Пол:</span><span style="font-weight: bold;">${sLine}</span></div>
                <div style="display: flex; justify-content: space-between;"><span>ИППП:</span><span style="font-weight: bold;">${s.sti.infected.length > 0 ? "⚠️ Заражена" : "✅ Чистая"}</span></div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                <button id="repro-condom-btn" style="padding: 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); background: ${c.condom ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.25)'}; color: white; cursor: pointer; font-size: 10px; font-weight: bold; font-family: Arial;">Презерватив<br>${cStat}</button>
                <button id="repro-pill-btn" style="padding: 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); background: ${c.pill ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.25)'}; color: white; cursor: pointer; font-size: 10px; font-weight: bold; font-family: Arial;">Таблетки<br>${pStat}</button>
            </div>
            <div style="font-size: 9px; opacity: 0.7; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 4px;">⚡ Вагинал + без защиты = беременность. Любой секс = ИППП.</div>
        </div>
    `;

    setTimeout(() => {
        const condomBtn = document.getElementById("repro-condom-btn");
        const pillBtn = document.getElementById("repro-pill-btn");

        if (condomBtn) {
            condomBtn.onclick = () => {
                s.contraception.condom = !s.contraception.condom;
                saveSettingsDebounced();
                renderPanel();
                addMessage(`🩹 Презерватив ${s.contraception.condom ? "надет" : "снят"}`);
            };
        }

        if (pillBtn) {
            pillBtn.onclick = () => {
                s.contraception.pill = !s.contraception.pill;
                saveSettingsDebounced();
                renderPanel();
                addMessage(`💊 Таблетки ${s.contraception.pill ? "приняты" : "отменены"}`);
            };
        }
    }, 50);
}

function initiatePregnancy() {
    const s = getSettings();
    const p = s.pregnancy;
    p.isPregnant = true;
    p.conceptionDate = new Date().toISOString();
    p.currentWeek = 1;

    const twinRoll = rollD100();
    let fetusCount = 1;
    if (twinRoll <= p.config.baseTripletChance) fetusCount = 3;
    else if (twinRoll <= p.config.baseTripletChance + p.config.baseTwinChance) fetusCount = 2;

    p.fetusCount = fetusCount;
    const sexes = [];
    for (let i = 0; i < fetusCount; i++) {
        sexes.push(rollD100() <= 50 ? "female" : "male");
    }
    p.fetusSexes = sexes;

    saveSettingsDebounced();
    renderPanel();

    const sexDisplay = sexes.map(s => s === "male" ? "👦" : "👧").join(" ");
    addMessage(`🤰 <b>ЗАЧАТИЕ:</b> ✅ Произошло! Эмбрионов: ${fetusCount}, Пол: ${sexDisplay}`);
}

function tryConception(messageText) {
    const s = getSettings();
    if (!s.automation.autoConception || !messageText) return;

    const lower = messageText.toLowerCase();
    const isInside = matchesAny(lower, s.triggers.conceptionKeywords);
    const isVaginal = matchesAny(lower, s.triggers.vaginalKeywords);

    if (!isInside || !isVaginal || s.pregnancy.isPregnant) return;

    const now = Date.now();
    if (now - s.lastTriggerTime < s.triggerCooldown) return;
    s.lastTriggerTime = now;

    const fertileRoll = rollD100();
    let chance = s.fertility.baseFertility;
    if (s.contraception.condom) chance *= 0.15;
    if (s.contraception.pill) chance *= 0.1;

    if (fertileRoll <= chance) {
        initiatePregnancy();
    } else {
        addMessage(`🤰 <b>ЗАЧАТИЕ:</b> ❌ На этот раз нет (шанс был ${chance.toFixed(1)}%)`);
    }

    saveSettingsDebounced();
}

function trySTICheck(messageText) {
    const s = getSettings();
    if (!s.automation.autoSTICheck || !s.sti.enabled || !messageText) return;

    const lower = messageText.toLowerCase();
    const isSex = matchesAny(lower, s.triggers.sexKeywords);
    if (!isSex) return;

    const now = Date.now();
    if (now - s.lastTriggerTime < s.triggerCooldown) return;

    const roll = rollD100();
    let risk = 10;
    if (s.contraception.condom) risk = Math.max(risk * 0.3, 2);

    if (roll <= risk) {
        const stiTypes = ["Хламидиоз", "Гонорея", "Герпес", "ВПЧ"];
        const randomSTI = stiTypes[Math.floor(Math.random() * stiTypes.length)];
        s.sti.infected = [randomSTI];
        saveSettingsDebounced();
        addMessage(`🔬 <b>ИППП:</b> ⚠️ Возможное заражение! Болезнь: ${randomSTI}`);
    } else {
        addMessage(`🔬 <b>ИППП:</b> ✅ Всё чисто`);
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

function init() {
    console.log("[ReproHealth] ✅ Loading...");
    getSettings();
    renderPanel();
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
    eventSource.on(event_types.MESSAGE_SENT, onMessage);
    console.log("[ReproHealth] ✅ Ready!");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

window.ReproHealth = { getSettings, renderPanel, init };
