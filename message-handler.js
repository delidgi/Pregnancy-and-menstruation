// ═══════════════════════════════════════════
// MESSAGE-HANDLER — обработка входящих сообщений
// ═══════════════════════════════════════════

import { getSettings, getPregnancyData, getCycleDay, setCycleDay, getCurrentChatId, dlog, dwarn } from './state.js';
import { scanMessage, scanDateTag, scanStatusTag, scanWeeksFromText, scanPregnancyStateTag, stripHiddenTags, stripThink } from './scanner.js';
import { applyScanResult, createPregnancyFromWeeks, createPregnancyFromStateTag } from './pregnancy.js';
import { updateBabyCare } from './baby-care.js';
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

// ─── Main scan logic ───

// Track whether this is a regeneration/swipe (skip time analysis)
let _isRegeneration = false;
// Snapshot of pregnancy data before last scan (for restoring on regen)
let _preRegenSnapshot = null;
// ChatId, которому принадлежит _preRegenSnapshot. БЕЗ этой привязки снапшот из
// старого чата восстанавливался при свайпе в НОВОМ чате → «беременность перетекла».
let _snapshotChatId = null;

// Снапшот состояния p без истории (иначе история вложится сама в себя)
function snapshotOf(p) {
    const c = structuredClone(p);
    delete c._history;
    return c;
}

// Быстрый хэш текста — для дедупа сканов. Позиция сама по себе не годится:
// при стриминге MESSAGE_RECEIVED может прийти с неполным текстом (без хвостовых тегов),
// а GENERATION_ENDED — с полным. Дедуп по позиции блокировал повторный скан → теги терялись.
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
    } catch (e) {
        dwarn('[Reproductive] pushStateHistory failed:', e);
    }
}

