// ═══════════════════════════════════════════
// PREGNANCY — зачатие, осложнения, роды
// ═══════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../script.js';
import { CHANCES } from './config.js';
import { getSettings, getPregnancyData, getPartnerData, getCycleDay, setCycleDay, carrierName, L, getContraception, syncBabyLegacyFields } from './state.js';
import { isOmegaverse, designationOf, carrierAboStatus, getCfg, canCarry, hasMenstrualCycle } from './omegaverse.js';
import { rollTest, isObvious, postpartumState, fertileWindow, inheritLooks, conceptionStruggle, missedDays } from './fertility.js';
import { roll, getCycleModifier, formatSexIcons, formatFetusCount, calculateWeeksFromDates, getHealthInfo, rollPlannedComplications } from './helpers.js';
import { calculateConceptionDate } from './date-parser.js';
import { showNotification, showBirthDialog } from './notifications.js';

// Forward declarations
let _syncUI = () => {};
let _updatePromptInjection = () => {};
let _renderInfoblock = () => {};
export function setSyncUI(fn) { _syncUI = fn; }
export function setUpdatePromptInjection(fn) { _updatePromptInjection = fn; }
export function setRenderInfoblock(fn) { _renderInfoblock = fn; }

// Обновить regen-snapshot (через динамический импорт чтобы избежать циклов).
// Зовём после любого ручного изменения состояния — без этого regen/swipe откатит правки.
function refreshSnap() {
    try {
        import('./message-handler.js').then(m => m.refreshRegenSnapshot && m.refreshRegenSnapshot());
    } catch (e) { /* ignore */ }
}


function configuredDuration(s) {
    return Math.max(4, parseInt(s?.pregnancyDuration) || 40);
}

// One gate for every birth path. Auto-birth requires the configured full term;
// explicit scene/manual birth keeps the legacy minimum threshold for plausibility.
export function canTriggerBirth(carrier, s = getSettings(), source = 'tag') {
    if (!carrier?.isPregnant) return false;
    const weeks = Math.max(0, parseInt(carrier.pregnancyWeeks) || 0);
    const duration = configuredDuration(s);
    if (source === 'auto') return weeks >= duration;
    const minBirthWeek = Math.min(20, duration);
    return weeks > 0 && weeks >= minBirthWeek;
}

// When RP time jumps past the due date, auto-birth is anchored to the due date,
// not the end of the time-skip. Explicit births use the current RP date.
export function resolveBirthRpDate(carrier, root, s = getSettings(), source = 'tag') {
    const current = root?.rpDate ? new Date(root.rpDate) : null;
    if (source === 'auto' && carrier?.conceptionDate) {
        const conception = new Date(carrier.conceptionDate);
        if (!isNaN(conception.getTime())) {
            const due = new Date(conception.getTime() + configuredDuration(s) * 7 * 86400000);
            if (!current || isNaN(current.getTime()) || current.getTime() >= due.getTime()) return due.toISOString();
        }
    }
    return current && !isNaN(current.getTime()) ? current.toISOString() : new Date().toISOString();
}

export function createUndoCheckpoint(label = 'Изменение') {
    const p = getPregnancyData();
    const snapshot = structuredClone(p);
    delete snapshot._undoSnapshot;
    p._undoSnapshot = { label, createdAt: Date.now(), state: snapshot };
    return p._undoSnapshot;
}

export function undoLastDestructiveChange() {
    const p = getPregnancyData();
    const backup = p?._undoSnapshot;
    if (!backup?.state) return false;
    const restored = structuredClone(backup.state);
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, restored);
    syncBabyLegacyFields(p);
    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    _renderInfoblock();
    return backup.label || true;
}

