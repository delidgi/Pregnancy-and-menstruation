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
    const phaseMap = { 1: 'Menstruation', 6: 'Follicular', 12: 'Ovulation', 17: 'Luteal' };
    let phase = 'Luteal';
    if (day <= 5) phase = 'Menstruation';
    else if (day <= 11) phase = 'Follicular';
    else if (day <= 16) phase = 'Ovulation';

    const contraMap = { condom: 'Condom', pill: 'Pill', iud: 'IUD', none: 'None' };
    const contra = contraMap[s.contraception] || 'None';

    let prompt = `[OOC: REPRODUCTIVE SYSTEM ACTIVE]\n`;
    prompt += `Cycle: Day ${day}/28 | ${phase} | Contraception: ${contra}\n`;

    if (s.contraception === 'condom') {
        prompt += `Condom: {{char}} uses it during sex. May break (~15%).\n`;
    }

    if (p.isPregnant) {
        prompt += `{{user}} is PREGNANT. Tag [CONCEPTION_CHECK] is FORBIDDEN.`;
        return prompt;
    }

    prompt += `\nTag [CONCEPTION_CHECK]: add ONLY when vaginal ejaculation inside has ALREADY HAPPENED (past tense).\n`;
    prompt += `DO NOT add for: ongoing sex, future tense ("will cum"), anal, oral, external ejaculation, pull-out, intact condom.\n`;
    prompt += `Format (hidden at end): <!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->`;

    return prompt;
}

export function getPregnancyPrompt() {
    const s = getSettings();
    const p = getPregnancyData();
    
    if (!p.isPregnant) return '';

    const duration = s.pregnancyDuration || 40;
    const { weeks } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
    const progressPercent = (weeks / duration) * 100;
    
    let symptoms = getSymptomsForProgress(progressPercent, weeks);
    let recommendations = getRecommendationsForProgress(progressPercent);
    
    let dueDateStr = '—';
    if (p.conceptionDate) {
        const dueDate = calculateDueDate(p.conceptionDate);
        if (dueDate) {
            dueDateStr = dueDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        }
    }

    const sexText = formatSexIcons(p.fetusSex, true);
    const fetusCountText = formatFetusCount(p.fetusCount, 'full');
    const fetusSize = getFetusSizeForProgress(progressPercent, false);
    
    const healthInfo = getHealthInfo(p.healthStatus);
    let healthDetails = '';
    if (p.healthStatus !== 'normal' && p.complications?.length) {
        healthDetails = ` (${p.complications.filter(c => !c.resolved).map(c => c.type).join(', ')})`;
    }

    let prompt = `\n[OOC: PREGNANCY ACTIVE]\n`;
    prompt += `Term: ${weeks}/${duration} weeks (${Math.round(progressPercent)}%)\n`;
    prompt += `Due date: ${dueDateStr}\n`;
    prompt += `Fetus: ${fetusCountText}`;
    if (sexText) prompt += ` | Sex: ${sexText}`;
    prompt += `\nSize: ${fetusSize}\n`;
    prompt += `Health: ${healthInfo.text}${healthDetails}\n`;
    prompt += `Symptoms: ${symptoms}\n`;
    prompt += `Recommendations: ${recommendations}\n`;

    const birthThreshold = Math.floor(duration * 0.9);
    if (weeks >= birthThreshold) {
        prompt += `\nBIRTH possible now (${weeks}/${duration} wk). If {{user}} gives birth, add at end: <!-- [BIRTH] -->\n`;
        prompt += `Do NOT add if: just talking about birth, preparing, not yet born.`;
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

    const phaseInfo = getPhaseInfo(result.cycleDay);

    let codeBlock = '```\n';
    codeBlock += `CONCEPTION CHECK\n`;
    codeBlock += `Cycle day: ${result.cycleDay} (${phaseInfo.name})\n`;
    codeBlock += `Roll: ${result.roll} | Threshold: ${result.chance}\n`;
    if (result.contraceptionFailed) codeBlock += `Contraception FAILED!\n`;

    if (result.success) {
        const sexes = formatSexIcons(p.fetusSex, true);
        codeBlock += `RESULT: PREGNANT! ${formatFetusCount(p.fetusCount)} | Sex: ${sexes}\n`;
    } else {
        codeBlock += `RESULT: No conception\n`;
    }
    codeBlock += '```';

    const oocPrompt = `[OOC: Display this block at the START of your response:\n${codeBlock}]`;

    setExtensionPrompt(extensionName + '-result', oocPrompt, extension_prompt_types.IN_CHAT, 0);
    updatePromptInjection();

    setTimeout(() => {
        setExtensionPrompt(extensionName + '-result', '', extension_prompt_types.IN_CHAT, 0);
    }, 2000);
}
