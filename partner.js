// ═══════════════════════════════════════════
// PARTNER — репродуктивная система партнёра ({{char}})
// Этап 2 «носители»: беременеть может не только юзер, но и партнёр.
// Данные живут в p.partner (внутри per-chat объекта) — попадают в снапшоты
// regen/history/rollback автоматически, отдельной миграции не нужно.
// Дети от партнёрской беременности идут в ОБЩИЕ p.babies/grownChildren
// с полями motherName/bornBy:'partner' — династия и промпт видят всех.
// ═══════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../script.js';
import { CHANCES, defaultPartnerData } from './config.js';
import { getSettings, getPregnancyData, dlog, dwarn } from './state.js';
import { roll, getCycleModifier, calculateWeeksFromDates, formatFetusCount, rollPlannedComplications } from './helpers.js';
import { showNotification, showBirthDialog } from './notifications.js';
import { isOmegaverse, ensureOmegaFields, getFertilityModifierOmegaverse, advanceOmegaCycle, getCfg } from './omegaverse.js';

// UI/промпт обновляем через динамические импорты: ui.js статически импортирует
// partner.js (кнопки сброса/ручной беременности), обратная статическая связь
// дала бы цикл. Тот же паттерн, что refreshSnap в pregnancy.js.
function uiRefresh() {
    try {
        import('./ui.js').then(m => m.syncUI && m.syncUI());
        import('./prompts.js').then(m => m.updatePromptInjection && m.updatePromptInjection());
        import('./message-handler.js').then(m => {
            if (m.renderInfoblock) setTimeout(m.renderInfoblock, 300);
        });
    } catch (e) { /* ignore */ }
}

// Обновить regen-snapshot после РУЧНЫХ изменений — иначе swipe/regen откатит правку
function refreshSnap() {
    try {
        import('./message-handler.js').then(m => m.refreshRegenSnapshot && m.refreshRegenSnapshot());
    } catch (e) { /* ignore */ }
}

// ─── Доступ к данным партнёра (ленивая инициализация + бэкфилл новых полей) ───
export function getPartner(p) {
    if (!p.partner) {
        p.partner = structuredClone(defaultPartnerData);
    } else {
        for (const k in defaultPartnerData) {
            if (p.partner[k] === undefined) p.partner[k] = structuredClone(defaultPartnerData[k]);
        }
    }
    return p.partner;
}

export function getPartnerName(p) {
    const pp = p?.partner;
    if (pp?.name) return pp.name;
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        if (ctx?.name2) return ctx.name2;
    } catch (e) { /* ignore */ }
    return 'Партнёр';
}

function getPlayerName() {
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        return ctx?.name1 || '';
    } catch (e) { return ''; }
}

// Сброс ТОЛЬКО полей беременности (enabled/name/contraception/cycleDay остаются)
export function resetPartnerPregnancyFields(pp) {
    pp.isPregnant = false;
    pp.conceptionDate = null;
    pp.pregnancyWeeks = 0;
    pp.fetusCount = 1;
    pp.fetusSex = [];
    pp.fetusSexRevealed = false;
    pp.complications = [];
    pp._plannedComplications = [];
    pp.healthStatus = 'normal';
    pp.mood = '';
    pp.libido = '';
    pp.weightGain = '';
    pp.babyActivity = '';
    pp.fatherName = '';
    pp._conceptionAnchored = false;
    pp._dynamic = {};
}

