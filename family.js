// ═══════════════════════════════════════════
// FAMILY — династия: стадии жизни, дни рождения, черты по возрасту
// ЧИСТАЯ логика: модуль ничего не импортирует из state/pregnancy —
// все функции принимают per-chat объект p явно. Это позволяет
// использовать его из prompts/ui/message-handler без циклов
// и при желании выпилить семейный блок в отдельную расширку.
// ═══════════════════════════════════════════

const DAY_MS = 86400000;
const YEAR_MS = 365.25 * DAY_MS;

// Стадии жизни (пороги в RP-днях, ~симовская лестница).
// Порядок важен: getLifeStageByDays берёт последнюю стадию с minDays <= возраст.
export const LIFE_STAGES = [
    { id: 'newborn', minDays: 0,    label: 'новорождённый', labelEn: 'newborn',  icon: 'fa-baby' },
    { id: 'infant',  minDays: 91,   label: 'младенец',      labelEn: 'infant',   icon: 'fa-baby-carriage' },
    { id: 'toddler', minDays: 366,  label: 'тоддлер',       labelEn: 'toddler',  icon: 'fa-shoe-prints' },
    { id: 'child',   minDays: 1096, label: 'ребёнок',       labelEn: 'child',    icon: 'fa-child' },
    { id: 'teen',    minDays: 4383, label: 'подросток',     labelEn: 'teenager', icon: 'fa-person-walking' },
    { id: 'adult',   minDays: 6574, label: 'взрослый',      labelEn: 'adult',    icon: 'fa-person' },
];

// Подсказки модели: как отыгрывать ребёнка на каждой стадии (EN — идёт в промпт)
export const STAGE_PROMPT_HINTS = {
    newborn: 'sleeps most of the day, feeds every 2-3h, communicates only by crying',
    infant:  'babbles, learns to sit/crawl, teething, grabs everything, needs diapers',
    toddler: 'walks, says first words and short sentences, tantrums, potty training, endlessly curious',
    child:   'talks fluently, attends school/kindergarten, has hobbies and friends, asks endless questions, own opinions',
    teen:    'mood swings, seeks independence, friends and first crushes matter most, may clash with parents',
    adult:   'grown-up child living their own life, visits and supports the family',
};

// Пулы черт характера по стадиям — для диалога взросления
export const STAGE_TRAIT_POOLS = {
    infant:  ['улыбчивый', 'наблюдательный', 'голосистый', 'спокойный', 'цепкий', 'смешливый', 'ручной'],
    toddler: ['упрямый', 'любознательный', 'болтливый', 'застенчивый', 'бесстрашный', 'нежный', 'непоседа', 'аккуратист', 'маленький помощник', 'хохотун'],
    child:   ['книголюб', 'заводила', 'фантазёр', 'спортивный', 'тихоня', 'почемучка', 'заботливый', 'хитрюга', 'творческая натура', 'собранный'],
    teen:    ['бунтарь', 'романтик', 'амбициозный', 'саркастичный', 'мечтатель', 'лидер', 'одиночка', 'максималист', 'верный друг', 'артистичный'],
    adult:   ['независимый', 'целеустремлённый', 'добросердечный', 'практичный', 'харизматичный', 'надёжный'],
};

export function stageIndex(id) {
    return LIFE_STAGES.findIndex(s => s.id === id);
}

export function getLifeStageByDays(ageDays) {
    let stage = LIFE_STAGES[0];
    for (const s of LIFE_STAGES) {
        if (ageDays >= s.minDays) stage = s;
        else break;
    }
    return stage;
}

// Возраст ребёнка в RP-днях (null если нет дат)
export function getAgeDays(child, rpIso) {
    if (!child?.birthRpDate || !rpIso) return null;
    const birthMs = new Date(child.birthRpDate).getTime();
    const nowMs = new Date(rpIso).getTime();
    if (isNaN(birthMs) || isNaN(nowMs) || nowMs < birthMs) return null;
    return Math.floor((nowMs - birthMs) / DAY_MS);
}