// Применить результат сканирования к состоянию
export function applyScanResult(result) {
    const s = getSettings();
    const p = getPregnancyData();
    let updated = false;

    // RP-дата
    if (result.rp_date) {
        const newDate = new Date(result.rp_date);
        if (!isNaN(newDate.getTime())) {
            const oldDate = p.rpDate;
            p.rpDate = newDate.toISOString();
            if (oldDate !== p.rpDate) {
                updated = true;

                // Auto-advance cycle day based on RP date difference
                if (oldDate) {
                    const oldTime = new Date(oldDate).getTime();
                    const newTime = newDate.getTime();
                    const daysPassed = Math.floor((newTime - oldTime) / 86400000);
                    if (daysPassed > 0 && !p.isPregnant) {
                        const oldCycleDay = getCycleDay();
                        const newCycleDay = ((oldCycleDay - 1 + daysPassed) % 28) + 1;
                        setCycleDay(newCycleDay);
                    }
                }

                // Pregnancy weeks are calculated strictly from conceptionDate + rpDate
                if (p.isPregnant) {
                    // Backfill conceptionDate if missing — anchor to current rpDate
                    if (!p.conceptionDate) {
                        if (p.pregnancyWeeks > 0) {
                            const cd = calculateConceptionDate(newDate, p.pregnancyWeeks);
                            if (cd) p.conceptionDate = cd.toISOString();
                        } else {
                            p.conceptionDate = newDate.toISOString();
                        }
                    }
                    // Clamp: if rpDate < conceptionDate (RP went backwards) — shift conception back
                    // НО: если юзер только что вручную выставил беременность — не трогаем дату.
                    if (p.conceptionDate && new Date(p.conceptionDate).getTime() > newDate.getTime()) {
                        const userSetMs = p._userSetWeeksAt || 0;
                        const recentlyUserSet = userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30;
                        if (recentlyUserSet) {
                        } else {
                            p.conceptionDate = newDate.toISOString();
                        }
                    }
                    // Sync pregnancyWeeks state from authoritative date math
                    const calc = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
                    if (calc.weeks !== p.pregnancyWeeks) {
                        p.pregnancyWeeks = calc.weeks;
                    }
                }
            }
        }
    }

    // День цикла
    if (result.cycle_day !== null && result.cycle_day !== undefined) {
        const day = parseInt(result.cycle_day);
        const current = getCycleDay();
        if (day >= 1 && day <= 28 && day !== current) {
            setCycleDay(day);
            updated = true;
        }
    }

    // Выкидыш / аборт → мягкий сброс беременности (дети, архив и цикл сохраняются)
    if (result.miscarriage_occurred || result.abortion_occurred) {
        if (!p.isPregnant) {
            return updated;
        }
        // Anti-resurrection: после ручного сброса модель может цепляться за старый контекст
        try {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
            const chatLen = ctx?.chat?.length || 0;
            if (!s._historyScanInProgress && s._birthBlockedUntilUser && chatLen < s._birthBlockedUntilUser) {
                return updated;
            }
        } catch (e) {}
        terminatePregnancy(result.abortion_occurred ? 'abortion' : 'miscarriage');
        return true; // роды/зачатие в этом же сообщении уже не обрабатываем
    }

    // Роды
    if (result.birth_occurred) {
        // ── Защиты от ложных срабатываний ──
        // 1) Игнорируем если беременности нет
        if (!p.isPregnant) {
            return updated;
        }
        // 2) Единая проверка срока для всех путей родов.
        const birthSource = result._birthSource || result._source || 'tag';
        if (!canTriggerBirth(p, s, birthSource)) return updated;
        // 3) Игнорируем если только что был reset (anti-resurrection — модель цепляется за старый контекст)
        try {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
            const chatLen = ctx?.chat?.length || 0;
            if (!s._historyScanInProgress && s._birthBlockedUntilUser && chatLen < s._birthBlockedUntilUser) {
                return updated;
            }
        } catch (e) {}

        // Save pregnancy data before resetting
        const babySex = p.fetusSex.length > 0 ? [...p.fetusSex] : ['M'];
        const newBabyCount = p.fetusCount || 1;
        const birthRpDate = resolveBirthRpDate(p, p, s, birthSource);

        // ── Сохраняем существующих детей (если они уже есть от предыдущих родов) ──
        const existingBabies = Array.isArray(p.babies) ? [...p.babies] : [];
        const prevMomState = p.momState;

        // ВАЖНО: не заменяем весь root defaultPregnancyData. Корень хранит не только
        // беременность, но и RP-дату, цикл, партнёра, историю/undo, родительские черты
        // и семейные данные. Сбрасываем только поля ТЕКУЩЕЙ беременности {{user}}.
        p.isPregnant = false;
        p.conceptionDate = null;
        p.pregnancyWeeks = 0;
        p._conceptionAnchored = false;
        p.fetusCount = 1;
        p.fetusSex = [];
        p.fetusSexRevealed = false;
        p.complications = [];
        p._plannedComplications = [];
        p.healthStatus = 'normal';
        p.lastComplicationCheck = null;
        p.lastComplicationCheckRpDate = null;
        p.lastDoctorVisitRpDate = null;
        p.pregnancyKnown = false;
        p.testTakenAt = null;
        p.lastTestResult = null;
        p.missedPeriodDays = 0;
        p.mood = '';
        p.libido = '';
        p.weightGain = '';
        p.babyActivity = '';
        p._dynamic = {};

        // Блок пере-триггера на 12 сообщений: послеродовой текст не создаёт новую
        // беременность/роды (явный [CONCEPTION_CHECK] тег блок обходит)
        try {
            if (!s._historyScanInProgress) {
                const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
                const chatLen = ctx?.chat?.length || 0;
                s._conceptionBlockedUntilUser = chatLen + 12;
                s._birthBlockedUntilUser = chatLen + 12;
                p._userSetWeeksAt = Date.now(); // глушит scanWeeksFromText на 30 мин
            }
        } catch (e) {}

        // Послеродовое восстановление: лактация, заживление, цикл не сразу
        p.postpartum = { startRpDate: birthRpDate, lactating: true };
        p.pregnancyKnown = false;
        p.lastTestResult = null;
        p.babyHealth = 'normal';
        p.babyMood = 'спокойный';
        p.babyDiaperClean = true;
        p.babySleep = 'спит';
        // babyAge — описание МЛАДШЕГО (новорождённого); для старших возраст хранится индивидуально
        p.babyAge = 'новорождённый';
        // Сохраняем momState (мама уже была мамой)
        if (prevMomState) p.momState = prevMomState;

        // Массив babies: сначала старшие (с их сохранёнными атрибутами), потом новенькие
        p.babies = [...existingBabies];

        // Добавляем новорождённых с привязкой к birthRpDate (для расчёта возраста)
        for (let i = 0; i < newBabyCount; i++) {
            p.babies.push({
                name: '',
                sex: babySex[i] || 'M',
                health: 'normal',
                mood: 'спокойный',
                sleep: 'спит',
                diaperClean: true,
                teething: false,
                colicky: false,
                feedingType: '',
                milestones: [],
                personality: [],
                // Внешность наследуется от родителей (менделевская модель)
                appearance: inheritedLooks(p),
                birthRpDate: birthRpDate,  // для расчёта возраста в днях
                age: 'новорождённый',
            });
        }
        syncBabyLegacyFields(p);
        saveSettingsDebounced();
        _syncUI();
        _updatePromptInjection();

        // Build baby stubs for dialog — pre-fill from model's BABY_TRAITS if scanner extracted it
        const modelTraits = result.baby_traits && Array.isArray(result.baby_traits.babies)
            ? result.baby_traits.babies : [];
        const dialogBabies = [];
        for (let i = 0; i < newBabyCount; i++) {
            const mt = modelTraits[i] || {};
            dialogBabies.push({
                sex: babySex[i] || 'M',
                name: mt.name || mt.имя || '',
                fatherName: mt.fatherName || mt.father || mt.отец || '',
                personality: Array.isArray(mt.personality) ? mt.personality
                          : Array.isArray(mt.характер) ? mt.характер : null,
                appearance: Array.isArray(mt.appearance) ? mt.appearance
                         : Array.isArray(mt.внешность) ? mt.внешность : null,
                special: mt.special !== undefined ? mt.special : undefined,
            });
        }

        // Индекс начала новорождённых в массиве p.babies (чтобы диалог писал имена в правильные слоты)
        const newbornStartIdx = existingBabies.length;

        // Show birth dialog for naming + traits (state already transitioned).
        // Full-history recovery runs silent to avoid popping historical birth dialogs.
        const applyNewbornTraits = (names, traitsData) => {
            // Заполняем ТОЛЬКО новорождённых (со старта новорождённых до конца массива)
            for (let i = 0; i < newBabyCount; i++) {
                const targetIdx = newbornStartIdx + i;
                const baby = p.babies[targetIdx];
                if (!baby) continue;
                if (names[i]) baby.name = names[i];
                const traits = traitsData[i] || {};
                if (Array.isArray(traits.personality) && traits.personality.length) baby.personality = traits.personality;
                if (Array.isArray(traits.appearance) && traits.appearance.length) baby.appearance = traits.appearance;
                if (traits.special) baby.special = traits.special;
                if (traits.fatherName) baby.fatherName = traits.fatherName;
            }
            // Legacy: babyName = имя первого ребёнка в семье
            if (p.babies[0]?.name) p.babyName = p.babies[0].name;
            saveSettingsDebounced();
            _syncUI();
            _updatePromptInjection();
            syncBabyLegacyFields(p);
            _renderInfoblock();
        };
        if (result._silent) {
            const names = dialogBabies.map(b => b.name || '');
            const traits = dialogBabies.map(b => ({
                personality: Array.isArray(b.personality) ? b.personality : [],
                appearance: Array.isArray(b.appearance) ? b.appearance : [],
                special: b.special,
                fatherName: b.fatherName,
            }));
            applyNewbornTraits(names, traits);
        } else {
            showBirthDialog(dialogBabies, applyNewbornTraits);
        }
        return true;
    }

    // Зачатие
    if (result.vaginal_ejaculation_occurred && !p.isPregnant) {
        const conceptionResult = checkConception();
        if (conceptionResult) {
            updated = true;
        }
    }

    // Недели беременности — ONLY calculated from conceptionDate + rpDate in advanceTime().
    // If we have weeks from API but no conceptionDate, backfill conceptionDate.
    if (result.pregnancy_weeks !== null && result.pregnancy_weeks !== undefined && p.isPregnant) {
        const weeks = parseInt(result.pregnancy_weeks);
        if (weeks > 0 && !p.conceptionDate && p.rpDate) {
            const cd = calculateConceptionDate(new Date(p.rpDate), weeks);
            if (cd) {
                p.conceptionDate = cd.toISOString();
                updated = true;
            }
        }
    }

    // Количество плодов
    if (result.fetus_count !== null && result.fetus_count !== undefined && p.isPregnant) {
        const count = parseInt(result.fetus_count);
        if (count >= 1 && count <= 3 && count !== p.fetusCount) {
            p.fetusCount = count;
            while (p.fetusSex.length < count) {
                p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
            }
            p.fetusSex = p.fetusSex.slice(0, count);
            updated = true;
        }
    }

    // Здоровье
    if (result.health_status && p.isPregnant) {
        const valid = ['normal', 'warning', 'critical'];
        if (valid.includes(result.health_status) && result.health_status !== p.healthStatus) {
            p.healthStatus = result.health_status;
            updated = true;
        }
    }

    // Осложнения
    if (result.complications_detected && result.complications_detected.length > 0 && p.isPregnant) {
        const { weeks } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
        for (const compType of result.complications_detected) {
            const exists = p.complications.some(c => c.type === compType && !c.resolved);
            if (!exists) {
                p.complications.push({
                    week: weeks,
                    type: compType,
                    severity: 'warning',
                    description: compType,
                    rpDate: p.rpDate,
                    date: new Date().toISOString(),
                    resolved: false,
                });
                updated = true;
                if (s.showNotifications) {
                    showNotification(`<i class="fa-solid fa-triangle-exclamation"></i> Осложнение: ${compType}`, 'warning');
                }
            }
        }
    }

    // Mood/libido/weight/activity (works for both pregnancy and general)
    if (result.mood && result.mood !== p.mood) { p.mood = result.mood; updated = true; }
    if (result.libido && result.libido !== p.libido) { p.libido = result.libido; updated = true; }
    if (p.isPregnant) {
        if (result.weight_gain && result.weight_gain !== p.weightGain) { p.weightGain = result.weight_gain; updated = true; }
        if (result.baby_activity && result.baby_activity !== p.babyActivity) { p.babyActivity = result.baby_activity; updated = true; }
    }

    // Baby state tracking. babies[] is authoritative; legacy root fields are mirrors.
    if (p.hasBaby && Array.isArray(p.babies) && p.babies.length > 0) {
        const baby = p.babies[0];
        if (result.baby_name && result.baby_name !== baby.name) {
            baby.name = result.baby_name;
            updated = true;
        }
        if (result.baby_age && result.baby_age !== baby.age) {
            baby.age = result.baby_age;
            updated = true;
        }
        if (result.baby_health) {
            const validHealth = ['normal', 'warning', 'critical'];
            if (validHealth.includes(result.baby_health) && result.baby_health !== baby.health) {
                baby.health = result.baby_health;
                updated = true;
            }
        }
        if (result.baby_teething !== null && result.baby_teething !== undefined) {
            const v = !!result.baby_teething;
            if (v !== !!baby.teething) { baby.teething = v; updated = true; }
        }
        if (result.baby_diaper_clean !== null && result.baby_diaper_clean !== undefined) {
            const v = !!result.baby_diaper_clean;
            if (v !== (baby.diaperClean !== false)) {
                baby.diaperClean = v;
                updated = true;
                if (!v && s.showNotifications) showNotification('<i class="fa-solid fa-baby-carriage"></i> Подгузник нужно сменить!', 'info');
            }
        }
        if (result.baby_feeding && result.baby_feeding !== baby.feedingType) {
            baby.feedingType = result.baby_feeding;
            baby.lastFeedRpDate = p.rpDate;
            p.babyLastFeedRpDate = p.rpDate;
            updated = true;
        }
        if (result.baby_sleep && result.baby_sleep !== baby.sleep) { baby.sleep = result.baby_sleep; updated = true; }
        if (result.baby_mood && result.baby_mood !== baby.mood) { baby.mood = result.baby_mood; updated = true; }
        if (result.baby_colicky !== null && result.baby_colicky !== undefined) {
            const v = !!result.baby_colicky;
            if (v !== !!baby.colicky) { baby.colicky = v; updated = true; }
        }
        if (result.mom_state && result.mom_state !== p.momState) {
            p.momState = result.mom_state;
            updated = true;
        }
        if (result.baby_milestone) {
            if (!Array.isArray(baby.milestones)) baby.milestones = [];
            const exists = baby.milestones.some(m => m.text === result.baby_milestone);
            if (!exists) {
                baby.milestones.push({ text: result.baby_milestone, rpDate: p.rpDate, date: new Date().toISOString() });
                updated = true;
                if (s.showNotifications) showNotification(`<i class="fa-solid fa-star"></i> Развитие: ${result.baby_milestone}`, 'success');
            }
        }
        if (updated) syncBabyLegacyFields(p);
    }

    if (updated) {
        saveSettingsDebounced();
        _syncUI();
        _updatePromptInjection();
    }

    return updated;
}

