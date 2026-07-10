// ═══════════════════════════════════════════
// CONFIG — константы и настройки по умолчанию
// ═══════════════════════════════════════════

export const extensionName = 'reproductive-system';

export const defaultSettings = {
    isEnabled: true,
    showNotifications: true,
    language: 'ru',
    contraception: 'none',
    cycleDay: 1,
    lastCycleUpdate: null,
    totalChecks: 0,
    totalConceptions: 0,
    chatPregnancyData: {},
    pregnancyDuration: 40,
    twinsChance: 3,
    tripletsChance: 0.1,
    scanDepth: 10,
    scanResponseLength: 1500,
    autoScan: true,
    infoblockPosition: 'off',
    customInfoblockCss: '',
    // Возраст в RP-днях, после которого малыш считается «выросшим»: инфоблок сбрасывается,
    // ребёнок переходит в архив p.grownChildren. Дефолт 730 = 2 года.
    babyMaxAgeDays: 730,
    // Отладка: НЕ вырезать теги из текста сообщений (видны прямо в чате)
    debugKeepTags: false,
    // Отладка: писать debug-логи в консоль (dlog/dwarn). По умолчанию выключено —
    // логи с содержимым тегов/промпта заметно грузили консоль.
    debugLogs: false,
    // Шанс случайного события у ребёнка, % в RP-день (0 = выкл). Одно активное на ребёнка.
    familyEventChance: 15,
    // ── Омегаверс (этап 3): длины циклов, глобальные дефолты ──
    heatCycleLength: 42,  // течка каждые ~6 недель
    heatDuration: 5,      // течка длится 5 дней
    rutCycleLength: 70,   // гон альфы каждые ~10 недель
    rutDuration: 3,
};

export const defaultPregnancyData = {
    isPregnant: false,
    // Цикл — ПЕР-CHAT (раньше был в глобальных settings → утечка между чатами)
    cycleDay: 1,
    lastCycleUpdate: null,
    conceptionDate: null,
    pregnancyWeeks: 0,
    rpDate: null,
    _lastRpDateTag: null,
    fetusCount: 1,
    fetusSex: [],
    fetusSexRevealed: false,
    complications: [],
    _plannedComplications: [],
    healthStatus: 'normal',
    lastComplicationCheck: null,
    lastComplicationCheckRpDate: null,
    lastDoctorVisitRpDate: null,
    // Pregnancy extras
    mood: '',
    libido: '',
    weightGain: '',
    babyActivity: '',
    // Baby data (after birth)
    hasBaby: false,
    babyName: '',
    babySex: [],
    babyCount: 0,
    babyAge: '',
    babyHealth: 'normal',
    babyTeething: false,
    babyColicky: false,
    babyDiaperClean: true,
    babyFeedingType: '',
    babySleep: '',
    babyMood: '',
    babyMilestones: [],
    babyBirthRpDate: null,
    babyLastFeedRpDate: null,
    babyLastChangeRpDate: null,
    momState: '',
    // Per-baby data (array of individual baby objects)
    babies: [],
    // Архив выросших детей (>babyMaxAgeDays). Не показываются в инфоблоке, но помнятся для промпта.
    grownChildren: [],
    // Dynamic descriptions from AI
    _dynamic: {},
};

// ── Партнёр-носитель ({{char}}): данные живут в p.partner ──
// enabled=false по умолчанию: старые чаты не меняются, пока юзер не включит
// «Партнёр может забеременеть». Дети от партнёрской беременности попадают
// в ОБЩИЕ p.babies/grownChildren с полями motherName/bornBy — династия едина.
export const defaultPartnerData = {
    enabled: false,
    name: '',              // пусто → {{char}} в промпте / ctx.name2 в UI
    isPregnant: false,
    cycleDay: 1,
    lastCycleUpdate: null,
    contraception: 'none', // своя контрацепция, независимая от юзерской
    conceptionDate: null,
    pregnancyWeeks: 0,
    fetusCount: 1,
    fetusSex: [],
    fetusSexRevealed: false,
    complications: [],
    _plannedComplications: [],
    healthStatus: 'normal',
    mood: '',
    libido: '',
    weightGain: '',
    babyActivity: '',
    fatherName: '',        // отец при партнёрской беременности (обычно {{user}})
    _conceptionAnchored: false,
    _userSetWeeksAt: null,
    _userSetCycleAt: null,
    _dynamic: {},
    // ── Омегаверс (этап 3): роль и циклы A/B/O партнёра ──
    // designation партнёра важен даже при enabled=false: альфа в гоне даёт
    // бонус к зачатию юзера. Дефолт «альфа» — классическая пара к юзеру-омеге.
    designation: 'alpha',
    heatCycleDay: 20,
    rutCycleDay: 30,
    heatSuppressant: false,
    scentBlockers: false,
};

export const CHANCES = {
    base: 20,
    contraception: {
        none: 0,
        condom: 85,
        pill: 91,
        iud: 99,
    },
};

export const LANG = {
    ru: {
        title: 'Репродуктивная Система',
        enabled: 'Включено',
        notifications: 'Уведомления',
        contraceptionTitle: 'Контрацепция',
        contraceptionTypes: {
            none: 'Нет защиты',
            condom: 'Презерватив (85%)',
            pill: 'Таблетки (91%)',
            iud: 'ВМС (99%)',
        },
        cycleDay: 'День цикла',
        status: 'Статус',
        notPregnant: 'Не беременна',
        pregnant: 'Беременна',
        conceptionSuccess: 'ЗАЧАТИЕ ПРОИЗОШЛО!',
        conceptionFail: 'Зачатия не произошло',
        contraceptionFailed: 'Контрацепция ПОДВЕЛА!',
        stats: 'Проверок: {checks} | Зачатий: {conceptions}',
        reset: 'Сбросить беременность',
        scan: 'Сканировать чат',
        scanning: 'Сканирование...',
        scanDepth: 'Глубина сканирования',
        autoScan: 'Авто-сканирование',
    },
    en: {
        title: 'Reproductive System',
        enabled: 'Enable',
        notifications: 'Notifications',
        contraceptionTitle: 'Contraception',
        contraceptionTypes: {
            none: 'None',
            condom: 'Condom (85%)',
            pill: 'Pill (91%)',
            iud: 'IUD (99%)',
        },
        cycleDay: 'Cycle day',
        status: 'Status',
        notPregnant: 'Not pregnant',
        pregnant: 'Pregnant',
        conceptionSuccess: 'CONCEPTION!',
        conceptionFail: 'No conception',
        contraceptionFailed: 'Contraception failed!',
        stats: 'Checks: {checks} | Conceptions: {conceptions}',
        reset: 'Reset pregnancy',
        scan: 'Scan chat',
        scanning: 'Scanning...',
        scanDepth: 'Scan depth',
        autoScan: 'Auto-scan',
    },
};

export const REPRO_REGEX = /<repro>([\s\S]*?)<\/repro>/i;
export const EXPIRATION_DEPTH = 50;
