// ═══════════════════════════════════════════
// HELPERS — чистые функции без зависимостей
// (НЕ импортировать state.js: omegaverse.js → helpers.js тестируются в node,
//  а state тянет extensions.js из SillyTavern)
// ═══════════════════════════════════════════

export function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── Автодетект языка чата (по последним сообщениям) ───
// Считаем кириллицу vs латиницу в последних 5 непустых сообщениях.
// Нужен, чтобы промпт требовал значения тегов на языке истории,
// а не на дефолтном английском модели.
export function detectChatLanguage() {
    try {
        const chat = typeof SillyTavern?.getContext === 'function'
            ? SillyTavern.getContext().chat : null;
        if (!chat || chat.length === 0) return 'ru';
        let cyr = 0, lat = 0, checked = 0;
        for (let i = chat.length - 1; i >= 0 && checked < 5; i--) {
            const m = chat[i];
            if (!m || !m.mes || m.is_system) continue;
            checked++;
            const sample = m.mes.slice(0, 1500);
            cyr += (sample.match(/[а-яё]/gi) || []).length;
            lat += (sample.match(/[a-z]/gi) || []).length;
        }
        if (cyr === 0 && lat === 0) return 'ru';
        return cyr >= lat ? 'ru' : 'en';
    } catch (e) {
        return 'ru';
    }
}

// ─── Фолбэк-перевод типовых английских значений статуса → русский ───
// Модели иногда игнорируют требование языка и пишут "High"/"Anxious".
// Инфоблок переводит известные односложные значения, незнакомые оставляет как есть.
const STATUS_EN_RU = {
    'high': 'Высокая', 'low': 'Низкая', 'medium': 'Средняя', 'average': 'Средняя',
    'normal': 'Норма', 'ok': 'Норма', 'good': 'Хорошо', 'bad': 'Плохо', 'none': 'Нет',
    'very high': 'Очень высокая', 'very low': 'Очень низкая',
    'anxious': 'Тревожное', 'worried': 'Встревоженное', 'nervous': 'Нервозное',
    'calm': 'Спокойное', 'relaxed': 'Расслабленное', 'neutral': 'Нейтральное',
    'happy': 'Радостное', 'joyful': 'Радостное', 'sad': 'Грустное', 'upset': 'Расстроенное',
    'scared': 'Испуганное', 'afraid': 'Испуганное', 'angry': 'Злое', 'irritated': 'Раздражённое',
    'excited': 'Взволнованное', 'playful': 'Игривое', 'flirty': 'Кокетливое',
    'tired': 'Усталость', 'exhausted': 'Измотанность', 'energetic': 'Энергичное',
    'sleepy': 'Сонливость', 'hungry': 'Голод', 'nauseous': 'Тошнота',
    'cold': 'Холодно', 'warm': 'Тепло', 'hot': 'Жарко', 'freezing': 'Замёрзла',
    'wet': 'Промокла', 'sore': 'Болезненность', 'aching': 'Ломота',
    'horny': 'Возбуждённое', 'aroused': 'Возбуждённое',
    'sleeping': 'Спит', 'awake': 'Бодрствует', 'crying': 'Плачет', 'fussy': 'Капризный',
    'content': 'Довольный', 'breastfeeding': 'Грудное', 'formula': 'Смесь',
    'sensitive': 'Чувствительность', 'sensitivity': 'Чувствительность',
};

export function translateStatusValue(val) {
    if (!val || typeof val !== 'string') return val;
    const key = val.trim().toLowerCase();
    return STATUS_EN_RU[key] || val;
}

export function parseReproBlock(raw) {
    const result = {};
    for (const line of raw.split('\n')) {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const key = line.substring(0, idx).trim().toLowerCase().replace(/\s+/g, '_');
        const val = line.substring(idx + 1).trim();
        if (key && val) result[key] = val;
    }
    return result;
}

export function getSeededRandomSymptoms(arr, count, seed) {
    function seededRandom(s) {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
    }
    const indexed = arr.map((item, idx) => ({ item, idx }));
    indexed.sort((a, b) => {
        return seededRandom(seed * 1000 + a.idx) - seededRandom(seed * 1000 + b.idx);
    });
    return indexed.slice(0, count).map(x => x.item).join(', ');
}

export function roll(max = 100) {
    return Math.floor(Math.random() * max) + 1;
}

export function getPhaseInfo(day, lang = 'ru') {
    const L = lang === 'en';
    if (day <= 5) return { name: L ? 'Menstruation' : 'Менструация', icon: 'fa-droplet', color: '#ff4444' };
    if (day <= 11) return { name: L ? 'Follicular' : 'Фолликулярная', icon: 'fa-seedling', color: '#66bb6a' };
    if (day <= 16) return { name: L ? 'Ovulation' : 'Овуляция', icon: 'fa-fire', color: '#ff6b6b' };
    return { name: L ? 'Luteal' : 'Лютеиновая', icon: 'fa-moon', color: '#ffd43b' };
}