export function checkConception() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!s.isEnabled) return null;
    if (p.isPregnant) return null;
    if (!canCarry(s, 'user')) return null;

    s.totalChecks++;

    const currentCycleDay = getCycleDay();
    // В омегаверсе у женщин обычный 28-дневный цикл продолжает иметь значение.
    // Для омеги течка дополнительно усиливает/ослабляет фертильность; у носителя без
    // месячных (например, мужчина-омега) шанс определяется только течкой.
    let cycleModifier = hasMenstrualCycle(s, 'user') ? getCycleModifier(currentCycleDay) : 1;
    if (isOmegaverse(s)) {
        const abo = carrierAboStatus(p, designationOf(s, 'user'), s);
        if (designationOf(s, 'user') === 'omega') cycleModifier *= (abo.fertility ?? 1);
    }
    let chance = Math.max(0, Math.min(100, Math.round(CHANCES.base * cycleModifier)));

    // Послеродовой период: пока цикл не вернулся, зачатие почти невозможно
    const pp = getPostpartum(p, p);
    if (pp) chance = Math.max(0, Math.min(100, Math.round(chance * pp.fertilityMul)));

    const contraception = getContraception('user');
    const contraceptionEff = CHANCES.contraception[contraception] || 0;
    let contraceptionFailed = false;

    // Контрацепция — отдельный бинарный барьер. Если она сработала, зачатия нет;
    // если подвела, дальше действует обычный биологический шанс.
    if (contraception !== 'none') {
        const protectionRoll = roll(100);
        if (protectionRoll <= contraceptionEff) {
            chance = 0;
        } else {
            contraceptionFailed = true;
            if (s.showNotifications) showNotification(L('contraceptionFailed'), 'warning');
        }
    }

    const conceptionRoll = roll(100);
    const success = conceptionRoll <= chance;

    const result = {
        roll: conceptionRoll,
        chance,
        contraception,
        contraceptionFailed,
        cycleDay: currentCycleDay,
        success,
    };

    if (success) {
        p.isPregnant = true;
        s._birthBlockedUntilUser = null;
        // Anchor conception STRICTLY to current rpDate. Никаких следов старых беременностей —
        // даже если в p случайно остались поля conceptionDate/pregnancyWeeks от прошлой беременности,
        // которая была сброшена не полностью, перезатираем их свежими значениями.
        // Если rpDate неизвестна — оставляем null, backfill на следующем RP_DATE тег.
        const freshConception = p.rpDate || null;
        p.conceptionDate = freshConception;
        p._conceptionAnchored = !!p.rpDate;
        p.pregnancyWeeks = 0;
        p._plannedComplications = rollPlannedComplications();
        s.totalConceptions++;

        const twinsChance = s.twinsChance || 3;
        const tripletsChance = s.tripletsChance || 0.1;
        const multiplesRoll = roll(1000) / 10;

        if (multiplesRoll <= tripletsChance) {
            p.fetusCount = 3;
        } else if (multiplesRoll <= twinsChance) {
            p.fetusCount = 2;
        } else {
            p.fetusCount = 1;
        }

        p.fetusSex = [];
        for (let i = 0; i < p.fetusCount; i++) {
            p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        }

        // Скрытая беременность: героиня пока не знает. Трекер знает, промпт молчит.
        p.pregnancyKnown = !s.hiddenPregnancy;
        p.lastTestResult = null;
        p.testTakenAt = null;

        if (s.showNotifications) {
            if (p.pregnancyKnown) {
                showNotification(`<i class="fa-solid fa-check"></i> Беременность! День ${currentCycleDay}, ${conceptionRoll}/${chance}<br>${formatFetusCount(p.fetusCount)} | Пол: ?`, 'success');
            } else {
                showNotification(`<i class="fa-solid fa-user-secret"></i> Зачатие произошло — но она пока не знает. Дождись задержки и сделай тест.`, 'success');
            }
        }
    } else {
        if (s.showNotifications) {
            showNotification(`<i class="fa-solid fa-xmark"></i> Не беременна. День ${currentCycleDay}, ${conceptionRoll}/${chance}`, 'info');
        }
    }

    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();

    return result;
}

