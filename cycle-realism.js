// ═══════════════════════════════════════════
// CYCLE REALISM — телесная сторона цикла: кровотечение, гигиена,
// фазовые эффекты, сбои цикла. Чистые функции, тестируются в node.
// ═══════════════════════════════════════════

// Средства гигиены. maxHours — сколько держит комфортно, limitHours — после
// чего это уже проблема (протечка; для тампона ещё и риск для здоровья).
export const HYGIENE = {
    pad:    { id: 'pad',    label: 'прокладка', labelEn: 'pad',         maxHours: 4,  limitHours: 6 },
    tampon: { id: 'tampon', label: 'тампон',    labelEn: 'tampon',      maxHours: 5,  limitHours: 8 },
    cup:    { id: 'cup',    label: 'чаша',      labelEn: 'menstrual cup', maxHours: 10, limitHours: 12 },
    none:   { id: 'none',   label: 'без средств', labelEn: 'nothing',    maxHours: 0,  limitHours: 0 },
};

// Интенсивность кровотечения по дню менструации (1-й день цикла = 1-й день месячных)
export function getFlow(day) {
    const d = parseInt(day) || 1;
    if (d === 1) return { level: 'starting', label: 'начинается',  labelEn: 'just started', factor: 0.7 };
    if (d <= 3)  return { level: 'heavy',    label: 'обильно',     labelEn: 'heavy',        factor: 1.4 };
    if (d === 4) return { level: 'medium',   label: 'умеренно',    labelEn: 'moderate',     factor: 1 };
    if (d <= 5)  return { level: 'light',    label: 'мазня',       labelEn: 'spotting',     factor: 0.5 };
    return { level: 'none', label: '', labelEn: '', factor: 0 };
}

// Часы между двумя RP-датами
export function hoursBetween(fromIso, toIso) {
    if (!fromIso || !toIso) return null;
    const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
    if (isNaN(ms) || ms < 0) return null;
    return ms / 3600000;
}

// Состояние средства гигиены: пора ли менять, есть ли риск протечки.
// Обильные дни «съедают» ресурс быстрее — отсюда flow.factor.
export function getHygieneState(typeId, hours, flow) {
    const h = HYGIENE[typeId] || HYGIENE.none;
    if (h.id === 'none') {
        return { type: h, hours, needsChange: true, overdue: true, leakRisk: flow?.factor > 0 ? 0.9 : 0,
                 label: 'ничего не использует', labelEn: 'using nothing', health: null };
    }
    if (hours === null || !(flow?.factor > 0)) {
        return { type: h, hours, needsChange: false, overdue: false, leakRisk: 0, label: h.label, labelEn: h.labelEn, health: null };
    }
    const factor = flow.factor || 1;
    const soft = h.maxHours / factor;
    const hard = h.limitHours / factor;

    const needsChange = hours >= soft;
    const overdue = hours >= hard;
    // Риск протечки растёт от «пора менять» до «давно пора»
    let leakRisk = 0;
    if (hours > soft) leakRisk = Math.min(0.95, (hours - soft) / Math.max(1, hard - soft) * 0.8);
    if (overdue) leakRisk = Math.min(0.95, 0.8 + (hours - hard) * 0.05);

    // Тампон дольше 8 часов — уже вопрос здоровья, а не удобства
    const health = (h.id === 'tampon' && hours >= 8) ? 'tampon-too-long' : null;

    return { type: h, hours, needsChange, overdue, leakRisk, label: h.label, labelEn: h.labelEn, health,
             hoursLeft: Math.max(0, Math.round((soft - hours) * 10) / 10) };
}