// «Сейчас» для расчёта возраста: RP-дата чата, а пока её нет — реальное время
// (малыши, добавленные до первой RP-даты, якорятся к реальным часам, поэтому
// возраст не должен показывать «—» в новых чатах без RP_DATE-тега).
export function ageRefIso(p) {
    return p?.rpDate || new Date().toISOString();
}

// Стадия конкретного ребёнка (по датам; фолбэк на сохранённое поле stage)
export function getStageOf(child, rpIso) {
    const ageDays = getAgeDays(child, rpIso);
    if (ageDays !== null) return getLifeStageByDays(ageDays);
    if (child?.stage) {
        const idx = stageIndex(child.stage);
        if (idx >= 0) return LIFE_STAGES[idx];
    }
    return null;
}

export function ruYears(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'год';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'года';
    return 'лет';
}

export function formatAgeRu(days) {
    // >100 лет — битые даты (RP-дата из другой эпохи), не пугаем цифрой
    if (days === null || days === undefined || days < 0 || days > 36500) return '—';
    if (days < 30) return days <= 7 ? 'новорожд.' : `${days} дн.`;
    const months = Math.floor(days / 30.44);
    if (months < 12) return `${months} мес.`;
    const years = Math.floor(days / 365.25);
    const remMonths = Math.floor((days - years * 365.25) / 30.44);
    return remMonths > 0 ? `${years} ${ruYears(years)} ${remMonths} мес.` : `${years} ${ruYears(years)}`;
}

export function formatAgeEn(days) {
    if (days === null || days === undefined || days < 0 || days > 36500) return 'unknown';
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30.44);
    if (months < 12) return `${months}m`;
    const years = Math.floor(days / 365.25);
    const remMonths = Math.floor((days - years * 365.25) / 30.44);
    return remMonths > 0 ? `${years}y ${remMonths}m` : `${years}y`;
}

// Все дети семьи: активные (инфоблок) + выросшие (архив)
export function getAllChildren(p) {
    const out = [];
    if (Array.isArray(p?.babies)) {
        p.babies.forEach((child, index) => out.push({ child, origin: 'active', index }));
    }
    if (Array.isArray(p?.grownChildren)) {
        p.grownChildren.forEach((child, index) => out.push({ child, origin: 'grown', index }));
    }
    return out;
}

// ─── Тихая инициализация стадий для детей из старых сохранений ───
// Дети, созданные до появления family-модуля, не имеют поля stage.
// Ставим им ВЫЧИСЛЕННУЮ стадию без диалогов — иначе при первом же
// сообщении посыпался бы каскад «Миша теперь подросток!» за все
// пропущенные стадии сразу.
export function ensureStages(p) {
    let changed = false;
    for (const { child, origin } of getAllChildren(p)) {
        if (child.stage && stageIndex(child.stage) >= 0) continue;
        const stage = getStageOf(child, p.rpDate);
        child.stage = stage ? stage.id : (origin === 'grown' ? 'child' : 'newborn');
        changed = true;
    }
    return changed;
}

// ─── Переходы стадий: у кого вычисленная стадия обогнала сохранённую ───
// Возвращает события; состояние НЕ меняет (это делает applyStageUps после диалога).
export function collectStageUps(p) {
    const events = [];
    for (const entry of getAllChildren(p)) {
        const { child } = entry;
        if (!child.stage) continue; // ещё не инициализирован — ensureStages разберётся
        const storedIdx = stageIndex(child.stage);
        const ageDays = getAgeDays(child, p.rpDate);
        if (ageDays === null || storedIdx < 0) continue;
        const computed = getLifeStageByDays(ageDays);
        if (stageIndex(computed.id) > storedIdx) {
            events.push({
                ...entry,
                fromStage: LIFE_STAGES[storedIdx],
                toStage: computed,
                ageDays,
            });
        }
    }
    return events;
}

