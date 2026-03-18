// ═══════════════════════════════════════════
// PROMPTS — инъекция промптов для AI
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types, saveSettingsDebounced } from '../../../../script.js';
import { extensionName } from './config.js';
import { getSettings, getPregnancyData } from './state.js';
import { getPhaseInfo, calculateWeeksFromDates, getSymptomsForProgress, getRecommendationsForProgress, getFetusSizeForProgress, formatSexIcons, formatFetusCount, getHealthInfo } from './helpers.js';
import { calculateDueDate } from './date-parser.js';
import { updateCycleDay, checkComplications } from './pregnancy.js';

export function getBasePrompt() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!s.isEnabled) return '';

    const day = s.cycleDay;
    let phase = '';
    if (day <= 5) phase = 'Менструация';
    else if (day <= 11) phase = 'Фолликулярная';
    else if (day <= 16) phase = 'Овуляция';
    else phase = 'Лютеиновая';

    const contraEmoji = 
        s.contraception === 'condom' ? 'Презерватив' :
        s.contraception === 'pill' ? 'Таблетки' :
        s.contraception === 'iud' ? 'ВМС' : 'Нет защиты';

    let prompt = `OOC: СИСТЕМА АКТИВНА\n`;
    prompt += `В статус-блок {{user}} ОБЯЗАТЕЛЬНО добавь:\n`;
    prompt += `Цикл: День ${day} | ${phase} | ${contraEmoji}\n\n`;
    prompt += `ЦИКЛ: 1-5 менструация, 6-11 фолликулярная, 12-16 овуляция (высокое либидо!), 17-28 лютеиновая.\n`;

    if (s.contraception === 'condom') {
        prompt += `ПРЕЗЕРВАТИВ: {{char}} достаёт/надевает при сексе. Может порваться (~15%).\n`;
    }

    // Если уже беременна - НЕ добавляем инструкцию про тег!
    if (p.isPregnant) {
        prompt += `🤰 {{user}} уже БЕРЕМЕННА — тег [CONCEPTION_CHECK] ЗАПРЕЩЁН!]`;
        return prompt;
    }

    // Только если НЕ беременна - инструкции про зачатие
    prompt += `\n\nКРИТИЧЕСКИ ВАЖНО — тег [CONCEPTION_CHECK]\n`;
    prompt += `════════════════════════════════════════════════════\n`;
    prompt += `✅ ДОБАВЛЯЙ тег ТОЛЬКО когда ВСЁ УЖЕ ПРОИЗОШЛО (прошедшее время!):\n`;
    prompt += `   1) Вагинальный секс СОСТОЯЛСЯ\n`;
    prompt += `   2) Эякуляция внутрь вагины УЖЕ СЛУЧИЛАСЬ (кончил, излил, выплеснул)\n`;
    prompt += `   3) Сперма УЖЕ ВНУТРИ неё\n\n`;
    prompt += `🚫 ЗАПРЕЩЕНО ДОБАВЛЯТЬ ТЕГ:\n`;
    prompt += `   ❌ Секс ЕЩЁ ИДЁТ (процесс, не финал)\n`;
    prompt += `   ❌ "Я кончу", "хочу кончить", "сейчас кончу" — это БУДУЩЕЕ время, НЕ ставь!\n`;
    prompt += `   ❌ АНАЛЬНЫЙ секс — не беременеют!\n`;
    prompt += `   ❌ ОРАЛЬНЫЙ секс — не беременеют!\n`;
    prompt += `   ❌ Эякуляция снаружи/на тело\n`;
    prompt += `   ❌ Прерванный акт\n`;
    prompt += `   ❌ Презерватив не порвался\n\n`;
    prompt += `ТЕГ ТОЛЬКО ПОСЛЕ ФИНАЛА! "Кончил внутрь" = прошедшее время = ОК\n`;
    prompt += `"Сейчас кончу" / "хочу кончить" = будущее = НЕ СТАВЬ ТЕГ!\n`;
    prompt += `════════════════════════════════════════════════════\n`;
    prompt += `Формат (скрыто в конце): <!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->`;

    return prompt;
}

