// ═══════════════════════════════════════════
// FERTILITY — скрытая беременность, тесты, планирование,
// послеродовое восстановление и генетика внешности.
// Чистые функции без ST-зависимостей вынесены наверх (тестируются в node).
// ═══════════════════════════════════════════

// ─── Тест на беременность ───
// Достоверность зависит от срока: до имплантации (≈8 дней) тест слеп,
// дальше чувствительность быстро растёт.
export function testReliability(daysSinceConception) {
    const d = Math.max(0, parseInt(daysSinceConception) || 0);
    if (d < 8) return 0;
    if (d < 11) return 0.35;
    if (d < 14) return 0.7;
    if (d < 18) return 0.92;
    return 0.99;
}

// Результат теста: 'positive' | 'faint' | 'negative'
export function rollTest(isPregnant, daysSinceConception, rnd = Math.random) {
    if (!isPregnant) return 'negative';
    const rel = testReliability(daysSinceConception);
    if (rel === 0) return 'negative';
    if (rnd() > rel) return 'negative';
    return daysSinceConception < 14 ? 'faint' : 'positive';
}

// ─── Задержка ───
export function missedDays(cycleDay, cycleLength = 28) {
    const d = parseInt(cycleDay) || 1;
    return d > cycleLength ? d - cycleLength : 0;
}

// Становится ли беременность очевидной сама (срок, живот, шевеления)
export function isObvious(weeks, obviousAtWeek = 12) {
    return (parseInt(weeks) || 0) >= (parseInt(obviousAtWeek) || 12);
}

// ─── Фертильное окно (для режима «планируем») ───
// Возвращает { fertile, peak, label, daysToPeak }
export function fertileWindow(cycleDay, cycleLength = 28) {
    const d = parseInt(cycleDay) || 1;
    const ovu = Math.round(cycleLength / 2);
    const start = ovu - 4;
    const end = ovu + 1;
    if (d >= start && d <= end) {
        return { fertile: true, peak: d >= ovu - 1 && d <= ovu + 1, label: d === ovu ? 'Овуляция — пик' : 'Фертильное окно', daysToPeak: ovu - d };
    }
    const daysToPeak = d < start ? ovu - d : cycleLength - d + ovu;
    return { fertile: false, peak: false, label: 'Низкая фертильность', daysToPeak };
}

// ─── Послеродовое восстановление ───
// Возвращает состояние по числу дней с родов.
export function postpartumState(daysSinceBirth, lactating = true) {
    const d = Math.max(0, parseInt(daysSinceBirth) || 0);
    const healing = d < 42
        ? (d < 10 ? 'швы свежие, больно' : d < 25 ? 'заживает' : 'почти зажило')
        : null;
    // Лактационная аменорея: цикл не возвращается пока кормит (грубо до ~6 мес)
    const cycleReturned = lactating ? d >= 180 : d >= 45;
    const lochia = d < 35;
    return {
        days: d,
        healing,
        lactating: lactating && d < 730,
        cycleReturned,
        lochia,
        // Пока цикл не вернулся — зачатие крайне маловероятно
        fertilityMul: cycleReturned ? 1 : (lactating ? 0.05 : 0.3),
        label: d < 42 ? 'Ранний послеродовой период' : cycleReturned ? 'Восстановление завершено' : 'Кормление, цикл не вернулся',
    };
}

// ─── Генетика внешности ───
// Простая менделевская модель: тёмное доминирует над светлым.
const EYE_RANK = { 'карие': 3, 'зелёные': 2, 'серые': 1, 'голубые': 1 };
const HAIR_RANK = { 'чёрные': 4, 'тёмные': 3, 'русые': 2, 'рыжие': 2, 'светлые': 1 };

function pickInherited(a, b, ranks, rnd) {
    const na = normalizeTrait(a, ranks);
    const nb = normalizeTrait(b, ranks);
    if (!na && !nb) return null;
    if (!na) return nb;
    if (!nb) return na;
    if (na === nb) return na;
    const ra = ranks[na] || 0;
    const rb = ranks[nb] || 0;
    // Доминантный признак берёт верх в 70% случаев, рецессивный проявляется в 30%
    const dominant = ra >= rb ? na : nb;
    const recessive = ra >= rb ? nb : na;
    return rnd() < 0.7 ? dominant : recessive;
}

function normalizeTrait(v, ranks) {
    if (!v || typeof v !== 'string') return null;
    const low = v.toLowerCase();
    for (const key of Object.keys(ranks)) {
        if (low.includes(key.slice(0, 4))) return key;
    }
    return null;
}

// Наследование внешности ребёнка от родителей. Возвращает { eyes, hair }.
export function inheritLooks(motherLooks, fatherLooks, rnd = Math.random) {
    return {
        eyes: pickInherited(motherLooks?.eyes, fatherLooks?.eyes, EYE_RANK, rnd),
        hair: pickInherited(motherLooks?.hair, fatherLooks?.hair, HAIR_RANK, rnd),
    };
}

// ─── Сложности с зачатием ───
// Сколько RP-месяцев пара «пытается» без результата → подсказка о проблеме.
export function conceptionStruggle(monthsTrying) {
    const m = Math.max(0, parseInt(monthsTrying) || 0);
    if (m < 6) return null;
    if (m < 12) return { level: 'concern', label: 'Полгода без результата — стоит провериться' };
    return { level: 'serious', label: 'Год без результата — повод обратиться к репродуктологу' };
}