// Применить переходы: обновить stage, добавить выбранную черту (choices[i] — строка или null)
export function applyStageUps(p, events, choices = []) {
    events.forEach((ev, i) => {
        const child = ev.child;
        child.stage = ev.toStage.id;
        const trait = (choices[i] || '').trim();
        if (trait) {
            if (!Array.isArray(child.personality)) child.personality = [];
            if (!child.personality.includes(trait)) child.personality.push(trait);
        }
        if (Array.isArray(child.milestones)) {
            child.milestones.push({
                text: `нов. стадия: ${ev.toStage.label}`,
                rpDate: p.rpDate || null,
                date: new Date().toISOString(),
            });
        }
        console.log(`[Reproductive] Stage up: ${child.name || 'child'} ${ev.fromStage.id} → ${ev.toStage.id}${trait ? ` (+trait: ${trait})` : ''}`);
    });
}

// Случайные черты-предложения для стадии
export function suggestTraits(stageId, n = 3) {
    const pool = STAGE_TRAIT_POOLS[stageId] || STAGE_TRAIT_POOLS.child;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
}

// ─── Дни рождения ───
// Пересечение годовщины рождения за прошедшие daysPassed RP-дней.
// Мутирует child._lastBdayCelebrated (анти-дубль), вызывающий сохраняет настройки.
export function collectBirthdays(p, daysPassed) {
    if (!p?.rpDate || !daysPassed || daysPassed <= 0) return [];
    const newMs = new Date(p.rpDate).getTime();
    if (isNaN(newMs)) return [];
    const oldMs = newMs - daysPassed * DAY_MS;
    const out = [];
    for (const { child } of getAllChildren(p)) {
        if (!child.birthRpDate) continue;
        const birthMs = new Date(child.birthRpDate).getTime();
        if (isNaN(birthMs)) continue;
        const yearsOld = Math.floor((oldMs - birthMs) / YEAR_MS);
        const yearsNew = Math.floor((newMs - birthMs) / YEAR_MS);
        if (yearsNew > yearsOld && yearsNew >= 1 && (child._lastBdayCelebrated || 0) < yearsNew) {
            child._lastBdayCelebrated = yearsNew;
            out.push({ child, name: child.name || 'малыш', years: yearsNew });
        }
    }
    return out;
}

// Дети, у которых день рождения ИМЕННО в текущую RP-дату (для промпта)
export function getTodaysBirthdays(p) {
    if (!p?.rpDate) return [];
    const now = new Date(p.rpDate);
    if (isNaN(now.getTime())) return [];
    const out = [];
    for (const { child } of getAllChildren(p)) {
        if (!child.birthRpDate) continue;
        const b = new Date(child.birthRpDate);
        if (isNaN(b.getTime())) continue;
        const years = now.getFullYear() - b.getFullYear();
        if (years >= 1 && b.getDate() === now.getDate() && b.getMonth() === now.getMonth()) {
            out.push({ child, name: child.name || 'the child', years });
        }
    }
    return out;
}

