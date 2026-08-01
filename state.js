// ═══════════════════════════════════════════
// STATE — доступ к настройкам и данным
// ═══════════════════════════════════════════

import { extension_settings } from '../../../extensions.js';
import { extensionName, defaultPregnancyData, defaultPartnerData, LANG } from './config.js';

export function getSettings() {
    return extension_settings[extensionName];
}

// ──────────────────────────────────────────────────────────────────────
// Управление chatId с кэшем.
// ──────────────────────────────────────────────────────────────────────
let _cachedChatId = null;

export function resetChatIdCache() {
    _cachedChatId = null;
}

// Все формы id текущего чата в порядке приоритета:
// uuid:<integrity> > file:<file_name> > hash:<chat_id_hash> > нормализованный ctx.chatId.
// getPregnancyData() ищет данные по всем формам и переносит под каноничный ключ.
export function computeChatIdForms() {
    const forms = [];
    try {
        const ctx = (typeof SillyTavern?.getContext === 'function')
            ? SillyTavern.getContext()
            : null;
        if (!ctx) return forms;

        const meta = ctx.chatMetadata || ctx.chat_metadata
                  || (typeof window !== 'undefined' ? window.chat_metadata : null);
        if (meta) {
            const integrity = meta.integrity;
            if ((typeof integrity === 'string' && integrity.length > 0) || typeof integrity === 'number') {
                forms.push(`uuid:${String(integrity)}`);
            }
            const fname = meta.file_name || meta.fileName;
            if (typeof fname === 'string' && fname.length > 0) {
                forms.push(`file:${fname}`);
            }
            let hash = meta.chat_id_hash;
            if (hash === undefined || hash === null) hash = meta.chatIdHash;
            if (hash !== undefined && hash !== null && hash !== '') {
                forms.push(`hash:${String(hash)}`);
            }
        }

        const directId = ctx.chatId;
        if ((typeof directId === 'string' && directId.trim().length > 0) || typeof directId === 'number') {
            // Normalize common human-readable form like "Name - 2026-05-28@11h08m17s150ms"
            // by trimming only the high-resolution millisecond suffix.
            let s = String(directId).trim();
            s = s.replace(/\s-\s(\d{4}-\d{2}-\d{2}@\d{2}h\d{2}m\d{2}s)\d*ms$/, ' - $1');
            s = s.replace(/\s@(\d{4}-\d{2}-\d{2}@\d{2}h\d{2}m\d{2}s)\d*ms$/, ' @$1');
            forms.push(s);
        }
    } catch (e) { /* ignore */ }
    return forms;
}

export function getCurrentChatId() {
    if (_cachedChatId) return _cachedChatId;

    try {
        const forms = computeChatIdForms();
        const resolved = forms.length > 0 ? forms[0] : null;

        if (resolved) {
            _cachedChatId = resolved;
            return resolved;
        }

        return null;
    } catch (e) {
        return null;
    }
}

export function getChat() {
    try {
        const context = typeof SillyTavern?.getContext === 'function'
            ? SillyTavern.getContext()
            : window;
        return context?.chat || [];
    } catch (e) {
        return [];
    }
}

// ──────────────────────────────────────────────────────────────────────
// Fallback объект — временное хранилище, когда chatId не определён.
// В постоянное хранилище НЕ мигрирует: изменения теряются на CHAT_CHANGED.
// ──────────────────────────────────────────────────────────────────────
let _fallback = null;

function getFallback() {
    if (!_fallback) _fallback = structuredClone(defaultPregnancyData);
    return _fallback;
}

export function resetFallback() {
    _fallback = null;
}

