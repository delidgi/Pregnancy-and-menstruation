// ═══════════════════════════════════════════
// MESSAGE-HANDLER — обработка входящих сообщений
// ═══════════════════════════════════════════

import { getSettings, getPregnancyData, getCycleDay, setCycleDay, getCurrentChatId } from './state.js';
import { scanMessage, scanDateTag, scanStatusTag, scanWeeksFromText, scanPregnancyStateTag, stripHiddenTags, stripThink, stripReproTags, hasReproTags, messageRaw } from './scanner.js';
import { applyScanResult, createPregnancyFromWeeks, createPregnancyFromStateTag, partnerCheckConception, partnerBirth, getPostpartum, canTriggerBirth } from './pregnancy.js';
import { getPartnerData, carrierName, isTracked } from './state.js';
import { hasMenstrualCycle, hasCycle, cyclePhase } from './omegaverse.js';
import { updateBabyCare } from './baby-care.js';
import { DISRUPTIONS, disruptionShift } from './cycle-realism.js';
import { updatePromptInjection } from './prompts.js';
import { syncUI, buildInfoblockHtml } from './ui.js';
import { showNotification } from './notifications.js';
import { saveSettingsDebounced } from '../../../../script.js';

// ─── Get last N messages as context for AI ───

function getRecentMessages(count = 3) {
    const chat = typeof SillyTavern?.getContext === 'function'
        ? SillyTavern.getContext().chat
        : window.chat;
    if (!chat || chat.length === 0) return [];

    const msgs = [];
    for (let i = chat.length - 1; i >= 0 && msgs.length < count; i--) {
        const msg = chat[i];
        if (msg && msg.mes && !msg.is_system) {
            msgs.unshift(msg);
        }
    }
    return msgs;
}


// ─── Технические теги не должны попадать в контекст модели ───
// Раньше они оставались в msg.mes «для повторного скана» — и уходили в промпт
// при каждой генерации. Модель их копировала и тянула старый сюжет (омегаверс
// из прежних полей), даже когда расширение выключено. Теперь после скана текст
// сообщения чистится, а исходник живёт в msg.extra.reproRaw.

// Исходник читается только если соответствует текущему тексту и свайпу.
export function rawTextOf(msg) {
    return messageRaw(msg);
}

// Вырезать теги из сообщения, сохранив исходник. true — если что-то изменилось
export function detachTags(msg) {
    if (!msg || !msg.mes || !hasReproTags(msg.mes)) return false;
    const raw = msg.mes;
    const clean = stripReproTags(raw);
    if (!clean || clean === raw) return false;
    msg.extra = msg.extra || {};
    msg.extra.reproRaw = raw;
    msg.extra.reproRawSwipe = msg.swipe_id ?? null;
    delete msg.extra.reproRawInvalid;
    msg.mes = clean;
    // Свайпы хранят свои версии текста — чистим и активный вариант
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === 'number' && msg.swipes[msg.swipe_id] === raw) {
        msg.swipes[msg.swipe_id] = clean;
    }
    return true;
}

// Есть ли в текущем чате наши теги в тексте сообщений
export function chatHasTags() {
    const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
    const chat = ctx?.chat || window.chat;
    if (!Array.isArray(chat)) return false;
    return chat.some(m => m && hasReproTags(m.mes));
}

// Разовая чистка всей истории чата (кнопка в настройках). Возвращает число сообщений.
export function purgeChatTags() {
    const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
    const chat = ctx?.chat || window.chat;
    if (!Array.isArray(chat)) return 0;
    let n = 0;
    for (const msg of chat) if (detachTags(msg)) n++;
    if (n && ctx?.saveChat) { try { ctx.saveChat(); } catch (e) { /* ignore */ } }
    return n;
}

// ─── Main scan logic ───

// Track whether this is a regeneration/swipe (skip time analysis)
let _isRegeneration = false;
// Snapshot of pregnancy data before last scan (for restoring on regen)
let _preRegenSnapshot = null;
// ChatId, которому принадлежит _preRegenSnapshot (защита от утечки между чатами)
let _snapshotChatId = null;

// Исключаем историю, undo и снимок ответа, чтобы копии не вкладывались друг в друга.
function snapshotOf(p) {
    const { _history, _undoSnapshot, _turnBaseline, ...state } = p;
    return structuredClone(state);
}

// Быстрый хэш текста — для дедупа сканов (позиции мало: стриминг шлёт текст дважды)
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
}

export function clearRegenState() {
    _isRegeneration = false;
    _preRegenSnapshot = null;
    _snapshotChatId = null;
}

// ─── История состояний по позициям чата (для отката при удалении сообщений) ───
// p._history = [{pos, state}] — состояние ПОСЛЕ обработки сообщения на позиции pos
// (pos = chat.length на момент скана). Хранится в per-chat данных, переживает перезагрузку.
const HISTORY_CAP = 25;

export function pushStateHistory(pos) {
    try {
        const p = getPregnancyData();
        if (!Array.isArray(p._history)) p._history = [];
        const snap = snapshotOf(p);
        const existing = p._history.find(h => h.pos === pos);
        if (existing) {
            existing.state = snap;
        } else {
            p._history.push({ pos, state: snap });
            p._history.sort((a, b) => a.pos - b.pos);
        }
        if (p._history.length > HISTORY_CAP) {
            p._history.splice(0, p._history.length - HISTORY_CAP);
        }
    } catch (e) { /* ignore */ }
}

// Откат состояния к моменту, когда в чате было newLen сообщений.
// Вызывается на MESSAGE_DELETED: удалила сообщение с зачатием → состояние вернулось
// к снапшоту предыдущего сообщения, где беременности ещё нет.
export function rollbackToPosition(newLen) {
    // Regenerate temporarily deletes the last answer. runScan handles that rollback;
    // treating it as a user deletion here would discard the newly committed manual days.
    if (_isRegeneration) return false;
    try {
        const p = getPregnancyData();
        if (!Array.isArray(p._history) || p._history.length === 0) return false;

        // Отрезаем снапшоты, сделанные ПОСЛЕ новой длины чата
        const kept = p._history.filter(h => h.pos <= newLen);
        const target = kept.length > 0 ? kept[kept.length - 1] : null;
        if (!target) {
            p._history = kept;
            return false;
        }

        // Полная замена состояния (с удалением ключей, появившихся позже)
        for (const k of Object.keys(p)) delete p[k];
        Object.assign(p, structuredClone(target.state));
        p._history = kept;

        // Синхронизируем regen-снапшот с откатом
        _preRegenSnapshot = snapshotOf(p);
        _snapshotChatId = getCurrentChatId();

        saveSettingsDebounced();
        return true;
    } catch (e) {
        return false;
    }
}