// ═══ Случайные события детей (Sims-style) ═══
// Пулы по стадиям жизни. ru — уведомление/хроника, en — строка в промпт,
// days — сколько RP-дней событие «живёт» в промпте.
export const FAMILY_EVENT_POOLS = {
    newborn: [
        { id: 'colic_night', ru: 'колики — ночь без сна', en: 'has colic — the whole family barely slept tonight', days: 1 },
        { id: 'first_smile', ru: 'первая улыбка!', en: 'smiled for the very first time today', days: 1 },
        { id: 'growth_spurt', ru: 'скачок роста — ест без остановки', en: 'is having a growth spurt — feeding constantly, extra fussy', days: 2 },
    ],
    infant: [
        { id: 'tooth', ru: 'режется первый зубик', en: 'is teething — a first tooth is coming through, fussy and drooling', days: 3 },
        { id: 'cold', ru: 'простудился(ась)', en: 'caught a mild cold — sniffles, needs extra care', days: 3 },
        { id: 'babble_name', ru: 'почти сказал(а) первое слово', en: 'is babbling something that sounds almost like a first word', days: 1 },
        { id: 'food_mess', ru: 'устроил(а) хаос с прикормом', en: 'made a spectacular mess with food — it is everywhere', days: 1 },
    ],
    toddler: [
        { id: 'tantrum', ru: 'истерика на ровном месте', en: 'is having dramatic tantrums over tiny things', days: 1 },
        { id: 'wall_art', ru: 'разрисовал(а) стены', en: 'drew all over the walls with whatever they could find', days: 1 },
        { id: 'lost_toy', ru: 'потерял(а) любимую игрушку', en: 'lost their favorite toy and is heartbroken until it is found', days: 2 },
        { id: 'dark_fear', ru: 'боится темноты', en: 'suddenly became afraid of the dark — wants to sleep with parents', days: 3 },
        { id: 'why_marathon', ru: 'марафон «почему?»', en: 'asks "why?" about absolutely everything today', days: 1 },
        { id: 'cold', ru: 'простудился(ась)', en: 'caught a cold — runny nose, mild fever, needs care', days: 3 },
    ],
    child: [
        { id: 'bad_grade', ru: 'принёс(ла) двойку', en: 'got a bad grade at school and is nervous about telling the parents', days: 1 },
        { id: 'good_grade', ru: 'грамота в школе!', en: 'earned an award at school and is bursting with pride', days: 1 },
        { id: 'friend_fight', ru: 'поссорился(ась) с другом', en: 'had a falling-out with their best friend and is moping', days: 2 },
        { id: 'school_play', ru: 'школьный утренник', en: 'has a school performance coming — rehearsing a part, wants the family to attend', days: 2 },
        { id: 'lost_tooth', ru: 'выпал молочный зуб', en: 'lost a baby tooth — tooth fairy expectations are high', days: 1 },
        { id: 'stray_kitten', ru: 'принёс(ла) бездомного котёнка', en: 'brought home a stray kitten and is begging to keep it', days: 2 },
        { id: 'scraped_knee', ru: 'разбил(а) коленку', en: 'scraped a knee playing outside — tears, a bandage and a story of heroism', days: 1 },
    ],
    teen: [
        { id: 'first_crush', ru: 'первая влюблённость', en: 'has a first crush and is acting mysterious about it', days: 4 },
        { id: 'parent_fight', ru: 'бунтует против родителей', en: 'is clashing with the parents — doors slam, "you don\'t understand me"', days: 2 },
        { id: 'party', ru: 'просится на вечеринку', en: 'is begging to go to a party at a friend\'s place', days: 1 },
        { id: 'exams', ru: 'готовится к экзаменам', en: 'is stressed preparing for exams — needs support', days: 4 },
        { id: 'new_crowd', ru: 'новая компания', en: 'is hanging out with a new crowd the parents haven\'t met yet', days: 3 },
        { id: 'secret_diary', ru: 'завёл(а) тайный дневник', en: 'started keeping a secret diary and guards it fiercely', days: 2 },
    ],
};

// Движок: истечение активных событий + шанс нового (одно на ребёнка за раз,
// кулдаун 3 RP-дня после окончания). chancePerDay — вероятность в день (0..0.5).
// Мутирует child.activeEvent / child._lastEventEndRp; вызывающий сохраняет.
export function processFamilyEvents(p, daysPassed, chancePerDay) {
    const started = [];
    const ended = [];
    if (!p?.rpDate || !daysPassed || daysPassed <= 0 || !chancePerDay) return { started, ended };
    const nowMs = new Date(p.rpDate).getTime();
    if (isNaN(nowMs)) return { started, ended };

    for (const { child } of getAllChildren(p)) {
        // Активное событие: проверяем истечение
        if (child.activeEvent) {
            const startMs = new Date(child.activeEvent.startRpDate || 0).getTime();
            const days = child.activeEvent.days || 2;
            if (isNaN(startMs) || (nowMs - startMs) / DAY_MS >= days) {
                ended.push({ child, event: child.activeEvent });
                child._lastEventEndRp = p.rpDate;
                child.activeEvent = null;
            }
            continue; // новое событие — не раньше следующего продвижения времени
        }
        // Кулдаун после прошлого события
        if (child._lastEventEndRp) {
            const endMs = new Date(child._lastEventEndRp).getTime();
            if (!isNaN(endMs) && (nowMs - endMs) / DAY_MS < 3) continue;
        }
        const stage = getStageOf(child, p.rpDate);
        const pool = stage ? FAMILY_EVENT_POOLS[stage.id] : null;
        if (!pool || pool.length === 0) continue;
        // Вероятность хотя бы одного события за daysPassed дней (капим окно 14 дн.)
        const pDay = Math.max(0, Math.min(0.5, chancePerDay));
        const prob = 1 - Math.pow(1 - pDay, Math.min(daysPassed, 14));
        if (Math.random() < prob) {
            const ev = pool[Math.floor(Math.random() * pool.length)];
            child.activeEvent = { id: ev.id, ru: ev.ru, en: ev.en, days: ev.days, startRpDate: p.rpDate };
            started.push({ child, event: child.activeEvent });
        }
    }
    return { started, ended };
}

