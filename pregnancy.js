// ═══════════════════════════════════════════
// PREGNANCY — зачатие, осложнения, роды
// ═══════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../script.js';
import { CHANCES, defaultPregnancyData } from './config.js';
import { getSettings, getPregnancyData, L } from './state.js';
import { roll, getCycleModifier, getPhaseInfo, calculateWeeksFromDates, formatSexIcons, formatFetusCount } from './helpers.js';
import { parseRpDate, calculateConceptionDate } from './date-parser.js';
import { showNotification } from './notifications.js';

// Forward declarations — будут установлены из index.js чтобы избежать circular imports
let _syncUI = () => {};
let _updatePromptInjection = () => {};
export function setSyncUI(fn) { _syncUI = fn; }
export function setUpdatePromptInjection(fn) { _updatePromptInjection = fn; }

export function parseAIStatus(text) {
    const s = getSettings();
    const p = getPregnancyData();
    let updated = false;
    let rpDateChanged = false;

    console.log('[Reproductive] Parsing AI status block...');

    const rpDate = parseRpDate(text);
    if (rpDate) {
        const oldRpDate = p.rpDate;
        p.rpDate = rpDate.toISOString();
        if (oldRpDate !== p.rpDate) {
            console.log(`[Reproductive] RP date updated: ${p.rpDate}`);
            rpDateChanged = true;
            updated = true;
            
            // Если уже беременна и rpDate изменился - пересчитать conceptionDate
            if (p.isPregnant && p.pregnancyWeeks > 0) {
                const newConceptionDate = calculateConceptionDate(new Date(p.rpDate), p.pregnancyWeeks);
                if (newConceptionDate) {
                    p.conceptionDate = newConceptionDate.toISOString();
                    console.log(`[Reproductive] Recalculated conception date: ${p.conceptionDate}`);
                }
            }
        }
    }

    const cycleDayPatterns = [
        /[Дд]ень\s+(?:цикла[:\s]+)?(\d+)/i,
        /[Цц]икл[:\s]+(?:[Дд]ень\s+)?(\d+)/i,
        /[Dd]ay\s+(?:of\s+cycle[:\s]+)?(\d+)/i,
        /[Cc]ycle[:\s]+(?:[Dd]ay\s+)?(\d+)/i,
        /🩸.*?[Дд]ень\s+(\d+)/i,
        /🩸.*?[Dd]ay\s+(\d+)/i,
        // JSON формат: cycle_day:{"output":"12"} или cycle_day:{'output':'5'}
        /cycle_day[:\s]*[{]["']?output["']?[:\s]*["'](\d+)["'][}]/i
    ];
    
    for (const pattern of cycleDayPatterns) {
        const match = text.match(pattern);
        if (match) {
            const day = parseInt(match[1]);
            if (day >= 1 && day <= 28 && day !== s.cycleDay) {
                console.log(`[Reproductive] Parsed cycle day: ${s.cycleDay} → ${day}`);
                s.cycleDay = day;
                s.lastCycleUpdate = Date.now();
                updated = true;
                break;
            }
        }
    }

    // Роды определяются через тег [BIRTH] в getPregnancyPrompt, не через паттерны

    const pregnancyPatterns = [
        /[Бб]еременност[ьи][^\n]{0,30}[\(:\s]+(\d+)\s*недел/i,
        /[Сс][Рр][Оо][Кк][:\s]+(\d+)\s*недел/i,
        /[Бб]еременна[^\n]{0,50}(\d+)\s*недел/i,
        /(\d+)\s*недел[ьяи][^\n]{0,30}беременност/i,
        /[Pp]regnant[^\n]{0,50}(\d+)\s*week/i,
        /[Pp]regnancy[^\n]{0,30}[\(:\s]+(\d+)\s*week/i,
        /(\d+)\s*weeks?\s*(?:of\s+)?pregnan/i,
        /🤰[^\n]{0,30}(\d+)\s*(?:недел|week)/i
    ];
    
    let weeks = null;
    for (const pattern of pregnancyPatterns) {
        const match = text.match(pattern);
        if (match) {
            weeks = parseInt(match[1]);
            console.log(`[Reproductive] Matched pregnancy pattern: ${pattern}, weeks: ${weeks}`);
            break;
        }
    }

    let detectedFetusCount = null;
    if (/[Дд]войн[яеи]|[Tt]wins?/i.test(text)) {
        detectedFetusCount = 2;
    } else if (/[Тт]ройн[яеи]|[Tt]riplets?/i.test(text)) {
        detectedFetusCount = 3;
    }
    
    if (weeks !== null && weeks > 0) {
        console.log(`[Reproductive] Parsed pregnancy: ${weeks} weeks`);

        // ВАЖНО: НЕ устанавливаем беременность автоматически!
        // Беременность начинается ТОЛЬКО через:
        // 1. Тег [CONCEPTION_CHECK] и успешный бросок
        // 2. Ручную установку через UI
        
        if (!p.isPregnant) {
            // Игнорируем упоминание беременности - персонаж не беременна
            console.log('[Reproductive] AI mentions pregnancy but character is not pregnant - ignoring (use [CONCEPTION_CHECK] tag or manual setup)');
        } else {
            // Уже беременна - синхронизируем данные с AI
            if (detectedFetusCount && detectedFetusCount !== p.fetusCount) {
                p.fetusCount = detectedFetusCount;
                while (p.fetusSex.length < p.fetusCount) {
                    p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
                }
                p.fetusSex = p.fetusSex.slice(0, p.fetusCount);
                updated = true;
            }
            
            if (weeks !== p.pregnancyWeeks) {
                console.log(`[Reproductive] Pregnancy week mismatch: ours=${p.pregnancyWeeks}, AI=${weeks}. Resyncing...`);
                p.pregnancyWeeks = weeks;
                
                // Пересчитываем conceptionDate на основе rpDate и новых недель
                if (p.rpDate) {
                    const conceptionDate = calculateConceptionDate(new Date(p.rpDate), weeks);
                    if (conceptionDate) {
                        p.conceptionDate = conceptionDate.toISOString();
                    }
                }
                
                updated = true;
                if (s.showNotifications) {
                    showNotification(`🔄 Срок обновлён: ${weeks} недель`, 'info');
                }
            }
        }
    }

    // УБРАНО: автоматический сброс по "не беременна" - слишком часто ложные срабатывания
    // Сброс беременности только через кнопку или роды на 36+ неделе

    if (updated) {
        saveSettingsDebounced();
        _syncUI();
        _updatePromptInjection();
    }

    return updated;
}

export function updateCycleDay() {
    const s = getSettings();
    if (!s.isEnabled) return;

    const now = Date.now();

    if (!s.lastCycleUpdate) {
        s.lastCycleUpdate = now;
        saveSettingsDebounced();
        return;
    }

    const timeDiff = now - s.lastCycleUpdate;
    const daysPassed = Math.floor(timeDiff / 86400000);

    if (daysPassed > 0) {
        const oldDay = s.cycleDay;
        s.cycleDay += daysPassed;
        while (s.cycleDay > 28) {
            s.cycleDay -= 28;
        }
        s.lastCycleUpdate = now;

        console.log(`[Reproductive] Auto-update: ${oldDay} → ${s.cycleDay} (${daysPassed} days passed)`);
        saveSettingsDebounced();
        _syncUI();
        _updatePromptInjection();

        if (s.showNotifications) {
            showNotification(`📅 День цикла обновлён: ${s.cycleDay}`, 'info');
        }
    }
}

export function checkConception() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!s.isEnabled) return null;
    if (p.isPregnant) {
        console.log('[Reproductive] Already pregnant, skipping check');
        return null;
    }

    s.totalChecks++;

    const cycleModifier = getCycleModifier(s.cycleDay);
    // Применяем модификатор плодовитости расы
    let chance = Math.round(CHANCES.base * cycleModifier);

    const contraceptionEff = CHANCES.contraception[s.contraception];
    let contraceptionFailed = false;

    if (s.contraception !== 'none') {
        const failRoll = roll(100);
        if (failRoll > contraceptionEff) {
            contraceptionFailed = true;
            if (s.showNotifications) {
                showNotification(L('contraceptionFailed'), 'warning');
            }
        } else {
            chance = Math.round(chance * (1 - contraceptionEff / 100));
        }
    }

    const conceptionRoll = roll(100);
    const success = conceptionRoll <= chance;

    console.log(`[Reproductive] Check: roll=${conceptionRoll}, need<=${chance}, result=${success ? 'PREGNANT' : 'no'}`);

    const result = {
        roll: conceptionRoll,
        chance: chance,
        contraception: s.contraception,
        contraceptionFailed: contraceptionFailed,
        cycleDay: s.cycleDay,
        success: success
    };

    if (success) {
        p.isPregnant = true;

        if (p.rpDate) {
            p.conceptionDate = p.rpDate;
            console.log(`[Reproductive] Conception date set to RP date: ${p.conceptionDate}`);
        } else {
            p.conceptionDate = new Date().toISOString();
            console.log(`[Reproductive] Conception date set to Real time (fallback): ${p.conceptionDate}`);
        }


        p.pregnancyWeeks = 0;
        s.totalConceptions++;

        // Используем шансы многоплодности из настроек расы
        const twinsChance = s.twinsChance || 3;
        const tripletsChance = s.tripletsChance || 0.1;
        
        const multiplesRoll = roll(1000) / 10;
        if (multiplesRoll <= tripletsChance) {
            p.fetusCount = 3;
        } else if (multiplesRoll <= twinsChance) {
            p.fetusCount = 2;
        } else {
            p.fetusCount = 1;
        }

        p.fetusSex = [];
        for (let i = 0; i < p.fetusCount; i++) {
            p.fetusSex.push(roll(2) === 1 ? 'M' : 'F');
        }

        if (s.showNotifications) {
            showNotification(`✅ Беременность! День ${s.cycleDay}, ${conceptionRoll}/${chance}\n${formatFetusCount(p.fetusCount)} | Пол: ${formatSexIcons(p.fetusSex)}`, 'success');
        }
    } else {
        if (s.showNotifications) {
            showNotification(`❌ Не Беременна. День ${s.cycleDay}, ${conceptionRoll}/${chance}`, 'info');
        }
    }

    saveSettingsDebounced();
    _syncUI();

    return result;
}

export function checkComplications() {
    const s = getSettings();
    const p = getPregnancyData();
    
    if (!p.isPregnant) return;
    if (!p.rpDate) return;

    const { weeks } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);

    const currentRpDate = new Date(p.rpDate);
    
    if (p.lastComplicationCheckRpDate) {
        const lastCheckRpDate = new Date(p.lastComplicationCheckRpDate);
        const daysSinceCheckRp = Math.floor((currentRpDate - lastCheckRpDate) / 86400000);
        
        if (daysSinceCheckRp < 7) {
            console.log(`[Reproductive] Complication check skipped: only ${daysSinceCheckRp} RP days since last check`);
            return;
        }
    }

    p.lastComplicationCheckRpDate = p.rpDate;

    if (s.showNotifications) {
        showNotification(`🩺 Проверка здоровья (${weeks} нед.)...`, 'info');
    }

    let baseChance = weeks <= 12 ? 15 : weeks <= 27 ? 5 : 12;
    if (p.fetusCount >= 2) baseChance += 10;
    if (p.fetusCount >= 3) baseChance += 15;
    
    // Накопление warning увеличивает шанс
    const warningCount = (p.complications || []).filter(c => c.severity === 'warning' && !c.resolved).length;
    if (warningCount >= 2) baseChance += 10;

    const complicationRoll = roll(100);
    console.log(`[Reproductive] Complication check: roll=${complicationRoll}, threshold=${baseChance}, warnings=${warningCount}`);

    if (complicationRoll <= baseChance) {
        const types = getComplicationTypes(weeks);
        const complication = types[Math.floor(Math.random() * types.length)];

        p.complications.push({
            week: weeks,
            type: complication.type,
            severity: complication.severity,
            description: complication.description,
            rpDate: p.rpDate,
            date: new Date().toISOString(),
            resolved: false
        });

        if (complication.severity === 'critical') {
            p.healthStatus = 'critical';
        } else if (complication.severity === 'warning' && p.healthStatus === 'normal') {
            p.healthStatus = 'warning';
        }

        saveSettingsDebounced();
        _syncUI();

        if (s.showNotifications) {
            const emoji = complication.severity === 'critical' ? '🚨' : '⚠️';
            showNotification(`${emoji} ОСЛОЖНЕНИЕ: ${complication.type}\n${complication.description}`, 
                           complication.severity === 'critical' ? 'warning' : 'info');
        }
        
        // Реальные последствия
        handleComplicationConsequences(complication, weeks);
        
    } else {
        // Шанс на выздоровление
        if (warningCount > 0 && roll(100) <= 30) {
            const unresolvedWarning = p.complications.find(c => c.severity === 'warning' && !c.resolved);
            if (unresolvedWarning) {
                unresolvedWarning.resolved = true;
                if (s.showNotifications) {
                    showNotification(`💊 ${unresolvedWarning.type} — состояние улучшилось!`, 'success');
                }
                const hasUnresolvedCritical = p.complications.some(c => c.severity === 'critical' && !c.resolved);
                const hasUnresolvedWarning = p.complications.some(c => c.severity === 'warning' && !c.resolved);
                p.healthStatus = hasUnresolvedCritical ? 'critical' : hasUnresolvedWarning ? 'warning' : 'normal';
            }
        }
        
        if (s.showNotifications) {
            showNotification(`✅ Проверка пройдена: всё в норме!`, 'success');
        }
        saveSettingsDebounced();
        _syncUI();
    }
}

export function handleComplicationConsequences(complication, weeks) {
    const s = getSettings();
    const p = getPregnancyData();
    
    // === УГРОЗА ВЫКИДЫША (1 триместр) — 25% шанс потери ===
    if (complication.type === 'Угроза выкидыша') {
        const miscarriageRoll = roll(100);
        console.log(`[Reproductive] Miscarriage roll: ${miscarriageRoll} (need >25 to survive)`);
        
        if (miscarriageRoll <= 25) {
            if (s.showNotifications) {
                showNotification(`💔 ВЫКИДЫШ\nБеременность прервалась на ${weeks} неделе...`, 'warning');
            }
            setTimeout(() => {
                Object.assign(p, structuredClone(defaultPregnancyData));
                saveSettingsDebounced();
                _syncUI();
                _updatePromptInjection();
            }, 1000);
            return;
        } else {
            if (s.showNotifications) {
                showNotification(`🏥 Угроза миновала! Требуется покой.`, 'info');
            }
        }
    }
    
    // === ПРЕЖДЕВРЕМЕННЫЕ РОДЫ (3 триместр) — немедленные роды ===
    if (complication.type === 'Преждевременные роды') {
        const statusText = weeks < 32 ? '⚠️ Недоношенный!' : weeks < 37 ? '⚠️ Ранний, но стабильный.' : '✅ Доношенный!';
        
        if (s.showNotifications) {
            showNotification(`👶 ПРЕЖДЕВРЕМЕННЫЕ РОДЫ (${weeks} нед.)\n${formatFetusCount(p.fetusCount)}: ${formatSexIcons(p.fetusSex)}\n${statusText}`, 'warning');
        }
        setTimeout(() => {
            Object.assign(p, structuredClone(defaultPregnancyData));
            saveSettingsDebounced();
            _syncUI();
            _updatePromptInjection();
        }, 1000);
        return;
    }
    
    // === ГЕСТОЗ — 15% шанс экстренного кесарева ===
    if (complication.type === 'Гестоз') {
        const emergencyRoll = roll(100);
        console.log(`[Reproductive] Gestosis emergency roll: ${emergencyRoll} (need >15 to avoid)`);
        
        if (emergencyRoll <= 15) {
            if (s.showNotifications) {
                showNotification(`🚨 ЭКСТРЕННОЕ КЕСАРЕВО!\nГестоз угрожает жизни.\nМалыш: ${formatSexIcons(p.fetusSex)}`, 'warning');
            }
            setTimeout(() => {
                Object.assign(p, structuredClone(defaultPregnancyData));
                saveSettingsDebounced();
                _syncUI();
                _updatePromptInjection();
            }, 1000);
            return;
        } else {
            if (s.showNotifications) {
                showNotification(`🏥 Гестоз под контролем. Постельный режим!`, 'info');
            }
        }
    }
    
    // === ИЦН — 20% шанс преждевременных родов ===
    if (complication.type === 'ИЦН') {
        const icnRoll = roll(100);
        console.log(`[Reproductive] ICN roll: ${icnRoll} (need >20 to survive)`);
        
        if (icnRoll <= 20) {
            if (s.showNotifications) {
                showNotification(`💔 ИЦН привела к потере беременности на ${weeks} неделе...`, 'warning');
            }
            setTimeout(() => {
                Object.assign(p, structuredClone(defaultPregnancyData));
                saveSettingsDebounced();
                _syncUI();
                _updatePromptInjection();
            }, 1000);
            return;
        } else {
            if (s.showNotifications) {
                showNotification(`🏥 ИЦН обнаружена. Наложен шов/пессарий, постельный режим!`, 'info');
            }
        }
    }
    
    // === ОТСЛОЙКА ПЛАЦЕНТЫ — 30% шанс потери / экстренных родов ===
    if (complication.type === 'Отслойка плаценты') {
        const abruptionRoll = roll(100);
        console.log(`[Reproductive] Placental abruption roll: ${abruptionRoll} (need >30 to survive)`);
        
        if (abruptionRoll <= 30) {
            if (weeks < 24) {
                if (s.showNotifications) {
                    showNotification(`💔 Отслойка плаценты привела к потере беременности...`, 'warning');
                }
            } else {
                if (s.showNotifications) {
                    showNotification(`🚨 ЭКСТРЕННЫЕ РОДЫ из-за отслойки плаценты!\n${formatFetusCount(p.fetusCount)}: ${formatSexIcons(p.fetusSex)}`, 'warning');
                }
            }
            setTimeout(() => {
                Object.assign(p, structuredClone(defaultPregnancyData));
                saveSettingsDebounced();
                _syncUI();
                _updatePromptInjection();
            }, 1000);
            return;
        } else {
            if (s.showNotifications) {
                showNotification(`🏥 Отслойка частичная, под контролем. Строгий постельный режим!`, 'info');
            }
        }
    }
    
    // === НАКОПЛЕНИЕ 3+ WARNING — риск потери ===
    const unresolvedWarnings = (p.complications || []).filter(c => c.severity === 'warning' && !c.resolved).length;
    if (unresolvedWarnings >= 3) {
        const criticalRoll = roll(100);
        console.log(`[Reproductive] Warning accumulation: ${unresolvedWarnings} warnings, roll=${criticalRoll}`);
        
        if (criticalRoll <= 20) {
            p.healthStatus = 'critical';
            
            if (weeks <= 12) {
                if (s.showNotifications) {
                    showNotification(`💔 Осложнения привели к потере беременности...`, 'warning');
                }
                setTimeout(() => {
                    Object.assign(p, structuredClone(defaultPregnancyData));
                    saveSettingsDebounced();
                    _syncUI();
                    _updatePromptInjection();
                }, 1000);
                return;
            } else {
                if (s.showNotifications) {
                    showNotification(`🚨 КРИТИЧЕСКОЕ СОСТОЯНИЕ!\nСрочно нужна медпомощь!`, 'warning');
                }
            }
            saveSettingsDebounced();
            _syncUI();
        }
    }
}

export function getComplicationTypes(weeks) {
    if (weeks <= 12) {
        return [
            { type: 'Токсикоз', severity: 'warning', description: 'Сильная тошнота, рвота до 5 раз в день' },
            { type: 'Угроза выкидыша', severity: 'critical', description: 'Тянущие боли внизу живота, кровянистые выделения' },
            { type: 'Анемия', severity: 'warning', description: 'Низкий гемоглобин, слабость, головокружение' }
        ];
    } else if (weeks <= 27) {
        return [
            { type: 'Предлежание плаценты', severity: 'critical', description: 'Плацента перекрывает выход из матки' },
            { type: 'ИЦН', severity: 'critical', description: 'Истмико-цервикальная недостаточность — шейка матки укорачивается, риск преждевременных родов' },
            { type: 'Гестационный диабет', severity: 'warning', description: 'Повышенный сахар в крови, требуется диета' },
            { type: 'Отёки', severity: 'warning', description: 'Задержка жидкости, опухшие ноги и руки' },
            { type: 'Отслойка плаценты', severity: 'critical', description: 'Частичное отделение плаценты от стенки матки, кровотечение' }
        ];
    } else {
        return [
            { type: 'Гестоз', severity: 'critical', description: 'Высокое давление, белок в моче, сильные отёки' },
            { type: 'Преждевременные роды', severity: 'critical', description: 'Схватки до 37 недель, риск недоношенности' },
            { type: 'Отслойка плаценты', severity: 'critical', description: 'Отделение плаценты, сильное кровотечение, угроза жизни' },
            { type: 'ЗВУР', severity: 'warning', description: 'Задержка внутриутробного развития — плод меньше нормы для срока' },
            { type: 'Маловодие', severity: 'warning', description: 'Недостаточное количество околоплодных вод' },
            { type: 'Симфизит', severity: 'warning', description: 'Расхождение лонного сочленения, боль при ходьбе' }
        ];
    }
}

export function resetPregnancy() {
    const p = getPregnancyData();
    Object.assign(p, structuredClone(defaultPregnancyData));
    saveSettingsDebounced();
    _syncUI();
    _updatePromptInjection();
}

export function visitDoctor() {
    const s = getSettings();
    const p = getPregnancyData();
    
    if (!p.isPregnant) return;
    
    // Проверяем кулдаун (3 RP-дня)
    if (p.lastDoctorVisitRpDate && p.rpDate) {
        const lastVisit = new Date(p.lastDoctorVisitRpDate);
        const currentRpDate = new Date(p.rpDate);
        const daysSinceVisit = Math.floor((currentRpDate - lastVisit) / 86400000);
        
        if (daysSinceVisit < 3) {
            if (s.showNotifications) {
                showNotification(`🏥 Следующий визит через ${3 - daysSinceVisit} RP-дн.`, 'info');
            }
            return;
        }
    }
    
    // Запоминаем дату визита
    p.lastDoctorVisitRpDate = p.rpDate || new Date().toISOString();
    
    // Ищем нерешённые осложнения
    const unresolvedComplications = p.complications.filter(c => !c.resolved);
    
    if (unresolvedComplications.length === 0) {
        if (s.showNotifications) {
            showNotification(`🏥 Врач: Всё в порядке, осложнений нет!`, 'success');
        }
        saveSettingsDebounced();
        return;
    }
    
    // Лечим осложнения
    let healed = 0;
    let failed = 0;
    
    for (const complication of unresolvedComplications) {
        // Шанс лечения зависит от severity
        const healChance = complication.severity === 'critical' ? 50 : 75;
        const healRoll = roll(100);
        
        console.log(`[Reproductive] Doctor treating ${complication.type}: roll=${healRoll}, need<=${healChance}`);
        
        if (healRoll <= healChance) {
            complication.resolved = true;
            healed++;
        } else {
            failed++;
        }
    }
    
    // Пересчитываем healthStatus
    const hasUnresolvedCritical = p.complications.some(c => c.severity === 'critical' && !c.resolved);
    const hasUnresolvedWarning = p.complications.some(c => c.severity === 'warning' && !c.resolved);
    p.healthStatus = hasUnresolvedCritical ? 'critical' : hasUnresolvedWarning ? 'warning' : 'normal';
    
    saveSettingsDebounced();
    _syncUI();
    
    // Уведомление
    if (s.showNotifications) {
        if (healed > 0 && failed === 0) {
            showNotification(`🏥 Врач помог!\n✅ Вылечено: ${healed} осложнений`, 'success');
        } else if (healed > 0 && failed > 0) {
            showNotification(`🏥 Частичный успех\n✅ Вылечено: ${healed}\n⚠️ Требует наблюдения: ${failed}`, 'info');
        } else {
            showNotification(`🏥 Лечение не помогло\n⚠️ Требуется повторный визит`, 'warning');
        }
    }
}

