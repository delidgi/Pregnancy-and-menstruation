// ═══════════════════════════════════════════
// HELPERS — чистые функции без зависимостей
// ═══════════════════════════════════════════

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

export function getPhaseInfo(day) {
    if (day <= 5) return { name: 'Менструация', emoji: '🔴', icon: 'fa-droplet', color: '#ff4444' };
    if (day <= 11) return { name: 'Фолликулярная', emoji: '🌱', icon: 'fa-seedling', color: '#66bb6a' };
    if (day <= 16) return { name: 'Овуляция', emoji: '🔥', icon: 'fa-fire', color: '#ff6b6b' };
    return { name: 'Лютеиновая', emoji: '🌙', icon: 'fa-moon', color: '#ffd43b' };
}

export function getCycleModifier(day) {
    if (day >= 12 && day <= 16) return 1.65;
    if (day >= 8 && day <= 11) return 0.5;
    if (day >= 17) return 0.25;
    return 0.25;
}

export function calculateWeeksFromDates(conceptionDate, rpDate, fallbackWeeks = 0) {
    if (conceptionDate && rpDate) {
        const rpTime = new Date(rpDate).getTime();
        const conceptionTime = new Date(conceptionDate).getTime();
        const diffMs = rpTime - conceptionTime;
        if (diffMs > 0) {
            const totalDays = Math.floor(diffMs / 86400000);
            return { weeks: Math.floor(totalDays / 7), days: totalDays % 7 };
        }
    }
    return { weeks: fallbackWeeks, days: 0 };
}

export function getSymptomsForProgress(progressPercent, weeks) {
    let pool, count;
    if (progressPercent <= 10) {
        pool = ['задержка менструации', 'лёгкая тошнота по утрам', 'повышенная усталость', 'перепады настроения', 'обострение обоняния', 'покалывание в груди', 'сонливость днём', 'лёгкие спазмы внизу живота'];
        count = 3;
    } else if (progressPercent <= 20) {
        pool = ['токсикоз (тошнота/рвота)', 'чувствительность груди', 'частое мочеиспускание', 'металлический привкус во рту', 'отвращение к запахам', 'головокружение', 'запоры', 'эмоциональная нестабильность'];
        count = 4;
    } else if (progressPercent <= 30) {
        pool = ['живот начинает округляться', 'токсикоз ослабевает', 'эмоциональные перепады', 'пигментация кожи', 'венозная сетка на груди', 'повышенный аппетит', 'одышка при подъёме'];
        count = 4;
    } else if (progressPercent <= 40) {
        pool = ['первые шевеления плода', 'либидо возрастает', 'энергия возвращается', 'грудь увеличивается', 'волосы гуще', 'судороги в икрах', 'заложенность носа'];
        count = 4;
    } else if (progressPercent <= 50) {
        pool = ['живот заметно увеличен', 'учащённое сердцебиение', 'растяжки', 'молозиво из сосков', 'судороги в ногах', 'изжога', 'потемнение ареол'];
        count = 5;
    } else if (progressPercent <= 70) {
        pool = ['тяжесть в животе', 'отёки ног к вечеру', 'боли в пояснице', 'одышка при ходьбе', 'изжога', 'бессонница', 'активные толчки плода', 'варикоз'];
        count = 5;
    } else if (progressPercent <= 90) {
        pool = ['сильная усталость', 'частые походы в туалет', 'тренировочные схватки', 'тяжело дышать', 'отёки', 'бессонница', 'боли в тазу', 'утиная походка'];
        count = 6;
    } else if (progressPercent <= 100) {
        pool = ['живот опустился', 'отхождение пробки', 'схватки учащаются', 'подтекание вод', 'диарея', 'тянущие боли', 'синдром гнездования'];
        count = 5;
    } else {
        return '⚠️ ПЕРЕНАШИВАНИЕ! Риск осложнений';
    }
    return getSeededRandomSymptoms(pool, count, weeks);
}

