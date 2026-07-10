// ═══════════════════════════════════════════
// OMEGAVERSE — биология A/B/O: течка, гон, назначения, супрессанты
// Этап 3. ЧИСТАЯ логика (импортирует только helpers) — функции принимают
// объект носителя и конфиг явно, тестируется в node без SillyTavern.
//
// Раскладка цикла течки (heatCycleDay 1..heatCycleLength):
//   дни 1..heatDuration        — ТЕЧКА (пик фертильности)
//   последние preheatDays дней — пред-течка (симптомы нарастают)
//   остальное                  — спокойная фаза
// Гон альфы устроен так же (rutCycleDay 1..rutCycleLength, дни 1..rutDuration — гон).
//
// Поля живут ПРЯМО на объекте носителя (p для юзера, p.partner для партнёра),
// НЕ в defaultPregnancyData — иначе Object.assign при родах/сбросе затирал бы
// вселенную и роли (тот же приём, что p.partner и p.userCanCarry).
// ═══════════════════════════════════════════

import { getCycleModifier } from './helpers.js';

export const OMEGA_DEFAULTS = {
    heatCycleLength: 42,  // течка каждые ~6 недель
    heatDuration: 5,
    preheatDays: 2,
    rutCycleLength: 70,   // гон каждые ~10 недель
    rutDuration: 3,
};

// Пер-чат поля юзера, которые должен переживать сброс/bootstrap (см. scanFullHistory)
// rutSympatheticOnly — лор-режим чата: у альф НЕТ собственного цикла гона,
// гон вспыхивает только симпатически, когда их омега в течке.
export const OMEGA_USER_FIELDS = ['universe', 'designation', 'heatCycleDay', 'rutCycleDay', 'heatSuppressant', 'scentBlockers', 'rutSympatheticOnly'];

export const DESIGNATION_LABELS = {
    alpha: { ru: 'Альфа', en: 'ALPHA' },
    beta:  { ru: 'Бета',  en: 'BETA' },
    omega: { ru: 'Омега', en: 'OMEGA' },
};

// Множители фертильности (поверх CHANCES.base)
export const FERT_MODS = {
    heat: 3.5,        // течка: 20% → 70%
    preheat: 1.5,
    calm: 0.25,       // между течками — низкая
    suppressed: 0.25, // супрессанты: течка не проявляется, ровный низкий фон
    sireRutBoost: 1.3, // отец-альфа в гоне (своём или симпатическом)
};

export function isOmegaverse(p) {
    return p?.universe === 'omegaverse';
}

function clampInt(v, min, max, dflt) {
    const n = parseInt(v);
    if (isNaN(n)) return dflt;
    return Math.max(min, Math.min(max, n));
}

// Конфиг длин циклов из глобальных настроек (с дефолтами)
export function getCfg(s) {
    return {
        heatCycleLength: clampInt(s?.heatCycleLength, 14, 180, OMEGA_DEFAULTS.heatCycleLength),
        heatDuration: clampInt(s?.heatDuration, 1, 14, OMEGA_DEFAULTS.heatDuration),
        preheatDays: OMEGA_DEFAULTS.preheatDays,
        rutCycleLength: clampInt(s?.rutCycleLength, 14, 180, OMEGA_DEFAULTS.rutCycleLength),
        rutDuration: clampInt(s?.rutDuration, 1, 14, OMEGA_DEFAULTS.rutDuration),
    };
}

// Бэкфилл A/B/O-полей на объекте носителя. isUser: дефолт юзера — омега,
// партнёра — альфа (классическая пара; меняется в настройках).
export function ensureOmegaFields(obj, isUser) {
    if (!obj) return false;
    let changed = false;
    if (!obj.designation) { obj.designation = isUser ? 'omega' : 'alpha'; changed = true; }
    if (typeof obj.heatCycleDay !== 'number') { obj.heatCycleDay = 20; changed = true; }
    if (typeof obj.rutCycleDay !== 'number') { obj.rutCycleDay = 30; changed = true; }
    if (obj.heatSuppressant === undefined) { obj.heatSuppressant = false; changed = true; }
    if (obj.scentBlockers === undefined) { obj.scentBlockers = false; changed = true; }
    return changed;
}