// Мягкое прерывание беременности (выкидыш/аборт): сбрасывает ТОЛЬКО поля беременности.
// resetPregnancy() тут НЕ подходит — он затирает весь per-chat объект дефолтом,
// включая уже рождённых детей (babies/grownChildren) и день цикла.
export function terminatePregnancy(reason) {
    const s = getSettings();
    const p = getPregnancyData();
    if (!p.isPregnant) return false;
    p.isPregnant = false;
    p.conceptionDate = null;
    p.pregnancyWeeks = 0;
    p.fetusCount = 1;
    p.fetusSex = [];
    p.fetusSexRevealed = false;
    p.complications = [];
    p._plannedComplications = [];
    p.healthStatus = 'normal';
    p._conceptionAnchored = false;
    p.mood = '';
    p.libido = '';
    p.weightGain = '';
    p.babyActivity = '';
    p._dynamic = {};
    // Блок scanWeeksFromText на 30 минут — модель не должна воскресить срок из текста
    // («ты была на 16 неделе...» сразу после потери)
    p._userSetWeeksAt = Date.now();
    try {
        if (!s._historyScanInProgress) {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
            const chatLen = ctx?.chat?.length || 0;
            s._birthBlockedUntilUser = chatLen + 10;
            // Явный тег зачатия блок обходит; блокируем только воскрешение из старого контекста.
            s._conceptionBlockedUntilUser = chatLen + 6;
            s._lastConceptionRollAt = null;
        }
    } catch (e) {}
    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    return true;
}

export function resetPregnancy() {
    const s = getSettings();
    const p = getPregnancyData();

    // Это именно «сброс беременности», а не «стереть весь чат-состояние».
    // Дети, архив, RP-дата, цикл, partner и послеродовое состояние сохраняются.
    if (p.isPregnant) {
        createUndoCheckpoint('Сброс беременности');
        terminatePregnancy('manual');
        return;
    }

    p._userSetWeeksAt = Date.now();
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
        const chatLen = ctx?.chat?.length || 0;
        s._conceptionBlockedUntilUser = chatLen + 10;
        s._birthBlockedUntilUser = chatLen + 10;
        s._lastScannedPosition = chatLen;
    } catch (e) {}
    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
}

export function resetBaby() {
    const s = getSettings();
    const p = getPregnancyData();
    if (p.hasBaby || (Array.isArray(p.babies) && p.babies.length > 0)) createUndoCheckpoint('Сброс малыша');
    // Block re-detection from stale context (conception, birth, AND text-week parsing)
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
        const chatLen = ctx?.chat?.length || 0;
        // 10 сообщений блокировки — должно хватить чтобы модель «забыла» прошлую родовую сцену
        s._conceptionBlockedUntilUser = chatLen + 10;
        s._conceptionBlockedUntilChar = chatLen + 10;
        s._birthBlockedUntilUser = chatLen + 10;
        s._birthBlockedUntilChar = chatLen + 10;
        s._lastScannedPosition = chatLen;
    } catch (e) {}
    p.hasBaby = false;
    p.babyName = '';
    p.babySex = [];
    p.babyCount = 0;
    p.babyAge = '';
    p.babyHealth = 'normal';
    p.babyTeething = false;
    p.babyColicky = false;
    p.babyDiaperClean = true;
    p.babyFeedingType = '';
    p.babySleep = '';
    p.babyMood = '';
    p.babyMilestones = [];
    p.babyBirthRpDate = null;
    p.babyLastFeedRpDate = null;
    p.babyLastChangeRpDate = null;
    p.momState = '';
    p.babies = [];
    // Метка ручной установки — защита от парсера текста
    p._userSetWeeksAt = Date.now();
    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
}

