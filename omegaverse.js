// ═══════════════════════════════════════════
// OMEGAVERSE — циклы течки (омега) и гона (альфа)
// Чистые функции без зависимостей от ST — легко тестируются в node.
// ═══════════════════════════════════════════

// Конфиг длин циклов из настроек (с дефолтами)
export function getCfg(s) {
    return {
        heatCycleLength: Math.max(7, parseInt(s?.heatCycleLength) || 42),
        heatDuration: Math.max(1, parseInt(s?.heatDuration) || 5),
        rutCycleLength: Math.max(7, parseInt(s?.rutCycleLength) || 70),
        rutDuration: Math.max(1, parseInt(s?.rutDuration) || 3),
    };
}

export function isOmegaverse(s) {
    return s?.universe === 'omegaverse';
}

// Роль носителя: 'user' → s.userDesignation, 'char' → s.charDesignation
export function designationOf(s, who) {
    const d = who === 'char' ? s?.charDesignation : s?.userDesignation;
    return (d === 'alpha' || d === 'beta' || d === 'omega') ? d : 'beta';
}

// Биологический пол носителя ('female' | 'male'). По умолчанию: юзер — женский, персонаж — мужской.
export function sexOf(s, who) {
    const v = who === 'char' ? s?.charSex : s?.userSex;
    if (v === 'male' || v === 'female') return v;
    return who === 'char' ? 'male' : 'female';
}

// Есть ли МЕСЯЧНЫЕ (обычный 28-дневный цикл). Зависит ТОЛЬКО от пола:
// женщина — да, в любой роли A/B/O (омега, бета, альфа); мужчина — нет.
export function hasMenstrualCycle(s, who) {
    return sexOf(s, who) === 'female';
}

// ─── Фаза течки омеги ───
// Цикл: [1..heatDuration] = течка, за 2 дня до конца цикла — предтечка, остальное — норма.
// Возвращает { phase, day, label, labelEn, fertility } — fertility = множитель шанса зачатия.
export function getHeatPhase(day, cfg) {
    const len = cfg.heatCycleLength;
    const dur = cfg.heatDuration;
    let d = ((parseInt(day) || 1) - 1) % len + 1;
    if (d < 1) d += len;

    if (d <= dur) {
        return {
            phase: 'heat', day: d, len,
            // Короткая метка для бейджа + подробность отдельно (день цикла всегда виден)
            label: `Течка · ${d}/${dur} дн.`,
            sub: `день ${d} из ${len} в цикле течки`,
            labelEn: `IN HEAT (day ${d} of ${dur}; cycle day ${d}/${len})`,
            fertility: 3.2,
        };
    }
    // Предтечка — последние 2 дня цикла перед новой течкой
    if (d > len - 2) {
        return {
            phase: 'preheat', day: d, len,
            label: `Предтечка · ${d}/${len}`,
            sub: `течка начнётся через ${len - d + 1} дн.`,
            labelEn: `PRE-HEAT, heat starts in ${len - d + 1} days (cycle day ${d}/${len})`,
            fertility: 1.4,
        };
    }
    return {
        phase: 'normal', day: d, len,
        label: `Спокойно · ${d}/${len}`,
        sub: `до следующей течки ${len - d + 1} дн.`,
        labelEn: `between heats, next heat in ${len - d + 1} days (cycle day ${d}/${len})`,
        fertility: 0.35,
    };
}

// ─── Фаза гона альфы ───
export function getRutPhase(day, cfg) {
    const len = cfg.rutCycleLength;
    const dur = cfg.rutDuration;
    let d = ((parseInt(day) || 1) - 1) % len + 1;
    if (d < 1) d += len;

    if (d <= dur) {
        return {
            inRut: true, phase: 'rut', day: d, len,
            label: `Гон · ${d}/${dur} дн.`,
            sub: `день ${d} из ${len} в цикле гона`,
            labelEn: `IN RUT (day ${d} of ${dur}; cycle day ${d}/${len})`,
            potency: 1.5,
        };
    }
    return {
        inRut: false, phase: 'normal', day: d, len,
        label: `Вне гона · ${d}/${len}`,
        sub: `до следующего гона ${len - d + 1} дн.`,
        labelEn: `not in rut, next rut in ${len - d + 1} days (cycle day ${d}/${len})`,
        potency: 1,
    };
}

// ─── Статус носителя одной строкой (для UI/промпта) ───
// carrier — объект данных носителя (p или p.partner), desig — роль, s — настройки.
export function carrierAboStatus(carrier, desig, s) {
    const cfg = getCfg(s);
    if (desig === 'omega') {
        if (carrier?.heatSuppressant) {
            return { kind: 'heat', suppressed: true, label: 'Течка подавлена (супрессанты)', labelEn: 'heat suppressed (on suppressants)', fertility: 0.1 };
        }
        const ph = getHeatPhase(carrier?.heatCycleDay || 1, cfg);
        return { kind: 'heat', suppressed: false, ...ph };
    }
    if (desig === 'alpha') {
        const rt = getRutPhase(carrier?.rutCycleDay || 1, cfg);
        return { kind: 'rut', ...rt, fertility: 1 };
    }
    return { kind: 'beta', label: 'Бета — обычный цикл', labelEn: 'beta (regular cycle)', fertility: 1 };
}

// Продвижение A/B/O-циклов на N RP-дней (мутирует carrier). Возвращает описание событий.
export function advanceAboCycles(carrier, desig, s, days) {
    const cfg = getCfg(s);
    const events = [];
    if (!carrier || !(days > 0)) return events;

    if (desig === 'omega') {
        const before = getHeatPhase(carrier.heatCycleDay || 1, cfg);
        carrier.heatCycleDay = ((carrier.heatCycleDay || 1) - 1 + days) % cfg.heatCycleLength + 1;
        const after = getHeatPhase(carrier.heatCycleDay, cfg);
        if (before.phase !== 'heat' && after.phase === 'heat') events.push('heat_start');
        if (before.phase === 'heat' && after.phase !== 'heat') events.push('heat_end');
        if (before.phase === 'normal' && after.phase === 'preheat') events.push('preheat');
    } else if (desig === 'alpha') {
        const before = getRutPhase(carrier.rutCycleDay || 1, cfg);
        carrier.rutCycleDay = ((carrier.rutCycleDay || 1) - 1 + days) % cfg.rutCycleLength + 1;
        const after = getRutPhase(carrier.rutCycleDay, cfg);
        if (!before.inRut && after.inRut) events.push('rut_start');
        if (before.inRut && !after.inRut) events.push('rut_end');
    }
    return events;
}

// ─── Может ли носитель ЗАБЕРЕМЕНЕТЬ ───
// Обычный мир: только женщины. Омегаверс: женщины + омеги любого пола; альфы — никогда.
export function canCarry(s, who) {
    const sex = sexOf(s, who);
    if (!isOmegaverse(s)) return sex === 'female';
    const d = designationOf(s, who);
    if (d === 'alpha') return false;
    return sex === 'female' || d === 'omega';
}

// Есть ли у носителя что отслеживать: цикл, течка или гон.
export function hasAnyTracking(s, who) {
    if (hasMenstrualCycle(s, who)) return true;
    if (!isOmegaverse(s)) return false;
    const d = designationOf(s, who);
    return d === 'omega' || d === 'alpha';
}