// ═══ Семейная хроника ═══
// Журнал событий семьи (дни рождения, случайные события и т.п.). Рождения,
// вехи и взросления НЕ дублируются сюда — buildChronicleEntries собирает их
// из данных детей напрямую (источник правды).
export function logChronicle(p, icon, text) {
    if (!Array.isArray(p.familyChronicle)) p.familyChronicle = [];
    p.familyChronicle.push({
        rpDate: p.rpDate || null,
        date: new Date().toISOString(),
        icon: icon || 'fa-star',
        text: String(text).slice(0, 200),
    });
    if (p.familyChronicle.length > 300) {
        p.familyChronicle.splice(0, p.familyChronicle.length - 300);
    }
}

// Собрать полную ленту: рождения/вехи/взросления из данных детей + журнал.
// Возвращает [{rpDate, icon, text}] по возрастанию даты.
export function buildChronicleEntries(p) {
    const entries = [];
    for (const { child } of getAllChildren(p)) {
        const nm = child.name || 'малыш';
        const fem = child.sex === 'F';
        if (child.birthRpDate) {
            entries.push({ rpDate: child.birthRpDate, icon: 'fa-baby', text: `Родил${fem ? 'ась' : 'ся'} ${nm}` });
        }
        for (const m of (child.milestones || [])) {
            if (m?.text) entries.push({ rpDate: m.rpDate || null, icon: 'fa-star', text: `${nm}: ${m.text}` });
        }
        if (child.graduatedRpDate) {
            entries.push({ rpDate: child.graduatedRpDate, icon: 'fa-child-reaching', text: `${nm}: вырос(ла) из младенческого трекинга` });
        }
    }
    for (const e of (p.familyChronicle || [])) {
        entries.push({ rpDate: e.rpDate, icon: e.icon || 'fa-star', text: e.text });
    }
    entries.sort((a, b) => new Date(a.rpDate || 0).getTime() - new Date(b.rpDate || 0).getTime());
    return entries;
}

// ═══ Знак зодиака по RP-дате рождения (специя для карточек) ═══
// Порядок СТРОГО по стартовой дате внутри календарного года (январь → декабрь):
// getZodiac идёт с конца и берёт последний знак, чьё начало <= даты рождения.
const ZODIAC = [
    { from: [1, 20],  name: 'Водолей',  symbol: '♒' },
    { from: [2, 19],  name: 'Рыбы',     symbol: '♓' },
    { from: [3, 21],  name: 'Овен',     symbol: '♈' },
    { from: [4, 20],  name: 'Телец',    symbol: '♉' },
    { from: [5, 21],  name: 'Близнецы', symbol: '♊' },
    { from: [6, 21],  name: 'Рак',      symbol: '♋' },
    { from: [7, 23],  name: 'Лев',      symbol: '♌' },
    { from: [8, 23],  name: 'Дева',     symbol: '♍' },
    { from: [9, 23],  name: 'Весы',     symbol: '♎' },
    { from: [10, 23], name: 'Скорпион', symbol: '♏' },
    { from: [11, 22], name: 'Стрелец',  symbol: '♐' },
    { from: [12, 22], name: 'Козерог',  symbol: '♑' },
];

export function getZodiac(dateIso) {
    if (!dateIso) return null;
    const d = new Date(dateIso);
    if (isNaN(d.getTime())) return null;
    const m = d.getMonth() + 1;
    const day = d.getDate();
    // Идём с конца: последний знак, чья стартовая дата <= даты рождения
    for (let i = ZODIAC.length - 1; i >= 0; i--) {
        const [zm, zd] = ZODIAC[i].from;
        if (m > zm || (m === zm && day >= zd)) return ZODIAC[i];
    }
    // Даты до 20 января не прошли ни один порог — это хвост Козерога (22.12–19.01)
    return ZODIAC.find(z => z.name === 'Козерог');
}