export function visitDoctor() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!p.isPregnant) return;

    if (p.lastDoctorVisitRpDate && p.rpDate) {
        const lastVisit = new Date(p.lastDoctorVisitRpDate);
        const currentRpDate = new Date(p.rpDate);
        const daysSinceVisit = Math.floor((currentRpDate - lastVisit) / 86400000);

        if (daysSinceVisit < 3) {
            if (s.showNotifications) {
                showNotification(`<i class="fa-solid fa-hospital"></i> Следующий визит через ${3 - daysSinceVisit} RP-дн.`, 'info');
            }
            return;
        }
    }

    p.lastDoctorVisitRpDate = p.rpDate || new Date().toISOString();

    const unresolvedComplications = p.complications.filter(c => !c.resolved);

    if (unresolvedComplications.length === 0) {
        if (s.showNotifications) {
            showNotification('<i class="fa-solid fa-hospital"></i> Врач: Всё в порядке!', 'success');
        }
        saveSettingsDebounced();
        return;
    }

    let healed = 0;
    let failed = 0;

    for (const complication of unresolvedComplications) {
        const healChance = complication.severity === 'critical' ? 50 : 75;
        if (roll(100) <= healChance) {
            complication.resolved = true;
            healed++;
        } else {
            failed++;
        }
    }

    const hasUnresolvedCritical = p.complications.some(c => c.severity === 'critical' && !c.resolved);
    const hasUnresolvedWarning = p.complications.some(c => c.severity === 'warning' && !c.resolved);
    p.healthStatus = hasUnresolvedCritical ? 'critical' : hasUnresolvedWarning ? 'warning' : 'normal';

    saveSettingsDebounced();
    _syncUI();

    if (s.showNotifications) {
        if (healed > 0 && failed === 0) {
            showNotification(`<i class="fa-solid fa-hospital"></i> Вылечено: ${healed} осложнений`, 'success');
        } else if (healed > 0) {
            showNotification(`<i class="fa-solid fa-hospital"></i> Вылечено: ${healed}, осталось: ${failed}`, 'info');
        } else {
            showNotification('<i class="fa-solid fa-hospital"></i> Лечение не помогло, повторный визит', 'warning');
        }
    }
}

// ─── Создание беременности из срока, упомянутого в тексте («я на 16 неделе») ───
// Используется runScan (живые сообщения) и scanFullHistory (bootstrap старого чата).
// Возвращает true если беременность создана.
export function createPregnancyFromWeeks(weeks, { notify = true } = {}) {
    const s = getSettings();
    const p = getPregnancyData();
    // Ни при активной беременности, ни при наличии малыша (послеродовой текст не считается)
    if (p.isPregnant || p.hasBaby) return false;
    const w = parseInt(weeks);
    if (!(w >= 1 && w <= 42)) return false;

    const anchor = p.rpDate ? new Date(p.rpDate) : new Date();
    p.isPregnant = true;
    p.conceptionDate = new Date(anchor.getTime() - w * 7 * 86400000).toISOString();
    p._conceptionAnchored = true;
    p.pregnancyWeeks = w;
    p.fetusCount = p.fetusCount || 1;
    if (!p.fetusSex || p.fetusSex.length === 0) {
        p.fetusSex = [];
        for (let i = 0; i < p.fetusCount; i++) {
            p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        }
    }
    p.healthStatus = p.healthStatus || 'normal';

    saveSettingsDebounced();
    if (notify && s.showNotifications) {
        showNotification(`<i class="fa-solid fa-baby"></i> Беременность из текста: ${w} нед.`, 'success');
    }
    return true;
}

// ─── Создание беременности из тега PREGNANCY_STATE, когда в расширке беременности нет ───
// Кейс: юзер начала играть уже беременной и не настроила расширку — модель (по карточке/
// контексту) ставит PREGNANCY_STATE, и мы принимаем его как источник правды.
// Возвращает true если беременность создана.
export function createPregnancyFromStateTag(pregState, { notify = true } = {}) {
    const s = getSettings();
    const p = getPregnancyData();
    if (p.isPregnant || p.hasBaby || !pregState || !pregState.conceptionDate) return false;

    const conceptionMs = new Date(pregState.conceptionDate).getTime();
    if (isNaN(conceptionMs)) return false;

    p.isPregnant = true;
    p.conceptionDate = pregState.conceptionDate;
    p._conceptionAnchored = true;
    p.fetusCount = pregState.fetusCount || 1;
    p.fetusSex = (pregState.fetusSex && pregState.fetusSex.length > 0)
        ? [...pregState.fetusSex]
        : Array.from({ length: p.fetusCount }, () => (roll(2) === 1 ? 'M' : 'F'));
    p.fetusSexRevealed = pregState.fetusSex?.length > 0 && pregState.fetusSex.every(x => x === 'M' || x === 'F');
    if (pregState.fatherName) p.fatherName = pregState.fatherName;
    p.healthStatus = p.healthStatus || 'normal';

    // Недели — от conceptionDate до rpDate (если rpDate ещё нет, пересчитается при первом RP_DATE)
    if (p.rpDate) {
        const rpMs = new Date(p.rpDate).getTime();
        p.pregnancyWeeks = rpMs >= conceptionMs ? Math.floor((rpMs - conceptionMs) / (7 * 86400000)) : 0;
    } else {
        p.pregnancyWeeks = 0;
    }

    saveSettingsDebounced();
    if (notify && s.showNotifications) {
        showNotification(`<i class="fa-solid fa-baby"></i> Беременность восстановлена из контекста: ${p.pregnancyWeeks} нед.`, 'success');
    }
    return true;
}

// ─── Ручная установка беременности с явной датой зачатия ───
// conceptionDateISO: ISO-строка даты зачатия (от пользователя через datepicker)
// fetusCount: 1-4
// fetusSex: массив ['M'/'F'], опционально — если null, генерится случайно
export function startManualPregnancy(conceptionDateISO, fetusCount, fetusSex = null) {
    const s = getSettings();
    const p = getPregnancyData();
    s._conceptionBlockedUntilUser = null;
    s._birthBlockedUntilUser = null;
    const count = Math.max(1, Math.min(4, parseInt(fetusCount) || 1));

    p.isPregnant = true;
    p.conceptionDate = conceptionDateISO;
    // Привязка: ручная дата зачатия — это RP-дата, не real-world.
    // Помечаем как уже привязанную, чтобы processDateTag не перезаписал её при первом RP_DATE.
    p._conceptionAnchored = true;
    // Метка ручной установки — защита от перезаписи парсером текста (30 минут)
    p._userSetWeeksAt = Date.now();
    p.fetusCount = count;
    p.healthStatus = 'normal';
    p.complications = [];
    p._plannedComplications = [];

    // Пол
    if (Array.isArray(fetusSex) && fetusSex.length === count) {
        p.fetusSex = [...fetusSex];
    } else {
        p.fetusSex = [];
        for (let i = 0; i < count; i++) {
            p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        }
    }
    p.fetusSexRevealed = false;

    // Пересчёт недель: если rpDate есть, считаем от него; иначе оставим 0 до первого RP_DATE
    if (p.rpDate) {
        const calc = calculateWeeksFromDates(p.conceptionDate, p.rpDate, 0);
        p.pregnancyWeeks = calc.weeks;
    } else {
        p.pregnancyWeeks = 0;
    }

    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();

    if (getSettings().showNotifications) {
        const dateStr = new Date(conceptionDateISO).toLocaleDateString('ru-RU');
        showNotification(`<i class="fa-solid fa-check"></i> Беременность: зачатие ${dateStr}, ${count} плод(а), ${p.pregnancyWeeks} нед.`, 'success');
    }

    return p;
}