function runScan() {
    const s = getSettings();
    if (!s.isEnabled) return;

    const chat = typeof SillyTavern?.getContext === 'function'
        ? SillyTavern.getContext().chat
        : window.chat;
    if (!chat || chat.length === 0) return;

    const lastMessage = chat[chat.length - 1];
    if (!lastMessage) return;

    // Use chat length as position ID — regeneration replaces at same index
    const positionId = chat.length;
    // Реген/свайп всегда заканчивается ботским сообщением: на юзерском флаг протух
    const isRegen = _isRegeneration && !lastMessage.is_user;
    _isRegeneration = false; // reset flag

    // Теги внутри CoT-блоков не считаются (закрытый think = мысли; незакрытый
    // с тегами = префилл, содержимое сканируется)
    const text = stripThink(rawTextOf(lastMessage));
    const textHash = simpleHash(text);

    // Дедуп: та же позиция И тот же текст (или его версия с уже вырезанными тегами) → скип.
    // Если текст на той же позиции ИЗМЕНИЛСЯ (стриминг дописал хвостовые теги) — сканируем заново.
    if (!isRegen && s._lastScannedPosition === positionId &&
        (textHash === s._lastScannedHash || textHash === s._lastScannedHashStripped)) {
        return;
    }

    // On regeneration: restore state snapshot from before the original message was processed.
    // ТОЛЬКО если снапшот принадлежит текущему чату — иначе утечка состояния между чатами.
    const p = getPregnancyData();
    const chatIdNow = getCurrentChatId();
    if (isRegen) restoreTurnBaseline(positionId);
    // A render/final callback for the same answer must not replace its BEFORE state.
    if (!p._turnBaseline || p._turnBaseline.pos !== positionId) {
        captureTurnBaseline(positionId);
    }


    // Отмечаем скан сразу (все ветки ниже могут выйти раньше)
    s._lastScannedPosition = positionId;
    s._lastScannedHash = textHash;
    s._lastScannedHashStripped = simpleHash(stripHiddenTags(text));

    // 0) RP_DATE tag: always extract date and advance time
    let dateAdvanced = processDateTag(text);

    // 1) Try tag-based detection (if model added tags)
    const freshStatus = scanStatusTag(text);
    if (freshStatus) applyStatusData(s, p, freshStatus);
    const tagResult = scanMessage(text);
    if (tagResult?.birth_occurred && !canTriggerBirth(p, s, 'tag')) tagResult.birth_occurred = false;
    if (tagResult) {
        // Ignore conception tag when already pregnant
        if (p.isPregnant) {
            tagResult.vaginal_ejaculation_occurred = false;
        }
        // Анти-дабл-ролл: если на ЭТОЙ позиции проверка зачатия уже кидалась
        // (частичный текст → полный текст), второй раз кубик не бросаем.
        if (tagResult.vaginal_ejaculation_occurred && s._lastConceptionRollAt === positionId) {
            tagResult.vaginal_ejaculation_occurred = false;
        }
        // Block keyword/API-based conception after manual reset (only explicit tags bypass)
        if (tagResult.vaginal_ejaculation_occurred && tagResult._source !== 'tag' && s._conceptionBlockedUntilUser && positionId <= s._conceptionBlockedUntilUser) {
            tagResult.vaginal_ejaculation_occurred = false;
        }
        // Block keyword-based birth on USER messages (only AI narration or explicit tag may trigger birth)
        if (tagResult.birth_occurred && tagResult._source === 'keyword' && lastMessage.is_user) {
            tagResult.birth_occurred = false;
        }
        // Block keyword-based birth when pregnancy is too early (require >= 85% of duration)
        if (tagResult.birth_occurred && tagResult._source === 'keyword' && p.isPregnant) {
            const minWeek = Math.ceil((s.pregnancyDuration || 40) * 0.85);
            if ((p.pregnancyWeeks || 0) < minWeek) {
                tagResult.birth_occurred = false;
            }
        }

        // Sex reveal detected (tag or keyword) — set the flag immediately
        if (tagResult.sex_revealed && p.isPregnant && !p.fetusSexRevealed) {
            // Override prerolled fetusSex with what the model ACTUALLY announced.
            // Otherwise infoblock shows "♂ мальчик" while the chat says "это девочка".
            if (tagResult.revealed_sexes && tagResult.revealed_sexes.length > 0) {
                const need = p.fetusCount || 1;
                const newSex = [];
                for (let i = 0; i < need; i++) {
                    newSex.push(tagResult.revealed_sexes[i] || tagResult.revealed_sexes[tagResult.revealed_sexes.length - 1]);
                }
                if (JSON.stringify(newSex) !== JSON.stringify(p.fetusSex)) {
                    p.fetusSex = newSex;
                }
            }
            p.fetusSexRevealed = true;
            saveSettingsDebounced();
            if (s.showNotifications) {
                const icons = p.fetusSex.map(sx => sx === 'M' ? '♂ мальчик' : '♀ девочка').join(', ');
                showNotification(`<i class="fa-solid fa-baby"></i> Пол определён: ${icons}`, 'success');
            }
            syncUI();
            updatePromptInjection();
            setTimeout(renderInfoblock, 500);
            // If no conception/birth to process — still continue to Extra API for dynamic data
        }

        // ── Партнёрские события ({{char}} — носитель) ──
        // Обрабатываются независимо от юзерских: в одном ответе может быть и то, и то.
        if (isTracked('char') && (tagResult.char_conception || tagResult.char_birth || tagResult.char_sex_revealed)) {
            const c = getPartnerData();
            let charChanged = false;
            if (tagResult.char_conception && !c.isPregnant) {
                const blocked = s._conceptionBlockedUntilChar && positionId <= s._conceptionBlockedUntilChar;
                if (blocked) {
                } else if (s._lastCharConceptionRollAt === positionId) {
                } else {
                    s._lastCharConceptionRollAt = positionId;
                    partnerCheckConception();
                    charChanged = true;
                }
            }
            if (tagResult.char_sex_revealed && c.isPregnant && !c.fetusSexRevealed) {
                if (tagResult.revealed_sexes?.length) {
                    const need = c.fetusCount || 1;
                    const ns = [];
                    for (let i = 0; i < need; i++) ns.push(tagResult.revealed_sexes[i] || tagResult.revealed_sexes[tagResult.revealed_sexes.length - 1]);
                    c.fetusSex = ns;
                }
                c.fetusSexRevealed = true;
                charChanged = true;
                if (s.showNotifications) {
                    const icons = c.fetusSex.map(sx => sx === 'M' ? '♂ мальчик' : '♀ девочка').join(', ');
                    showNotification(`<i class="fa-solid fa-baby"></i> ${carrierName('char')}: пол определён — ${icons}`, 'success');
                }
            }
            if (tagResult.char_birth) {
                const blocked = s._birthBlockedUntilChar && positionId <= s._birthBlockedUntilChar;
                if (!blocked && partnerBirth(tagResult.baby_traits)) charChanged = true;
            }
            if (charChanged) {
                saveSettingsDebounced();
                syncUI();
                updatePromptInjection();
                setTimeout(renderInfoblock, 500);
                pushStateHistory(positionId);
            }
        }

        // Only proceed if there's actually something to process
        if (tagResult.vaginal_ejaculation_occurred || tagResult.birth_occurred || tagResult.miscarriage_occurred || tagResult.abortion_occurred) {
            if (tagResult.vaginal_ejaculation_occurred) s._lastConceptionRollAt = positionId;
            applyScanResult(tagResult);
            if (s.showNotifications) {
                const parts = [];
                if (tagResult.vaginal_ejaculation_occurred) parts.push('<i class="fa-solid fa-droplet"></i> Зачатие проверено!');
                if (tagResult.birth_occurred) parts.push('<i class="fa-solid fa-baby"></i> Роды!');
                if (tagResult.miscarriage_occurred) parts.push('<i class="fa-solid fa-heart-crack"></i> Выкидыш — беременность прервана');
                if (tagResult.abortion_occurred) parts.push('<i class="fa-solid fa-heart-crack"></i> Аборт — беременность прервана');
                const nType = (tagResult.miscarriage_occurred || tagResult.abortion_occurred) ? 'warning' : 'success';
                showNotification(`${parts.join(' | ')}`, nType);
            }
            syncUI();
            updatePromptInjection();
            setTimeout(renderInfoblock, 500);
            pushStateHistory(positionId);
            saveSettingsDebounced();
            return;
        } else {
        }
    }

    // 1.5) RP_STATUS tag: parse dynamic scene data from main model
    const statusData = scanStatusTag(text);
    if (statusData) {
        applyStatusData(s, p, statusData);
        saveSettingsDebounced();
    }

    // 1.6) PREGNANCY_STATE tag — иммутабельные данные беременности (дата зачатия, пол, отец).
    // Это ЕДИНЫЙ источник правды для активной беременности — расширка инструктирует модель
    // ставить этот тег в каждом ответе после успешного зачатия, и здесь его читает.
    // НЕ перезаписывает conceptionDate если значения совпадают; иначе обновляет и пересчитывает недели.
    const pregState = scanPregnancyStateTag(text);
    if (pregState && !p.isPregnant) {
        // Модель поставила тег беременности, но в расширке беременности нет.
        // Кейс «юзер начала играть уже беременной и не настроила расширку»:
        // принимаем тег как источник правды и СОЗДАЁМ беременность с правильной датой.
        // Защиты: недавний ручной сброс/установка (30 мин) и блок после reset — не создаём.
        const userSetMs = p._userSetWeeksAt || 0;
        const recentlyUserSet = userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30;
        const blocked = s._conceptionBlockedUntilUser && positionId <= s._conceptionBlockedUntilUser;
        if (recentlyUserSet || blocked) {
        } else {
            createPregnancyFromStateTag(pregState);
        }
    }
    if (pregState && p.isPregnant) {
        let stateChanged = false;
        // Established conception date is tracker state. A model echo cannot redate it.
        if (pregState.fetusCountConfirmed && pregState.fetusCount !== null && p.fetusCount !== pregState.fetusCount) {
            p.fetusCount = pregState.fetusCount;
            stateChanged = true;
        }
        // Пол: обновляем если в теге не "?" и отличается
        const tagSex = pregState.fetusSex.filter(x => x === 'M' || x === 'F');
        if (tagSex.length > 0 && JSON.stringify(p.fetusSex) !== JSON.stringify(pregState.fetusSex)) {
            p.fetusSex = pregState.fetusSex;
            const allKnown = pregState.fetusSex.every(x => x === 'M' || x === 'F');
            if (allKnown && !p.fetusSexRevealed) {
                p.fetusSexRevealed = true;
            }
            stateChanged = true;
        }
        if (!p._secondParentManual && pregState.fatherName && p.fatherName !== pregState.fatherName) {
            p.fatherName = pregState.fatherName;
            stateChanged = true;
        }
        // Пересчёт недель от обновлённой conceptionDate (всегда когда есть pregState и rpDate)
        if (p.rpDate && p.conceptionDate) {
            const conceptionMs = new Date(p.conceptionDate).getTime();
            const rpMs = new Date(p.rpDate).getTime();
            if (rpMs >= conceptionMs) {
                const newWeeks = Math.floor((rpMs - conceptionMs) / (7 * 86400000));
                if (newWeeks !== p.pregnancyWeeks) {
                    p.pregnancyWeeks = newWeeks;
                    stateChanged = true;
                }
            }
        }
        if (stateChanged) saveSettingsDebounced();
    }

    // 1.7) Парсер срока беременности из обычного текста — ТОЛЬКО для создания новой беременности.
    // Если уже беременна → данные приходят через PREGNANCY_STATE тег, парсер текста не работает.
    // Это сделано чтобы избежать бесконечной перезаписи срока когда модель упоминает «X недель»
    // или копирует SIMS-блоки с прогресс-форматами.
    //
    // Работает и на сообщениях юзера, И на сообщениях бота — кейс «начала играть уже
    // беременной, расширку не настроила»: бот описывает «ты на 16 неделе» → создаём
    // беременность с корректной датой зачатия. От утечки из старого чата защищают:
    // per-chat хранилище, блок после ручного сброса (_conceptionBlockedUntil) и
    // контекстные фильтры парсера (future/progress/OOC).
    if (!p.isPregnant) {
        const weeksData = scanWeeksFromText(text);
        if (weeksData && weeksData.weeks >= 1 && weeksData.weeks <= 42) {
            const manualSetMs = p._userSetWeeksAt || 0;
            const minutesSinceManual = (Date.now() - manualSetMs) / 60000;
            const recentlyManual = manualSetMs > 0 && minutesSinceManual < 30;
            const blocked = s._conceptionBlockedUntilUser && positionId <= s._conceptionBlockedUntilUser;

            if (recentlyManual) {
            } else if (blocked) {
            } else {
                createPregnancyFromWeeks(weeksData.weeks);
            }
        }
    }

    // 1.8) Симуляция малыша: вехи/уход по RP-возрасту (идемпотентно, дёшево)
    if (p.hasBaby) {
        try { updateBabyCare(); } catch (e) { /* ignore */ }
    }

    // 2) UI update — динамика приходит из RP_STATUS тега от основной модели (без Extra API)
    pushStateHistory(positionId);
    saveSettingsDebounced();
    syncUI();
    updatePromptInjection();
    setTimeout(renderInfoblock, 500);
}