// Откат состояния к моменту, когда в чате было newLen сообщений.
// Вызывается на MESSAGE_DELETED: удалила сообщение с зачатием → состояние вернулось
// к снапшоту предыдущего сообщения, где беременности ещё нет.
export function rollbackToPosition(newLen) {
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

        dlog(`[Reproductive] State rolled back to position ${target.pos} (chat len now ${newLen}): pregnant=${p.isPregnant}, weeks=${p.pregnancyWeeks}, cycle=${p.cycleDay}`);
        saveSettingsDebounced();
        return true;
    } catch (e) {
        dwarn('[Reproductive] rollbackToPosition failed:', e);
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
    // Реген/свайп ВСЕГДА заканчивается ботским сообщением. Если последнее сообщение — юзера,
    // значит флаг протух (юзер полистал свайпы туда-сюда БЕЗ генерации и написал пост):
    // раньше такой скан «восстанавливал» старый снапшот → _dynamic пустел → инфоблок
    // сбрасывался к статичным заглушкам при отправке нового сообщения.
    const isRegen = _isRegeneration && !lastMessage.is_user;
    _isRegeneration = false; // reset flag

    // Теги внутри CoT-блоков не считаются (закрытый think = мысли; незакрытый
    // с тегами = префилл, содержимое сканируется)
    const text = stripThink(lastMessage.mes || '');
    const textHash = simpleHash(text);

    // Дедуп: та же позиция И тот же текст (или его версия с уже вырезанными тегами) → скип.
    // Если текст на той же позиции ИЗМЕНИЛСЯ (стриминг дописал хвостовые теги) — сканируем заново.
    if (!isRegen && s._lastScannedPosition === positionId &&
        (textHash === s._lastScannedHash || textHash === s._lastScannedHashStripped)) {
        dlog('[Reproductive] Position+text already scanned — skipping');
        return;
    }

    dlog(`[Reproductive] Scan msg (len=${text.length}, regen=${isRegen}), tail="${text.slice(-100)}"`);

    // On regeneration: restore state snapshot from before the original message was processed.
    // ТОЛЬКО если снапшот принадлежит текущему чату — иначе утечка состояния между чатами.
    const p = getPregnancyData();
    const chatIdNow = getCurrentChatId();
    if (isRegen && _preRegenSnapshot) {
        if (_snapshotChatId === chatIdNow) {
            dlog('[Reproductive] Regen: restoring pre-scan state snapshot');
            Object.assign(p, _preRegenSnapshot);
            saveSettingsDebounced();
        } else {
            dwarn(`[Reproductive] Regen snapshot belongs to another chat (${_snapshotChatId} ≠ ${chatIdNow}) — NOT restoring`);
        }
        _preRegenSnapshot = null;
        // Свайп = новое сообщение на той же позиции: проверка зачатия должна кидаться заново
        s._lastConceptionRollAt = null;
    }
    // Save snapshot before processing (for potential future regen)
    _preRegenSnapshot = snapshotOf(p);
    _snapshotChatId = chatIdNow;

    // Отмечаем скан сразу (все ветки ниже могут выйти раньше)
    s._lastScannedPosition = positionId;
    s._lastScannedHash = textHash;
    s._lastScannedHashStripped = simpleHash(stripHiddenTags(text));

    // 0) RP_DATE tag: always extract date and advance time
    let dateAdvanced = processDateTag(text);

    // 1) Try tag-based detection (if model added tags)
    const tagResult = scanMessage(text);
    if (tagResult) {
        // Ignore conception tag when already pregnant
        if (p.isPregnant) {
            tagResult.vaginal_ejaculation_occurred = false;
        }
        // Анти-дабл-ролл: если на ЭТОЙ позиции проверка зачатия уже кидалась
        // (частичный текст → полный текст), второй раз кубик не бросаем.
        if (tagResult.vaginal_ejaculation_occurred && s._lastConceptionRollAt === positionId) {
            dlog('[Reproductive] Conception already rolled at this position — skipping re-roll');
            tagResult.vaginal_ejaculation_occurred = false;
        }
        // Block keyword/API-based conception after manual reset (only explicit tags bypass)
        if (tagResult.vaginal_ejaculation_occurred && tagResult._source !== 'tag' && s._conceptionBlockedUntil && positionId <= s._conceptionBlockedUntil) {
            dlog(`[Reproductive] Conception blocked (reset protection until pos ${s._conceptionBlockedUntil}, current ${positionId})`);
            tagResult.vaginal_ejaculation_occurred = false;
        }
        // Block keyword-based birth on USER messages (only AI narration or explicit tag may trigger birth)
        if (tagResult.birth_occurred && tagResult._source === 'keyword' && lastMessage.is_user) {
            dlog('[Reproductive] Keyword-birth in USER message — IGNORED');
            tagResult.birth_occurred = false;
        }
        // Block keyword-based birth when pregnancy is too early (require >= 85% of duration)
        if (tagResult.birth_occurred && tagResult._source === 'keyword' && p.isPregnant) {
            const minWeek = Math.ceil((p.pregnancyDuration || 40) * 0.85);
            if ((p.pregnancyWeek || 0) < minWeek) {
                dlog(`[Reproductive] Keyword-birth blocked: week ${p.pregnancyWeek} < ${minWeek} (need explicit [BIRTH] tag for early labor)`);
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
                    dlog(`[Reproductive] Fetus sex OVERRIDDEN from narrative: ${p.fetusSex.join(',')} → ${newSex.join(',')}`);
                    p.fetusSex = newSex;
                }
            }
            p.fetusSexRevealed = true;
            dlog(`[Reproductive] Fetus sex REVEALED (tag/keyword): ${p.fetusSex.join(', ')}`);
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

        // Only proceed if there's actually something to process
        if (tagResult.vaginal_ejaculation_occurred || tagResult.birth_occurred) {
            dlog('[Reproductive] Tag detected!', tagResult);
            if (tagResult.vaginal_ejaculation_occurred) s._lastConceptionRollAt = positionId;
            applyScanResult(tagResult);
            // Update snapshot to reflect post-birth state (prevents regen from restoring pregnancy)
            _preRegenSnapshot = snapshotOf(getPregnancyData());
            _snapshotChatId = chatIdNow;
            if (s.showNotifications) {
                const parts = [];
                if (tagResult.vaginal_ejaculation_occurred) parts.push('<i class="fa-solid fa-droplet"></i> Зачатие проверено!');
                if (tagResult.birth_occurred) parts.push('<i class="fa-solid fa-baby"></i> Роды!');
                showNotification(`<i class="fa-solid fa-check"></i> ${parts.join(' | ')}`, 'success');
            }
            syncUI();
            updatePromptInjection();
            setTimeout(renderInfoblock, 500);
            pushStateHistory(positionId);
            saveSettingsDebounced();
            return;
        } else {
            dlog('[Reproductive] Tag found but irrelevant (pregnant, no birth) — skipping tag');
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
        const blocked = s._conceptionBlockedUntil && positionId <= s._conceptionBlockedUntil;
        if (recentlyUserSet || blocked) {
            dlog(`[Reproductive] PREGNANCY_STATE received while not pregnant — NOT creating (recent manual action or reset protection)`);
        } else {
            createPregnancyFromStateTag(pregState);
        }
    }
    if (pregState && p.isPregnant) {
        let stateChanged = false;
        if (p.conceptionDate !== pregState.conceptionDate) {
            // Защита: если юзер недавно вручную выставил беременность — НЕ затираем его дату,
            // даже если бот в PREGNANCY_STATE прислал другое (бот может пересчитать или округлить).
            const userSetMs = p._userSetWeeksAt || 0;
            const recentlyUserSet = userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30;
            if (recentlyUserSet) {
                dlog(`[Reproductive] PREGNANCY_STATE conceptionDate IGNORED — manual set recent (kept ${p.conceptionDate})`);
            } else {
                dlog(`[Reproductive] PREGNANCY_STATE conceptionDate updated: ${p.conceptionDate} → ${pregState.conceptionDate}`);
                p.conceptionDate = pregState.conceptionDate;
                p._conceptionAnchored = true;
                stateChanged = true;
            }
        }
        if (p.fetusCount !== pregState.fetusCount) {
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
                dlog('[Reproductive] PREGNANCY_STATE revealed all sexes:', pregState.fetusSex);
            }
            stateChanged = true;
        }
        if (pregState.fatherName && p.fatherName !== pregState.fatherName) {
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
            const blocked = s._conceptionBlockedUntil && positionId <= s._conceptionBlockedUntil;

            if (recentlyManual) {
                dlog(`[Reproductive] Skipping text-weeks parser — user manually set weeks ${minutesSinceManual.toFixed(1)}min ago`);
            } else if (blocked) {
                dlog(`[Reproductive] Skipping text-weeks parser — reset protection until pos ${s._conceptionBlockedUntil}`);
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
    if (!fullText) return;
    fullText = stripThink(fullText);
    const s = getSettings();
    if (!s.isEnabled) return;

    const p = getPregnancyData();
    const positionId = (typeof messageIndex === 'number' ? messageIndex + 1 : (s._lastScannedPosition || 0));

    // Tag-based detection on FULL text
    const tagResult = scanMessage(fullText);
    if (tagResult) {
        if (p.isPregnant) tagResult.vaginal_ejaculation_occurred = false;
        if (tagResult.vaginal_ejaculation_occurred && tagResult._source !== 'tag' && s._conceptionBlockedUntil && positionId <= s._conceptionBlockedUntil) {
            tagResult.vaginal_ejaculation_occurred = false;
        }
        // Block keyword-based birth in early pregnancy (rescan: bot text only, but still apply week guard)
        if (tagResult.birth_occurred && tagResult._source === 'keyword' && p.isPregnant) {
            const minWeek = Math.ceil((p.pregnancyDuration || 40) * 0.85);
            if ((p.pregnancyWeek || 0) < minWeek) {
                dlog(`[Reproductive] (rescan) Keyword-birth blocked: week ${p.pregnancyWeek} < ${minWeek}`);
                tagResult.birth_occurred = false;
            }
        }

        // Sex reveal — only if not yet revealed (idempotent)
        if (tagResult.sex_revealed && p.isPregnant && !p.fetusSexRevealed) {
            if (tagResult.revealed_sexes && tagResult.revealed_sexes.length > 0) {
                const need = p.fetusCount || 1;
                const newSex = [];
                for (let i = 0; i < need; i++) {
                    newSex.push(tagResult.revealed_sexes[i] || tagResult.revealed_sexes[tagResult.revealed_sexes.length - 1]);
                }
                if (JSON.stringify(newSex) !== JSON.stringify(p.fetusSex)) {
                    dlog(`[Reproductive] (rescan) Fetus sex OVERRIDDEN from narrative: ${p.fetusSex.join(',')} → ${newSex.join(',')}`);
                    p.fetusSex = newSex;
                }
            }
            p.fetusSexRevealed = true;
            dlog(`[Reproductive] (rescan) Fetus sex REVEALED: ${p.fetusSex.join(', ')}`);
            saveSettingsDebounced();
            if (s.showNotifications) {
                const icons = p.fetusSex.map(sx => sx === 'M' ? '♂ мальчик' : '♀ девочка').join(', ');
                showNotification(`<i class="fa-solid fa-baby"></i> Пол определён: ${icons}`, 'success');
            }
            syncUI();
            updatePromptInjection();
            setTimeout(renderInfoblock, 300);
        }

        if (tagResult.vaginal_ejaculation_occurred || tagResult.birth_occurred) {
            dlog('[Reproductive] (rescan) Tag detected on full rendered text!', tagResult);
            applyScanResult(tagResult);
            _preRegenSnapshot = snapshotOf(getPregnancyData());
            _snapshotChatId = getCurrentChatId();
            s._lastScannedPosition = positionId;
            pushStateHistory(positionId);
            if (s.showNotifications) {
                const parts = [];
                if (tagResult.vaginal_ejaculation_occurred) parts.push('<i class="fa-solid fa-droplet"></i> Зачатие проверено!');
                if (tagResult.birth_occurred) parts.push('<i class="fa-solid fa-baby"></i> Роды!');
                showNotification(`<i class="fa-solid fa-check"></i> ${parts.join(' | ')}`, 'success');
            }
            syncUI();
            updatePromptInjection();
            setTimeout(renderInfoblock, 300);
            return;
        }
    }

    // RP_STATUS tag — apply dynamic scene data (idempotent: just overwrites _dynamic)
    const statusData = scanStatusTag(fullText);
    if (statusData) {
        applyStatusData(s, p, statusData);
        saveSettingsDebounced();
        syncUI();
        setTimeout(renderInfoblock, 300);
    }
}

// ─── Apply RP_STATUS JSON data to pregnancy state ───
function applyStatusData(s, p, data) {
    dlog('[Reproductive] Applying RP_STATUS data:', data);

    if (p.hasBaby) {
        // Baby mode
        if (data.babies && Array.isArray(data.babies) && p.babies?.length > 0) {
            data.babies.forEach((apiB, i) => {
                if (i < p.babies.length) {
                    const baby = p.babies[i];
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
                            dlog(`[Reproductive] Skipped name overwrite: "${baby.name}" → "${cleanName}" (existing name protected)`);
                        }
                    }
                    if (apiB.mood) baby.mood = apiB.mood;
                    if (apiB.sleep) baby.sleep = apiB.sleep;
                    // FIX: пишем в ОБА поля — UI читает feedingType, промпт feeding
                    if (apiB.feeding) {
                        baby.feeding = apiB.feeding;
                        baby.feedingType = apiB.feeding;
                    }
                    // Подгузник: парсим текст в diaperClean boolean + сохраняем текст
                    if (apiB.diaper) {
                        baby.diaperStatus = apiB.diaper;
                        const cleanPatterns = /^(?:чист|clean|dry|сух)/i;
                        baby.diaperClean = cleanPatterns.test(apiB.diaper);
                    }
                    // Рекомендация по уходу от модели
                    if (apiB.care_note) {
                        baby.careNote = apiB.care_note;
                    }
                    if (apiB.father_name && apiB.father_name !== baby.fatherName) {
                        baby.fatherName = String(apiB.father_name).slice(0, 80);
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
        if (data.father_name && data.father_name !== p.fatherName) {
            p.fatherName = String(data.father_name).slice(0, 80);
            dlog(`[Reproductive] Father name set from RP_STATUS: ${p.fatherName}`);
        }

        // Sex reveal from RP_STATUS (in case model puts it here instead of tag)
        if (data.sex_revealed === true && !p.fetusSexRevealed) {
            p.fetusSexRevealed = true;
            dlog(`[Reproductive] Fetus sex REVEALED (RP_STATUS): ${p.fetusSex.join(', ')}`);
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
}


// ─── Advance cycle day and pregnancy weeks ───

function advanceTime(s, p, daysPassed) {
    if (daysPassed <= 0) return;
    let changed = false;

    // ── Advance cycle day (28-day cycle, wraps around) ──
    if (!p.isPregnant) {
        // Если юзер только что вручную выставил день цикла — не двигаем его автоматически 30 минут.
        // Иначе следующий же бот-ответ с новым RP_DATE сдвинет цикл и выглядит как "сброс".
        const userSetMs = p._userSetCycleAt || 0;
        const minutesSinceUserSet = (Date.now() - userSetMs) / 60000;
        if (userSetMs > 0 && minutesSinceUserSet < 30) {
            dlog(`[Reproductive] Cycle auto-advance SKIPPED — user set cycle ${minutesSinceUserSet.toFixed(1)}min ago`);
        } else {
        const oldDay = getCycleDay();
        const newDay = ((oldDay - 1 + daysPassed) % 28) + 1;
        setCycleDay(newDay, true, false);
        dlog(`[Reproductive] Cycle day: ${oldDay} → ${newDay} (+${daysPassed}d)`);
        changed = true;

        // Cycle milestone notifications
        if (s.showNotifications) {
            if (oldDay > 5 && newDay <= 5) {
                showNotification('<i class="fa-solid fa-droplet"></i> Менструация началась', 'info');
            }
            if (oldDay < 12 && newDay >= 12 && newDay <= 16) {
                showNotification('<i class="fa-solid fa-fire"></i> Окно овуляции — фертильность максимальна', 'warning');
            }
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
            if (newW !== oldWeeks) {
                p.pregnancyWeeks = newW;
                dlog(`[Reproductive] Pregnancy weeks (strict): ${oldWeeks} → ${newW}`);
                changed = true;

                const duration = s.pregnancyDuration || 40;

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
                        showNotification('<i class="fa-solid fa-hospital"></i> ПДР достигнута — роды могут начаться в любой момент!', 'warning');
                    }
                }

                // ── AUTO-BIRTH: if weeks exceed duration+2, trigger birth automatically ──
                if (newW >= duration + 2) {
                    dlog(`[Reproductive] Auto-birth triggered at ${newW} weeks (duration: ${duration})`);
                    const birthResult = {
                        birth_occurred: true,
                        vaginal_ejaculation_occurred: false,
                        cycle_day: null,
                    };
                    applyScanResult(birthResult);
                    // Update snapshot to reflect post-birth state
                    _preRegenSnapshot = snapshotOf(p);
                    _snapshotChatId = getCurrentChatId();
                    return; // applyScanResult handles everything
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
                dwarn('[Reproductive] graduation dialog import failed:', e);
                // Тихий fallback: всё равно выпускаем
                mod.graduateBabies(graduates);
                _graduationDialogShowing = false;
            });
        }).catch(e => {
            dwarn('[Reproductive] graduation check failed:', e);
        });
    } catch (e) {
        dwarn('[Reproductive] maybeGraduateBabies error:', e);
    }
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
            dlog(`[Reproductive] Complication revealed at week ${pc.revealWeek}: ${pc.type}`);
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
    if (!pos || pos === 'off') return;

    document.querySelectorAll('.rp-infoblock-inserted').forEach(el => el.remove());

    const html = buildInfoblockHtml();
    if (!html) return;

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

    const wrapper = document.createElement('div');
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

export function markRegeneration() {
    _isRegeneration = true;
}

// Вызывать после любого РУЧНОГО изменения состояния (setCycleDay, startManualPregnancy,
// resetPregnancy, resetBaby и т.п.). Без этого regen/swipe откатит ручные правки
// к состоянию ДО последнего скана — выглядит как "поставил, отправил, сбросилось".
export function refreshRegenSnapshot() {
    try {
        const p = getPregnancyData();
        _preRegenSnapshot = snapshotOf(p);
        _snapshotChatId = getCurrentChatId();
        // Ручное изменение фиксируем и в истории состояний — иначе откат при удалении
        // сообщения отменил бы и ручные правки, сделанные после этого сообщения.
        try {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
            const len = ctx?.chat?.length ?? 0;
            if (len > 0) pushStateHistory(len);
        } catch (e) { /* ignore */ }
    } catch (e) {
        dwarn('[Reproductive] refreshRegenSnapshot failed:', e);
    }
}

export async function onMessageReceived(messageIndex, type) {
    dlog(`[Reproductive] MESSAGE_RECEIVED fired! index=${messageIndex}, type=${type}`);
    if (type === 'quiet') return;
    runScan();
}

// User-side scan: triggered from MESSAGE_SENT so player descriptions
// (я рожаю / кончает в меня / у нас будет девочка) are also detected.
export async function onMessageSent(messageIndex, type) {
    dlog(`[Reproductive] MESSAGE_SENT fired! index=${messageIndex}, type=${type}`);
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
    let prevRaw = p._lastRpDateTag;

    // Bootstrap: if no previous date stored, scan chat history
    if (!prevRaw) {
        const chat = typeof SillyTavern?.getContext === 'function'
            ? SillyTavern.getContext().chat : window.chat;
        if (chat) {
            for (let i = chat.length - 2; i >= 0; i--) {
                const msg = chat[i];
                if (msg && msg.mes && !msg.is_system) {
                    const prev = scanDateTag(stripThink(msg.mes));
                    if (prev) {
                        prevRaw = prev.toISOString();
                        dlog(`[Reproductive] RP_DATE bootstrap: found ${prevRaw.slice(0,10)} in msg ${i}`);
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
    if (p.isPregnant && !p._conceptionAnchored) {
        const w = Math.max(0, p.pregnancyWeeks || 0);
        p.conceptionDate = new Date(rpDate.getTime() - w * 7 * 86400000).toISOString();
        p._conceptionAnchored = true;
        dlog(`[Reproductive] conceptionDate re-anchored to RP timeline: ${p.conceptionDate} (preserved ${w}w)`);
    } else if (p.isPregnant && !p.conceptionDate) {
        // Safety net: pregnant but no conceptionDate at all
        p.conceptionDate = newIso;
        p._conceptionAnchored = true;
        dlog(`[Reproductive] conceptionDate backfilled from RP_DATE: ${p.conceptionDate}`);
    }
    // Clamp: if rpDate < conceptionDate (model rewound time), pull conceptionDate back
    // НО: если юзер только что вручную выставил беременность — НЕ трогаем его дату зачатия.
    // Иначе ручная "беременна с 01.06.2026" мгновенно сбрасывается до текущей RP-даты бота.
    if (p.isPregnant && p.conceptionDate && new Date(p.conceptionDate).getTime() > rpDate.getTime()) {
        const userSetMs = p._userSetWeeksAt || 0;
        const minutesSinceUserSet = (Date.now() - userSetMs) / 60000;
        const recentlyUserSet = userSetMs > 0 && minutesSinceUserSet < 30;
        if (recentlyUserSet) {
            dlog(`[Reproductive] Clamp SKIPPED — user set pregnancy ${minutesSinceUserSet.toFixed(1)}min ago (preserving manual conceptionDate)`);
        } else {
            const w = Math.max(0, p.pregnancyWeeks || 0);
            // Preserve weeks: shift conceptionDate to (rpDate - weeks*7d)
            p.conceptionDate = new Date(rpDate.getTime() - w * 7 * 86400000).toISOString();
            dwarn(`[Reproductive] rpDate < conceptionDate — re-anchored preserving ${w}w`);
        }
    }

    if (prevRaw) {
        const prev = new Date(prevRaw);
        const diffMs = rpDate.getTime() - prev.getTime();
        const diffDays = Math.round(diffMs / 86400000);
        if (diffDays > 0 && diffDays <= 365) {
            dlog(`[Reproductive] RP_DATE: ${diffDays}d (${prevRaw.slice(0,10)} → ${newIso.slice(0,10)})`);
            advanceTime(s, p, diffDays);
            saveSettingsDebounced();
            syncUI();
            updatePromptInjection();
            setTimeout(renderInfoblock, 500);
            return true;
        } else if (diffDays < 0) {
            dlog(`[Reproductive] RP_DATE: date went backwards, ignoring`);
        }
    } else {
        dlog(`[Reproductive] RP_DATE: first date recorded ${newIso.slice(0,10)}`);
        saveSettingsDebounced();
    }
    return false;
}