// ─── Добавить малыша вручную (без беременности-предка) ───
// Полезно для восстановления потерянных данных или для РП где малыш уже есть на старте чата.
// babiesData: массив объектов { sex: 'M'|'F', name, fatherName, ageDays }
// Возраст в днях → короткая подпись (дн. / мес. / годы)
function fmtAgeShort(days) {
    days = Math.max(0, parseInt(days) || 0);
    if (days === 0) return 'новорождённый';
    if (days < 30) return `${days} дн.`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} мес.`;
    const years = Math.floor(days / 365);
    const remM = Math.floor((days % 365) / 30);
    return remM > 0 ? `${years} г. ${remM} мес.` : `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
}

export function startManualBaby(babiesData) {
    if (!Array.isArray(babiesData) || babiesData.length === 0) return null;
    const p = getPregnancyData();

    // Если уже есть малыш — добавляем к существующим (как при родах второго ребёнка)
    const existingBabies = Array.isArray(p.babies) ? [...p.babies] : [];

    // birthRpDate — рассчитываем от текущей RP-даты минус ageDays
    const nowRp = p.rpDate ? new Date(p.rpDate) : new Date();

    p.isPregnant = false;
    p.conceptionDate = null;
    p.pregnancyWeeks = 0;
    p.fetusCount = 0;
    p.fetusSex = [];
    p.fetusSexRevealed = false;
    p.hasBaby = true;
    p.babyCount = existingBabies.length + babiesData.length;
    p.babyHealth = 'normal';
    p.babyMood = 'спокойный';
    p.babyDiaperClean = true;
    p.babySleep = 'спит';
    p.babyAge = fmtAgeShort(babiesData[0].ageDays || 0);

    p.babies = [...existingBabies];
    babiesData.forEach((b, i) => {
        const ageDays = parseInt(b.ageDays) || 0;
        const birthMs = nowRp.getTime() - ageDays * 86400000;
        p.babies.push({
            name: b.name || '',
            sex: b.sex === 'F' ? 'F' : 'M',
            health: 'normal',
            mood: 'спокойный',
            sleep: 'спит',
            diaperClean: true,
            teething: false,
            colicky: false,
            feedingType: '',
            milestones: [],
            personality: Array.isArray(b.personality) ? b.personality : [],
            appearance: Array.isArray(b.appearance) ? b.appearance : [],
            fatherName: b.fatherName || '',
            birthRpDate: new Date(birthMs).toISOString(),
            age: fmtAgeShort(ageDays),
        });
    });

    syncBabyLegacyFields(p);

    // Малыш с ненулевым возрастом сразу получает уже достигнутые вехи развития
    // и флаги ухода (зубки/колики). Динамический импорт — чтобы не плодить циклы.
    try {
        import('./baby-care.js').then(m => {
            m.updateBabyCare();
            refreshSnap();
            saveSettingsDebounced();
            _syncUI();
            _updatePromptInjection();
            _renderInfoblock();
        }).catch(() => {});
    } catch (e) { /* ignore */ }

    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    _renderInfoblock();

    if (getSettings().showNotifications) {
        showNotification(`<i class="fa-solid fa-baby"></i> Добавлен малыш: ${p.babies[p.babies.length-1].name || 'без имени'}`, 'success');
    }
    return p;
}

// ─── Выпустить ребёнка во взрослые (переносит из p.babies в p.grownChildren) ───
// graduatedBabies — массив объектов из p.babies, которые надо «выпустить»
export function graduateBabies(graduatedBabies) {
    if (!Array.isArray(graduatedBabies) || graduatedBabies.length === 0) return;
    const p = getPregnancyData();
    if (!Array.isArray(p.grownChildren)) p.grownChildren = [];

    const ids = new Set(graduatedBabies.map(b => `${b.name || ''}|${b.birthRpDate || ''}|${b.sex || ''}`));

    // Архивируем
    for (const baby of graduatedBabies) {
        p.grownChildren.push({
            name: baby.name || '',
            sex: baby.sex || '?',
            personality: baby.personality || [],
            appearance: baby.appearance || [],
            fatherName: baby.fatherName || '',
            birthRpDate: baby.birthRpDate || null,
            graduatedRpDate: p.rpDate || null,
            special: baby.special || null,
            milestones: Array.isArray(baby.milestones) ? [...baby.milestones] : [],
        });
    }

    // Удаляем из активных
    p.babies = (p.babies || []).filter(b => !ids.has(`${b.name || ''}|${b.birthRpDate || ''}|${b.sex || ''}`));
    syncBabyLegacyFields(p);

    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    _renderInfoblock();
}

// ─── Проверка возраста детей: возвращает массив babies, которым пора «выпускаться» ───
// Не модифицирует состояние — только возвращает кандидатов
export function checkBabyGraduation() {
    const s = getSettings();
    const p = getPregnancyData();
    if (!p.hasBaby || !Array.isArray(p.babies) || p.babies.length === 0) return [];
    if (!p.rpDate) return [];

    const maxDays = s.babyMaxAgeDays || 730;
    const nowMs = new Date(p.rpDate).getTime();
    const graduates = [];

    for (const baby of p.babies) {
        if (!baby.birthRpDate) continue;
        const birthMs = new Date(baby.birthRpDate).getTime();
        if (isNaN(birthMs)) continue;
        const ageDays = (nowMs - birthMs) / 86400000;
        if (ageDays >= maxDays) {
            graduates.push(baby);
        }
    }
    return graduates;
}

// ═══════════════════════════════════════════
// НОСИТЕЛЬ-ПЕРСОНАЖ ({{char}}) — своя беременность, общая семья
// Дети от партнёрских родов попадают в ОБЩИЙ p.babies (семья одна).
// ═══════════════════════════════════════════