// ─── Force re-scan with full message text (called from CHARACTER_MESSAGE_RENDERED).
//     MESSAGE_RECEIVED may fire before streaming completes the trailing tags,
//     so the first scan misses them. This re-processes them on full text.
export function rescanMessage(fullText, messageIndex) {
    const chat = SillyTavern.getContext().chat || [];
    const idx = typeof messageIndex === 'number' ? messageIndex : chat.length - 1;
    // The legacy entry point uses the same deduplication and rollback path.
    // Never apply an arbitrary old answer to the current chat state.
    if (idx !== chat.length - 1 || rawTextOf(chat[idx]) !== fullText) return;
    runScan();
}

// Финальный безопасный проход для событий рендера: применяет только RP_STATUS.
// В отличие от rescanMessage не повторяет роды/зачатие/выкидыш и не создаёт
// дублирующие уведомления, если CHARACTER_MESSAGE_RENDERED пришёл после MESSAGE_RECEIVED.
export function rescanStatusOnly(fullText) {
    if (!fullText) return false;
    const s = getSettings();
    if (!s.isEnabled) return false;

    const statusData = scanStatusTag(stripThink(fullText));
    if (!statusData) return false;

    applyStatusData(s, getPregnancyData(), statusData);
    saveSettingsDebounced();
    syncUI();
    setTimeout(renderInfoblock, 300);
    return true;
}