export function getCycleModifier(day) {
    if (day >= 12 && day <= 16) return 1.65;
    if (day >= 8 && day <= 11) return 0.5;
    return 0.25;
}

export function calculateWeeksFromDates(conceptionDate, rpDate, fallbackWeeks = 0) {
    if (conceptionDate && rpDate) {
        const rpTime = new Date(rpDate).getTime();
        const conceptionTime = new Date(conceptionDate).getTime();
        const diffMs = rpTime - conceptionTime;
        if (diffMs >= 0) {
            const totalDays = Math.floor(diffMs / 86400000);
            return { weeks: Math.floor(totalDays / 7), days: totalDays % 7 };
        }
        // rpDate < conceptionDate — broken state (e.g. real-world conceptionDate vs RP rpDate).
        // Don't fall back to stale pregnancyWeeks (would mask the bug). Return 0; caller's
        // clamp logic in processDateTag will fix conceptionDate on next RP_DATE tag.
        return { weeks: 0, days: 0 };
    }
    return { weeks: fallbackWeeks, days: 0 };
}

export function getSymptomsForProgress(progressPercent, weeks, lang = 'ru') {
    const L = lang === 'en';
    let pool, count;
    if (progressPercent <= 10) {
        pool = L
            ? ['missed period', 'mild morning nausea', 'increased fatigue', 'mood swings', 'heightened sense of smell', 'tingling in breasts', 'daytime drowsiness', 'mild lower abdominal cramps']
            : ['задержка менструации', 'лёгкая тошнота по утрам', 'повышенная усталость', 'перепады настроения', 'обострение обоняния', 'покалывание в груди', 'сонливость днём', 'лёгкие спазмы внизу живота'];
        count = 3;
    } else if (progressPercent <= 20) {
        pool = L
            ? ['morning sickness (nausea/vomiting)', 'breast tenderness', 'frequent urination', 'metallic taste in mouth', 'aversion to smells', 'dizziness', 'constipation', 'emotional instability']
            : ['токсикоз (тошнота/рвота)', 'чувствительность груди', 'частое мочеиспускание', 'металлический привкус во рту', 'отвращение к запахам', 'головокружение', 'запоры', 'эмоциональная нестабильность'];
        count = 4;
    } else if (progressPercent <= 30) {
        pool = L
            ? ['belly starts to show', 'morning sickness fading', 'mood swings', 'skin pigmentation', 'visible veins on breasts', 'increased appetite', 'shortness of breath on stairs']
            : ['живот начинает округляться', 'токсикоз ослабевает', 'эмоциональные перепады', 'пигментация кожи', 'венозная сетка на груди', 'повышенный аппетит', 'одышка при подъёме'];
        count = 4;
    } else if (progressPercent <= 40) {
        pool = L
            ? ['first fetal movements', 'libido increases', 'energy returns', 'breasts enlarging', 'thicker hair', 'leg cramps', 'nasal congestion']
            : ['первые шевеления плода', 'либидо возрастает', 'энергия возвращается', 'грудь увеличивается', 'волосы гуще', 'судороги в икрах', 'заложенность носа'];
        count = 4;
    } else if (progressPercent <= 50) {
        pool = L
            ? ['noticeably larger belly', 'rapid heartbeat', 'stretch marks', 'colostrum from nipples', 'leg cramps', 'heartburn', 'darkening areolas']
            : ['живот заметно увеличен', 'учащённое сердцебиение', 'растяжки', 'молозиво из сосков', 'судороги в ногах', 'изжога', 'потемнение ареол'];
        count = 5;
    } else if (progressPercent <= 70) {
        pool = L
            ? ['heaviness in abdomen', 'swollen feet by evening', 'lower back pain', 'shortness of breath walking', 'heartburn', 'insomnia', 'active fetal kicks', 'varicose veins']
            : ['тяжесть в животе', 'отёки ног к вечеру', 'боли в пояснице', 'одышка при ходьбе', 'изжога', 'бессонница', 'активные толчки плода', 'варикоз'];
        count = 5;
    } else if (progressPercent <= 90) {
        pool = L
            ? ['severe fatigue', 'frequent bathroom trips', 'Braxton Hicks contractions', 'difficulty breathing', 'swelling', 'insomnia', 'pelvic pain', 'waddling gait']
            : ['сильная усталость', 'частые походы в туалет', 'тренировочные схватки', 'тяжело дышать', 'отёки', 'бессонница', 'боли в тазу', 'утиная походка'];
        count = 6;
    } else if (progressPercent <= 100) {
        pool = L
            ? ['belly has dropped', 'mucus plug discharge', 'contractions intensifying', 'water leaking', 'diarrhea', 'pulling pains', 'nesting instinct']
            : ['живот опустился', 'отхождение пробки', 'схватки учащаются', 'подтекание вод', 'диарея', 'тянущие боли', 'синдром гнездования'];
        count = 5;
    } else {
        return L ? 'OVERDUE — risk of complications' : 'ПЕРЕНАШИВАНИЕ — риск осложнений';
    }
    return getSeededRandomSymptoms(pool, count, weeks);
}