// ═══ CHILD_UPDATE от модели: аккуратный мердж в профиль ребёнка ═══
// Правила: массивы (черты/внешность) ДОБАВЛЯЮТСЯ без дублей (до 10 шт.);
// глаза/волосы/особая черта заполняются ТОЛЬКО если пусты — ручной профиль
// юзера главнее; note дописывается в лор (child.notes, кап 400).
// Возвращает { child, changes: [строки RU] } или null, состояние сохраняет вызывающий.
export function applyChildUpdate(p, upd) {
    if (!upd) return null;
    const wanted = String(upd.name || upd.label || '').trim().toLowerCase();
    if (!wanted) return null;
    let target = null;
    for (const { child } of getAllChildren(p)) {
        const nm = String(child.name || '').trim().toLowerCase();
        if (nm && (nm === wanted || nm.startsWith(wanted) || wanted.startsWith(nm))) { target = child; break; }
    }
    if (!target) return null;

    const changes = [];
    const norm = (v, n) => String(v).trim().slice(0, n);
    const toArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? v.split(',') : []);
    const addUnique = (field, items, label) => {
        if (!items.length) return;
        if (!Array.isArray(target[field])) target[field] = [];
        for (let it of items) {
            it = norm(it, 40);
            if (!it) continue;
            const exists = target[field].some(x => String(x).trim().toLowerCase() === it.toLowerCase());
            if (!exists && target[field].length < 10) {
                target[field].push(it);
                changes.push(`${label}: ${it}`);
            }
        }
    };
    addUnique('personality', toArr(upd.add_personality ?? upd.personality), 'черта');
    addUnique('appearance', toArr(upd.add_appearance ?? upd.appearance), 'внешность');
    if (upd.eyes && !target.eyes) { target.eyes = norm(upd.eyes, 80); changes.push(`глаза: ${target.eyes}`); }
    if (upd.hair && !target.hair) { target.hair = norm(upd.hair, 80); changes.push(`волосы: ${target.hair}`); }
    const hasSpecial = !!(target.special?.name || (typeof target.special === 'string' && target.special));
    if (upd.special && !hasSpecial) {
        target.special = { name: norm(upd.special, 80) };
        changes.push(`особая черта: ${target.special.name}`);
    }
    if (upd.note) {
        const note = norm(upd.note, 200);
        const existing = String(target.notes || '');
        if (note && !existing.toLowerCase().includes(note.toLowerCase())) {
            target.notes = (existing ? existing + ' | ' : '') + note;
            if (target.notes.length > 400) target.notes = target.notes.slice(-400);
            changes.push(`заметка: ${note}`);
        }
    }
    if (changes.length === 0) return null;
    return { child: target, changes };
}

// ═══ Близнецы: дети с одинаковой RP-датой рождения (специя) ═══
// Возвращает группы entries по 2+ ребёнка, рождённых в один день.
export function findTwinGroups(p) {
    const byDate = new Map();
    for (const entry of getAllChildren(p)) {
        const d = entry.child.birthRpDate ? String(entry.child.birthRpDate).slice(0, 10) : null;
        if (!d) continue;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(entry);
    }
    return [...byDate.values()].filter(g => g.length >= 2);
}

// Особая черта «растёт» вместе с ребёнком: та же черта, но подача по стадии
// (младенец «подаёт первые признаки» → взрослый «мастер»). EN — идёт в промпт.
const SPECIAL_STAGE_FLAVOR = {
    newborn: 'the first flickers of it are already noticeable',
    infant:  'early signs of it are showing',
    toddler: 'it shows more clearly every day',
    child:   'actively developing this gift',
    teen:    'the gift is blossoming into real skill',
    adult:   'a fully developed talent',
};

