// ═══════════════════════════════════════════
// BABY-CARE — возрастные нормы ухода и вехи развития малыша
// Всё считается от RP-возраста (birthRpDate → p.rpDate).
// У каждого малыша персональные окна (детерминированный джиттер из birthRpDate),
// поэтому близнецы и разные дети развиваются немного по-разному, но стабильно
// между перезагрузками.
// ═══════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../script.js';
import { getSettings, getPregnancyData, dlog } from './state.js';
import { showNotification } from './notifications.js';

// ─── Детерминированный «рандом» из строки (FNV-1a) ───
function seedHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
}

// Джиттер от -range до +range дней, стабильный для пары (малыш, ключ вехи)
function jitter(baby, key, range) {
    if (!range) return 0;
    const h = seedHash(`${baby?.birthRpDate || ''}|${baby?.sex || ''}|${key}`);
    return (h % (range * 2 + 1)) - range;
}

// ─── RP-возраст малыша в днях (null если нет дат) ───
export function babyAgeDays(baby, p) {
    if (!baby?.birthRpDate || !p?.rpDate) return null;
    const ms = new Date(p.rpDate).getTime() - new Date(baby.birthRpDate).getTime();
    if (isNaN(ms) || ms < 0) return null;
    return Math.floor(ms / 86400000);
}

// ─── Вехи развития: base — типичный день, range — персональный разброс ───
const MILESTONES = [
    { key: 'smile',   label: 'первая улыбка',                base: 40,  range: 12 },
    { key: 'head',    label: 'уверенно держит головку',      base: 75,  range: 15 },
    { key: 'roll',    label: 'переворачивается со спины',    base: 120, range: 20 },
    { key: 'laugh',   label: 'громко смеётся',               base: 130, range: 20 },
    { key: 'sit',     label: 'сидит без поддержки',          base: 185, range: 25 },
    { key: 'solids',  label: 'первый прикорм',               base: 183, range: 10 },
    { key: 'tooth',   label: 'первый зуб (нижний резец)',    base: 195, range: 55 },
    { key: 'crawl',   label: 'ползает',                      base: 250, range: 35 },
    { key: 'stand',   label: 'встаёт у опоры',               base: 290, range: 25 },
    { key: 'babble',  label: 'лепечет «мама», «папа»',       base: 320, range: 40 },
    { key: 'steps',   label: 'первые шаги',                  base: 370, range: 40 },
    { key: 'words',   label: 'первые осознанные слова',      base: 380, range: 45 },
    { key: 'run',     label: 'бегает',                       base: 550, range: 60 },
    { key: 'phrases', label: 'фразы из двух слов',           base: 640, range: 70 },
    { key: 'potty',   label: 'осваивает горшок',             base: 660, range: 90 },
];

// Персональный день наступления вехи для конкретного малыша
export function milestoneDay(baby, m) {
    return m.base + jitter(baby, m.key, m.range);
}