// ─── Apply RP_STATUS JSON data to pregnancy state ───
function applyStatusData(s, p, data) {
    if (data.subject && data.subject !== 'user') return;
    if (data.partner?.subject && data.partner.subject !== 'char') {
        data = { ...data, partner: undefined };
    }
    const applyLooks = (carrier, looks) => {
        if (!looks || typeof looks !== 'object') return;
        carrier.motherLooks ||= {};
        for (const key of ['hair','eyes']) {
            if (typeof looks[key] === 'string' && looks[key].trim()) carrier.motherLooks[key] = looks[key].trim().slice(0,80);
        }
    };
    if (isTracked('user')) applyLooks(p, data.looks);
    if (isTracked('char')) applyLooks(getPartnerData(), data.partner?.looks);
    const applyKnowledge = (c, fact) => {
        if (!c.isPregnant || !fact || typeof fact !== 'object') return;
        if (fact.pregnancy_known === true) c.pregnancyKnown = true;
        const count = Number(fact.fetus_count);
        if (fact.fetus_count_confirmed === true && Number.isInteger(count) && count >= 1 && count <= 4) {
            c.fetusCount = count;
            c.fetusSex = Array.from({ length: count }, (_, i) => c.fetusSex?.[i] || '?');
            c.pregnancyKnown = true;
        }
        if (['positive', 'faint', 'negative'].includes(fact.test_result)) {
            c.lastTestResult = fact.test_result;
            if (fact.test_result !== 'negative') c.pregnancyKnown = true;
        }
    };
    if (isTracked('user')) applyKnowledge(p, data);
    if (isTracked('char')) applyKnowledge(getPartnerData(), data.partner);

    // Сбой цикла: модель отмечает событие, расширение растягивает текущий цикл.
    // Только в режиме реализма и не чаще одного раза за цикл.
    if (s.realism && typeof data.cycle_event === 'string' && !p.isPregnant) {
        const kind = data.cycle_event.trim().toLowerCase();
        if (DISRUPTIONS[kind] && !p._cycleShift) {
            const days = disruptionShift(kind);
            if (days > 0) {
                p._cycleShift = days;
                if (s.showNotifications) {
                    showNotification(`<i class="fa-solid fa-calendar-xmark"></i> Цикл сбился (${DISRUPTIONS[kind].label}) — задержка около ${days} дн.`, 'warning');
                }
            }
        }
    }


    if (p.hasBaby) {
        // Baby mode
        if (data.babies && Array.isArray(data.babies) && p.babies?.length > 0) {
            data.babies.forEach((apiB, i) => {
                if (!apiB || typeof apiB !== 'object') return;

                // Модель возвращает стабильный label из промпта. Сначала ищем
                // малыша по нему, а индекс используем как fallback. Это важно,
                // когда ребёнок был добавлен вручную к уже существующим детям.
                const label = typeof apiB.label === 'string' ? apiB.label.trim() : '';
                const statusName = typeof apiB.name === 'string' ? apiB.name.trim() : '';
                const identity = label || statusName;
                let baby = identity
                    ? p.babies.find(b => b.name && b.name.localeCompare(identity, undefined, { sensitivity: 'base' }) === 0)
                    : null;
                const numberedLabel = label.match(/^Baby\s*(\d+)$/i);
                if (!baby && numberedLabel) baby = p.babies[Number(numberedLabel[1]) - 1];
                if (!baby) baby = p.babies[i];

                if (baby) {
                    // Имя: применяем ТОЛЬКО если у малыша имени ещё нет (был безымянный).
                    // Существующее имя НИКОГДА не затирается через RP_STATUS — иначе модель
                    // ломает его плейсхолдерами ("...", "Baby1") или своими альт-вариантами.
                    // Отдельно фильтруем «мусорные» значения которые модель может прислать.
                    if (apiB.name && typeof apiB.name === 'string') {
                        const cleanName = apiB.name.trim();
                        const isJunk = !cleanName
                                    || cleanName === '...'
                                    || cleanName === '…'
                                    || /^baby\s*\d*$/i.test(cleanName)
                                    || /^child\s*\d*$/i.test(cleanName)
                                    || /^малыш\s*\d*$/i.test(cleanName)
                                    || /^unnamed$/i.test(cleanName)
                                    || /^<.*>$/.test(cleanName)
                                    || cleanName.length > 60;
                        if (!isJunk && !baby.name) {
                            // Имени не было — записываем
                            baby.name = cleanName;
                        } else if (!isJunk && baby.name && baby.name !== cleanName) {
                            // Имя есть и не совпадает — не трогаем (юзер уже назвал)
                        }
                    }
                    // Проверяем наличие ключа, а не truthiness: пустая строка в новом
                    // RP_STATUS означает «сейчас данных нет» и должна очищать старое.
                    if (Object.hasOwn(apiB, 'mood')) baby.mood = apiB.mood || '';
                    if (Object.hasOwn(apiB, 'sleep')) baby.sleep = apiB.sleep || '';
                    if (Object.hasOwn(apiB, 'health')) baby.health = apiB.health || 'normal';
                    // Пишем в оба поля: UI читает feedingType, промпт — feeding
                    if (Object.hasOwn(apiB, 'feeding')) {
                        baby.feeding = apiB.feeding || '';
                        baby.feedingType = apiB.feeding || '';
                    }
                    // Подгузник: парсим текст в diaperClean boolean + сохраняем текст
                    if (Object.hasOwn(apiB, 'diaper')) {
                        baby.diaperStatus = apiB.diaper || '';
                        const cleanPatterns = /^(?:чист|clean|dry|сух)/i;
                        if (apiB.diaper) baby.diaperClean = cleanPatterns.test(apiB.diaper);
                    }
                    // Рекомендация по уходу от модели. Общую справку по возрастным
                    // нормам не сохраняем: инфоблок показывает только текущую сцену.
                    if (apiB.care_note) {
                        const careNote = String(apiB.care_note).trim();
                        const isGenericCareNorm =
                            /кормлен\w*\s+(?:по\s+требованию\s+)?каждые\s*2\s*[–—-]\s*3\s*(?:ч|час)/i.test(careNote) ||
                            /сон\s*16\s*[–—-]\s*18\s*(?:ч|час)/i.test(careNote) ||
                            /колик\w*.*(?:пик|6\s*нед)/i.test(careNote) ||
                            /(?:памперс|подгузник)\w*\s*8\s*[–—-]\s*10\s*раз/i.test(careNote);
                        baby.careNote = isGenericCareNorm ? null : careNote;
                    }
                    if (apiB.father_name && apiB.father_name !== baby.fatherName) {
                        baby.fatherName = String(apiB.father_name).slice(0, 80);
                    }
                    // ── Сюжетное достижение («первое агу», «первый смех в голос»...) ──
                    // Модель присылает его в "milestone" ТОЛЬКО когда в сцене случилось
                    // что-то впервые. Дедуп по нормализованному тексту, кап 40 записей.
                    if (Object.hasOwn(apiB, 'milestone') && apiB.milestone && typeof apiB.milestone === 'string') {
                        const txt = apiB.milestone.trim().slice(0, 80);
                        const junk = !txt || txt === '...' || txt === '…' || /^(?:null|none|нет|-)$/i.test(txt);
                        if (!junk) {
                            if (!Array.isArray(baby.milestones)) baby.milestones = [];
                            const norm = txt.toLowerCase();
                            const dup = baby.milestones.some(x => (x.text || '').toLowerCase() === norm);
                            if (!dup) {
                                baby.milestones.push({
                                    text: txt,
                                    source: 'story',
                                    rpDate: p.rpDate,
                                    date: new Date().toISOString(),
                                });
                                if (baby.milestones.length > 40) {
                                    baby.milestones.splice(0, baby.milestones.length - 40);
                                }
                                if (s.showNotifications) {
                                    showNotification(`<i class="fa-solid fa-trophy"></i> ${baby.name || 'Малыш'}: ${txt}`, 'success');
                                }
                            }
                        }
                    }
                }
            });
        }
        p._dynamic = { note: data.note || null };

    } else if (p.isPregnant) {
        // Pregnancy mode
        if (data.mood) p.mood = data.mood;
        if (data.libido) p.libido = data.libido;
        if (data.weight_gain) p.weightGain = data.weight_gain;
        if (data.baby_activity) p.babyActivity = data.baby_activity;
        if (!p._secondParentManual && data.father_name && data.father_name !== p.fatherName) {
            p.fatherName = String(data.father_name).slice(0, 80);
        }

        // Sex reveal from RP_STATUS (in case model puts it here instead of tag)
        if (data.sex_revealed === true && !p.fetusSexRevealed) {
            p.fetusSexRevealed = true;
            if (s.showNotifications) {
                const icons = p.fetusSex.map(sx => sx === 'M' ? '♂ мальчик' : '♀ девочка').join(', ');
                showNotification(`<i class="fa-solid fa-baby"></i> Пол определён: ${icons}`, 'success');
            }
        }

        p._dynamic = {
            symptoms: data.symptoms || null,
            recommendations: data.recommendations || null,
            movements: data.movements || null,
            swelling: data.swelling || null,
            braxton_hicks: data.braxton_hicks || null,
            fetal_position: data.fetal_position || null,
            // Размер плода описывает МОДЕЛЬ (живее статичной таблицы). Если не прислала —
            // инфоблок сам подставит расчётный размер по сроку.
            fetusSize: data.fetus_size || null,
            note: data.note || null,
        };

    } else {
        // Cycle mode
        p._dynamic = {
            fertility: data.fertility || null,
            libido: data.libido || null,
            mood: data.mood || null,
            physical: data.physical || null,
            note: data.note || null,
        };
    }

    // ── Данные носителя-ПЕРСОНАЖА из блока "partner" в RP_STATUS ──
    if (data.partner && typeof data.partner === 'object' && isTracked('char')) {
        const c = getPartnerData();
        const d2 = data.partner;
        if (d2.mood) c.mood = d2.mood;
        if (d2.libido) c.libido = d2.libido;
        if (d2.weight_gain) c.weightGain = d2.weight_gain;
        if (d2.baby_activity) c.babyActivity = d2.baby_activity;
        if (!c._secondParentManual && d2.father_name) c.fatherName = String(d2.father_name).slice(0, 80);
        if (d2.sex_revealed === true && c.isPregnant && !c.fetusSexRevealed) c.fetusSexRevealed = true;
        c._dynamic = c.isPregnant ? {
            symptoms: d2.symptoms || null,
            recommendations: d2.recommendations || null,
            movements: d2.movements || null,
            fetusSize: d2.fetus_size || null,
            note: d2.note || null,
        } : {
            fertility: d2.fertility || null,
            libido: d2.libido || null,
            mood: d2.mood || null,
            physical: d2.physical || null,
            note: d2.note || null,
        };
    }
}