function wrapDay(day, len) {
    return ((Math.round(day) - 1) % len + len) % len + 1;
}

export function getHeatPhase(day, cfg) {
    const len = cfg.heatCycleLength;
    const d = wrapDay(day || 1, len);
    if (d <= cfg.heatDuration) {
        return {
            phase: 'heat', day: d, dayInPhase: d,
            labelRu: `Течка (день ${d}/${cfg.heatDuration})`,
            labelEn: `IN HEAT (day ${d} of ${cfg.heatDuration})`,
        };
    }
    if (d > len - cfg.preheatDays) {
        return {
            phase: 'preheat', day: d, dayInPhase: d - (len - cfg.preheatDays),
            labelRu: 'Пред-течка',
            labelEn: 'PRE-HEAT (heat imminent, 1-2 days)',
        };
    }
    return { phase: 'calm', day: d, labelRu: 'Спокойная фаза', labelEn: 'calm phase' };
}

export function getRutPhase(day, cfg) {
    const len = cfg.rutCycleLength;
    const d = wrapDay(day || 1, len);
    if (d <= cfg.rutDuration) {
        return {
            inRut: true, day: d,
            labelRu: `Гон (день ${d}/${cfg.rutDuration})`,
            labelEn: `IN RUT (day ${d} of ${cfg.rutDuration})`,
        };
    }
    return { inRut: false, day: d, labelRu: 'Спокоен', labelEn: 'calm (no rut)' };
}

// ─── Фертильность носителя в омегаверсе ───
// carrier: {designation, heatCycleDay, heatSuppressant, cycleDay} — cycleDay для бет
// sire:    {designation, rutCycleDay} | null — «отец», его гон даёт бонус
// Возвращает {modifier, phaseLabelRu, phaseLabelEn, inHeat, sireBoost}.
// modifier === 0 → носитель не может зачать (альфа).
export function getFertilityModifierOmegaverse(carrier, sire, cfg) {
    const d = carrier?.designation || 'omega';

    if (d === 'alpha') {
        return { modifier: 0, phaseLabelRu: 'Альфа — не беременеет', phaseLabelEn: 'alpha (cannot conceive)', inHeat: false, sireBoost: 1 };
    }

    let modifier, phaseLabelRu, phaseLabelEn;
    let inHeat = false;

    if (d === 'beta') {
        // Беты — обычная человеческая биология (реализм-цикл 28 дней)
        const cd = clampInt(carrier.cycleDay, 1, 28, 14);
        modifier = getCycleModifier(cd);
        phaseLabelRu = `День цикла ${cd}/28`;
        phaseLabelEn = `cycle day ${cd}/28`;
    } else if (carrier.heatSuppressant) {
        modifier = FERT_MODS.suppressed;
        phaseLabelRu = 'Течка подавлена';
        phaseLabelEn = 'heat suppressed';
    } else {
        const ph = getHeatPhase(carrier.heatCycleDay, cfg);
        modifier = FERT_MODS[ph.phase];
        inHeat = ph.phase === 'heat';
        phaseLabelRu = ph.labelRu;
        phaseLabelEn = ph.labelEn;
    }

    // Гон отца-альфы: собственный по циклу ИЛИ симпатический (носитель в течке).
    // Подавители гона (heatSuppressant у альфы) гасят и то и другое — буста нет.
    // sympatheticOnly (лор-режим): своего цикла у альфы нет, только реакция на течку.
    let sireBoost = 1;
    if (sire && (sire.designation || '') === 'alpha' && !sire.heatSuppressant) {
        const ownRut = sire.sympatheticOnly ? false : getRutPhase(sire.rutCycleDay, cfg).inRut;
        if (ownRut || inHeat) sireBoost = FERT_MODS.sireRutBoost;
    }

    return { modifier, phaseLabelRu, phaseLabelEn, inHeat, sireBoost };
}