// ─── Нормы ухода для возраста (в днях). Возвращает строки на русском ───
// { feeding, sleep, diaper, teething|null, colic:bool, upcoming|null }
export function getCareNorms(ageDays, baby) {
    const c = { feeding: '', sleep: '', diaper: '', teething: null, colic: false, upcoming: null };
    const a = ageDays;

    // Кормление / прикорм (прикорм — с персональной вехи solids, ~6 мес)
    const solidsDay = milestoneDay(baby, MILESTONES.find(m => m.key === 'solids'));
    if (a < 60) c.feeding = 'грудь/смесь каждые 2–3 ч, 8–12 раз в сутки (и ночью)';
    else if (a < 120) c.feeding = 'грудь/смесь каждые ~3 ч, 7–8 кормлений';
    else if (a < solidsDay) c.feeding = 'грудь/смесь каждые 3.5–4 ч; прикорм ещё рано (с ~6 мес)';
    else if (a < 240) c.feeding = 'первый прикорм: овощное пюре и каши с чайной ложки + грудь/смесь';
    else if (a < 365) c.feeding = 'прикорм 3 раза в день (пюре, каши, мясо, кусочки) + грудь/смесь';
    else if (a < 540) c.feeding = 'общий стол (адаптированный), 4–5 раз в день';
    else c.feeding = 'общий стол, 4 раза в день + перекусы';

    // Сон
    if (a < 90) c.sleep = 'сон 16–18 ч/сутки, ночью просыпается каждые 2–4 ч';
    else if (a < 140) c.sleep = 'сон 15–16 ч; возможен регресс сна (~4 мес)';
    else if (a < 183) c.sleep = 'сон 14–15 ч, 3 дневных сна';
    else if (a < 365) c.sleep = 'сон 13–14 ч, 2 дневных сна';
    else if (a < 540) c.sleep = 'сон ~13 ч, 1–2 дневных сна';
    else c.sleep = 'сон 12–13 ч, 1 дневной сон';

    // Подгузники / горшок (горшок — с персональной вехи potty)
    const pottyDay = milestoneDay(baby, MILESTONES.find(m => m.key === 'potty'));
    if (a < 365) c.diaper = 'подгузники: 6–10 смен в день';
    else if (a < pottyDay) c.diaper = 'подгузники: 4–6 смен в день';
    else c.diaper = 'осваивает горшок, подгузник на сон и прогулку';

    // Колики: ~3 недели — ~3.5 месяца, пик около 6 недель
    c.colic = a >= 20 && a <= 105;

    // Зубки: от персонального первого зуба, стадиями до ~2.5 лет
    const toothDay = milestoneDay(baby, MILESTONES.find(m => m.key === 'tooth'));
    if (a >= toothDay - 15 && a < toothDay) c.teething = 'дёсны набухли, слюни, всё тянет в рот — скоро первый зуб';
    else if (a >= toothDay && a < toothDay + 80) c.teething = 'режутся резцы: капризы, слюни, возможна температура';
    else if (a >= 390 && a < 480) c.teething = 'режутся боковые резцы';
    else if (a >= 480 && a < 630) c.teething = 'режутся первые моляры и клыки — самые болезненные';
    else if (a >= 630 && a < 850) c.teething = 'режутся вторые моляры';

    // Ближайшая веха (для промпта: «скоро может...»)
    let next = null;
    for (const m of MILESTONES) {
        const d = milestoneDay(baby, m);
        if (d > a && (!next || d < next.d)) next = { d, label: m.label };
    }
    if (next && next.d - a <= 45) c.upcoming = next.label;

    return c;
}

// ─── Потребности малыша по времени суток (fallback когда модель не прислала RP_STATUS) ───
// Возвращает { feeding, diaper, sleep, careNote } — текстовые статусы на основании
// возраста (ageDays) и текущего RP-времени (rpTime = "HH:MM" или null).
// Используются как defaults в UI и промпте когда модель ещё не отправила свои значения.
export function getCareNeeds(ageDays, rpTime, baby) {
    const needs = { feeding: null, diaper: null, sleep: null, careNote: null };
    if (ageDays === null || ageDays === undefined) return needs;

    // Парсим время; если нет — считаем полдень (нейтрально)
    let hour = 12;
    if (rpTime && typeof rpTime === 'string') {
        const parts = rpTime.split(':');
        if (parts.length >= 2) {
            const h = parseInt(parts[0]);
            if (h >= 0 && h <= 23) hour = h;
        }
    }

    // Персональный сдвиг расписания (±1ч) чтобы близнецы отличались
    const offset = baby ? jitter(baby, 'schedule', 1) : 0;
    const adjHour = (hour + 24 - offset) % 24;

    // ── Интервал кормления по возрасту (часы) ──
    let feedInterval;
    if (ageDays < 60)       feedInterval = 2.5;
    else if (ageDays < 120) feedInterval = 3;
    else if (ageDays < 180) feedInterval = 3.5;
    else if (ageDays < 365) feedInterval = 4;
    else                    feedInterval = 5;

    // Определяем: пора кормить? (упрощённо: каждые N часов от полуночи)
    const hoursSinceLastFeed = adjHour % feedInterval;
    if (hoursSinceLastFeed >= feedInterval - 0.5) {
        needs.feeding = 'Хочет есть';
    } else if (hoursSinceLastFeed < 0.5) {
        needs.feeding = 'Накормлен';
    } else {
        needs.feeding = 'Сыт';
    }

    // ── Подгузник: смена примерно каждые 2-3ч для новорождённых, 3-4ч для старших ──
    const diaperInterval = ageDays < 180 ? 2.5 : 3.5;
    const hoursSinceDiaper = adjHour % diaperInterval;
    if (hoursSinceDiaper >= diaperInterval - 0.5) {
        needs.diaper = 'Требует смены';
    } else {
        needs.diaper = 'Чистый';
    }

    // ── Сон по времени суток и возрасту ──
    const isNight = hour >= 20 || hour < 6;
    const isEarlyMorning = hour >= 6 && hour < 8;
    const isNapTime1 = hour >= 10 && hour < 12;  // утренний сон
    const isNapTime2 = hour >= 14 && hour < 16;  // послеобеденный сон

    if (isNight) {
        needs.sleep = 'Спит';
        if (ageDays < 90 && (hour >= 1 && hour < 5)) {
            // Новорождённые просыпаются ночью
            needs.sleep = 'Проснулся';
            needs.feeding = 'Хочет есть';
            needs.careNote = 'Ночное кормление';
        }
    } else if (isEarlyMorning) {
        needs.sleep = 'Просыпается';
    } else if (ageDays < 365 && isNapTime1) {
        needs.sleep = 'Дневной сон';
    } else if (ageDays < 540 && isNapTime2) {
        needs.sleep = 'Дневной сон';
    } else {
        needs.sleep = 'Бодрствует';
    }

    // ── Рекомендация по уходу ──
    if (!needs.careNote) {
        if (hour >= 19 && hour < 20) {
            needs.careNote = 'Пора купать и готовить ко сну';
        } else if (hour >= 9 && hour < 11 && ageDays > 30) {
            needs.careNote = 'Хорошее время для прогулки';
        } else if (hour >= 16 && hour < 18 && ageDays > 30) {
            needs.careNote = 'Вечерняя прогулка';
        } else if (ageDays < 90 && needs.feeding === 'Хочет есть') {
            needs.careNote = 'Кормление по требованию каждые 2-3ч';
        }
    }

    return needs;
}