// ─── Проверка зачатия партнёра (бросок кубика по тегу CONCEPTION_CHECK:PARTNER) ───
export function checkPartnerConception() {
    const s = getSettings();
    const p = getPregnancyData();
    const pp = getPartner(p);

    if (!s.isEnabled || !pp.enabled) return null;
    if (pp.isPregnant) return null;

    s.totalChecks++;
    const name = getPartnerName(p);

    const day = Math.max(1, Math.min(28, parseInt(pp.cycleDay) || 1));
    let cycleModifier;
    let dayLabel = `День ${day}`;
    if (isOmegaverse(p)) {
        // Омегаверс: носитель — партнёр, «отец» — юзер (его гон даёт бонус)
        ensureOmegaFields(pp, false);
        const info = getFertilityModifierOmegaverse(
            { designation: pp.designation, heatCycleDay: pp.heatCycleDay, heatSuppressant: pp.heatSuppressant, cycleDay: day },
            { designation: p.designation || 'omega', rutCycleDay: p.rutCycleDay },
            getCfg(s),
        );
        if (info.modifier <= 0) {
            dlog(`[Reproductive] Partner conception skipped — ${name} is an alpha (cannot conceive)`);
            return null;
        }
        cycleModifier = info.modifier * info.sireBoost;
        dayLabel = info.phaseLabelRu + (info.sireBoost > 1 ? ' + гон альфы' : '');
    } else {
        cycleModifier = getCycleModifier(day);
    }
    let chance = Math.min(95, Math.round(CHANCES.base * cycleModifier));

    const eff = CHANCES.contraception[pp.contraception] ?? 0;
    let contraceptionFailed = false;
    if (pp.contraception !== 'none') {
        if (roll(100) > eff) {
            contraceptionFailed = true;
            if (s.showNotifications) {
                showNotification(`<i class="fa-solid fa-triangle-exclamation"></i> ${name}: контрацепция ПОДВЕЛА!`, 'warning');
            }
        } else {
            chance = Math.round(chance * (1 - eff / 100));
        }
    }

    const conceptionRoll = roll(100);
    const success = conceptionRoll <= chance;
    dlog(`[Reproductive] PARTNER conception check: roll=${conceptionRoll}, need<=${chance}, result=${success ? 'PREGNANT' : 'no'}`);

    if (success) {
        pp.isPregnant = true;
        // Якорим зачатие СТРОГО к текущей RP-дате (как у юзера); если её нет —
        // advancePartnerTime доякорит на первом RP_DATE.
        pp.conceptionDate = p.rpDate || null;
        pp._conceptionAnchored = !!p.rpDate;
        pp.pregnancyWeeks = 0;
        pp._plannedComplications = rollPlannedComplications();
        pp.healthStatus = 'normal';
        s.totalConceptions++;

        const twinsChance = s.twinsChance || 3;
        const tripletsChance = s.tripletsChance || 0.1;
        const multiplesRoll = roll(1000) / 10;
        pp.fetusCount = multiplesRoll <= tripletsChance ? 3 : multiplesRoll <= twinsChance ? 2 : 1;
        pp.fetusSex = [];
        for (let i = 0; i < pp.fetusCount; i++) {
            pp.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        }
        pp.fetusSexRevealed = false;

        // Отец — по умолчанию игрок (модель может уточнить через PREGNANCY_STATE)
        if (!pp.fatherName) pp.fatherName = getPlayerName();

        if (s.showNotifications) {
            showNotification(`<i class="fa-solid fa-check"></i> ${name} беременна! ${dayLabel}, ${conceptionRoll}/${chance}<br>${formatFetusCount(pp.fetusCount)}`, 'success');
        }
    } else {
        if (s.showNotifications) {
            showNotification(`<i class="fa-solid fa-xmark"></i> ${name} не забеременела. ${dayLabel}, ${conceptionRoll}/${chance}`, 'info');
        }
    }

    saveSettingsDebounced();
    uiRefresh();
    return { roll: conceptionRoll, chance, success, cycleDay: day, contraceptionFailed };
}