// Бросок зачатия для партнёра. Возвращает {success, roll, chance} или null.
export function partnerCheckConception() {
    const s = getSettings();
    const c = getPartnerData();
    if (!s.isEnabled || c.isPregnant) return null;
    if (!canCarry(s, 'char')) {
        return null;
    }
    const p = getPregnancyData();

    s.totalChecks++;
    let cycleModifier = hasMenstrualCycle(s, 'char') ? getCycleModifier(c.cycleDay || 1) : 1;
    if (isOmegaverse(s)) {
        const st = carrierAboStatus(c, designationOf(s, 'char'), s);
        if (designationOf(s, 'char') === 'omega') cycleModifier *= (st.fertility ?? 1);
    }
    let chance = Math.max(0, Math.min(100, Math.round(CHANCES.base * cycleModifier)));

    const contraception = getContraception('char');
    const contraEff = CHANCES.contraception[contraception] || 0;
    if (contraception !== 'none') {
        const protectionRoll = roll(100);
        if (protectionRoll <= contraEff) chance = 0;
        else if (s.showNotifications) showNotification(L('contraceptionFailed'), 'warning');
    }

    const r = roll(100);
    const success = r <= chance;

    if (success) {
        c.isPregnant = true;
        s._birthBlockedUntilChar = null;
        c.conceptionDate = p.rpDate || null;
        c._conceptionAnchored = !!p.rpDate;
        c.pregnancyWeeks = 0;
        c._plannedComplications = rollPlannedComplications();
        c.healthStatus = 'normal';
        s.totalConceptions++;
        const mult = roll(1000) / 10;
        c.fetusCount = mult <= (s.tripletsChance || 0.1) ? 3 : mult <= (s.twinsChance || 3) ? 2 : 1;
        c.fetusSex = [];
        for (let i = 0; i < c.fetusCount; i++) c.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        c.fetusSexRevealed = false;
        if (!c.fatherName) c.fatherName = carrierName('user');
        if (s.showNotifications) {
            showNotification(`<i class="fa-solid fa-check"></i> ${carrierName('char')} беременна! ${formatFetusCount(c.fetusCount)}`, 'success');
        }
    } else if (s.showNotifications) {
        showNotification(`<i class="fa-solid fa-xmark"></i> ${carrierName('char')} — зачатия не произошло (${r}/${chance})`, 'info');
    }

    saveSettingsDebounced();
    refreshSnap();
    _syncUI();
    _updatePromptInjection();
    return { success, roll: r, chance };
}

// Роды у партнёра: дети уходят в ОБЩИЙ p.babies, беременность партнёра сбрасывается.
export function partnerBirth(babyTraits, options = {}) {
    const s = getSettings();
    const p = getPregnancyData();
    const c = getPartnerData();
    const birthSource = options.source || 'tag';
    if (!canTriggerBirth(c, s, birthSource)) return false;

    const count = c.fetusCount || 1;
    const sexes = c.fetusSex?.length ? [...c.fetusSex] : ['M'];
    const birthRpDate = resolveBirthRpDate(c, p, s, birthSource);
    const motherName = carrierName('char');
    const fatherName = c.fatherName || carrierName('user');

    // Сброс беременности партнёра
    c.isPregnant = false;
    c.conceptionDate = null;
    c.pregnancyWeeks = 0;
    c.fetusCount = 1;
    c.fetusSex = [];
    c.fetusSexRevealed = false;
    c.complications = [];
    c._plannedComplications = [];
    c._dynamic = {};

    // Дети — в общую семью
    if (!Array.isArray(p.babies)) p.babies = [];
    const startIdx = p.babies.length;
    for (let i = 0; i < count; i++) {
        p.babies.push({
            name: '', sex: sexes[i] || 'M', health: 'normal', mood: 'спокойный', sleep: 'спит',
            diaperClean: true, teething: false, colicky: false, feedingType: '',
            milestones: [], personality: [], appearance: [],
            fatherName, motherName, bornBy: 'char',
            birthRpDate, age: 'новорождённый',
        });
    }
    syncBabyLegacyFields(p);
    c.postpartum = { startRpDate: birthRpDate, lactating: true };
    c.pregnancyKnown = false;
    c.lastTestResult = null;

    // Блок пере-триггера (как при родах юзера)
    try {
        if (!s._historyScanInProgress) {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
            const chatLen = ctx?.chat?.length || 0;
            s._conceptionBlockedUntilChar = chatLen + 12;
            s._birthBlockedUntilChar = chatLen + 12;
        }
    } catch (e) {}

    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();

    // Диалог именования (переиспользуем общий)
    const modelTraits = babyTraits?.babies && Array.isArray(babyTraits.babies) ? babyTraits.babies : [];
    const dialogBabies = [];
    for (let i = 0; i < count; i++) {
        const mt = modelTraits[i] || {};
        dialogBabies.push({
            sex: sexes[i] || 'M',
            name: mt.name || mt.имя || '',
            fatherName: mt.fatherName || mt.father || fatherName,
            personality: Array.isArray(mt.personality) ? mt.personality : null,
            appearance: Array.isArray(mt.appearance) ? mt.appearance : null,
            special: mt.special !== undefined ? mt.special : undefined,
        });
    }
    const applyPartnerNewbornTraits = (names, traitsData) => {
        for (let i = 0; i < count; i++) {
            const baby = p.babies[startIdx + i];
            if (!baby) continue;
            if (names[i]) baby.name = names[i];
            const tr = traitsData[i] || {};
            if (Array.isArray(tr.personality) && tr.personality.length) baby.personality = tr.personality;
            if (Array.isArray(tr.appearance) && tr.appearance.length) baby.appearance = tr.appearance;
            if (tr.special) baby.special = tr.special;
            if (tr.fatherName) baby.fatherName = tr.fatherName;
        }
        if (p.babies[0]?.name) p.babyName = p.babies[0].name;
        saveSettingsDebounced();
        _syncUI();
        _updatePromptInjection();
        syncBabyLegacyFields(p);
        _renderInfoblock();
    };
    if (options.silent) {
        const names = dialogBabies.map(b => b.name || '');
        const traits = dialogBabies.map(b => ({
            personality: Array.isArray(b.personality) ? b.personality : [],
            appearance: Array.isArray(b.appearance) ? b.appearance : [],
            special: b.special,
            fatherName: b.fatherName,
        }));
        applyPartnerNewbornTraits(names, traits);
    } else {
        showBirthDialog(dialogBabies, applyPartnerNewbornTraits);
    }

    if (!options.silent && s.showNotifications) showNotification(`<i class="fa-solid fa-baby"></i> ${motherName} родила!`, 'success');
    return true;
}