// ─── Блок семьи для промпта (EN, стадийно-осознанный) ───
// Заменяет прежние списки [FAMILY — CHILDREN] и [OLDER CHILDREN] в prompts.js.
export function buildFamilyPromptBlock(p) {
    const all = getAllChildren(p);
    if (all.length === 0) return '';

    const sexT = (s) => s === 'M' ? 'boy' : s === 'F' ? 'girl' : 'child';
    const usedStages = new Set();
    // Омегаверс: вторичный пол детей и роли родителей (p.universe — строка, без импорта omegaverse)
    const omegaUni = p.universe === 'omegaverse';

    const nowRef = ageRefIso(p);
    let block = `\n[FAMILY — CHILDREN]\n`;
    all.forEach(({ child, origin }, i) => {
        const ageDays = getAgeDays(child, nowRef);
        const stage = getStageOf(child, nowRef);
        if (stage) usedStages.add(stage.id);
        block += `Child ${i + 1}: ${child.name || 'unnamed'} (${sexT(child.sex)}, ${formatAgeEn(ageDays)}${stage ? `, stage: ${stage.labelEn}` : ''})`;
        // Профиль: глаза/волосы отдельными полями — модель ОБЯЗАНА их помнить
        if (child.eyes) block += ` | Eyes: ${child.eyes}`;
        if (child.hair) block += ` | Hair: ${child.hair}`;
        if (child.personality?.length) block += ` | Personality: ${child.personality.join(', ')}`;
        if (child.appearance?.length) block += ` | Appearance: ${child.appearance.join(', ')}`;
        const specialName = child.special?.name || (typeof child.special === 'string' ? child.special : '');
        if (specialName) {
            const flavor = stage ? SPECIAL_STAGE_FLAVOR[stage.id] : '';
            block += ` | Special: ${specialName}${flavor ? ` (${flavor})` : ''}`;
        }
        if (omegaUni) {
            if (child.designation) block += ` | Secondary gender: ${String(child.designation).toUpperCase()}`;
            else block += ` | not yet presented`;
        }
        if (child.fatherName) block += ` | Father: ${child.fatherName}${omegaUni && child.fatherDesignation ? ` (${child.fatherDesignation})` : ''}`;
        if (child.motherName) block += ` | Mother: ${child.motherName}${omegaUni && child.motherDesignation ? ` (${child.motherDesignation}, carrier)` : ''}`;
        if (origin === 'grown') block += ` | (no infant tracking — still in the family)`;
        block += `\n`;
        // Свободный лор ребёнка (из профиля) — вторая строка, чтобы не раздувать первую
        if (child.notes) block += `  Lore: ${String(child.notes).slice(0, 400)}\n`;
    });

    // Активные случайные события — модель вплетает их в сцену
    for (const { child } of all) {
        if (child.activeEvent?.en) {
            block += `[FAMILY EVENT] ${child.name || 'the child'} ${child.activeEvent.en} — weave it into the scene naturally.\n`;
        }
    }

    // Близнецовая связь — парная специя
    for (const group of findTwinGroups(p)) {
        const names = group.map(g => g.child.name || 'unnamed').join(' & ');
        block += `[TWIN BOND] ${names} are ${group.length === 2 ? 'twins' : 'multiples'} — they share an uncanny bond, sense each other's moods and often act in sync.\n`;
    }

    // Омегаверс: правило презентации для непрезентованных детей
    if (omegaUni && all.some(({ child }) => !child.designation)) {
        block += `[A/B/O] Children PRESENT their secondary gender (alpha/beta/omega) in their early teens. Before presentation a child is indistinguishable from a beta and must NOT show alpha/omega traits.\n`;
    }

    if (usedStages.size > 0) {
        block += `[STAGE GUIDE — play each child true to their stage]\n`;
        for (const id of usedStages) {
            if (STAGE_PROMPT_HINTS[id]) block += `${id}: ${STAGE_PROMPT_HINTS[id]}\n`;
        }
    }

    const bdays = getTodaysBirthdays(p);
    for (const b of bdays) {
        block += `[BIRTHDAY TODAY] ${b.name} turns ${b.years} TODAY — weave the celebration into the scene naturally!\n`;
    }

    return block;
}