export function getRecommendationsForProgress(progressPercent, lang = 'ru') {
    const L = lang === 'en';
    if (progressPercent <= 10) return L ? 'Early stage, rest, proper nutrition' : 'Начальная стадия, отдых, правильное питание';
    if (progressPercent <= 20) return L ? 'First trimester, monitoring, small frequent meals' : 'Первый триместр, наблюдение, дробное питание';
    if (progressPercent <= 30) return L ? 'Weight control, vitamins, avoid overheating' : 'Контроль веса, витамины, избегать перегрева';
    if (progressPercent <= 40) return L ? 'Mid-term, sex can be determined, anti-stretch massage' : 'Середина срока, можно определить пол, массаж от растяжек';
    if (progressPercent <= 50) return L ? 'Belly support band, iron supplements, stretch mark cream' : 'Бандаж для живота, железо, крем от растяжек';
    if (progressPercent <= 70) return L ? 'Sleep on left side, rest, regular checkups' : 'Сон на левом боку, отдых, регулярное наблюдение';
    if (progressPercent <= 90) return L ? 'Birth preparation, exercises, frequent checkups' : 'Подготовка к родам, упражнения, частое наблюдение';
    if (progressPercent <= 100) return L ? 'BIRTH SOON — be ready!' : 'РОДЫ СКОРО — быть готовой!';
    return L ? 'URGENT — labor induction may be needed' : 'СРОЧНО — возможна стимуляция родов';
}

export function getFetusSizeForProgress(progressPercent, withIcon = false, lang = 'ru') {
    const L = lang === 'en';
    const sizes = L ? [
        [5,  'poppy seed (~1-2 mm)',         'fa-seedling'],
        [10, 'grain of rice (~5-10 mm)',     'fa-seedling'],
        [15, 'grape (~2-3 cm)',              'fa-lemon'],
        [20, 'lime (~5-6 cm)',               'fa-lemon'],
        [25, 'lemon (~7-8 cm)',              'fa-lemon'],
        [30, 'avocado (~10-12 cm)',          'fa-apple-whole'],
        [35, 'mango (~14-16 cm)',            'fa-apple-whole'],
        [40, 'banana (~18-20 cm)',           'fa-carrot'],
        [50, 'ear of corn (~25-28 cm)',      'fa-wheat-awn'],
        [60, 'eggplant (~30-35 cm)',         'fa-pepper-hot'],
        [70, 'zucchini (~38-40 cm)',         'fa-pepper-hot'],
        [80, 'honeydew melon (~42-45 cm)',   'fa-circle'],
        [90, 'watermelon (~45-48 cm)',       'fa-circle'],
    ] : [
        [5,  'маковое зёрнышко (~1-2 мм)',     'fa-seedling'],
        [10, 'рисовое зерно (~5-10 мм)',        'fa-seedling'],
        [15, 'виноградинка (~2-3 см)',           'fa-lemon'],
        [20, 'лайм (~5-6 см)',                   'fa-lemon'],
        [25, 'лимон (~7-8 см)',                  'fa-lemon'],
        [30, 'авокадо (~10-12 см)',              'fa-apple-whole'],
        [35, 'манго (~14-16 см)',                'fa-apple-whole'],
        [40, 'банан (~18-20 см)',                'fa-carrot'],
        [50, 'кукурузный початок (~25-28 см)',   'fa-wheat-awn'],
        [60, 'баклажан (~30-35 см)',             'fa-pepper-hot'],
        [70, 'кабачок (~38-40 см)',              'fa-pepper-hot'],
        [80, 'дыня (~42-45 см)',                 'fa-circle'],
        [90, 'арбуз (~45-48 см)',                'fa-circle'],
    ];
    for (const [threshold, text, icon] of sizes) {
        if (progressPercent <= threshold) {
            return withIcon ? `<i class="fa-solid ${icon}" style="opacity:0.5;font-size:9px"></i> ${text}` : text;
        }
    }
    const finalText = L ? 'full-term (~48-52 cm, 2.5-4 kg)' : 'доношенный (~48-52 см, 2.5-4 кг)';
    return withIcon ? `<i class="fa-solid fa-baby" style="opacity:0.5;font-size:9px"></i> ${finalText}` : finalText;
}