// Ручная беременность партнёра (из панели настроек)
export function startPartnerPregnancy(conceptionDateISO, fetusCount, fetusSex = null) {
    const s = getSettings();
    const c = getPartnerData();
    const p = getPregnancyData();
    s._conceptionBlockedUntilChar = null;
    s._birthBlockedUntilChar = null;
    const count = Math.max(1, Math.min(4, parseInt(fetusCount) || 1));
    c.isPregnant = true;
    c.conceptionDate = conceptionDateISO;
    c._conceptionAnchored = true;
    c._userSetWeeksAt = Date.now();
    c.fetusCount = count;
    c.healthStatus = 'normal';
    c.complications = [];
    c._plannedComplications = [];
    c.fetusSex = (Array.isArray(fetusSex) && fetusSex.length === count)
        ? [...fetusSex]
        : Array.from({ length: count }, () => (roll(2) === 1 ? 'M' : 'F'));
    c.fetusSexRevealed = false;
    if (!c.fatherName) c.fatherName = carrierName('user');
    c.pregnancyWeeks = p.rpDate ? calculateWeeksFromDates(c.conceptionDate, p.rpDate, 0).weeks : 0;

    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    if (getSettings().showNotifications) {
        showNotification(`<i class="fa-solid fa-check"></i> ${carrierName('char')}: беременность ${c.pregnancyWeeks} нед.`, 'success');
    }
    return c;
}

// Сброс беременности партнёра
export function resetPartnerPregnancy() {
    const c = getPartnerData();
    if (c.isPregnant) createUndoCheckpoint('Сброс беременности персонажа');
    c.isPregnant = false;
    c.conceptionDate = null;
    c.pregnancyWeeks = 0;
    c.fetusCount = 1;
    c.fetusSex = [];
    c.fetusSexRevealed = false;
    c.complications = [];
    c._plannedComplications = [];
    c.healthStatus = 'normal';
    c._dynamic = {};
    c._userSetWeeksAt = Date.now();
    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
}

// ═══════════════════════════════════════════
// ТЕСТ НА БЕРЕМЕННОСТЬ / СКРЫТАЯ БЕРЕМЕННОСТЬ
// ═══════════════════════════════════════════

// Дней с зачатия (по RP-датам)
export function daysSinceConception(carrier, root) {
    if (!carrier?.conceptionDate || !root?.rpDate) return 0;
    const ms = new Date(root.rpDate).getTime() - new Date(carrier.conceptionDate).getTime();
    return isNaN(ms) ? 0 : Math.max(0, Math.floor(ms / 86400000));
}

// Знает ли героиня о беременности (по факту теста или очевидному сроку)
export function pregnancyIsKnown(carrier, s) {
    if (!carrier?.isPregnant) return false;
    if (carrier.pregnancyKnown) return true;
    return isObvious(carrier.pregnancyWeeks || 0, s?.obviousAtWeek || 12);
}

// Сделать тест. Возвращает 'positive' | 'faint' | 'negative'.
export function takePregnancyTest(who = 'user') {
    const s = getSettings();
    const p = getPregnancyData();
    const c = who === 'char' ? getPartnerData() : p;

    const days = daysSinceConception(c, p);
    const result = rollTest(!!c.isPregnant, days);

    c.lastTestResult = result;
    c.testTakenAt = p.rpDate || null;
    if (result !== 'negative') c.pregnancyKnown = true;

    if (s.showNotifications) {
        const nm = who === 'char' ? carrierName('char') + ': ' : '';
        if (result === 'positive') {
            showNotification(`<i class="fa-solid fa-vial-circle-check"></i> ${nm}тест положительный — две чёткие полоски`, 'success');
        } else if (result === 'faint') {
            showNotification(`<i class="fa-solid fa-vial"></i> ${nm}вторая полоска слабая, но она есть`, 'success');
        } else {
            showNotification(`<i class="fa-solid fa-vial"></i> ${nm}тест отрицательный${c.isPregnant ? ' — возможно, слишком рано' : ''}`, 'info');
        }
    }

    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    return result;
}

// Сообщить героине о беременности вручную (например, врач подтвердил)
export function revealPregnancy(who = 'user') {
    const c = who === 'char' ? getPartnerData() : getPregnancyData();
    if (!c.isPregnant) return false;
    c.pregnancyKnown = true;
    c.lastTestResult = 'positive';
    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    return true;
}

// ═══════════════════════════════════════════
// ПОСЛЕРОДОВОЕ ВОССТАНОВЛЕНИЕ
// ═══════════════════════════════════════════

// Текущее состояние восстановления носителя (или null)
export function getPostpartum(carrier, root) {
    const pp = carrier?.postpartum;
    if (!pp?.startRpDate || !root?.rpDate) return null;
    const ms = new Date(root.rpDate).getTime() - new Date(pp.startRpDate).getTime();
    if (isNaN(ms) || ms < 0) return null;
    const days = Math.floor(ms / 86400000);
    const st = postpartumState(days, pp.lactating !== false);
    if (days > 730) return null;
    return { ...st, lactating: pp.lactating !== false && st.lactating };
}

// Включить/выключить кормление грудью
export function setLactating(who, value) {
    const c = who === 'char' ? getPartnerData() : getPregnancyData();
    if (!c.postpartum) return false;
    c.postpartum.lactating = !!value;
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
    return true;
}

// ═══════════════════════════════════════════
// ПЛАНИРОВАНИЕ И СЛОЖНОСТИ С ЗАЧАТИЕМ
// ═══════════════════════════════════════════

// Сколько RP-месяцев пара пытается зачать
export function monthsTrying(p) {
    if (!p?._tryingSince || !p?.rpDate) return 0;
    const ms = new Date(p.rpDate).getTime() - new Date(p._tryingSince).getTime();
    return isNaN(ms) ? 0 : Math.max(0, Math.floor(ms / (30 * 86400000)));
}

// Включить/выключить режим «планируем»
export function setTrying(value) {
    const s = getSettings();
    const p = getPregnancyData();
    s.tryingToConceive = !!value;
    if (value && !p._tryingSince) p._tryingSince = p.rpDate || new Date().toISOString();
    if (!value) p._tryingSince = null;
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
}

// ─── Наследование внешности ребёнка от родителей ───
// Родительские черты берём из p.motherLooks / p.fatherLooks (задаются в панели).
export function inheritedLooks(p) {
    try {
        const res = inheritLooks(p?.motherLooks, p?.fatherLooks);
        const out = [];
        if (res.eyes) out.push(`${res.eyes} глаза`);
        if (res.hair) out.push(`${res.hair} волосы`);
        return out;
    } catch (e) {
        return [];
    }
}

// Задать внешность родителей (для наследования)
export function setParentLooks(which, looks) {
    const p = getPregnancyData();
    const key = which === 'father' ? 'fatherLooks' : 'motherLooks';
    p[key] = { eyes: looks?.eyes || '', hair: looks?.hair || '' };
    saveSettingsDebounced();
    _syncUI();
    return p[key];
}