// Что фаза делает с телом. Коротко — это идёт в промпт как одна строка.
export function getPhaseEffects(day) {
    const d = parseInt(day) || 1;
    if (d <= 5) {
        const flow = getFlow(d);
        return {
            key: 'menstruation',
            label: 'Менструация',
            labelEn: 'menstruation',
            body: d <= 3 ? 'спазмы, тяжесть внизу живота, поясница' : 'слабые спазмы, усталость',
            bodyEn: d <= 3 ? 'cramps, heaviness low in the belly, aching back' : 'mild cramps, tiredness',
            energy: d <= 2 ? -2 : -1,
            libido: d <= 2 ? -1 : 0,
            mood: -1,
            flow,
        };
    }
    if (d <= 11) {
        return { key: 'follicular', label: 'Фолликулярная', labelEn: 'follicular',
                 body: 'силы возвращаются, кожа чище', bodyEn: 'energy returning, clearer skin',
                 energy: 1, libido: 1, mood: 1, flow: getFlow(99) };
    }
    if (d <= 16) {
        return { key: 'ovulation', label: 'Овуляция', labelEn: 'ovulation',
                 body: 'тянет низ живота с одной стороны, выделения тягучие, обострённое обоняние',
                 bodyEn: 'one-sided twinge low in the belly, stretchy discharge, sharper sense of smell',
                 energy: 2, libido: 2, mood: 1, flow: getFlow(99) };
    }
    if (d <= 24) {
        return { key: 'luteal', label: 'Лютеиновая', labelEn: 'luteal',
                 body: 'грудь чувствительнее, тянет на солёное, вздутие',
                 bodyEn: 'tender breasts, salt cravings, bloating',
                 energy: 0, libido: 0, mood: 0, flow: getFlow(99) };
    }
    return { key: 'pms', label: 'ПМС', labelEn: 'PMS',
             body: 'грудь болит, отёки, раздражительность, тянет поясницу',
             bodyEn: 'sore breasts, water retention, irritability, aching lower back',
             energy: -1, libido: -1, mood: -2, flow: getFlow(99) };
}

// Сбой цикла: стресс, болезнь, голод, перелёт сдвигают овуляцию, а с ней и месячные.
export const DISRUPTIONS = {
    stress:    { label: 'сильный стресс',   shift: [3, 10] },
    illness:   { label: 'болезнь',          shift: [2, 7] },
    starvation:{ label: 'недоедание',       shift: [5, 14] },
    travel:    { label: 'смена часовых поясов', shift: [1, 5] },
    overtrain: { label: 'перетренированность',  shift: [3, 9] },
};

// Насколько сдвинуть цикл. Возвращает число дней задержки (или 0).
export function disruptionShift(kind, rnd = Math.random) {
    const d = DISRUPTIONS[kind];
    if (!d) return 0;
    const [min, max] = d.shift;
    return min + Math.floor(rnd() * (max - min + 1));
}

// Строка о состоянии для промпта — максимально плотно, без воды.
// Только то, что тело чувствует СЕЙЧАС, плюс гигиена, если идут месячные.
export function realismPromptLine(day, hygieneState, opts = {}) {
    const eff = getPhaseEffects(day);
    const en = opts.lang !== 'ru';
    const parts = [];
    parts.push(en ? `${eff.labelEn} (cycle day ${day})` : `${eff.label} (день ${day})`);
    parts.push(en ? eff.bodyEn : eff.body);

    if (eff.key === 'menstruation' && hygieneState) {
        const h = hygieneState;
        const flowWord = en ? eff.flow.labelEn : eff.flow.label;
        parts.push(en ? `bleeding: ${flowWord}` : `кровотечение: ${flowWord}`);
        if (h.type.id === 'none') {
            parts.push(en ? 'no protection in use — will stain through' : 'без средств — протечёт');
        } else if (h.overdue) {
            parts.push(en
                ? `${h.labelEn} is well past due (${Math.round(h.hours)}h) — leaking is likely`
                : `${h.label} давно пора сменить (${Math.round(h.hours)} ч) — вот-вот протечёт`);
        } else if (h.needsChange) {
            parts.push(en ? `${h.labelEn} needs changing soon` : `${h.label} пора менять`);
        }
        if (h.health === 'tampon-too-long') {
            parts.push(en ? 'tampon in over 8h — a real health risk' : 'тампон больше 8 часов — это уже опасно');
        }
    }
    return parts.join('; ');
}
