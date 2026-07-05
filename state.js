// ═══════════════════════════════════════════
// STATE — доступ к настройкам и данным
// ═══════════════════════════════════════════

import { extension_settings } from '../../../extensions.js';
import { extensionName, defaultPregnancyData, LANG } from './config.js';

export function getSettings() {
    return extension_settings[extensionName];
}

// ──────────────────────────────────────────────────────────────────────
// Управление chatId с кэшем.
// ──────────────────────────────────────────────────────────────────────
let _cachedChatId = null;

export function resetChatIdCache() {
    if (_cachedChatId !== null) {
        console.log(`[Reproductive] chatId cache reset (was: ${_cachedChatId})`);
    }
    _cachedChatId = null;
}

// Все возможные формы id ТЕКУЩЕГО чата, в порядке приоритета:
// uuid:<integrity> > file:<file_name> > hash:<chat_id_hash> > нормализованный ctx.chatId.
// Нужно для миграции: если в разные моменты id резолвился по-разному (например, сначала
// file:, потом uuid:), данные чата «терялись» под старым ключом. getPregnancyData()
// теперь ищет данные по ВСЕМ формам и переносит их под каноничный ключ.
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
    } catch (e) {
        console.warn('[Reproductive] computeChatIdForms error:', e);
    }
    return forms;
}

export function getCurrentChatId() {
    if (_cachedChatId) return _cachedChatId;

    try {
        const forms = computeChatIdForms();
        const resolved = forms.length > 0 ? forms[0] : null;

        if (resolved) {
            _cachedChatId = resolved;
            console.log(`[Reproductive] chatId resolved: ${resolved}`);
            return resolved;
        }

        return null;
    } catch (e) {
        console.warn('[Reproductive] getCurrentChatId error:', e);
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
// Fallback объект (когда chatId === null).
// Используется ТОЛЬКО когда мы не можем определить чат.
//
// ВАЖНО: НИКАКОЙ миграции fallback → постоянное хранилище! Раньше была логика
// «если fallback модифицирован — переносим в чат когда chatId появится», но это
// приводило к УТЕЧКЕ данных между чатами: модификации с конца старого чата
// или промежуточные изменения переезжали в новый чат с новым ботом.
//
// Теперь fallback — просто временное хранилище для случаев когда расширка
// читает данные в момент перехода. Любые модификации в нём ТЕРЯЮТСЯ при
// следующем CHAT_CHANGED. Это безопаснее.
// ──────────────────────────────────────────────────────────────────────
let _fallback = null;

function getFallback() {
    if (!_fallback) _fallback = structuredClone(defaultPregnancyData);
    return _fallback;
}

export function resetFallback() {
    if (_fallback) console.log('[Reproductive] Fallback state reset (any unsaved changes lost — this is intentional)');
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

    // chatId известен, но под каноничным ключом данных нет. Прежде чем создавать чистый объект,
    // ищем данные под АЛЬТЕРНАТИВНЫМИ формами id этого же чата (file:/hash:/plain) и мигрируем.
    // Это чинит «состояние сбросилось к дефолту»: раньше при смене формы резолва id
    // (например file: → uuid:) данные оставались под старым ключом и казались потерянными.
    if (!s.chatPregnancyData[chatId]) {
        const aliases = computeChatIdForms();
        for (const alt of aliases) {
            if (alt !== chatId && s.chatPregnancyData[alt]) {
                s.chatPregnancyData[chatId] = s.chatPregnancyData[alt];
                delete s.chatPregnancyData[alt];
                console.log(`[Reproductive] Migrated pregnancy data key: ${alt} → ${chatId}`);
                break;
            }
        }
    }

    // Если и после миграции пусто — это действительно новый чат, создаём чистый объект.
    // НЕ мигрируем fallback (даже если он модифицирован) — слишком высокий риск утечки.
    if (!s.chatPregnancyData[chatId]) {
        s.chatPregnancyData[chatId] = structuredClone(defaultPregnancyData);
        console.log(`[Reproductive] Fresh pregnancy data for new chatId: ${chatId}`);
    }

    return s.chatPregnancyData[chatId];
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
