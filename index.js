// ═══════════════════════════════════════════
// INDEX — точка входа расширения
// ═══════════════════════════════════════════

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { extensionName, defaultSettings } from './config.js';
import { getSettings, getPregnancyData, getCurrentChatId, resetChatIdCache, resetFallback, dlog, dwarn } from './state.js';
import { initCustomNotifications } from './notifications.js';
import { setSyncUI, setUpdatePromptInjection, setRenderInfoblock } from './pregnancy.js';
import { updatePromptInjection } from './prompts.js';
import { syncUI, setupUI } from './ui.js';
import { onMessageReceived, onMessageSent, renderInfoblock, markRegeneration, processDateTag, rescanStatusOnly, rollbackToPosition, clearRegenState } from './message-handler.js';
import { stripHiddenTags, scanFullHistory } from './scanner.js';

// ── Load CSS ──
const cssId = 'reproductive-system-css';
if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = '/scripts/extensions/third-party/Pregnancy/style.css?t=' + Date.now();
    document.head.appendChild(link);
}

function loadSettings() {
    try {
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = structuredClone(defaultSettings);
        } else {
            const s = extension_settings[extensionName];

            // Миграция старых данных
            if (s.isPregnant !== undefined && !s.chatPregnancyData) {
                dlog('[Reproductive] Migrating old data...');
                s.chatPregnancyData = {};
                const chatId = getCurrentChatId();
                if (chatId && s.isPregnant) {
                    s.chatPregnancyData[chatId] = {
                        isPregnant: s.isPregnant,
                        conceptionDate: s.conceptionDate,
                        pregnancyWeeks: s.pregnancyWeeks,
                        rpDate: s.rpDate,
                        fetusCount: s.fetusCount,
                        fetusSex: s.fetusSex,
                        complications: s.complications || [],
                        healthStatus: s.healthStatus || 'normal',
                        lastComplicationCheck: s.lastComplicationCheck,
                    };
                }
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

            // Удаляем устаревшие поля
            delete s.racePreset;
            delete s.fertilityModifier;
            delete s.customRaceName;
            delete s.specialTraits;

            // Добавляем новые поля
            for (const key in defaultSettings) {
                if (s[key] === undefined) {
                    s[key] = defaultSettings[key];
                }
            }

            // ── Repair broken conceptionDate (real-world Date stored vs RP rpDate) ──
            // Old bug: checkConception fell back to `new Date()` when rpDate was missing,
            // creating a real-world ISO that's far ahead of the RP timeline → weeks=0 forever.
            if (s.chatPregnancyData) {
                for (const cid in s.chatPregnancyData) {
                    const cp = s.chatPregnancyData[cid];
                    if (!cp || !cp.isPregnant) continue;

                    // Backfill _conceptionAnchored flag for existing saves
                    if (cp._conceptionAnchored === undefined) {
                        if (cp.conceptionDate && cp.rpDate) {
                            const ct = new Date(cp.conceptionDate).getTime();
                            const rt = new Date(cp.rpDate).getTime();
                            const diffWeeks = (rt - ct) / (7 * 86400000);
                            // Anchored if math matches pregnancyWeeks within 1 week
                            cp._conceptionAnchored = (diffWeeks >= 0 && Math.abs(diffWeeks - (cp.pregnancyWeeks || 0)) <= 1);
                        } else {
                            cp._conceptionAnchored = false;
                        }
                    }

                    if (cp.conceptionDate && cp.rpDate) {
                        const ct = new Date(cp.conceptionDate).getTime();
                        const rt = new Date(cp.rpDate).getTime();
                        if (ct > rt) {
                            dwarn(`[Reproductive] Repair chat ${cid}: conceptionDate (${cp.conceptionDate.slice(0,10)}) > rpDate (${cp.rpDate.slice(0,10)}) — clamping`);
                            // Preserve pregnancyWeeks by shifting conceptionDate backwards from rpDate
                            const w = Math.max(0, cp.pregnancyWeeks || 0);
                            cp.conceptionDate = new Date(rt - w * 7 * 86400000).toISOString();
                            cp._conceptionAnchored = true;
                        }
                    }
                }
            }
        }
        dlog('[Reproductive] Settings loaded');
    } catch (error) {
        console.error('[Reproductive] Error loading settings:', error);
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
}

function refreshAfterChatChange(attempt = 1) {
    const MAX_ATTEMPTS = 6;
    const chatId = getCurrentChatId();
    dlog(`[Reproductive] chat refresh attempt ${attempt} — chatId: ${chatId ?? 'null'}`);
    syncUI();
    updatePromptInjection();
    renderInfoblock();
    if (!chatId && attempt < MAX_ATTEMPTS) {
        setTimeout(() => refreshAfterChatChange(attempt + 1), 200);
        return;
    }
    if (chatId) {
        maybeBootstrapFromHistory();
    }
}

// ── Авто-bootstrap: если чат открыт впервые для расширки (девственное состояние),
// но в нём уже есть история сообщений — тихо сканируем её и восстанавливаем
// состояние (даты, зачатия, роды, срок из текста). Кейс «играю уже беременная,
// а расширку включила/поставила позже».
let _bootstrapRunning = false;
async function maybeBootstrapFromHistory() {
    if (_bootstrapRunning) return;
    try {
        const s = getSettings();
        if (!s.isEnabled) return;
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat;
        if (!chat || chat.length < 2) return;

        const p = getPregnancyData();
        if (p._bootstrapDone) return;

        // Девственное состояние = расширка этот чат ещё не вела
        const virgin = !p.isPregnant && !p.hasBaby && !p.rpDate
            && (!Array.isArray(p._history) || p._history.length === 0);
        p._bootstrapDone = true;
        if (!virgin) {
            saveSettingsDebounced();
            return;
        }

        _bootstrapRunning = true;
        dlog(`[Reproductive] Virgin state + ${chat.length} messages in chat — bootstrapping from history...`);
        const stats = await scanFullHistory();
        getPregnancyData()._bootstrapDone = true; // scanFullHistory сбрасывает состояние — вернуть флаг
        dlog('[Reproductive] Bootstrap scan done:', stats);
        saveSettingsDebounced();
        syncUI();
        updatePromptInjection();
        setTimeout(renderInfoblock, 300);
    } catch (e) {
        dwarn('[Reproductive] Bootstrap from history failed:', e);
    } finally {
        _bootstrapRunning = false;
    }
}

jQuery(async () => {
    try {
        dlog('[Reproductive] Loading...');

        loadSettings();

        // Связываем circular deps
        setSyncUI(syncUI);
        setUpdatePromptInjection(updatePromptInjection);
        setRenderInfoblock(renderInfoblock);

        initCustomNotifications();
        setupUI();
        updatePromptInjection();

        // Сканирование при получении нового сообщения (основной путь)
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

        // ── Common handler для финального скана, рендера infoblock и скрытия тегов ──
        // В некоторых конфигурациях ST CHARACTER_MESSAGE_RENDERED приходит раньше
        // MESSAGE_RECEIVED. Поэтому сначала повторно читаем ПОЛНЫЙ исходный текст:
        // rescanStatusOnly идемпотентно перезаписывает динамический RP_STATUS и гарантирует,
        // что вручную добавленный малыш получит mood/sleep/feeding/diaper из ответа модели.
        const processFinalMessage = (messageIndex) => {
            try {
                const context = SillyTavern.getContext();
                let idx = messageIndex;
                // GENERATION_ENDED gives chat.length, not message index — adjust
                if (typeof idx !== 'number' || idx >= context.chat.length) {
                    idx = context.chat.length - 1;
                }
                const msg = context.chat[idx];
                if (!msg || !msg.mes || msg.is_user) {
                    setTimeout(renderInfoblock, 200);
                    return;
                }
                // Сканируем до stripHiddenTags: после удаления HTML-комментария
                // RP_STATUS восстановить из msg.mes уже невозможно.
                try {
                    rescanStatusOnly(msg.mes);
                } catch (e) {
                    dwarn('[Reproductive] Final RP_STATUS rescan failed:', e);
                }
                // Скрываем теги только в отображаемом DOM. msg.mes оставляем исходным:
                // технические комментарии нужны при повторном скане, swipe и открытии чата.
                if (
                    msg.mes.includes('<!--') &&
                    (msg.mes.includes('[CONCEPTION_CHECK]') ||
                     msg.mes.includes('[BIRTH]') ||
                     msg.mes.includes('[MISCARRIAGE]') ||
                     msg.mes.includes('[ABORTION]') ||
                     msg.mes.includes('[SEX_REVEAL]') ||
                     msg.mes.includes('[CYCLE_DAY') ||
                     msg.mes.includes('[RP_STATUS:') ||
                     msg.mes.includes('[RP_DATE:') ||
                     msg.mes.includes('[PREGNANCY_STATE:') ||
                     msg.mes.includes('[BABY_TRAITS:'))
                ) {
                    // Если включён debug режим — оставляем теги в чате для отладки
                    const s = getSettings();
                    if (!s.debugKeepTags) {
                        const renderedMessage = document.querySelector(`.mes[mesid="${idx}"] .mes_text`);
                        if (renderedMessage) {
                            renderedMessage.innerHTML = stripHiddenTags(renderedMessage.innerHTML);
                        }
                    }
                }
            } catch (e) {
                dwarn('[Reproductive] processFinalMessage error:', e);
            }
            setTimeout(renderInfoblock, 300);
            setTimeout(renderInfoblock, 800); // second pass — survives ST's own re-render
        };

        // Fallback: рендер инфоблока + скрытие тегов после отрисовки сообщения (НЕ-streaming)
        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, processFinalMessage);
        }

        // GENERATION_ENDED — ЕДИНСТВЕННЫЙ хук для стриминговых swipe/continue
        // (SillyTavern для них не эмитит ни MESSAGE_RECEIVED, ни CHARACTER_MESSAGE_RENDERED).
        // КРИТИЧНО: сканируем ДО processFinalMessage — иначе стрип вырежет теги из msg.mes
        // раньше, чем сканер их прочитает, и данные потеряются навсегда.
        // runScan дедупит по позиции+хэшу текста — двойного сканирования не будет.
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, (messageIndex) => {
                // 1) Скан полного текста (пока теги ещё на месте)
                try { onMessageReceived(messageIndex, 'final'); } catch (e) {}
                // 2) Потом чистим теги и рендерим инфоблок
                processFinalMessage(messageIndex);
            });
        }

        // Обновление при отправке сообщения — также сканируем пользовательский текст
        // ("я рожаю", "у нас будет девочка", "кончает в меня" и т.п.)
        eventSource.on(event_types.MESSAGE_SENT, (messageIndex, type) => {
            updatePromptInjection();
            onMessageSent(messageIndex, type);
            setTimeout(renderInfoblock, 500);
        });

        // Regeneration / swipe — mark so time doesn't double-count
        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, () => {
                dlog('[Reproductive] Swipe detected — marking regeneration');
                markRegeneration();
            });
        }
        if (event_types.GENERATION_STARTED) {
            // ВАЖНО: GENERATION_STARTED стреляет в САМОМ НАЧАЛЕ Generate() — ДО того как
            // сообщение юзера добавлено в чат. Старая эвристика «длина чата не выросла =
            // реген» из-за этого помечала регеном КАЖДУЮ обычную отправку: последним в чате
            // ещё висел прошлый бот-пост, длина совпадала с _lastScannedPosition. Дальше скан
            // юзерского сообщения «восстанавливал» снапшот до бот-поста → терялись _dynamic
            // (инфоблок падал на заглушки), сдвиги даты и цикла.
            // Теперь используем ЯВНЫЙ тип генерации, который ST передаёт первым аргументом.
            eventSource.on(event_types.GENERATION_STARTED, (genType, params, dryRun) => {
                if (dryRun) return;
                if (genType === 'regenerate' || genType === 'swipe') {
                    dlog(`[Reproductive] Regeneration detected via GENERATION_STARTED (type=${genType})`);
                    markRegeneration();
                }
            });
        }

        // Re-render infoblock after message edit/swipe
        if (event_types.MESSAGE_EDITED) {
            eventSource.on(event_types.MESSAGE_EDITED, () => {
                setTimeout(renderInfoblock, 400);
            });
        }
        if (event_types.MESSAGE_UPDATED) {
            eventSource.on(event_types.MESSAGE_UPDATED, () => {
                setTimeout(renderInfoblock, 400);
            });
        }

        // Смена чата
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                // Guard: many ST operations emit CHAT_CHANGED even for small metadata updates
                // (e.g. filename/timestamp updates). Only perform a full reset when the
                // resolved chatId actually changes. Otherwise keep per-chat data intact.
                try {
                    const prevId = getCurrentChatId();
                    // Allow ST to update context, then re-resolve
                    setTimeout(() => {
                        // Clear cached resolution and obtain fresh id
                        resetChatIdCache();
                        const newId = getCurrentChatId();
                        dlog(`[Reproductive] Chat changed — prev:${prevId ?? 'null'} new:${newId ?? 'null'}`);
                            const s = getSettings();
                            // Consider same logical chat carefully:
                            // - If either id is a uuid: prefix, compare uuids exactly.
                            // - If both are 'file:' or plain strings, compare normalized base names
                            //   (strip ms suffix). Treat mixed types as different to avoid
                            //   accidentally merging distinct chats.
                            const isSame = (() => {
                                try {
                                    // Оба id неизвестны → считаем чаты РАЗНЫМИ: если оба чата жили
                                    // в fallback, его надо сбросить, иначе состояние утечёт между ними.
                                    if (prevId == null && newId == null) return false;
                                    if (prevId === newId) return true;
                                    const parseId = (id) => {
                                        if (!id) return { type: null, val: null, base: null };
                                        const s = String(id);
                                        const m = s.match(/^([^:]+):(.+)$/);
                                        if (m) {
                                            const type = m[1];
                                            const val = m[2];
                                            const base = String(val).replace(/\s-\s\d{4}-\d{2}-\d{2}@.*$/, '').replace(/\s@\d{4}-\d{2}-\d{2}@.*$/, '');
                                            return { type, val, base };
                                        }
                                        return { type: 'plain', val: s, base: s.replace(/\s-\s\d{4}-\d{2}-\d{2}@.*$/, '').replace(/\s@\d{4}-\d{2}-\d{2}@.*$/, '') };
                                    };
                                    const a = parseId(prevId);
                                    const b = parseId(newId);
                                    // If either is uuid, require exact match
                                    if (a.type === 'uuid' || b.type === 'uuid') return a.type === b.type && a.val === b.val;
                                    // If both have the same typed val, treat same
                                    if (a.type && b.type && a.type === b.type && a.val === b.val) return true;
                                    // If both are file/plain compare base
                                    const allowed = (t) => t === 'plain' || t === 'file';
                                    if (allowed(a.type) && allowed(b.type)) return a.base === b.base;
                                    return false;
                                } catch (e) { return false; }
                            })();

                            if (isSame) {
                                // Same logical chat — do not wipe fallback or per-chat storage.
                                s._lastScannedPosition = null;
                                s._processedMessageHashes = {};
                                // Quick UI refresh to pick up any metadata changes
                                refreshAfterChatChange(1);
                                return;
                            }

                        // Different chat — perform full reset as before
                        resetFallback();
                        clearRegenState(); // снапшот регенерации из старого чата не должен пережить смену чата
                        s._lastScannedPosition = null;
                        s._lastScannedHash = null;
                        s._lastScannedHashStripped = null;
                        s._lastConceptionRollAt = null;
                        s._processedMessageHashes = {};
                        setTimeout(() => refreshAfterChatChange(1), 100);
                    }, 80);
                } catch (e) {
                    // Fallback to previous behavior on error
                    dwarn('[Reproductive] CHAT_CHANGED handler failed, falling back to full reset', e);
                    resetChatIdCache();
                    resetFallback();
                    clearRegenState();
                    const s = getSettings();
                    s._lastScannedPosition = null;
                    s._lastScannedHash = null;
                    s._lastScannedHashStripped = null;
                    s._lastConceptionRollAt = null;
                    s._processedMessageHashes = {};
                    setTimeout(() => refreshAfterChatChange(1), 100);
                }
            });
        }

        // Удаление сообщения — ОТКАТ состояния к снапшоту предыдущей позиции.
        // Кейс: в сообщении случилось зачатие, юзер удаляет его → беременность отменяется,
        // состояние возвращается к тому, что было до этого сообщения.
        // ST эмитит MESSAGE_DELETED с НОВОЙ длиной чата (после удаления).
        if (event_types.MESSAGE_DELETED) {
            eventSource.on(event_types.MESSAGE_DELETED, (newLength) => {
                dlog(`[Reproductive] Message deleted — rolling back state (new len: ${newLength})`);
                const s = getSettings();
                s._lastScannedPosition = null;
                s._lastScannedHash = null;
                s._lastScannedHashStripped = null;
                s._lastConceptionRollAt = null;
                try {
                    const len = typeof newLength === 'number'
                        ? newLength
                        : (SillyTavern.getContext()?.chat?.length ?? 0);
                    const rolled = rollbackToPosition(len);
                    if (rolled) {
                        dlog('[Reproductive] State rollback after deletion: OK');
                    }
                } catch (e) {
                    dwarn('[Reproductive] Rollback after deletion failed:', e);
                }
                saveSettingsDebounced();
                syncUI();
                updatePromptInjection();
                setTimeout(renderInfoblock, 300);
            });
        }

        dlog('[Reproductive] Ready!');

        // ── MutationObserver: re-insert infoblock if ST removes it during re-render ──
        // Continue/edit/swipe rebuild .mes_text, wiping our injected element.
        // Watch the chat container and re-render when the last bot message changes.
        try {
            const chatEl = document.getElementById('chat');
            if (chatEl) {
                let pending = false;
                const reinsert = () => {
                    if (pending) return;
                    pending = true;
                    requestAnimationFrame(() => {
                        pending = false;
                        try {
                            // Only re-insert if our block is missing from the last bot message
                            const all = document.querySelectorAll('.mes:not([is_system="true"])');
                            let lastBot = null;
                            for (let i = all.length - 1; i >= 0; i--) {
                                if (all[i].getAttribute('is_user') === 'false' && !all[i].classList.contains('gp-sms-hidden')) { lastBot = all[i]; break; }
                            }
                            if (!lastBot) return;
                            if (!lastBot.querySelector('.rp-infoblock-inserted')) {
                                renderInfoblock();
                            }
                        } catch (e) { /* ignore */ }
                    });
                };
                const observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        // Watch for child changes inside .mes_text and new messages added
                        if (m.target && (m.target.classList?.contains('mes_text') || m.target.classList?.contains('mes'))) {
                            reinsert();
                            return;
                        }
                        // Also re-insert when nodes are removed (our block got wiped)
                        for (const n of m.removedNodes || []) {
                            if (n.classList?.contains('rp-infoblock-inserted')) {
                                reinsert();
                                return;
                            }
                        }
                    }
                });
                observer.observe(chatEl, { childList: true, subtree: true });
                dlog('[Reproductive] Infoblock observer attached');
            }
        } catch (e) {
            dwarn('[Reproductive] Observer setup failed:', e);
        }

    } catch (error) {
        console.error('[Reproductive] FATAL ERROR:', error);
    }
});