export function getRecommendationsForProgress(progressPercent) {
    if (progressPercent <= 10) return 'Начальная стадия, отдых, правильное питание';
    if (progressPercent <= 20) return 'Первый триместр, наблюдение, дробное питание';
    if (progressPercent <= 30) return 'Контроль веса, витамины, избегать перегрева';
    if (progressPercent <= 40) return 'Середина срока, можно определить пол, массаж от растяжек';
    if (progressPercent <= 50) return 'Бандаж для живота, железо, крем от растяжек';
    if (progressPercent <= 70) return 'Сон на левом боку, отдых, регулярное наблюдение';
    if (progressPercent <= 90) return 'Подготовка к родам, упражнения, частое наблюдение';
    if (progressPercent <= 100) return 'РОДЫ СКОРО! Быть готовой!';
    return '⚠️ СРОЧНО! Возможна стимуляция родов';
}

export function getFetusSizeForProgress(progressPercent, withEmoji = false) {
    const sizes = [
        [5,  'маковое зёрнышко (~1-2 мм)',     'fa-seedling',    '🌱'],
        [10, 'рисовое зерно (~5-10 мм)',        'fa-grain-wheat', '🍚'],
        [15, 'виноградинка (~2-3 см)',           'fa-apple-whole', '🍇'],
        [20, 'лайм (~5-6 см)',                   'fa-lemon',       '🍋'],
        [25, 'лимон (~7-8 см)',                  'fa-lemon',       '🍋'],
        [30, 'авокадо (~10-12 см)',              'fa-apple-whole', '🥑'],
        [35, 'манго (~14-16 см)',                'fa-apple-whole', '🥭'],
        [40, 'банан (~18-20 см)',                'fa-banana',      '🍌'],
        [50, 'кукурузный початок (~25-28 см)',   'fa-wheat-awn',   '🌽'],
        [60, 'баклажан (~30-35 см)',             'fa-carrot',      '🍆'],
        [70, 'кабачок (~38-40 см)',              'fa-carrot',      '🥒'],
        [80, 'дыня (~42-45 см)',                 'fa-apple-whole', '🍈'],
        [90, 'арбуз (~45-48 см)',                'fa-circle',      '🍉'],
    ];
    for (const [threshold, text, icon, emoji] of sizes) {
        if (progressPercent <= threshold) {
            return withEmoji ? `${emoji} ${text}` : text;
        }
    }
    const finalText = 'доношенный (~48-52 см, 2.5-4 кг)';
    return withEmoji ? `👶 ${finalText}` : finalText;
}

export function formatSexIcons(fetusSex, withText = false) {
    if (!fetusSex || fetusSex.length === 0) return '';
    return fetusSex.map(sex => {
        if (withText) return sex === 'M' ? 'мальчик ♂️' : 'девочка ♀️';
        return sex === 'M' ? '♂️' : '♀️';
    }).join(withText ? ', ' : ' ');
}

export function formatFetusCount(count, style = 'short') {
    if (style === 'instrumental') {
        return count === 1 ? 'одним плодом' : count === 2 ? 'двойней' : 'тройней';
    }
    if (style === 'full') {
        return count === 1 ? '1 плод' : count === 2 ? '2 плода (двойня)' : '3 плода (тройня)';
    }
    return count === 1 ? '1 плод' : count === 2 ? 'Двойня' : 'Тройня';
}

export function getHealthInfo(healthStatus) {
    if (healthStatus === 'warning') return { text: 'Требует внимания', emoji: '⚠️', icon: 'fa-triangle-exclamation', color: '#ffaa00' };
    if (healthStatus === 'critical') return { text: 'КРИТИЧЕСКОЕ', emoji: '🚨', icon: 'fa-circle-exclamation', color: '#ff4444' };
    return { text: 'Норма', emoji: '✅', icon: 'fa-circle-check', color: '#00ff88' };
}