export function getPregnancyData() {
    const s = getSettings();
    const chatId = getCurrentChatId();

    if (!s.chatPregnancyData) {
        s.chatPregnancyData = {};
    }

    // Нет chatId → fallback объект. ИЗМЕНЕНИЯ В НЁМ НЕ ПЕРЕЕЗЖАЮТ В ПОСТОЯННОЕ ХРАНИЛИЩЕ.
    // Это намеренно: предотвращает утечку данных между чатами в момент перехода.
    if (!chatId) {
        return getFallback();
    }

    // Данных под каноничным ключом нет — ищем под альтернативными формами id и мигрируем
    if (!s.chatPregnancyData[chatId]) {
        const aliases = computeChatIdForms();
        for (const alt of aliases) {
            if (alt !== chatId && s.chatPregnancyData[alt]) {
                s.chatPregnancyData[chatId] = s.chatPregnancyData[alt];
                delete s.chatPregnancyData[alt];
                break;
            }
        }
    }

    // Новый чат — создаём чистый объект (fallback не мигрируем)
    if (!s.chatPregnancyData[chatId]) {
        const fresh = structuredClone(defaultPregnancyData);
        // Каждый новый чат стартует в случайной фазе цикла, а не всегда с 1-го дня
        const heatLen = Math.max(7, parseInt(s.heatCycleLength) || 30);
        const rutLen = Math.max(7, parseInt(s.rutCycleLength) || 30);
        fresh.cycleDay = 1 + Math.floor(Math.random() * 28);
        fresh.heatCycleDay = 1 + Math.floor(Math.random() * heatLen);
        fresh.rutCycleDay = 1 + Math.floor(Math.random() * rutLen);
        fresh.lastCycleUpdate = Date.now();
        fresh.partner = structuredClone(defaultPartnerData);
        fresh.partner.cycleDay = 1 + Math.floor(Math.random() * 28);
        fresh.partner.heatCycleDay = 1 + Math.floor(Math.random() * heatLen);
        fresh.partner.rutCycleDay = 1 + Math.floor(Math.random() * rutLen);
        s.chatPregnancyData[chatId] = fresh;
    }

    return s.chatPregnancyData[chatId];
}

// ──────────────────────────────────────────────────────────────────────
// Носители (s.trackFor = user | char | both): юзер — в корне p, персонаж — в p.partner.
// Дети (babies/grownChildren) общие и лежат в корне — семья одна.
// ──────────────────────────────────────────────────────────────────────
export function getPartnerData() {
    const p = getPregnancyData();
    if (!p.partner) p.partner = structuredClone(defaultPartnerData);
    // Досыпаем новые поля в старые сейвы
    for (const k in defaultPartnerData) {
        if (p.partner[k] === undefined) p.partner[k] = defaultPartnerData[k];
    }
    return p.partner;
}

// Данные носителя по ключу: 'user' → p, 'char' → p.partner
export function getCarrier(who) {
    return who === 'char' ? getPartnerData() : getPregnancyData();
}

// Список активных носителей: [{ who, data }]
export function getCarriers() {
    const s = getSettings();
    const mode = s?.trackFor || 'user';
    const list = [];
    if (mode === 'user' || mode === 'both') list.push({ who: 'user', data: getPregnancyData() });
    if (mode === 'char' || mode === 'both') list.push({ who: 'char', data: getPartnerData() });
    if (list.length === 0) list.push({ who: 'user', data: getPregnancyData() });
    return list;
}

// Имя носителя для UI/промпта
export function carrierName(who) {
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        if (who === 'char') return ctx?.name2 || 'Персонаж';
        return ctx?.name1 || 'Ты';
    } catch (e) {
        return who === 'char' ? 'Персонаж' : 'Ты';
    }
}

// Отслеживается ли носитель
export function isTracked(who) {
    const mode = getSettings()?.trackFor || 'user';
    return mode === 'both' || mode === who;
}

export function L(key) {
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

// ─── Cycle day accessors (per-chat) ───
export function getCycleDay() {
    const p = getPregnancyData();
    if (typeof p.cycleDay === 'number' && p.cycleDay >= 1 && p.cycleDay <= 28) {
        return p.cycleDay;
    }
    const s = getSettings();
    const globalCycle = (typeof s.cycleDay === 'number' && s.cycleDay >= 1 && s.cycleDay <= 28) ? s.cycleDay : 1;
    p.cycleDay = globalCycle;
    if (!p.lastCycleUpdate && s.lastCycleUpdate) p.lastCycleUpdate = s.lastCycleUpdate;
    return p.cycleDay;
}

export function setCycleDay(day, updateTimestamp = true, isUserAction = false) {
    const p = getPregnancyData();
    const d = Math.max(1, Math.min(28, parseInt(day) || 1));
    p.cycleDay = d;
    if (updateTimestamp) p.lastCycleUpdate = Date.now();
    if (isUserAction) {
        // Метка ручной установки цикла — защита от auto-advance в advanceTime
        // (бот-ответ с новым RP_DATE не должен затирать день, выставленный юзером)
        p._userSetCycleAt = Date.now();
    }
    return d;
}