// ─── Advance cycle day and pregnancy weeks ───

function advanceTime(s, p, daysPassed) {
    if (daysPassed <= 0) return;
    let changed = false;

    // ── Носитель-персонаж: свой цикл и недели беременности ──
    if (isTracked('char')) {
        try {
            const c = getPartnerData();
            // Each selected carrier advances the same cycle model independently.
            if (!c.isPregnant && hasCycle(s, 'char')) {
                const pp = getPostpartum(c, p);
                if (!pp || pp.cycleReturned) {
                    c._dynamic = {};
                    c.cycleDay = ((c.cycleDay || 1) - 1 + daysPassed) % 28 + 1;
                    changed = true;
                }
            }
            if (c.isPregnant && c.conceptionDate && p.rpDate) {
                const w = Math.floor((new Date(p.rpDate).getTime() - new Date(c.conceptionDate).getTime()) / (7 * 86400000));
                const dur = s.pregnancyDuration || 40;
                if (w >= 0 && w !== c.pregnancyWeeks) {
                    c.pregnancyWeeks = w;
                    changed = true;
                }

            }
        } catch (e) { /* ignore */ }
    }

    // ── Advance cycle day (28-day cycle, wraps around) ──
    const userPostpartum = getPostpartum(p, p);
    if (!p.isPregnant && isTracked('user') && hasCycle(s, 'user') && (!userPostpartum || userPostpartum.cycleReturned)) {
        const oldDay = getCycleDay();
        // Сбой цикла (стресс, болезнь) растягивает ТЕКУЩИЙ цикл: месячные приходят позже.
        // Как только цикл закрылся, растяжка сгорает — следующий снова обычный.
        const shift = Math.max(0, parseInt(p._cycleShift) || 0);
        const cycleLen = 28 + shift;
        let newDay = oldDay + daysPassed;
        if (newDay > cycleLen) {
            newDay = ((newDay - cycleLen - 1) % 28) + 1;
            if (shift) p._cycleShift = 0;
        }
        if (newDay > 28 && !shift) newDay = ((newDay - 1) % 28) + 1;
        p._dynamic = {};
        setCycleDay(newDay, true, false);
        changed = true;

        // Cycle milestone notifications
        if (s.showNotifications) {
            if (hasMenstrualCycle(s, 'user') && s.menstruationEnabled !== false && oldDay > 5 && newDay <= 5) {
                showNotification('<i class="fa-solid fa-droplet"></i> Менструация началась', 'info');
            }
            if (oldDay < 12 && newDay >= 12 && newDay <= 16) {
                showNotification(`<i class="fa-solid fa-fire"></i> Началась фаза: ${cyclePhase(s, 'user', newDay).name}`, 'warning');
            }
        }
    }

    // ── Recalculate pregnancy weeks strictly from conceptionDate ──
    if (p.isPregnant && p.conceptionDate && p.rpDate) {
        const oldWeeks = p.pregnancyWeeks;
        const conceptionTime = new Date(p.conceptionDate).getTime();
        const rpTime = new Date(p.rpDate).getTime();
        const diffMs = rpTime - conceptionTime;

        if (diffMs > 0) {
            const newW = Math.floor(diffMs / (7 * 86400000));
            const duration = s.pregnancyDuration || 40;
            if (newW !== oldWeeks) {
                p.pregnancyWeeks = newW;
                changed = true;

                // ── Milestone notifications ──
                if (s.showNotifications && newW > oldWeeks) {
                    if (oldWeeks < 13 && newW >= 13)
                        showNotification('<i class="fa-solid fa-leaf"></i> 2-й триместр — токсикоз отступает, энергия возвращается', 'success');
                    if (oldWeeks < 28 && newW >= 28)
                        showNotification('<i class="fa-solid fa-baby"></i> 3-й триместр — финишная прямая!', 'info');
                    if (oldWeeks < 8 && newW >= 8)
                        showNotification('<i class="fa-solid fa-heart-pulse"></i> 8 недель — сердцебиение плода определяется', 'info');
                    if (oldWeeks < 12 && newW >= 12)
                        showNotification('<i class="fa-solid fa-stethoscope"></i> 12 недель — время первого скрининга', 'info');
                    if (oldWeeks < 20 && newW >= 20)
                        showNotification('<i class="fa-solid fa-cake-candles"></i> 20 недель — экватор! Анатомическое УЗИ', 'success');
                    if (oldWeeks < 24 && newW >= 24)
                        showNotification('<i class="fa-solid fa-shield-halved"></i> 24 недели — плод жизнеспособен вне утробы', 'info');
                    if (oldWeeks < 36 && newW >= 36)
                        showNotification('<i class="fa-solid fa-suitcase-medical"></i> 36 недель — пора собирать сумку в роддом', 'warning');

                    const oldMonth = Math.floor(oldWeeks / 4);
                    const newMonth = Math.floor(newW / 4);
                    if (newMonth > oldMonth && newW !== 8 && newW !== 12 && newW !== 20 && newW !== 24 && newW !== 28 && newW !== 36) {
                        showNotification(`<i class="fa-solid fa-calendar-check"></i> ${newW} недель — ${newMonth + 1}-й лунный месяц`, 'info');
                    }

                    if (newW >= duration && oldWeeks < duration) {
                        showNotification('<i class="fa-solid fa-hospital"></i> Достигнут ожидаемый срок. Роды отмечаются по событию в сцене.', 'warning');
                    }
                }

                // ── Reveal planned complications whose week has arrived ──
                revealPlannedComplications(s, p, oldWeeks, newW);
            }


        }
    }

    // ── Дети: вехи развития/уход по возрасту + пора ли «выпускать» во взрослые ──
    if (p.hasBaby && p.babies && p.babies.length > 0 && p.rpDate) {
        try { updateBabyCare(); } catch (e) { /* ignore */ }
        maybeGraduateBabies(s, p);
    }

    if (changed) {
        saveSettingsDebounced();
    }
}