// ─── Роды партнёра ───
// result: {baby_traits?, _source?} — как applyScanResult, но трогает ТОЛЬКО
// партнёрскую беременность; юзерская (если идёт параллельно) не сбрасывается.
export function applyPartnerBirth(result = {}) {
    const s = getSettings();
    const p = getPregnancyData();
    const pp = getPartner(p);

    if (!pp.isPregnant) {
        dwarn('[Reproductive] Partner birth ignored — partner not pregnant');
        return false;
    }

    const { weeks } = calculateWeeksFromDates(pp.conceptionDate, p.rpDate, pp.pregnancyWeeks);
    const currentWeeks = weeks || pp.pregnancyWeeks || 0;

    if (result._source !== 'manual' && result._source !== 'auto') {
        // Те же защиты от ложных срабатываний, что у юзерских родов
        if (currentWeeks > 0 && currentWeeks < 20) {
            dwarn(`[Reproductive] Partner birth ignored — too early (${currentWeeks} weeks)`);
            return false;
        }
        if (currentWeeks === 0) {
            dwarn('[Reproductive] Partner birth ignored — 0 weeks (just conceived)');
            return false;
        }
        try {
            const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
            const chatLen = ctx?.chat?.length || 0;
            if (s._birthBlockedUntil && chatLen < s._birthBlockedUntil) {
                dwarn(`[Reproductive] Partner birth ignored — blocked until position ${s._birthBlockedUntil}`);
                return false;
            }
        } catch (e) { /* ignore */ }
    }

    dlog('[Reproductive] PARTNER birth!');
    const partnerName = getPartnerName(p);
    const babySex = pp.fetusSex.length > 0 ? [...pp.fetusSex] : ['M'];
    const newBabyCount = pp.fetusCount || 1;
    const birthRpDate = p.rpDate || new Date().toISOString();
    const fatherName = pp.fatherName || getPlayerName();

    resetPartnerPregnancyFields(pp);

    // Новорождённые — в ОБЩУЮ семью (после старших, как при юзерских родах)
    if (!Array.isArray(p.babies)) p.babies = [];
    const newbornStartIdx = p.babies.length;
    // Омегаверс: запоминаем роли родителей — партнёр выносил (мать), отец обычно юзер
    const isOmega = p.universe === 'omegaverse';
    for (let i = 0; i < newBabyCount; i++) {
        p.babies.push({
            name: '',
            sex: babySex[i] || 'M',
            ...(isOmega ? { motherDesignation: pp.designation || null, fatherDesignation: p.designation || null } : {}),
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
            birthRpDate: birthRpDate,
            age: 'новорождённый',
            stage: 'newborn',
            fatherName: fatherName,
            motherName: partnerName,
            bornBy: 'partner',
        });
    }

    p.hasBaby = true;
    p.babyCount = p.babies.length;
    p.babySex = p.babies.map(b => b.sex);
    p.babyBirthRpDate = birthRpDate;
    p.babyHealth = 'normal';
    p.babyMood = 'спокойный';
    p.babyDiaperClean = true;
    p.babySleep = 'спит';
    p.babyAge = 'новорождённый';
    if (p.babies[0]?.name) p.babyName = p.babies[0].name;

    saveSettingsDebounced();
    uiRefresh();

    // Диалог именования — префилл из BABY_TRAITS, если модель его дала
    const modelTraits = result.baby_traits && Array.isArray(result.baby_traits.babies)
        ? result.baby_traits.babies : [];
    const dialogBabies = [];
    for (let i = 0; i < newBabyCount; i++) {
        const mt = modelTraits[i] || {};
        dialogBabies.push({
            sex: babySex[i] || 'M',
            name: mt.name || mt.имя || '',
            fatherName: mt.fatherName || mt.father || mt.отец || fatherName,
            personality: Array.isArray(mt.personality) ? mt.personality
                      : Array.isArray(mt.характер) ? mt.характер : null,
            appearance: Array.isArray(mt.appearance) ? mt.appearance
                     : Array.isArray(mt.внешность) ? mt.внешность : null,
            special: mt.special !== undefined ? mt.special : undefined,
        });
    }

    showBirthDialog(dialogBabies, (names, traitsData) => {
        for (let i = 0; i < newBabyCount; i++) {
            const baby = p.babies[newbornStartIdx + i];
            if (!baby) continue;
            if (names[i]) baby.name = names[i];
            const traits = traitsData[i] || { personality: [], appearance: [] };
            baby.personality = traits.personality;
            baby.appearance = traits.appearance;
            if (traits.special) baby.special = traits.special;
            if (traits.fatherName) baby.fatherName = traits.fatherName;
        }
        if (p.babies[0]?.name) p.babyName = p.babies[0].name;
        saveSettingsDebounced();
        uiRefresh();
    });

    return true;
}

