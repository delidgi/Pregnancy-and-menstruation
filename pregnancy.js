// ═══════════════════════════════════════════
// PREGNANCY — зачатие, осложнения, роды
// ═══════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../script.js';
import { CHANCES, defaultPregnancyData } from './config.js';
import { getSettings, getPregnancyData, getCycleDay, setCycleDay, L, dlog, dwarn } from './state.js';
import { roll, getCycleModifier, formatSexIcons, formatFetusCount, calculateWeeksFromDates, getHealthInfo, rollPlannedComplications } from './helpers.js';
import { calculateConceptionDate } from './date-parser.js';
import { showNotification, showBirthDialog } from './notifications.js';
import { getLifeStageByDays } from './family.js';
import { isOmegaverse, ensureOmegaFields, getFertilityModifierOmegaverse, getCfg } from './omegaverse.js';

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
                dlog(`[Reproductive] RP date → ${p.rpDate}`);
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
                        dlog(`[Reproductive] Cycle day auto-advanced: ${oldCycleDay} → ${newCycleDay} (+${daysPassed} RP days)`);
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
                            dlog(`[Reproductive] Backfilled conceptionDate from rpDate: ${p.conceptionDate}`);
                        }
                    }
                    // Clamp: if rpDate < conceptionDate (RP went backwards) — shift conception back
                    // НО: если юзер только что вручную выставил беременность — не трогаем дату.
                    if (p.conceptionDate && new Date(p.conceptionDate).getTime() > newDate.getTime()) {
                        const userSetMs = p._userSetWeeksAt || 0;
                        const recentlyUserSet = userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30;
                        if (recentlyUserSet) {
                            dlog('[Reproductive] applyScanResult clamp SKIPPED — manual pregnancy recently set');
                        } else {
                            dwarn(`[Reproductive] rpDate < conceptionDate — clamping conceptionDate to rpDate`);
                            p.conceptionDate = newDate.toISOString();
                        }
                    }
                    // Sync pregnancyWeeks state from authoritative date math
                    const calc = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
                    if (calc.weeks !== p.pregnancyWeeks) {
                        dlog(`[Reproductive] pregnancyWeeks ${p.pregnancyWeeks} → ${calc.weeks} (from dates)`);
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
            dlog(`[Reproductive] Cycle day ${current} → ${day}`);
            setCycleDay(day);
            updated = true;
        }
    }

    // Роды
    if (result.birth_occurred) {
        // ── Защиты от ложных срабатываний ──
        // 1) Игнорируем если беременности нет
        if (!p.isPregnant) {
            dwarn('[Reproductive] Birth tag ignored — not pregnant');
            return updated;
        }
        // 2) Игнорируем если roды на критически раннем сроке (<20 недель — плод не выживает)
        const currentWeeks = p.pregnancyWeeks || 0;
        if (currentWeeks > 0 && currentWeeks < 20) {
            dwarn(`[Reproductive] Birth tag ignored — too early (${currentWeeks} weeks, minimum 20)`);
            return updated;
        }
        if (currentWeeks === 0) {
            dwarn('[Reproductive] Birth tag ignored — 0 weeks pregnancy (just conceived)');
            return updated;
        }
        // 3) Игнорируем если только что был reset (anti-resurrection — модель цепляется за старый контекст)
        try {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
            const chatLen = ctx?.chat?.length || 0;
            if (s._birthBlockedUntil && chatLen < s._birthBlockedUntil) {
                dwarn(`[Reproductive] Birth tag ignored — blocked until position ${s._birthBlockedUntil} (current ${chatLen})`);
                return updated;
            }
        } catch (e) {}

        dlog('[Reproductive] Birth detected by scanner!');
        // Save pregnancy data before resetting
        const babySex = p.fetusSex.length > 0 ? [...p.fetusSex] : ['M'];
        const newBabyCount = p.fetusCount || 1;
        const birthRpDate = p.rpDate || new Date().toISOString();

        // ── Сохраняем существующих детей (если они уже есть от предыдущих родов) ──
        const existingBabies = Array.isArray(p.babies) ? [...p.babies] : [];
        const existingGrown = Array.isArray(p.grownChildren) ? [...p.grownChildren] : [];
        // Сохраняем babyAge/momState — старшим детям актуальный возраст нужен
        const prevBabyAge = p.babyAge;
        const prevMomState = p.momState;

        // Сбрасываем ТОЛЬКО pregnancy-поля, сохраняя baby/family поля
        // Сохраняем: rpDate, _lastRpDateTag (нужны для трекинга времени),
        //            grownChildren (архив выросших), babies (старшие дети)
        const savedRpDate = p.rpDate;
        const savedLastRpDateTag = p._lastRpDateTag;

        Object.assign(p, structuredClone(defaultPregnancyData));
        p.rpDate = savedRpDate;
        p._lastRpDateTag = savedLastRpDateTag;
        p.grownChildren = existingGrown;

        p.hasBaby = true;
        // Общее количество детей = старшие + новорождённые
        p.babyCount = existingBabies.length + newBabyCount;
        // babySex: для legacy кода — массив всех живых детей
        p.babySex = [...existingBabies.map(b => b.sex), ...babySex];
        p.babyBirthRpDate = birthRpDate;
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
        // В омегаверсе запоминаем роль матери-носителя — для презентации ребёнка
        // в подростке (роль отца выводится по имени, см. inferParentDesignations)
        const momDesig = isOmegaverse(p) ? (p.designation || null) : null;
        for (let i = 0; i < newBabyCount; i++) {
            p.babies.push({
                name: '',
                sex: babySex[i] || 'M',
                ...(momDesig ? { motherDesignation: momDesig } : {}),
                health: 'normal',
                mood: 'спокойный',
                sleep: 'спит',
                diaperClean: true,
                teething: false,
                colicky: false,
                feedingType: '',
                milestones: [],
                personality: [],
                appearance: [],
                birthRpDate: birthRpDate,  // ⬅ для расчёта возраста в днях
                age: 'новорождённый',
                stage: 'newborn',
            });
        }
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

        // Show birth dialog for naming + traits (state already transitioned)
        showBirthDialog(dialogBabies, (names, traitsData) => {
            // Заполняем ТОЛЬКО новорождённых (со старта новорождённых до конца массива)
            for (let i = 0; i < newBabyCount; i++) {
                const targetIdx = newbornStartIdx + i;
                const baby = p.babies[targetIdx];
                if (!baby) continue;
                if (names[i]) baby.name = names[i];
                const traits = traitsData[i] || { personality: [], appearance: [] };
                baby.personality = traits.personality;
                baby.appearance = traits.appearance;
                if (traits.special) baby.special = traits.special;
                if (traits.fatherName) baby.fatherName = traits.fatherName;
            }
            // Legacy: babyName = имя первого ребёнка в семье
            if (p.babies[0]?.name) p.babyName = p.babies[0].name;
            saveSettingsDebounced();
            _syncUI();
            _updatePromptInjection();
            _renderInfoblock();
        });
        return true;
    }

    // Зачатие
    if (result.vaginal_ejaculation_occurred && !p.isPregnant) {
        dlog('[Reproductive] Vaginal ejaculation detected by scanner — rolling conception...');
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
                dlog(`[Reproductive] Backfilled conceptionDate from API weeks: ${p.conceptionDate}`);
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

    // Baby state tracking
    if (p.hasBaby) {
        if (result.baby_name && result.baby_name !== p.babyName) {
            p.babyName = result.baby_name;
            updated = true;
        }
        if (result.baby_age && result.baby_age !== p.babyAge) {
            p.babyAge = result.baby_age;
            updated = true;
        }
        if (result.baby_health) {
            const validHealth = ['normal', 'warning', 'critical'];
            if (validHealth.includes(result.baby_health) && result.baby_health !== p.babyHealth) {
                p.babyHealth = result.baby_health;
                updated = true;
            }
        }
        if (result.baby_teething !== null && result.baby_teething !== undefined) {
            if (result.baby_teething !== p.babyTeething) {
                p.babyTeething = !!result.baby_teething;
                updated = true;
            }
        }
        if (result.baby_diaper_clean !== null && result.baby_diaper_clean !== undefined) {
            if (result.baby_diaper_clean !== p.babyDiaperClean) {
                p.babyDiaperClean = !!result.baby_diaper_clean;
                updated = true;
                if (!p.babyDiaperClean && s.showNotifications) {
                    showNotification('<i class="fa-solid fa-baby-carriage"></i> Подгузник нужно сменить!', 'info');
                }
            }
        }
        if (result.baby_feeding && result.baby_feeding !== p.babyFeedingType) {
            p.babyFeedingType = result.baby_feeding;
            p.babyLastFeedRpDate = p.rpDate;
            updated = true;
        }
        if (result.baby_sleep && result.baby_sleep !== p.babySleep) {
            p.babySleep = result.baby_sleep;
            updated = true;
        }
        if (result.baby_mood && result.baby_mood !== p.babyMood) {
            p.babyMood = result.baby_mood;
            updated = true;
        }
        if (result.baby_colicky !== null && result.baby_colicky !== undefined) {
            if (result.baby_colicky !== p.babyColicky) {
                p.babyColicky = !!result.baby_colicky;
                updated = true;
            }
        }
        if (result.mom_state && result.mom_state !== p.momState) {
            p.momState = result.mom_state;
            updated = true;
        }
        if (result.baby_milestone) {
            if (!p.babyMilestones) p.babyMilestones = [];
            const exists = p.babyMilestones.some(m => m.text === result.baby_milestone);
            if (!exists) {
                p.babyMilestones.push({
                    text: result.baby_milestone,
                    rpDate: p.rpDate,
                    date: new Date().toISOString(),
                });
                updated = true;
                if (s.showNotifications) {
                    showNotification(`<i class="fa-solid fa-star"></i> Развитие: ${result.baby_milestone}`, 'success');
                }
            }
        }
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
    // Юзер-носитель выключен (беременеет только партнёр) — кубик не бросаем
    if (p.userCanCarry === false) return null;

    s.totalChecks++;

    const currentCycleDay = getCycleDay();
    let cycleModifier;
    let dayLabel = `День ${currentCycleDay}`;
    if (isOmegaverse(p)) {
        // Омегаверс: фертильность от фазы течки (омега) / цикла (бета);
        // альфа не беременеет. Гон партнёра-альфы даёт бонус.
        ensureOmegaFields(p, true);
        // FIX: подавители гона партнёра и режим «только симпатический гон» должны
        // доходить до расчёта — иначе буст шёл даже на супрессантах
        const sire = p.partner
            ? { designation: p.partner.designation || 'alpha', rutCycleDay: p.partner.rutCycleDay, heatSuppressant: !!p.partner.heatSuppressant, sympatheticOnly: !!p.rutSympatheticOnly }
            : { designation: 'alpha', rutCycleDay: 30, sympatheticOnly: !!p.rutSympatheticOnly };
        const info = getFertilityModifierOmegaverse(
            { designation: p.designation, heatCycleDay: p.heatCycleDay, heatSuppressant: p.heatSuppressant, cycleDay: currentCycleDay },
            sire,
            getCfg(s),
        );
        if (info.modifier <= 0) {
            dlog('[Reproductive] Conception check skipped — user is an alpha (cannot conceive)');
            return null;
        }
        cycleModifier = info.modifier * info.sireBoost;
        dayLabel = info.phaseLabelRu + (info.sireBoost > 1 ? ' + гон альфы' : '');
    } else {
        cycleModifier = getCycleModifier(currentCycleDay);
    }
    let chance = Math.min(95, Math.round(CHANCES.base * cycleModifier));

    const contraceptionEff = CHANCES.contraception[s.contraception];
    let contraceptionFailed = false;

    if (s.contraception !== 'none') {
        const failRoll = roll(100);
        if (failRoll > contraceptionEff) {
            contraceptionFailed = true;
            if (s.showNotifications) {
                showNotification(L('contraceptionFailed'), 'warning');
            }
        } else {
            chance = Math.round(chance * (1 - contraceptionEff / 100));
        }
    }

    const conceptionRoll = roll(100);
    const success = conceptionRoll <= chance;

    dlog(`[Reproductive] Conception check: roll=${conceptionRoll}, need<=${chance}, result=${success ? 'PREGNANT' : 'no'}`);

    const result = {
        roll: conceptionRoll,
        chance,
        contraception: s.contraception,
        contraceptionFailed,
        cycleDay: currentCycleDay,
        success,
    };

    if (success) {
        p.isPregnant = true;
        // Anchor conception STRICTLY to current rpDate. Никаких следов старых беременностей —
        // даже если в p случайно остались поля conceptionDate/pregnancyWeeks от прошлой беременности,
        // которая была сброшена не полностью, перезатираем их свежими значениями.
        // Если rpDate неизвестна — оставляем null, backfill на следующем RP_DATE тег.
        const freshConception = p.rpDate || null;
        if (p.conceptionDate && freshConception && p.conceptionDate !== freshConception) {
            dwarn(`[Reproductive] Overwriting stale conceptionDate ${p.conceptionDate} → ${freshConception}`);
        }
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

        if (s.showNotifications) {
            showNotification(`<i class="fa-solid fa-check"></i> Беременность! ${dayLabel}, ${conceptionRoll}/${chance}<br>${formatFetusCount(p.fetusCount)} | Пол: ?`, 'success');
        }
    } else {
        if (s.showNotifications) {
            showNotification(`<i class="fa-solid fa-xmark"></i> Не беременна. ${dayLabel}, ${conceptionRoll}/${chance}`, 'info');
        }
    }

    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();

    return result;
}

export function resetPregnancy() {
    const s = getSettings();
    const p = getPregnancyData();
    Object.assign(p, structuredClone(defaultPregnancyData));
    // Метка «юзер только что вмешался» — блокирует scanWeeksFromText на 30 минут.
    // Без неё бот-ответ типа «ты на 16 неделе» мгновенно воссоздаст беременность из текста.
    p._userSetWeeksAt = Date.now();
    // Mark reset position so keyword/API detection doesn't re-trigger pregnancy from old context
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
        const chatLen = ctx?.chat?.length || 0;
        s._conceptionBlockedUntil = chatLen + 10;
        s._birthBlockedUntil = chatLen + 10;
        s._lastScannedPosition = chatLen; // prevent re-scan of current message
        dlog(`[Reproductive] Pregnancy reset: blocking conception and birth until position ${chatLen + 10}`);
    } catch (e) {}
    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
}