// ─── Выпуск «взрослых» детей: показываем плашку с конфетти и переносим в архив ───
let _graduationDialogShowing = false;
function maybeGraduateBabies(s, p) {
    if (_graduationDialogShowing) return;
    try {
        // Динамический импорт чтобы избежать циклов
        import('./pregnancy.js').then(mod => {
            const graduates = mod.checkBabyGraduation();
            if (!graduates || graduates.length === 0) return;
            if (_graduationDialogShowing) return;
            _graduationDialogShowing = true;
            import('./notifications.js').then(nMod => {
                nMod.showGraduationDialog(graduates, () => {
                    mod.graduateBabies(graduates);
                    _graduationDialogShowing = false;
                    setTimeout(renderInfoblock, 300);
                });
            }).catch(e => {
                // Тихий fallback: всё равно выпускаем
                mod.graduateBabies(graduates);
                _graduationDialogShowing = false;
            });
        }).catch(e => {
        });
    } catch (e) { /* ignore */ }
}

// ─── Reveal planned complications when their week arrives ───

function revealPlannedComplications(s, p, oldWeeks, newWeeks) {
    if (!p._plannedComplications || p._plannedComplications.length === 0) return;
    for (const pc of p._plannedComplications) {
        if (pc.revealed) continue;
        if (pc.revealWeek > oldWeeks && pc.revealWeek <= newWeeks) {
            pc.revealed = true;
            p.complications.push({
                week: pc.revealWeek,
                type: pc.type,
                severity: pc.severity,
                description: pc.type,
                rpDate: p.rpDate,
                date: new Date().toISOString(),
                resolved: false,
            });
            if (pc.severity === 'critical') {
                p.healthStatus = 'critical';
            } else if (p.healthStatus === 'normal') {
                p.healthStatus = 'warning';
            }
            if (s.showNotifications) {
                const icon = pc.severity === 'critical'
                    ? '<i class="fa-solid fa-circle-exclamation"></i>'
                    : '<i class="fa-solid fa-triangle-exclamation"></i>';
                showNotification(`${icon} Осложнение (${pc.revealWeek} нед.): ${pc.type}`, pc.severity === 'critical' ? 'warning' : 'info');
            }
        }
    }
}