// ─── Создание партнёрской беременности из PREGNANCY_STATE тега с carrier:"partner" ───
// Требует pp.enabled — защита от галлюцинаций модели (она не может «включить»
// партнёрскую беременность сама, если юзер не активировал трекинг).
export function createPartnerPregnancyFromStateTag(pregState, { notify = true } = {}) {
    const s = getSettings();
    const p = getPregnancyData();
    const pp = getPartner(p);
    if (!pp.enabled || pp.isPregnant || !pregState?.conceptionDate) return false;

    const conceptionMs = new Date(pregState.conceptionDate).getTime();
    if (isNaN(conceptionMs)) return false;

    const userSetMs = pp._userSetWeeksAt || 0;
    if (userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30) {
        dlog('[Reproductive] Partner PREGNANCY_STATE ignored — recent manual action');
        return false;
    }

    pp.isPregnant = true;
    pp.conceptionDate = pregState.conceptionDate;
    pp._conceptionAnchored = true;
    pp.fetusCount = pregState.fetusCount || 1;
    pp.fetusSex = (pregState.fetusSex && pregState.fetusSex.length > 0)
        ? [...pregState.fetusSex]
        : Array.from({ length: pp.fetusCount }, () => (roll(2) === 1 ? 'M' : 'F'));
    pp.fetusSexRevealed = pregState.fetusSex?.length > 0 && pregState.fetusSex.every(x => x === 'M' || x === 'F');
    if (pregState.fatherName) pp.fatherName = pregState.fatherName;
    pp.healthStatus = pp.healthStatus || 'normal';

    if (p.rpDate) {
        const rpMs = new Date(p.rpDate).getTime();
        pp.pregnancyWeeks = rpMs >= conceptionMs ? Math.floor((rpMs - conceptionMs) / (7 * 86400000)) : 0;
    } else {
        pp.pregnancyWeeks = 0;
    }

    dlog(`[Reproductive] Partner pregnancy created from PREGNANCY_STATE: conception ${pp.conceptionDate.slice(0, 10)}, ${pp.pregnancyWeeks}w`);
    saveSettingsDebounced();
    if (notify && s.showNotifications) {
        showNotification(`<i class="fa-solid fa-baby"></i> ${getPartnerName(p)} беременна (из контекста): ${pp.pregnancyWeeks} нед.`, 'success');
    }
    uiRefresh();
    return true;
}

// ─── Обновление активной партнёрской беременности из PREGNANCY_STATE тега ───
export function applyPartnerPregnancyStateTag(pregState) {
    const p = getPregnancyData();
    const pp = getPartner(p);
    if (!pp.enabled || !pp.isPregnant || !pregState) return false;

    let changed = false;

    if (pregState.conceptionDate && pp.conceptionDate !== pregState.conceptionDate) {
        const userSetMs = pp._userSetWeeksAt || 0;
        const recentlyUserSet = userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30;
        if (!recentlyUserSet) {
            dlog(`[Reproductive] Partner conceptionDate updated: ${pp.conceptionDate} → ${pregState.conceptionDate}`);
            pp.conceptionDate = pregState.conceptionDate;
            pp._conceptionAnchored = true;
            changed = true;
        }
    }
    if (pregState.fetusCount && pp.fetusCount !== pregState.fetusCount) {
        pp.fetusCount = pregState.fetusCount;
        changed = true;
    }
    const tagSex = (pregState.fetusSex || []).filter(x => x === 'M' || x === 'F');
    if (tagSex.length > 0 && JSON.stringify(pp.fetusSex) !== JSON.stringify(pregState.fetusSex)) {
        pp.fetusSex = pregState.fetusSex;
        if (pregState.fetusSex.every(x => x === 'M' || x === 'F') && !pp.fetusSexRevealed) {
            pp.fetusSexRevealed = true;
        }
        changed = true;
    }
    if (pregState.fatherName && pp.fatherName !== pregState.fatherName) {
        pp.fatherName = pregState.fatherName;
        changed = true;
    }
    // Пересчёт недель от conceptionDate
    if (p.rpDate && pp.conceptionDate) {
        const conceptionMs = new Date(pp.conceptionDate).getTime();
        const rpMs = new Date(p.rpDate).getTime();
        if (rpMs >= conceptionMs) {
            const newWeeks = Math.floor((rpMs - conceptionMs) / (7 * 86400000));
            if (newWeeks !== pp.pregnancyWeeks) {
                pp.pregnancyWeeks = newWeeks;
                changed = true;
            }
        }
    }

    if (changed) saveSettingsDebounced();
    return changed;
}