export function getPregnancyPrompt() {
    const s = getSettings();
    const p = getPregnancyData();
    
    if (!p.isPregnant) return '';

    const duration = s.pregnancyDuration || 40;
    
    const { weeks } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);

    const progressPercent = (weeks / duration) * 100;
    
    let symptoms = '';
    let recommendations = '';
    
    symptoms = getSymptomsForProgress(progressPercent, weeks);
    recommendations = getRecommendationsForProgress(progressPercent);
    
    let conceptionDateStr = p.conceptionDate ? new Date(p.conceptionDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    
    let dueDateStr = '—';
    if (p.conceptionDate) {
        const dueDate = calculateDueDate(p.conceptionDate);
        if (dueDate) {
            dueDateStr = dueDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        }
    }

    const sexText = formatSexIcons(p.fetusSex, true);
    const fetusText = formatFetusCount(p.fetusCount, 'instrumental');
    const fetusCountText = formatFetusCount(p.fetusCount, 'full');
    
    const fetusSize = getFetusSizeForProgress(progressPercent, false);
    
    // Здоровье
    const healthInfo = getHealthInfo(p.healthStatus);
    let healthText = `${healthInfo.emoji} ${healthInfo.text}`;
    let healthDetails = '';
    if (p.healthStatus !== 'normal') {
        healthDetails = p.complications && p.complications.length > 0 
            ? ` (${p.complications.filter(c => !c.resolved).map(c => c.type).join(', ')})`
            : '';
    }

    let prompt = `

[OOC:БЕРЕМЕННОСТЬ — АКТИВНА]
━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Срок: ${weeks}/${duration} недель (${Math.round(progressPercent)}%)
🗓️ ПДР: ${dueDateStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Плод: ${fetusCountText}
${sexText ? `⚤ Пол: ${sexText}` : ''}
Размер: ${fetusSize}
Здоровье: ${healthText}${healthDetails}
━━━━━━━━━━━━━━━━━━━━━━━━━━

СИМПТОМЫ: ${symptoms}

РЕКОМЕНДАЦИИ: ${recommendations}
`;

    // Инструкция про роды когда >= 90% срока
    const birthThreshold = Math.floor(duration * 0.9);
    if (weeks >= birthThreshold) {
        prompt += `
РОДЫ: Срок ${weeks}/${duration} нед. — роды возможны в любой момент!
Если в сообщении {{user}} РОЖАЕТ (начались схватки, отошли воды, ребёнок появился на свет), добавь в конце:
<!-- [BIRTH] -->
❌ НЕ добавляй если: просто разговор о родах, "ещё не родился", подготовка к родам.
`;
    }

    return prompt;
}

export function updatePromptInjection() {
    try {
        const s = getSettings();

        setExtensionPrompt(extensionName, '', extension_prompt_types.IN_CHAT, 0);

        if (!s.isEnabled) return;

        updateCycleDay();
        checkComplications();

        const fullPrompt = getBasePrompt() + getPregnancyPrompt();

        setTimeout(() => {
            setExtensionPrompt(extensionName, fullPrompt, extension_prompt_types.IN_CHAT, 0);
            console.log('[Reproductive] Prompt injected');
        }, 50);

    } catch (error) {
        console.error('[Reproductive] updatePromptInjection error:', error);
    }
}

export function injectConceptionResult(result) {
    const s = getSettings();
    const p = getPregnancyData();

    const getPhase = (day) => {
        const info = getPhaseInfo(day);
        return `${info.emoji} ${info.name}`;
    };

    let codeBlock = '```\n';
    codeBlock += `🤰 ПРОВЕРКА ЗАЧАТИЯ\n━━━━━━━━━━━━━━━━━━━━\n`;
    codeBlock += `📅 День: ${result.cycleDay} (${getPhase(result.cycleDay)})\n`;
    codeBlock += `🎲 Бросок: ${result.roll} | Порог: ${result.chance}\n`;
    if (result.contraceptionFailed) codeBlock += `⚠️ Контрацепция ПОДВЕЛА!\n`;
    codeBlock += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (result.success) {
        const sexes = formatSexIcons(p.fetusSex, true);
        codeBlock += `✅ БЕРЕМЕННОСТЬ!\n👶 ${formatFetusCount(p.fetusCount)}\n⚤ Пол: ${sexes}\n`;
    } else {
        codeBlock += `❌ ЗАЧАТИЯ НЕ ПРОИЗОШЛО\n`;
    }
    codeBlock += '```';

    const oocPrompt = `[OOC: Выведи этот блок В НАЧАЛЕ ответа:\n${codeBlock}]`;

    setExtensionPrompt(extensionName + '-result', oocPrompt, extension_prompt_types.IN_CHAT, 0);
    updatePromptInjection();

    setTimeout(() => {
        setExtensionPrompt(extensionName + '-result', '', extension_prompt_types.IN_CHAT, 0);
    }, 2000);
}