// ─── Infoblock rendering ───

export function renderInfoblock() {
    const s = getSettings();
    const pos = s.infoblockPosition;
    if (!s.isEnabled || !pos || pos === 'off') {
        document.querySelectorAll('.rp-infoblock-inserted').forEach(el => el.remove());
        return;
    }

    const html = buildInfoblockHtml();
    if (!html) { document.querySelectorAll('.rp-infoblock-inserted').forEach(el => el.remove()); return; }

    const allMessages = document.querySelectorAll('.mes:not([is_system="true"])');
    let lastBotMsg = null;
    for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        // gp-sms-hidden — смс, скрытые расширением GlassPhone: в них инфоблок не виден
        if (msg.getAttribute('is_user') === 'false' && !msg.classList.contains('gp-sms-hidden')) {
            lastBotMsg = msg;
            break;
        }
    }
    if (!lastBotMsg) return;
    const mesText = lastBotMsg.querySelector('.mes_text');
    if (!mesText) return;

    const existing = mesText.querySelector('.rp-infoblock-inserted');
    if (existing && existing._reproHtml === html && existing._reproPos === pos) return;
    document.querySelectorAll('.rp-infoblock-inserted').forEach(el => el.remove());
    const wrapper = document.createElement('div');
    wrapper._reproHtml = html;
    wrapper._reproPos = pos;
    wrapper.className = 'rp-infoblock-inserted';
    wrapper.innerHTML = html;

    if (pos === 'top') {
        mesText.insertBefore(wrapper, mesText.firstChild);
    } else {
        mesText.appendChild(wrapper);
    }

    // Клик по имени малыша → prompt для переименования
    wrapper.querySelectorAll('.repro-baby-name').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(el.getAttribute('data-baby-idx'));
            const p = getPregnancyData();
            if (!p.babies || !p.babies[idx]) return;
            const current = p.babies[idx].name || '';
            const newName = prompt('Имя малыша:', current);
            if (newName === null) return; // отмена
            const cleanName = newName.trim().slice(0, 60);
            p.babies[idx].name = cleanName;
            // Legacy: babyName = имя первого ребёнка
            if (idx === 0) p.babyName = cleanName;
            try { saveSettingsDebounced(); } catch (e) {}
            renderInfoblock();
        });
    });
}

// ─── Event handler ───

const TURN_GUARDS = ['_lastConceptionRollAt', '_lastCharConceptionRollAt',
    '_conceptionBlockedUntilUser', '_conceptionBlockedUntilChar',
    '_birthBlockedUntilUser', '_birthBlockedUntilChar'];

function captureTurnBaseline(pos) {
    const p = getPregnancyData(), s = getSettings();
    _preRegenSnapshot = snapshotOf(p);
    _snapshotChatId = getCurrentChatId();
    p._turnBaseline = { pos, state: _preRegenSnapshot,
        guards: Object.fromEntries(TURN_GUARDS.map(k => [k, s[k] ?? null])) };
}

function restoreTurnBaseline(pos) {
    const p = getPregnancyData(), s = getSettings();
    let baseline = p._turnBaseline;
    // Upgrade old saves: their previous committed message is the available baseline.
    if (!baseline && s._lastScannedPosition === pos) {
        const prev = (p._history || []).filter(h => h.pos < pos).sort((a,b) => b.pos-a.pos)[0];
        if (prev) baseline = { pos, state: prev.state, guards: {} };
    }
    if (!baseline || baseline.pos !== pos) return false;
    const history = (p._history || []).filter(h => h.pos < pos);
    const restored = snapshotOf(baseline.state);
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, restored, { _history: history, _turnBaseline: baseline });
    for (const k of TURN_GUARDS) s[k] = baseline.guards?.[k] ?? null;
    _preRegenSnapshot = snapshotOf(p);
    _snapshotChatId = getCurrentChatId();
    saveSettingsDebounced();
    return true;
}

export function markRegeneration({ newReply = false } = {}) {
    const chat = SillyTavern.getContext().chat;
    const msg = chat?.[chat.length - 1];
    if (newReply && msg?.extra?.reproRaw) {
        // A fresh generation can produce identical prose without the old event tag.
        // Clone extra so metadata of an already saved swipe remains intact.
        msg.extra = { ...msg.extra, reproRawInvalid: true };
    }
    if (_isRegeneration) return;
    _isRegeneration = true;
    // Restore BEFORE generating too, so the model receives the correct state.
    if (restoreTurnBaseline(chat?.length || 0)) {
        updatePromptInjection();
        syncUI();
    }
}

// Called for every host generation, even if no MESSAGE_SENT event is emitted
// (regenerate, swipe, continue and prompt preview). No additional prompt slot.
export function prepareGeneration(genType, dryRun = false) {
    if (!dryRun && (genType === 'regenerate' || genType === 'swipe')) {
        markRegeneration({ newReply: true });
    }
    updatePromptInjection();
}

// Вызывать после любого РУЧНОГО изменения состояния (setCycleDay, startManualPregnancy,
// resetPregnancy, resetBaby и т.п.). Без этого regen/swipe откатит ручные правки
// к состоянию ДО последнего скана — выглядит как "поставил, отправил, сбросилось".
export function setManualCycleDay(who, day) {
    if (!['user','char'].includes(who)) return false;
    const p = getPregnancyData(), c = who === 'char' ? getPartnerData() : p;
    if (c.isPregnant) return false;
    const value = Math.max(1, Math.min(28, parseInt(day) || 1));
    c.cycleDay = value;
    c._cycleShift = 0;
    c._dynamic = {};
    c._userSetCycleAt = Date.now();
    c._manualCyclePosition = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext().chat?.length || 0 : 0;
    // Synchronous commit before another regeneration event can restore an older snapshot.
    refreshRegenSnapshot();
    saveSettingsDebounced();
    updatePromptInjection();
    return value;
}