// ═══ Наследование вторичного пола (династия) ═══
// Вероятности [альфа, бета, омега] в % по паре родителей (ключ отсортирован).
// Канон жанра: роль проявляется («презентация») в раннем подростковом возрасте.
const DESIGNATION_GENETICS = {
    'alpha|omega': [40, 20, 40],
    'alpha|beta':  [40, 50, 10],
    'alpha|alpha': [60, 30, 10],
    'beta|omega':  [10, 50, 40],
    'beta|beta':   [5,  85, 10],
    'omega|omega': [10, 30, 60],
};

// Ролл вторичного пола ребёнка по ролям родителей. Неизвестный родитель = бета.
export function rollChildDesignation(fatherDesig, motherDesig, rand = Math.random) {
    const valid = (d) => ['alpha', 'beta', 'omega'].includes(d) ? d : 'beta';
    const key = [valid(fatherDesig), valid(motherDesig)].sort().join('|');
    const probs = DESIGNATION_GENETICS[key] || [10, 80, 10];
    const r = rand() * 100;
    if (r < probs[0]) return 'alpha';
    if (r < probs[0] + probs[1]) return 'beta';
    return 'omega';
}

// Роли родителей ребёнка: сохранённые при рождении поля (fatherDesignation/
// motherDesignation), иначе выводим из текущих ролей носителей:
// носитель-юзер → p.designation, носитель-партнёр → p.partner.designation.
// Неопределимо → null (в ролле считается бетой).
export function inferParentDesignations(p, child) {
    let father = child?.fatherDesignation || null;
    let mother = child?.motherDesignation || null;
    if (!mother) {
        mother = child?.bornBy === 'partner' ? (p?.partner?.designation || null) : (p?.designation || null);
    }
    if (!father) {
        if (child?.bornBy === 'partner') {
            // Партнёр выносил — отец обычно юзер
            father = p?.designation || null;
        } else {
            const partnerName = String(p?.partner?.name || '').trim().toLowerCase();
            const fatherName = String(child?.fatherName || '').trim().toLowerCase();
            if (partnerName && fatherName && (fatherName === partnerName || fatherName.startsWith(partnerName) || partnerName.startsWith(fatherName))) {
                father = p?.partner?.designation || null;
            }
        }
    }
    return { father, mother };
}

// ─── Продвижение цикла течки/гона носителя на daysPassed RP-дней ───
// Мутирует carrierObj (heatCycleDay или rutCycleDay по назначению).
// Возвращает события смены фаз для уведомлений. Для бет — no-op
// (их 28-дневный цикл двигает существующий реализм-код).
export function advanceOmegaCycle(carrierObj, daysPassed, cfg) {
    const events = { changed: false, enteredPreheat: false, enteredHeat: false, heatEnded: false, enteredRut: false, rutEnded: false };
    if (!carrierObj || !daysPassed || daysPassed <= 0) return events;
    const d = carrierObj.designation || 'omega';

    if (d === 'omega') {
        const oldDay = wrapDay(carrierObj.heatCycleDay || 1, cfg.heatCycleLength);
        const newDay = wrapDay(oldDay + daysPassed, cfg.heatCycleLength);
        if (newDay !== oldDay) {
            const oldPhase = getHeatPhase(oldDay, cfg).phase;
            const newPhase = getHeatPhase(newDay, cfg).phase;
            carrierObj.heatCycleDay = newDay;
            events.changed = true;
            if (newPhase === 'heat' && oldPhase !== 'heat') events.enteredHeat = true;
            if (newPhase === 'preheat' && oldPhase === 'calm') events.enteredPreheat = true;
            if (oldPhase === 'heat' && newPhase !== 'heat') events.heatEnded = true;
        }
    } else if (d === 'alpha') {
        const oldDay = wrapDay(carrierObj.rutCycleDay || 1, cfg.rutCycleLength);
        const newDay = wrapDay(oldDay + daysPassed, cfg.rutCycleLength);
        if (newDay !== oldDay) {
            const wasRut = getRutPhase(oldDay, cfg).inRut;
            const isRut = getRutPhase(newDay, cfg).inRut;
            carrierObj.rutCycleDay = newDay;
            events.changed = true;
            if (isRut && !wasRut) events.enteredRut = true;
            if (wasRut && !isRut) events.rutEnded = true;
        }
    }
    return events;
}