// ─── Обновление вех и флагов по текущему RP-возрасту ───
// Вызывается при сдвиге RP-даты и после сканов. Записывает достигнутые вехи
// в baby.milestones, обновляет teething/colicky флаги. Идемпотентно.
export function updateBabyCare() {
    try {
        const s = getSettings();
        const p = getPregnancyData();
        if (!p.hasBaby || !Array.isArray(p.babies) || p.babies.length === 0 || !p.rpDate) return false;

        let changed = false;
        const newly = [];

        for (const baby of p.babies) {
            const age = babyAgeDays(baby, p);
            if (age === null) continue;
            if (!Array.isArray(baby.milestones)) baby.milestones = [];

            for (const m of MILESTONES) {
                if (milestoneDay(baby, m) > age) continue;
                const already = baby.milestones.some(x => x.key === m.key || x.text === m.label);
                if (already) continue;
                baby.milestones.push({
                    key: m.key,
                    text: m.label,
                    rpDate: p.rpDate,
                    date: new Date().toISOString(),
                });
                newly.push({ baby, m });
                changed = true;
            }

            const care = getCareNorms(age, baby);
            const teethingNow = !!care.teething;
            if (baby.teething !== teethingNow) { baby.teething = teethingNow; changed = true; }
            if (baby.colicky !== care.colic) { baby.colicky = care.colic; changed = true; }
        }

        // Legacy-поля — от младшего (последнего в массиве)
        const youngest = p.babies[p.babies.length - 1];
        if (youngest) {
            p.babyTeething = !!youngest.teething;
            p.babyColicky = !!youngest.colicky;
        }

        if (changed) saveSettingsDebounced();

        if (newly.length > 0 && s.showNotifications) {
            if (newly.length <= 2) {
                for (const { baby, m } of newly) {
                    showNotification(`<i class="fa-solid fa-star"></i> ${baby.name || 'Малыш'}: ${m.label}!`, 'success');
                }
            } else {
                // Bootstrap старого чата / большой скачок времени — не спамим
                showNotification(`<i class="fa-solid fa-star"></i> Вехи развития: +${newly.length}`, 'success');
            }
        }
        if (newly.length > 0) dlog(`[Reproductive] Baby milestones reached: ${newly.map(x => x.m.key).join(', ')}`);

        return changed;
    } catch (e) {
        console.error('[Reproductive] updateBabyCare error:', e);
        return false;
    }
}