export function formatSexIcons(fetusSex, withText = false) {
    if (!fetusSex || fetusSex.length === 0) return '';
    return fetusSex.map(sex => {
        if (withText) return sex === 'M' ? '<i class="fa-solid fa-mars" style="color:#4dabf7"></i> мальчик' : '<i class="fa-solid fa-venus" style="color:#ff9ff3"></i> девочка';
        return sex === 'M' ? '<i class="fa-solid fa-mars" style="color:#4dabf7"></i>' : '<i class="fa-solid fa-venus" style="color:#ff9ff3"></i>';
    }).join(withText ? ', ' : ' ');
}

export function formatFetusCount(count, style = 'short', lang = 'ru') {
    const L = lang === 'en';
    if (style === 'instrumental') {
        return L
            ? (count === 1 ? 'single fetus' : count === 2 ? 'twins' : 'triplets')
            : (count === 1 ? 'одним плодом' : count === 2 ? 'двойней' : 'тройней');
    }
    if (style === 'full') {
        return L
            ? (count === 1 ? '1 fetus' : count === 2 ? '2 fetuses (twins)' : '3 fetuses (triplets)')
            : (count === 1 ? '1 плод' : count === 2 ? '2 плода (двойня)' : '3 плода (тройня)');
    }
    return L
        ? (count === 1 ? '1 fetus' : count === 2 ? 'Twins' : 'Triplets')
        : (count === 1 ? '1 плод' : count === 2 ? 'Двойня' : 'Тройня');
}

export function getHealthInfo(healthStatus, lang = 'ru') {
    const L = lang === 'en';
    if (healthStatus === 'warning') return { text: L ? 'Needs attention' : 'Требует внимания', icon: 'fa-triangle-exclamation', color: '#ffaa00' };
    if (healthStatus === 'critical') return { text: L ? 'CRITICAL' : 'КРИТИЧЕСКОЕ', icon: 'fa-circle-exclamation', color: '#ff4444' };
    return { text: L ? 'Normal' : 'Норма', icon: 'fa-circle-check', color: '#00e676' };
}

// ─── Complication definitions (one-time roll at conception) ───

const COMPLICATIONS = {
    early: [
        { type: 'Угроза выкидыша', severity: 'critical', chance: 8, weekMin: 4, weekMax: 12 },
        { type: 'Сильный токсикоз', severity: 'warning', chance: 15, weekMin: 5, weekMax: 12 },
        { type: 'Низкий прогестерон', severity: 'warning', chance: 10, weekMin: 4, weekMax: 10 },
    ],
    mid: [
        { type: 'Гестационный диабет', severity: 'warning', chance: 10, weekMin: 14, weekMax: 26 },
        { type: 'Анемия', severity: 'warning', chance: 12, weekMin: 14, weekMax: 26 },
        { type: 'Предлежание плаценты', severity: 'critical', chance: 5, weekMin: 16, weekMax: 24 },
        { type: 'Истмико-цервикальная недостаточность', severity: 'critical', chance: 4, weekMin: 14, weekMax: 22 },
    ],
    late: [
        { type: 'Преэклампсия', severity: 'critical', chance: 8, weekMin: 28, weekMax: 38 },
        { type: 'Тазовое предлежание', severity: 'warning', chance: 12, weekMin: 30, weekMax: 37 },
        { type: 'Маловодие', severity: 'warning', chance: 7, weekMin: 28, weekMax: 38 },
        { type: 'Многоводие', severity: 'warning', chance: 5, weekMin: 28, weekMax: 38 },
        { type: 'Преждевременные схватки', severity: 'critical', chance: 6, weekMin: 28, weekMax: 36 },
    ],
};

/**
 * Roll ALL complications at conception. Each complication is rolled once:
 * either it will happen at a specific week, or it won't happen at all.
 */
export function rollPlannedComplications() {
    const planned = [];
    const allPools = [...COMPLICATIONS.early, ...COMPLICATIONS.mid, ...COMPLICATIONS.late];
    for (const comp of allPools) {
        if (roll(100) <= comp.chance) {
            const week = comp.weekMin + Math.floor(Math.random() * (comp.weekMax - comp.weekMin + 1));
            planned.push({
                type: comp.type,
                severity: comp.severity,
                revealWeek: week,
                revealed: false,
            });
            console.log(`[Reproductive] Planned complication: ${comp.type} at week ${week}`);
        }
    }
    return planned;
}