export function refreshRegenSnapshot() {
    try {
        const p = getPregnancyData();
        _preRegenSnapshot = snapshotOf(p);
        _snapshotChatId = getCurrentChatId();
        // Ручное изменение фиксируем в истории состояний (переживает откат)
        try {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
            const len = ctx?.chat?.length ?? 0;
            if (len > 0) { captureTurnBaseline(len); pushStateHistory(len); }
        } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
}

export async function onMessageReceived(messageIndex, type) {
    if (type === 'quiet') return;
    runScan();
}

// User-side scan: triggered from MESSAGE_SENT so player descriptions
// (я рожаю / кончает в меня / у нас будет девочка) are also detected.
export async function onMessageSent(messageIndex, type) {
    if (type === 'quiet') return;
    runScan();
}

// ─── Process RP_DATE tag from text (can be called from index.js on render) ───

export function processDateTag(text) {
    if (!text) return false;
    text = stripThink(text);
    const s = getSettings();
    const rpDate = scanDateTag(text);
    if (!rpDate) return false;

    const p = getPregnancyData();
    // Сохраняем RP-время (HH:MM) если модель его прислала
    if (rpDate.rpTime) {
        p.rpTime = rpDate.rpTime;
    }
    let prevRaw = p._lastRpDateTag || p.rpDate;

    // Bootstrap: if no previous date stored, scan chat history
    if (!prevRaw) {
        const chat = typeof SillyTavern?.getContext === 'function'
            ? SillyTavern.getContext().chat : window.chat;
        if (chat) {
            for (let i = chat.length - 2; i >= 0; i--) {
                const msg = chat[i];
                if (msg && msg.mes && !msg.is_system) {
                    const prev = scanDateTag(stripThink(rawTextOf(msg)));
                    if (prev) {
                        prevRaw = prev.toISOString();
                        break;
                    }
                }
            }
        }
    }

    // Same date as last stored? Skip
    const newIso = rpDate.toISOString();
    if (p._lastRpDateTag === newIso) return false;

    p._lastRpDateTag = newIso;
    p.rpDate = newIso;

    // ── Anchor pregnancy to RP timeline ──
    // If conception was set manually (or before any RP_DATE was seen), conceptionDate is
    // anchored to real-world time. On the FIRST RP_DATE we see, re-anchor so that the
    // accumulated pregnancyWeeks are preserved and start ticking from the RP timeline.
    for (const c of [p, getPartnerData()]) {
        if (c.isPregnant && (!c._conceptionAnchored || !c.conceptionDate)) {
            const weeks = Math.max(0, c.pregnancyWeeks || 0);
            c.conceptionDate = new Date(rpDate.getTime() - weeks * 7 * 86400000).toISOString();
            c._conceptionAnchored = true;
        }
    }

    // Clamp: if rpDate < conceptionDate (model rewound time), pull conceptionDate back
    // НО: если юзер только что вручную выставил беременность — НЕ трогаем его дату зачатия.
    // Иначе ручная "беременна с 01.06.2026" мгновенно сбрасывается до текущей RP-даты бота.
    if (p.isPregnant && p.conceptionDate && new Date(p.conceptionDate).getTime() > rpDate.getTime()) {
        const userSetMs = p._userSetWeeksAt || 0;
        const minutesSinceUserSet = (Date.now() - userSetMs) / 60000;
        const recentlyUserSet = userSetMs > 0 && minutesSinceUserSet < 30;
        if (recentlyUserSet) {
        } else {
            const w = Math.max(0, p.pregnancyWeeks || 0);
            // Preserve weeks: shift conceptionDate to (rpDate - weeks*7d)
            p.conceptionDate = new Date(rpDate.getTime() - w * 7 * 86400000).toISOString();
        }
    }

    if (prevRaw) {
        const prev = new Date(prevRaw);
        const diffMs = rpDate.getTime() - prev.getTime();
        // Cycle days follow RP calendar dates, not rounded partial days.
        const calendarDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
        const diffDays = calendarDay(rpDate) - calendarDay(prev);
        if (diffDays > 0 && diffDays <= 365) {
            advanceTime(s, p, diffDays);
            saveSettingsDebounced();
            syncUI();
            updatePromptInjection();
            setTimeout(renderInfoblock, 500);
            return true;
        } else if (diffDays < 0) {
        }
    } else {
        saveSettingsDebounced();
    }
    return false;
}

export function setManualPregnancyWeeks(who, value) {
    if (!['user','char'].includes(who)) return false;
    const p = getPregnancyData(), c = who === 'char' ? getPartnerData() : p;
    if (!c.isPregnant) return false;
    const weeks = Math.max(0, Math.min(100, parseInt(value) || 0));
    const anchor = p.rpDate ? new Date(p.rpDate) : null;
    c.pregnancyWeeks = weeks;
    c.conceptionDate = anchor && Number.isFinite(anchor.getTime())
        ? new Date(anchor.getTime() - weeks * 7 * 86400000).toISOString() : null;
    c._conceptionAnchored = !!c.conceptionDate;
    c._userSetWeeksAt = Date.now();
    refreshRegenSnapshot();
    saveSettingsDebounced();
    updatePromptInjection();
    return weeks;
}

export function prepareTrackerOutput(msg) {
    if (!msg || msg.is_user || !getSettings().isEnabled) return false;
    const current = msg.mes || '';
    if (/\[RP_DATE[:\s]/i.test(current)) return false;
    const date = scanDateTag(stripThink(current));
    if (!date?.rpTime) return false;
    const pad = n => String(n).padStart(2, '0');
    // Canonicalize the explicit clock already supplied by the phone extension.
    msg.mes = current + `\n<!-- [RP_DATE:${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()} ${date.rpTime}] -->`;
    if (Array.isArray(msg.swipes) && msg.swipes[msg.swipe_id] === current) msg.swipes[msg.swipe_id] = msg.mes;
    return true;
}

export function filterTrackerContext(messages) {
    // SillyTavern passes coreChat, a prompt copy. Replace entries rather than
    // mutating shared message objects or deleting the tags in the saved chat.
    for (let i = 0; i < messages.length; i++) {
        if (typeof messages[i]?.mes !== 'string') continue;
        const clean = stripReproTags(messages[i].mes);
        if (clean !== messages[i].mes) messages[i] = { ...messages[i], mes: clean };
    }
    updatePromptInjection();
}

export function setSecondParent(who, name) {
    if (!['user','char'].includes(who)) return false;
    const carrier = who === 'char' ? getPartnerData() : getPregnancyData();
    if (!carrier.isPregnant) return false;
    carrier.fatherName = String(name || '').trim().slice(0,80);
    carrier._secondParentManual = true;
    refreshRegenSnapshot();
    saveSettingsDebounced();
    syncUI();
    updatePromptInjection();
    renderInfoblock();
    return true;
}