export function resetBaby() {
    const s = getSettings();
    const p = getPregnancyData();
    // Block re-detection from stale context (conception, birth, AND text-week parsing)
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
        const chatLen = ctx?.chat?.length || 0;
        // 10 сообщений блокировки — должно хватить чтобы модель «забыла» прошлую родовую сцену
        s._conceptionBlockedUntil = chatLen + 10;
        s._birthBlockedUntil = chatLen + 10;
        s._lastScannedPosition = chatLen;
        dlog(`[Reproductive] Baby reset: blocking conception and birth until position ${chatLen + 10}`);
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

    // Врач лечит ОБОИХ носителей (юзера и партнёра, если та беременна)
    const pp = p.partner;
    const partnerPregnant = !!(pp && pp.enabled && pp.isPregnant);
    if (!p.isPregnant && !partnerPregnant) return;

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

    const unresolvedComplications = [
        ...(p.isPregnant ? p.complications.filter(c => !c.resolved) : []),
        ...(partnerPregnant ? pp.complications.filter(c => !c.resolved) : []),
    ];

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

    const recalcHealth = (carrier) => {
        const crit = carrier.complications.some(c => c.severity === 'critical' && !c.resolved);
        const warn = carrier.complications.some(c => c.severity === 'warning' && !c.resolved);
        carrier.healthStatus = crit ? 'critical' : warn ? 'warning' : 'normal';
    };
    if (p.isPregnant) recalcHealth(p);
    if (partnerPregnant) recalcHealth(pp);

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
    if (p.isPregnant) return false;
    // Юзер-носитель выключен: «она на 16 неделе» в тексте — это про партнёра,
    // юзерскую беременность из текста не создаём
    if (p.userCanCarry === false) return false;
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
    dlog(`[Reproductive] Pregnancy created from text: ${w} weeks (conception ${p.conceptionDate.slice(0, 10)})`);

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
    if (p.isPregnant || !pregState || !pregState.conceptionDate) return false;
    // Юзер-носитель выключен — юзерский PREGNANCY_STATE игнорируем (модель ошиблась
    // или описывает партнёра без carrier-поля; партнёрский путь идёт отдельно)
    if (p.userCanCarry === false) return false;

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

    dlog(`[Reproductive] Pregnancy created from PREGNANCY_STATE tag: conception ${p.conceptionDate.slice(0, 10)}, ${p.pregnancyWeeks}w`);
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
    const p = getPregnancyData();
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
export function startManualBaby(babiesData) {
    if (!Array.isArray(babiesData) || babiesData.length === 0) return null;
    const p = getPregnancyData();

    // Если уже есть малыш — добавляем к существующим (как при родах второго ребёнка)
    const existingBabies = Array.isArray(p.babies) ? [...p.babies] : [];

    // birthRpDate — рассчитываем от текущей RP-даты минус ageDays.
    // Если RP-даты в чате ещё не было, якорим к реальному времени ВРЕМЕННО
    // и помечаем — processDateTag перепривяжет к RP-оси при первой же RP-дате.
    const nowRp = p.rpDate ? new Date(p.rpDate) : new Date();
    const realTimeAnchored = !p.rpDate;

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
    p.babyAge = babiesData[0].ageDays && babiesData[0].ageDays > 0
        ? `${babiesData[0].ageDays} дн.` : 'новорождённый';

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
            age: ageDays > 0 ? (ageDays < 30 ? `${ageDays} дн.` : `${Math.floor(ageDays/30)} мес.`) : 'новорождённый',
            stage: getLifeStageByDays(ageDays).id,
            ...(realTimeAnchored ? { _birthRealAnchored: true, _manualAgeDays: ageDays } : {}),
        });
    });

    p.babySex = p.babies.map(b => b.sex);
    if (p.babies[0]?.name) p.babyName = p.babies[0].name;
    p.babyBirthRpDate = p.babies[p.babies.length - 1].birthRpDate;

    refreshSnap();
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();

    // Малыш с ненулевым возрастом сразу получает уже достигнутые вехи развития
    // и флаги ухода (зубки/колики). Динамический импорт — чтобы не плодить циклы.
    try {
        import('./baby-care.js').then(m => {
            m.updateBabyCare();
            refreshSnap();
            _syncUI();
            _updatePromptInjection();
        }).catch(() => {});
    } catch (e) { /* ignore */ }

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
            stage: baby.stage || null,
            _lastBdayCelebrated: baby._lastBdayCelebrated || 0,
            motherName: baby.motherName || '',
            bornBy: baby.bornBy || 'user',
        });
    }

    // Удаляем из активных
    p.babies = (p.babies || []).filter(b => !ids.has(`${b.name || ''}|${b.birthRpDate || ''}|${b.sex || ''}`));
    p.babyCount = p.babies.length;

    // Если активных детей не осталось — выключаем baby mode
    if (p.babies.length === 0) {
        p.hasBaby = false;
        p.babyName = '';
        p.babySex = [];
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
    } else {
        // Обновляем legacy-поля от первого оставшегося ребёнка
        const first = p.babies[0];
        p.babyName = first.name || '';
        p.babySex = p.babies.map(b => b.sex);
    }

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
