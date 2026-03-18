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
    currentChatId: null,
    chatPregnancyData: {},
    lastCheckedMessageId: null,
    pregnancyDuration: 40,
    twinsChance: 3,
    tripletsChance: 0.1
};

export const defaultPregnancyData = {
    isPregnant: false,
    conceptionDate: null,
    pregnancyWeeks: 0,
    rpDate: null,
    fetusCount: 1,
    fetusSex: [],
    complications: [],
    healthStatus: 'normal',
    lastComplicationCheck: null,
    lastComplicationCheckRpDate: null,
    lastDoctorVisitRpDate: null
};

export const CHANCES = {
    base: 20,
    cycleModifier: {
        '1-7': { low: 0.25 },
        '8-11': { medium: 0.5 },
        '12-16': { high: 1.65 },
        '17-28': { luteal: 0.25 }
    },
    contraception: {
        none: 0,
        condom: 85,
        pill: 91,
        iud: 99
    }
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
            iud: 'ВМС (99%)'
        },
        cycleDay: 'День цикла',
        status: 'Статус',
        notPregnant: 'Не беременна',
        pregnant: 'Беременна',
        conceptionSuccess: 'ЗАЧАТИЕ ПРОИЗОШЛО!',
        conceptionFail: 'Зачатия не произошло',
        contraceptionFailed: 'Контрацепция ПОДВЕЛА!',
        stats: 'Проверок: {checks} | Зачатий: {conceptions}',
        reset: 'Сбросить беременность'
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
            iud: 'IUD (99%)'
        },
        cycleDay: 'Cycle day',
        status: 'Status',
        notPregnant: 'Not pregnant',
        pregnant: 'Pregnant',
        conceptionSuccess: 'CONCEPTION!',
        conceptionFail: 'No conception',
        contraceptionFailed: 'Contraception failed!',
        stats: 'Checks: {checks} | Conceptions: {conceptions}',
        reset: 'Reset pregnancy'
    }
};