// ─── Ручная партнёрская беременность (datepicker из панели) ───
export function startManualPartnerPregnancy(conceptionDateISO, fetusCount, fetusSex = null) {
    const s = getSettings();
    const p = getPregnancyData();
    const pp = getPartner(p);
    const count = Math.max(1, Math.min(4, parseInt(fetusCount) || 1));

    pp.enabled = true; // ручной запуск подразумевает включение трекинга
    pp.isPregnant = true;
    pp.conceptionDate = conceptionDateISO;
    pp._conceptionAnchored = true;
    pp._userSetWeeksAt = Date.now();
    pp.fetusCount = count;
    pp.healthStatus = 'normal';
    pp.complications = [];
    pp._plannedComplications = [];
    if (!pp.fatherName) pp.fatherName = getPlayerName();

    if (Array.isArray(fetusSex) && fetusSex.length === count) {
        pp.fetusSex = [...fetusSex];
    } else {
        pp.fetusSex = [];
        for (let i = 0; i < count; i++) {
            pp.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        }
    }
    pp.fetusSexRevealed = false;

    if (p.rpDate) {
        const calc = calculateWeeksFromDates(pp.conceptionDate, p.rpDate, 0);
        pp.pregnancyWeeks = calc.weeks;
    } else {
        pp.pregnancyWeeks = 0;
    }

    refreshSnap();
    saveSettingsDebounced();
    uiRefresh();

    if (s.showNotifications) {
        const dateStr = new Date(conceptionDateISO).toLocaleDateString('ru-RU');
        showNotification(`<i class="fa-solid fa-check"></i> ${getPartnerName(p)} беременна: зачатие ${dateStr}, ${pp.pregnancyWeeks} нед.`, 'success');
    }
    return pp;
}

// ─── Сброс партнёрской беременности (кнопка в UI) ───
export function resetPartnerPregnancy() {
    const s = getSettings();
    const p = getPregnancyData();
    const pp = getPartner(p);
    resetPartnerPregnancyFields(pp);
    pp._userSetWeeksAt = Date.now();
    // Блокируем повторное «воскрешение» из старого контекста (те же позиции, что у юзера)
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : window;
        const chatLen = ctx?.chat?.length || 0;
        s._partnerConceptionBlockedUntil = chatLen + 10;
        s._birthBlockedUntil = Math.max(s._birthBlockedUntil || 0, chatLen + 10);
        dlog(`[Reproductive] Partner pregnancy reset: blocked until position ${chatLen + 10}`);
    } catch (e) { /* ignore */ }
    refreshSnap();
    saveSettingsDebounced();
    uiRefresh();
}

// ─── Продвижение времени партнёра (вызывается из advanceTime на каждом RP_DATE) ───
export function advancePartnerTime(s, p, daysPassed) {
    const pp = p.partner;
    if (!pp || daysPassed <= 0) return;

    // Трекинг беременности выключен, но в омегаверсе циклы всё равно тикают:
    // гон альфы-партнёра даёт бонус к зачатию юзера (симпатический — от течки).
    if (!pp.enabled) {
        if (isOmegaverse(p) && (pp.designation || 'alpha') !== 'beta' && !pp.isPregnant) {
            const ev = advanceOmegaCycle(pp, daysPassed, getCfg(s));
            if (ev.changed) saveSettingsDebounced();
        }
        return;
    }

    let changed = false;
    const name = getPartnerName(p);

    // ── Цикл (если не беременна) ──
    if (!pp.isPregnant) {
        const userSetMs = pp._userSetCycleAt || 0;
        const recentlySet = userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30;
        if (!recentlySet) {
            if (isOmegaverse(p) && (pp.designation || 'alpha') !== 'beta') {
                // Омегаверс: течка (омега) / гон (альфа) вместо 28-дневного цикла
                ensureOmegaFields(pp, false);
                const ev = advanceOmegaCycle(pp, daysPassed, getCfg(s));
                if (ev.changed) changed = true;
                if (s.showNotifications && !pp.heatSuppressant) {
                    if (ev.enteredPreheat) showNotification(`<i class="fa-solid fa-temperature-half"></i> ${name}: пред-течка`, 'info');
                    if (ev.enteredHeat) showNotification(`<i class="fa-solid fa-fire"></i> ${name}: ТЕЧКА началась!`, 'warning');
                    if (ev.heatEnded) showNotification(`<i class="fa-solid fa-wind"></i> ${name}: течка закончилась`, 'info');
                }
                if (s.showNotifications) {
                    if (ev.enteredRut) showNotification(`<i class="fa-solid fa-fire"></i> ${name}: гон начался`, 'warning');
                    if (ev.rutEnded) showNotification(`<i class="fa-solid fa-wind"></i> ${name}: гон закончился`, 'info');
                }
            } else {
                const oldDay = Math.max(1, Math.min(28, parseInt(pp.cycleDay) || 1));
                const newDay = ((oldDay - 1 + daysPassed) % 28) + 1;
                if (newDay !== oldDay) {
                    pp.cycleDay = newDay;
                    pp.lastCycleUpdate = Date.now();
                    changed = true;
                    if (s.showNotifications && oldDay < 12 && newDay >= 12 && newDay <= 16) {
                        showNotification(`<i class="fa-solid fa-fire"></i> ${name}: окно овуляции`, 'info');
                    }
                }
            }
        }
    }

    // ── Беременность: якорение и пересчёт недель ──
    if (pp.isPregnant) {
        // Якорим conceptionDate к RP-датам, если зачатие случилось до первого RP_DATE
        if (!pp._conceptionAnchored && p.rpDate) {
            const w = Math.max(0, pp.pregnancyWeeks || 0);
            pp.conceptionDate = new Date(new Date(p.rpDate).getTime() - w * 7 * 86400000).toISOString();
            pp._conceptionAnchored = true;
            changed = true;
            dlog(`[Reproductive] Partner conceptionDate anchored to RP timeline: ${pp.conceptionDate}`);
        }
        // Clamp: RP-время откатилось раньше зачатия — сдвигаем зачатие, сохраняя недели
        if (pp.conceptionDate && p.rpDate && new Date(pp.conceptionDate).getTime() > new Date(p.rpDate).getTime()) {
            const userSetMs = pp._userSetWeeksAt || 0;
            const recentlyUserSet = userSetMs > 0 && (Date.now() - userSetMs) / 60000 < 30;
            if (!recentlyUserSet) {
                const w = Math.max(0, pp.pregnancyWeeks || 0);
                pp.conceptionDate = new Date(new Date(p.rpDate).getTime() - w * 7 * 86400000).toISOString();
                changed = true;
                dwarn(`[Reproductive] Partner rpDate < conceptionDate — re-anchored preserving ${w}w`);
            }
        }

        if (pp.conceptionDate && p.rpDate) {
            const { weeks: newW } = calculateWeeksFromDates(pp.conceptionDate, p.rpDate, pp.pregnancyWeeks);
            const oldWeeks = pp.pregnancyWeeks;
            if (newW !== oldWeeks) {
                pp.pregnancyWeeks = newW;
                changed = true;
                const duration = s.pregnancyDuration || 40;

                if (s.showNotifications && newW > oldWeeks) {
                    if (oldWeeks < 13 && newW >= 13)
                        showNotification(`<i class="fa-solid fa-leaf"></i> ${name}: 2-й триместр`, 'success');
                    if (oldWeeks < 28 && newW >= 28)
                        showNotification(`<i class="fa-solid fa-baby"></i> ${name}: 3-й триместр`, 'info');
                    if (newW >= duration && oldWeeks < duration)
                        showNotification(`<i class="fa-solid fa-hospital"></i> ${name}: ПДР достигнута — роды в любой момент!`, 'warning');
                }

                // Авто-роды при перенашивании (как у юзера)
                if (newW >= duration + 2) {
                    dlog(`[Reproductive] Partner auto-birth at ${newW} weeks`);
                    saveSettingsDebounced();
                    applyPartnerBirth({ _source: 'auto' });
                    return;
                }

                revealPartnerComplications(s, pp, oldWeeks, newW, name);
            }
        }
    }

    if (changed) saveSettingsDebounced();
}

// ─── Раскрытие запланированных осложнений партнёра по неделям ───
function revealPartnerComplications(s, pp, oldWeeks, newWeeks, name) {
    if (!pp._plannedComplications || pp._plannedComplications.length === 0) return;
    for (const pc of pp._plannedComplications) {
        if (pc.revealed) continue;
        if (pc.revealWeek > oldWeeks && pc.revealWeek <= newWeeks) {
            pc.revealed = true;
            pp.complications.push({
                week: pc.revealWeek,
                type: pc.type,
                severity: pc.severity,
                description: pc.type,
                date: new Date().toISOString(),
                resolved: false,
            });
            if (pc.severity === 'critical') {
                pp.healthStatus = 'critical';
            } else if (pp.healthStatus === 'normal') {
                pp.healthStatus = 'warning';
            }
            dlog(`[Reproductive] Partner complication at week ${pc.revealWeek}: ${pc.type}`);
            if (s.showNotifications) {
                const icon = pc.severity === 'critical'
                    ? '<i class="fa-solid fa-circle-exclamation"></i>'
                    : '<i class="fa-solid fa-triangle-exclamation"></i>';
                showNotification(`${icon} ${name}, осложнение (${pc.revealWeek} нед.): ${pc.type}`, pc.severity === 'critical' ? 'warning' : 'info');
            }
        }
    }
}
