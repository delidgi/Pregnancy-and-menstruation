// ═══════════════════════════════════════════
// PROMPTS — инъекция промптов для AI
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { extensionName } from './config.js';
import { getSettings, getPregnancyData, getCycleDay, dlog, dwarn } from './state.js';
import { getPhaseInfo, calculateWeeksFromDates, getSymptomsForProgress, getRecommendationsForProgress, getFetusSizeForProgress, formatFetusCount, getHealthInfo, detectChatLanguage } from './helpers.js';
import { calculateDueDate } from './date-parser.js';
import { getAllChildren, buildFamilyPromptBlock } from './family.js';
import { isOmegaverse, getHeatPhase, getRutPhase, getCfg } from './omegaverse.js';
import { babyAgeDays, getCareNorms, getCareNeeds } from './baby-care.js';

// Требование языка для значений в тегах: детектим язык чата, чтобы модель
// не писала "High"/"Anxious" в русской истории.
function langRequirement() {
    const lang = detectChatLanguage();
    const langName = lang === 'ru' ? 'Russian' : 'English';
    let line = `ALL values inside the tag JSON must be written in ${langName} — the language of the story.`;
    if (lang === 'ru') line += ` Do NOT write English values like "High"/"Normal"/"Anxious" — write «Высокая»/«Норма»/«Тревожное» etc.`;
    return { lang, langName, line };
}

function sexToText(arr) {
    if (!arr || arr.length === 0) return '';
    return arr.map(s => s === 'M' ? 'boy' : 'girl').join(', ');
}

// Опции размера промпта (галочки в панели: компакт / уход / CHILD_UPDATE)
function promptOpts() {
    const s = getSettings();
    return { compact: !!s.promptCompact };
}

// ─── CHILD_UPDATE — опциональный тег: модель сама дополняет профиль ребёнка ───
// Добавляется везде, где в контексте есть дети (вместе с семейным блоком).
function childUpdateInstruction(p) {
    const s = getSettings();
    if (s.promptChildUpdateTag === false) return '';
    const all = getAllChildren(p);
    if (all.length === 0) return '';
    const names = all.map(({ child }, i) => child.name || `Baby${i + 1}`).join('", "');
    if (s.promptCompact) {
        let t = `\n[CHILD_UPDATE — optional] If THIS reply sets a lasting NEW fact about a child ("${names}"), append (only changed fields, sparingly, story language):\n`;
        t += `<!-- [CHILD_UPDATE:{"name":"...","add_personality":["..."],"add_appearance":["..."],"eyes":"...","hair":"...","special":"...","note":"..."}] -->\n`;
        return t;
    }
    let t = `\n[CHILD PROFILE UPDATE — optional tag]\n`;
    t += `When THIS reply establishes a lasting NEW fact about a child ("${names}") — a personality trait shows itself, an appearance detail is described (eye/hair color!), a talent emerges, a memorable quirk — you MAY record it with an HTML comment at the END of your reply:\n`;
    t += `<!-- [CHILD_UPDATE:{"name":"<child's name>","add_personality":["..."],"add_appearance":["..."],"eyes":"...","hair":"...","special":"...","note":"..."}] -->\n`;
    t += `Include ONLY the fields that changed, omit the rest. One tag per child. Use SPARINGLY — only genuinely new lasting canon, not every reply. Values in the story's language. The tracker merges it into the child's profile so future scenes stay consistent.\n`;
    return t;
}

// ─── Блок правил вселенной A/B/O + текущие статусы обоих (этап 3) ───
function buildUniverseBlock(p, s) {
    if (!isOmegaverse(p)) return '';
    const cfg = getCfg(s);
    const userDesig = p.designation || 'omega';
    const partnerDesig = p.partner?.designation || 'alpha';

    let block = `[UNIVERSE: OMEGAVERSE — A/B/O dynamics apply]\n`;
    block += `Alphas: dominant instincts, experience RUTS, knot during sex, sire offspring, CANNOT get pregnant. Omegas: experience HEATS, CAN conceive regardless of gender. Betas: baseline humans with regular cycles.\n`;
    block += `Children inherit A/B/O genetics from their parents and PRESENT their secondary gender in their early teens.\n`;

    // Статус юзера
    if (userDesig === 'omega') {
        if (p.heatSuppressant) {
            block += `{{user}} is an OMEGA on heat suppressants — heat is chemically muted (no heat symptoms, low fertility).\n`;
        } else {
            const ph = getHeatPhase(p.heatCycleDay || 1, cfg);
            block += `{{user}} is an OMEGA. Heat cycle day ${ph.day}/${cfg.heatCycleLength} — ${ph.labelEn}.`;
            if (ph.phase === 'heat') block += ` Portray the heat: feverish arousal, heightened sensitivity, slick, instinctive craving for a knot; fertility EXTREMELY high.`;
            if (ph.phase === 'preheat') block += ` Heat is imminent: restlessness, rising warmth and sensitivity.`;
            block += `\n`;
        }
    } else if (userDesig === 'alpha') {
        if (p.heatSuppressant) {
            block += `{{user}} is an ALPHA (cannot get pregnant) on rut suppressants — rut is chemically muted (no rut symptoms, no rut fertility boost).\n`;
        } else if (p.rutSympatheticOnly) {
            const pOmegaInHeat = (p.partner?.designation === 'omega') && !p.partner?.heatSuppressant
                && getHeatPhase(p.partner?.heatCycleDay || 20, cfg).phase === 'heat';
            block += `{{user}} is an ALPHA (cannot get pregnant). Alphas here have NO rut cycle of their own — rut flares only SYMPATHETICALLY when their omega is in heat.${pOmegaInHeat ? ' RIGHT NOW the omega is in heat — {{user}} is in sympathetic rut.' : ''}\n`;
        } else {
            const rut = getRutPhase(p.rutCycleDay || 1, cfg);
            block += `{{user}} is an ALPHA (cannot get pregnant). Rut status: ${rut.labelEn}.\n`;
        }
    } else {
        block += `{{user}} is a BETA (regular human cycle).\n`;
    }

    // Статус партнёра ({{char}}) — важен даже без трекинга его беременности
    if (partnerDesig === 'alpha') {
        if (p.partner?.heatSuppressant) {
            block += `{{char}} is an ALPHA on rut suppressants — rut is chemically muted, no rut boost, no sympathetic rut.\n`;
        } else if (p.rutSympatheticOnly) {
            const userInHeatS = userDesig === 'omega' && !p.heatSuppressant && getHeatPhase(p.heatCycleDay || 1, cfg).phase === 'heat';
            block += `{{char}} is an ALPHA. Alphas here have NO rut cycle of their own — rut flares only SYMPATHETICALLY when their omega is in heat.${userInHeatS ? ' RIGHT NOW {{user}} is in heat — {{char}} is in sympathetic rut: heightened instincts, possessiveness, extreme libido.' : ''}\n`;
        } else {
            const rutP = getRutPhase(p.partner?.rutCycleDay || 30, cfg);
            block += `{{char}} is an ALPHA. Rut status: ${rutP.labelEn}.`;
            const userInHeat = userDesig === 'omega' && !p.heatSuppressant && getHeatPhase(p.heatCycleDay || 1, cfg).phase === 'heat';
            if (userInHeat && !rutP.inRut) block += ` (An alpha close to an omega in heat typically slips into sympathetic rut.)`;
            block += `\n`;
        }
    } else if (partnerDesig === 'omega') {
        if (p.partner?.heatSuppressant) {
            block += `{{char}} is an OMEGA on heat suppressants — heat is chemically muted (no heat symptoms, low fertility).\n`;
        } else {
            const phP = getHeatPhase(p.partner?.heatCycleDay || 20, cfg);
            block += `{{char}} is an OMEGA. Heat cycle day ${phP.day}/${cfg.heatCycleLength} — ${phP.labelEn}.\n`;
        }
    } else {
        block += `{{char}} is a BETA.\n`;
    }

    // Блокаторы запаха — только RP-флейвор
    if (p.scentBlockers) block += `{{user}} wears scent blockers — their scent is masked from others.\n`;
    if (p.partner?.scentBlockers) block += `{{char}} wears scent blockers — their scent is masked.\n`;

    block += `\n`;
    return block;
}

export function getBasePrompt() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!s.isEnabled) return '';

    const omega = isOmegaverse(p);
    const userDesig = omega ? (p.designation || 'omega') : null;
    const universeBlock = buildUniverseBlock(p, s);

    // Юзер не может беременеть (носитель — только партнёр, либо юзер — альфа):
    // цикл и зачатие юзера выключаем, но DATE-тег обязателен всегда — на нём
    // держится всё RP-время (недели партнёра, взросление детей, дни рождения).
    if (p.userCanCarry === false || (omega && userDesig === 'alpha')) {
        let prompt = universeBlock + `[REPRO TRACKER]\n`;
        prompt += `You are running a reproduction tracker for this RP. Each reply must END with hidden HTML-comment markers. These markers ARE INVISIBLE to the reader (HTML comments don't render) — a technical channel, not narration. Never paraphrase them into visible text.\n\n`;
        prompt += `[DATE TAG — REQUIRED every reply]\n`;
        prompt += `COPY THIS LINE VERBATIM as the LAST line of your reply (replace DD.MM.YYYY with the in-story date, advance it if time passed):\n`;
        prompt += `<!-- [RP_DATE:DD.MM.YYYY] -->\n`;
        prompt += `Must be an HTML comment exactly as shown.\n`;
        return prompt;
    }

    const day = getCycleDay();
    let phase = '';
    if (day <= 5) phase = 'Menstruation';
    else if (day <= 11) phase = 'Follicular';
    else if (day <= 16) phase = 'Ovulation';
    else phase = 'Luteal';

    const contraLabel =
        s.contraception === 'condom' ? 'Condom' :
        s.contraception === 'pill' ? 'Birth control pill' :
        s.contraception === 'iud' ? 'IUD' : 'No protection';

    // Шапка трекера: у омеги вместо 28-дневного цикла — статус течки
    const userIsOmega = omega && userDesig === 'omega';
    let headerLine;
    if (userIsOmega) {
        const cfg = getCfg(s);
        const heatStatus = p.heatSuppressant
            ? 'Heat suppressed (on suppressants)'
            : `Heat cycle day ${getHeatPhase(p.heatCycleDay || 1, cfg).day}/${cfg.heatCycleLength} — ${getHeatPhase(p.heatCycleDay || 1, cfg).labelEn}`;
        headerLine = `[REPRO TRACKER — OMEGAVERSE] ${heatStatus} | ${contraLabel}\n`;
    } else {
        headerLine = `[REPRO TRACKER] Cycle day ${day}/28 (${phase}) | ${contraLabel}\n`;
    }

    let prompt = universeBlock + headerLine;
    prompt += `You are running a fertility/cycle simulation for {{user}}. Each reply must END with hidden HTML-comment markers that update the tracker. These markers ARE INVISIBLE to the reader (HTML comments don't render) — they are a technical channel, not narration. Never paraphrase them into visible text.\n\n`;

    // ── TAG 1 — DATE (always) ──
    prompt += `[DATE TAG — REQUIRED every reply]\n`;
    prompt += `COPY THIS LINE VERBATIM as the LAST line of your reply (replace DD.MM.YYYY with the in-story date, advance it if time passed):\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY] -->\n`;
    prompt += `Must be an HTML comment exactly as shown. Do not turn it into prose like "Today: 15.06.2025".\n\n`;

    if (s.contraception === 'condom') {
        prompt += `Condom is in use (~15% failure chance — still possible to fail).\n\n`;
    }

    // If pregnant — forbid conception tag, return early
    if (p.isPregnant) {
        prompt += `{{user}} IS PREGNANT — never add CONCEPTION_CHECK tag.\n`;
        return prompt;
    }

    if (p.hasBaby) {
        prompt += `{{user}} has a baby (postpartum — fertility may still apply, follow tag rules below).\n\n`;
    }

    // ── TAG 2 — CONCEPTION (conditional) ──
    // ВАЖНО: модели парафразят инструкцию ("Output this tag" → "{Pregnancy Check: TRIGGERED}" в видимом тексте).
    // Нужно ЯВНО подчеркнуть: COPY VERBATIM, это HTML-комментарий, СКРЫТЫЙ ОТ ЧИТАТЕЛЯ.
    // Омега: без эха CYCLE_DAY (день течки трекается по RP_DATE), триггер упоминает узел
    const conceptionTagLine = userIsOmega
        ? `<!-- [CONCEPTION_CHECK] -->`
        : `<!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->`;
    prompt += `[CONCEPTION TAG — conditional]\n`;
    if (userIsOmega) {
        prompt += `Trigger: in this reply's narrative, a partner (typically an alpha) finishes or knots inside {{user}} (internal release / knotting / creampie / condom failure with release inside). Add the tag whenever the trigger is true.\n`;
    } else {
        prompt += `Trigger: in this reply's narrative, a male partner finishes inside {{user}}'s vagina (internal release / creampie / cum-inside / condom failure with release inside). Add the tag whenever the trigger is true.\n`;
    }
    prompt += `\n`;
    prompt += `When triggered, COPY THIS LINE VERBATIM at the END of your reply (after all the prose, on its own line):\n`;
    prompt += `${conceptionTagLine}\n`;
    prompt += `\n`;
    prompt += `CRITICAL FORMAT RULES (most models break these — read carefully):\n`;
    prompt += `  • It MUST be an HTML comment: starts with the four characters \`<!--\` and ends with the three characters \`-->\`.\n`;
    prompt += `  • The tag IS HIDDEN from the reader (HTML comments don't render). Do NOT visualize it.\n`;
    prompt += `  • DO NOT paraphrase. DO NOT write \`{Pregnancy Check: TRIGGERED}\`, \`[Conception happened]\`, \`*conception marker*\`, \`<conception_check>\`, or any other natural-language version. Those break the tracker.\n`;
    prompt += `  • DO NOT translate the tag to Russian. Leave \`CYCLE_DAY\` and \`CONCEPTION_CHECK\` exactly as English caps.\n`;
    prompt += `  • Even if your character card uses a different status format (SIMS-blocks, status panels, etc.), this specific tag MUST still be the HTML comment above — it's a separate technical channel.\n`;
    prompt += `\n`;
    prompt += `Do NOT add it if: no sex scene this reply / withdrawal before finish / release outside the vagina (mouth, hand, body, anal only) / only foreplay.\n\n`;

    // ── TAG 3 — RP_STATUS (always, dynamic) ──
    const langReq = langRequirement();
    prompt += `[STATUS TAG — REQUIRED every reply]\n`;
    prompt += `COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, fields in ${langReq.langName} 2-4 words, describes {{user}}):\n`;
    prompt += `<!-- [RP_STATUS:{"fertility":"...","libido":"...","mood":"...","physical":"...","note":"..."}] -->\n`;
    prompt += `"note" = 1 short sentence about {{user}}'s sensations from THIS scene. Must be an HTML comment; do NOT replace with a visible status block.\n`;
    prompt += `${langReq.line}\n\n`;

    prompt += `[ORDER OF TAGS — at the END of your reply, after all the prose, each on its own line]\n`;
    prompt += `Line N-2 (only if creampie this reply): ${conceptionTagLine}\n`;
    prompt += `Line N-1: <!-- [RP_STATUS:{...}] -->\n`;
    prompt += `Line N (very last): <!-- [RP_DATE:DD.MM.YYYY] -->\n`;
    prompt += `\n`;
    prompt += `Reminder: these are HTML comments — INVISIBLE to the reader. They are NOT a SIMS-style status block, NOT a header, NOT a tag the reader sees. If your character card has its own visible status format, KEEP using it normally — these HTML-comment markers are an additional, separate technical channel for the tracker.\n`;

    return prompt;
}

export function getPregnancyPrompt() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!p.isPregnant && !p.hasBaby) return '';

    // Baby prompt
    if (p.hasBaby) {
        return getBabyPrompt(p);
    }

    const duration = s.pregnancyDuration || 40;
    const { weeks } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
    const progressPercent = (weeks / duration) * 100;

    const symptoms = getSymptomsForProgress(progressPercent, weeks, 'en');
    const recommendations = getRecommendationsForProgress(progressPercent, 'en');
    const fetusSize = getFetusSizeForProgress(progressPercent, false, 'en');
    const sexText = sexToText(p.fetusSex);
    const fetusCountText = formatFetusCount(p.fetusCount, 'full', 'en');
    const healthInfo = getHealthInfo(p.healthStatus, 'en');

    let dueDateStr = '—';
    if (p.conceptionDate) {
        const dueDate = calculateDueDate(p.conceptionDate);
        if (dueDate) {
            dueDateStr = dueDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
        }
    }

    let healthDetails = '';
    if (p.healthStatus !== 'normal' && p.complications?.length > 0) {
        healthDetails = ` (${p.complications.filter(c => !c.resolved).map(c => c.type).join(', ')})`;
    }

    let prompt = `\n[PREGNANCY]\n`;
    prompt += `Term: ${weeks}/${duration} weeks (${Math.round(progressPercent)}%)\n`;
    prompt += `Due date: ${dueDateStr}\n`;
    prompt += `Fetus: ${fetusCountText}`;
    if (p.fetusSexRevealed && sexText) prompt += ` | Sex: ${sexText}`;
    else prompt += ` | Sex: unknown yet`;
    prompt += `\nSize: ${fetusSize}\n`;
    prompt += `Health: ${healthInfo.text}${healthDetails}\n`;
    prompt += `Symptoms: ${symptoms}\n`;
    prompt += `Recommendations: ${recommendations}\n`;

    // Старшие дети — семья остаётся в контексте и во время новой беременности
    prompt += buildFamilyPromptBlock(p, promptOpts());
    prompt += childUpdateInstruction(p);

    // ── PREGNANCY_STATE тег — ИММУТАБЕЛЬНЫЕ данные беременности ──
    // Расширка инструктирует модель ставить этот тег в КАЖДОМ ответе пока активна беременность.
    // Это источник правды для conception_date, fetus_count, fetus_sex, father.
    // Недели всегда считаются от conception_date в этом теге, не из текста ответа.
    {
        // Конвертируем conceptionDate в DD.MM.YYYY для модели (нам потом всё равно как парсить)
        let conceptionStr = '';
        if (p.conceptionDate) {
            const cd = new Date(p.conceptionDate);
            const dd = String(cd.getDate()).padStart(2, '0');
            const mm = String(cd.getMonth() + 1).padStart(2, '0');
            conceptionStr = `${dd}.${mm}.${cd.getFullYear()}`;
        }
        const sexJson = JSON.stringify(p.fetusSex || []);
        const fatherStr = p.fatherName || '?';

        prompt += `\n[PREGNANCY_STATE TAG — REQUIRED every reply while pregnant]\n`;
        prompt += `COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, hidden from reader):\n`;
        prompt += `<!-- [PREGNANCY_STATE:{"conception_date":"${conceptionStr}","fetus_count":${p.fetusCount || 1},"fetus_sex":${sexJson},"father":"${fatherStr}"}] -->\n`;
        prompt += `\n`;
        prompt += `Must be an HTML comment exactly as shown. DO NOT paraphrase into visible prose like "Pregnancy: 4 weeks" or {Pregnancy Active}.\n`;
        prompt += `Fields are IMMUTABLE — copy values AS-IS unless the RP narrative reveals a new fact (ultrasound reveals sex → update "fetus_sex"; second fetus discovered → update "fetus_count"). Never change "conception_date".\n`;
    }

    // Birth tag instruction — ВСЕГДА когда беременна. Роды могут случиться в любой момент:
    // преждевременные роды, выкидыш-как-роды по сюжету, ускоренное РП, ручная беременность
    // на нестандартной длительности и т.п. Расширка должна ловить роды независимо от срока.
    {
        const nearTerm = weeks >= Math.floor(duration * 0.85);
        prompt += `\n[BIRTH TAG — conditional${nearTerm ? ' — near due date!' : ''}]\n`;
        prompt += `If the baby is ACTUALLY BORN in this reply (delivered, out, first cry, cord cut — NOT just labor/contractions/pushing), COPY THIS LINE VERBATIM at the END of your reply (HTML comment, hidden from reader):\n`;
        prompt += `<!-- [BIRTH] -->\n`;
        prompt += `Plus this BABY_TRAITS line (values in ${langRequirement().langName}; "name" empty if not yet named):\n`;
        prompt += `<!-- [BABY_TRAITS:{"babies":[{"name":"...","fatherName":"...","personality":["...","..."],"appearance":["...","...","..."]}]}] -->\n`;
        prompt += `Must be HTML comments. Do NOT write "{BIRTH: triggered}" or similar visible text.\n`;
    }

    // Sex reveal tag instruction when sex is still unknown — always injected
    if (!p.fetusSexRevealed) {
        prompt += `\n[SEX_REVEAL TAG — conditional]\n`;
        prompt += `If the baby's sex is DEFINITIVELY learned in this reply via medical means (ultrasound / test / doctor) — NOT guessing or dreaming — COPY THIS LINE VERBATIM at the END of your reply (HTML comment, hidden):\n`;
        prompt += `<!-- [SEX_REVEAL] -->\n`;
    }

    // RP_STATUS — dynamic scene data for pregnancy mode — always injected
    {
        const optFields = [];
        optFields.push('"mood"');
        optFields.push('"libido"');
        optFields.push('"weight_gain"');
        optFields.push('"baby_activity"');
        optFields.push('"father_name" (or null)');
        optFields.push('"symptoms"');
        optFields.push('"recommendations"');
        if (weeks >= 16) optFields.push('"movements"');
        if (weeks >= 20) optFields.push('"swelling" (or null)');
        if (weeks >= 28) optFields.push('"braxton_hicks" (or null)');
        if (weeks >= 32) optFields.push('"fetal_position"');
        optFields.push('"note"');
        const langReqP = langRequirement();
        prompt += `\n[STATUS TAG — REQUIRED every reply]\n`;
        prompt += `COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, ${langReqP.langName} 2-5 words/field, null if irrelevant, describes {{user}}):\n`;
        prompt += `<!-- [RP_STATUS:{${optFields.join(',')}}] -->\n`;
        prompt += `"note" = 1 short sentence about {{user}}'s state from THIS scene. Must be HTML comment, not a visible status block.\n`;
        prompt += `${langReqP.line}\n`;
    }

    prompt += `\n[DATE TAG — REQUIRED every reply]\n`;
    prompt += `COPY THIS LINE VERBATIM as the LAST line of your reply:\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY] -->\n\n`;

    prompt += `[ORDER OF TAGS — at the END of your reply, after all the prose, each on its own line]\n`;
    prompt += `<!-- [PREGNANCY_STATE:{...}] -->\n`;
    if (!p.fetusSexRevealed) prompt += `<!-- [SEX_REVEAL] --> (if sex revealed this reply)\n`;
    prompt += `<!-- [BIRTH] --> + <!-- [BABY_TRAITS:{...}] --> (if birth this reply)\n`;
    prompt += `<!-- [RP_STATUS:{...}] -->\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY] --> (very last)\n`;
    prompt += `\n`;
    prompt += `Reminder: these are HTML comments — INVISIBLE to the reader. They are NOT a SIMS-style block, NOT a status header, NOT a marker the reader sees. If your character card uses its own visible status format, keep using it normally — these HTML-comment markers are a separate technical channel for the tracker.\n`;

    return prompt;
}

function getBabyPrompt(p) {
    const healthInfo = getHealthInfo(p.babyHealth || 'normal', 'en');
    const diaperText = p.babyDiaperClean ? 'clean' : 'needs changing';
    const teethingText = p.babyTeething ? 'teething' : 'no';

    // Единый семейный блок (активные + выросшие, стадии жизни, дни рождения)
    let prompt = buildFamilyPromptBlock(p, promptOpts());
    if (!prompt) {
        // Legacy fallback: hasBaby без массива babies (очень старые сохранения)
        const sexText = p.babySex?.length > 0 ? sexToText(p.babySex) : 'unknown';
        prompt = `\n[FAMILY — CHILDREN]\n`;
        prompt += `Name: ${p.babyName || 'not named yet'}\n`;
        prompt += `Sex: ${sexText}\n`;
    }

    prompt += childUpdateInstruction(p);

    // ── Возрастные нормы ухода (симуляция baby-care) — только активные малыши.
    // Выключается галочкой «Уход за малышом в промпте»; компакт режет пояснение.
    const sPrompt = getSettings();
    if (sPrompt.promptCareNorms !== false && Array.isArray(p.babies) && p.babies.length > 0) {
        for (const baby of p.babies) {
            const ageDays = babyAgeDays(baby, p);
            if (ageDays === null) continue;
            const care = getCareNorms(ageDays, baby);
            prompt += `Care norms — ${baby.name || 'baby'} (age ${ageDays}d): кормление — ${care.feeding} | сон — ${care.sleep} | ${care.diaper}`;
            if (care.teething) prompt += ` | зубки: ${care.teething}`;
            if (care.colic) prompt += ` | период колик (вечерний плач 1–3 ч, поджимает ножки)`;
            if (care.upcoming) prompt += ` | скоро: ${care.upcoming}`;
            prompt += `\n`;
            // Текущие потребности по времени суток
            const needs = getCareNeeds(ageDays, p.rpTime, baby);
            if (needs.feeding || needs.sleep || needs.diaper) {
                prompt += `  RIGHT NOW (${p.rpTime || '??:??'}): кормление=«${needs.feeding || '?'}» сон=«${needs.sleep || '?'}» подгузник=«${needs.diaper || '?'}»`;
                if (needs.careNote) prompt += ` (рек.: ${needs.careNote})`;
                prompt += `\n`;
            }
            const recentMs = (baby.milestones || []).slice(-3).map(m => m.text).join(', ');
            if (recentMs) prompt += `  Recent development: ${recentMs}\n`;
        }
        if (sPrompt.promptCompact) {
            prompt += `[INFANT NEEDS] The baby ACTS on the needs above unprompted (cries when hungry/wet/tired, teething fussiness, shows new skills); caring takes {{user}}'s real scene time. Update RP_STATUS fields accordingly.\n`;
        } else {
            prompt += `\n[INFANT NEEDS — play them proactively]\n`;
            prompt += `The baby has REAL needs on a realistic schedule (see care norms and RIGHT NOW status above): gets hungry, needs diaper changes, gets tired and fussy, wakes at night, feels teething pain. In your replies the baby ACTS on these needs UNPROMPTED — cries when hungry/wet/tired, demands feeding on schedule, refuses to sleep, drools and chews things while teething, shows off new skills from "Recent development". Caring for the baby takes {{user}}'s real time and attention in scenes. Update ALL fields in RP_STATUS (mood/sleep/feeding/diaper/care_note) accordingly.\n`;
        }
    }

    // Состояние младшего (для совместимости с RP_STATUS)
    prompt += `\n[YOUNGEST CHILD STATE]\n`;
    prompt += `Health: ${healthInfo.text}\n`;
    prompt += `Teething: ${teethingText}\n`;
    prompt += `Diaper: ${diaperText}\n`;
    prompt += `Feeding: ${p.babyFeedingType || 'breastfeeding'}\n`;
    prompt += `Sleep: ${p.babySleep || '—'}\n`;
    prompt += `Mood: ${p.babyMood || '—'}\n`;

    if (p.babyMilestones && p.babyMilestones.length > 0) {
        const recent = p.babyMilestones.slice(-3);
        prompt += `Milestones: ${recent.map(m => m.text).join(', ')}\n`;
    }

    // RP_STATUS — dynamic scene data for baby mode — always injected
    // ВАЖНО: не включаем поле "name" в шаблон. Имя малыша задаётся ОДИН РАЗ через диалог
    // именования или через BABY_TRAITS при родах. Если бы name был в шаблоне RP_STATUS,
    // модель могла бы либо вернуть плейсхолдер ("..."), либо самовольно поменять имя
    // в каждом сообщении. RP_STATUS — это только динамические состояния (настроение, сон, кормление).
    {
        let babyKeys = '';
        if (p.babies && p.babies.length > 0) {
            babyKeys = p.babies.map((baby, i) => {
                // Идентифицируем малыша по имени/индексу для модели, но НЕ просим её возвращать имя
                const label = baby.name || `Baby${i+1}`;
                return `{"label":"${label}","mood":"...","sleep":"...","feeding":"...","diaper":"...","care_note":"..."}`;
            }).join(',');
        } else {
            babyKeys = `{"label":"Baby","mood":"...","sleep":"...","feeding":"...","diaper":"...","care_note":"..."}`;
        }
        const langReqB = langRequirement();
        prompt += `\n[STATUS TAG — REQUIRED every reply]\n`;
        prompt += `COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, ${langReqB.langName} 2-4 words/field; "label" identifies the baby — keep as-is, do NOT rename):\n`;
        prompt += `<!-- [RP_STATUS:{"babies":[${babyKeys}],"note":"..."}] -->\n`;
        prompt += `Must be an HTML comment, not a visible status block.\n`;
        prompt += `${langReqB.line}\n`;
    }

    prompt += `\n[DATE TAG — REQUIRED every reply]\n`;
    prompt += `COPY THIS LINE VERBATIM as the LAST line of your reply:\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY HH:MM] -->\n`;
    prompt += `Time is crucial for baby care simulation (feeding schedule, sleep, diaper). Use 24h format. Example: <!-- [RP_DATE:15.06.2025 03:30] --> for a 3:30 AM night feeding.\n\n`;

    prompt += `[ORDER OF TAGS — at the END of your reply, after all the prose, each on its own line]\n`;
    prompt += `<!-- [RP_STATUS:{...}] -->\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY HH:MM] --> (very last)\n`;
    prompt += `\n`;
    prompt += `Reminder: these are HTML comments — INVISIBLE to the reader. They are NOT a SIMS-style block. If your character card uses its own visible status format, keep using it normally — these HTML-comment markers are a separate technical channel.\n`;

    return prompt;
}

// ─── Промпт партнёра-носителя (этап 2): цикл/зачатие или активная беременность ───
export function getPartnerPrompt() {
    const s = getSettings();
    if (!s.isEnabled) return '';
    const p = getPregnancyData();
    const pp = p.partner;
    if (!pp || !pp.enabled) return '';

    const name = pp.name || '{{char}}';

    // ── Партнёр НЕ беременна: цикл/течка + условный тег зачатия ──
    if (!pp.isPregnant) {
        const omega = isOmegaverse(p);
        const partnerDesig = omega ? (pp.designation || 'alpha') : null;

        // Альфа не беременеет — тег зачатия партнёра не нужен вовсе
        if (omega && partnerDesig === 'alpha') {
            let prompt = `\n[PARTNER TRACKER — ${name}]\n`;
            prompt += `${name} is an ALPHA and CANNOT conceive. Never emit a CONCEPTION_CHECK:PARTNER tag.\n`;
            return prompt;
        }

        const day = Math.max(1, Math.min(28, parseInt(pp.cycleDay) || 1));
        let phase = '';
        if (day <= 5) phase = 'Menstruation';
        else if (day <= 11) phase = 'Follicular';
        else if (day <= 16) phase = 'Ovulation';
        else phase = 'Luteal';
        const contraLabel =
            pp.contraception === 'condom' ? 'Condom' :
            pp.contraception === 'pill' ? 'Birth control pill' :
            pp.contraception === 'iud' ? 'IUD' : 'No protection';

        let prompt = `\n[PARTNER TRACKER — ${name}]\n`;
        if (omega && partnerDesig === 'omega') {
            // Омега-партнёр: статус течки вместо 28-дневного цикла
            const cfg = getCfg(s);
            const heatStatus = pp.heatSuppressant
                ? 'heat suppressed (on suppressants)'
                : `heat cycle day ${getHeatPhase(pp.heatCycleDay || 1, cfg).day}/${cfg.heatCycleLength} — ${getHeatPhase(pp.heatCycleDay || 1, cfg).labelEn}`;
            prompt += `${name} is an OMEGA and can conceive. Status: ${heatStatus} | ${contraLabel}\n`;
            prompt += `[PARTNER CONCEPTION TAG — conditional]\n`;
            prompt += `Trigger: in this reply's narrative, a partner (typically {{user}}) finishes or knots inside ${name} (internal release / knotting / creampie / condom failure with release inside).\n`;
        } else {
            prompt += `${name} can also conceive. Partner cycle day ${day}/28 (${phase}) | ${contraLabel}\n`;
            prompt += `[PARTNER CONCEPTION TAG — conditional]\n`;
            prompt += `Trigger: in this reply's narrative, a male partner (usually {{user}}) finishes inside ${name}'s vagina (internal release / creampie / condom failure with release inside).\n`;
        }
        prompt += `When triggered, COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, hidden from reader):\n`;
        prompt += `<!-- [CONCEPTION_CHECK:PARTNER] -->\n`;
        prompt += `The :PARTNER suffix means ${name} conceives — do NOT confuse with {{user}}'s own CONCEPTION_CHECK tag (without suffix). Same format rules: HTML comment, copy verbatim, do NOT paraphrase or translate.\n`;
        prompt += `Do NOT add it if: no sex scene this reply / release outside ${name} / only foreplay.\n`;
        return prompt;
    }

    // ── Партнёр БЕРЕМЕННА: состояние + теги PREGNANCY_STATE/BIRTH/SEX_REVEAL с :PARTNER ──
    const duration = s.pregnancyDuration || 40;
    const { weeks } = calculateWeeksFromDates(pp.conceptionDate, p.rpDate, pp.pregnancyWeeks);
    const progressPercent = (weeks / duration) * 100;
    const sexText = sexToText(pp.fetusSex);
    const healthInfo = getHealthInfo(pp.healthStatus, 'en');

    let dueDateStr = '—';
    let conceptionStr = '';
    if (pp.conceptionDate) {
        const dueDate = calculateDueDate(pp.conceptionDate);
        if (dueDate) dueDateStr = dueDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
        const cd = new Date(pp.conceptionDate);
        conceptionStr = `${String(cd.getDate()).padStart(2, '0')}.${String(cd.getMonth() + 1).padStart(2, '0')}.${cd.getFullYear()}`;
    }

    let prompt = `\n[PARTNER PREGNANCY — ${name}]\n`;
    prompt += `${name} is pregnant. Term: ${weeks}/${duration} weeks (${Math.round(progressPercent)}%)\n`;
    prompt += `Due date: ${dueDateStr}\n`;
    prompt += `Fetus: ${formatFetusCount(pp.fetusCount, 'full', 'en')}`;
    if (pp.fetusSexRevealed && sexText) prompt += ` | Sex: ${sexText}`;
    else prompt += ` | Sex: unknown yet`;
    prompt += `\nHealth: ${healthInfo.text}\n`;
    prompt += `Symptoms: ${getSymptomsForProgress(progressPercent, weeks, 'en')}\n`;
    prompt += `Father: ${pp.fatherName || '{{user}}'}\n`;
    prompt += `Portray ${name}'s pregnancy consistently with this term (belly size, symptoms, mood).\n`;

    prompt += `\n[PARTNER PREGNANCY_STATE TAG — REQUIRED every reply while ${name} is pregnant]\n`;
    prompt += `COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, hidden). The "carrier":"partner" field marks WHOSE pregnancy this is:\n`;
    prompt += `<!-- [PREGNANCY_STATE:{"carrier":"partner","conception_date":"${conceptionStr}","fetus_count":${pp.fetusCount || 1},"fetus_sex":${JSON.stringify(pp.fetusSex || [])},"father":"${pp.fatherName || '?'}"}] -->\n`;
    prompt += `Fields are IMMUTABLE — copy values AS-IS unless the narrative reveals a new fact. Never change "conception_date". If {{user}} is ALSO pregnant, emit BOTH PREGNANCY_STATE tags — hers WITHOUT carrier field, this one WITH "carrier":"partner".\n`;

    prompt += `\n[PARTNER BIRTH TAG — conditional]\n`;
    prompt += `If ${name}'s baby is ACTUALLY BORN in this reply (delivered, out, first cry — NOT just labor/contractions), COPY THIS LINE VERBATIM at the END (HTML comment):\n`;
    prompt += `<!-- [BIRTH:PARTNER] -->\n`;
    prompt += `Plus the usual BABY_TRAITS line: <!-- [BABY_TRAITS:{"babies":[{"name":"...","fatherName":"...","personality":["..."],"appearance":["..."]}]}] -->\n`;

    if (!pp.fetusSexRevealed) {
        prompt += `\n[PARTNER SEX_REVEAL TAG — conditional]\n`;
        prompt += `If ${name}'s baby's sex is DEFINITIVELY learned via medical means this reply (ultrasound/test): COPY VERBATIM <!-- [SEX_REVEAL:PARTNER] --> at the END (HTML comment).\n`;
    }

    prompt += `\n[PARTNER STATUS — extend RP_STATUS]\n`;
    prompt += `Inside your RP_STATUS JSON add a "partner" object describing ${name}: "partner":{"mood":"...","weight_gain":"...","baby_activity":"...","note":"..."} (RU, 2-4 words per field).\n`;

    return prompt;
}

// Семейный контекст для режима цикла (не беременна, активных малышей нет,
// но есть выросшие дети). В baby/pregnancy режимах блок уже встроен в их промпты.
function getFamilyContextPrompt() {
    const p = getPregnancyData();
    if (p.isPregnant || p.hasBaby) return '';
    if (getAllChildren(p).length === 0) return '';
    return buildFamilyPromptBlock(p, promptOpts()) + childUpdateInstruction(p);
}

export function updatePromptInjection() {
    try {
        const s = getSettings();

        const chatKey = extensionName;          // IN_CHAT depth 0 — прямо перед ответом
        const sysKey = extensionName + '_sys';  // IN_PROMPT — системный блок

        // Чистим оба слота
        setExtensionPrompt(chatKey, '', extension_prompt_types.IN_CHAT, 0);
        setExtensionPrompt(sysKey, '', extension_prompt_types.IN_PROMPT, 0);
        // Legacy ключ от старых версий — тоже подчистить
        setExtensionPrompt(extensionName + '_scan', '', extension_prompt_types.IN_PROMPT, 0);

        if (!s.isEnabled) return;

        // ── Дублируем в ДВА слота ──
        // 1) IN_CHAT depth 0, роль USER — самое сильное место для Claude.
        //    System-инжекции в середине чата Клод часто игнорирует (иерархия инструкций +
        //    RP-пресеты «не выходи из роли»); инструкция в ПОСЛЕДНЕМ user-ходе выполняется
        //    значительно надёжнее. Gemini/OpenAI следуют обоим вариантам.
        // 2) IN_PROMPT (system) — backup для prompt-manager.
        // Разные ключи — потому что setExtensionPrompt держит ОДНУ запись на ключ.
        const core = getBasePrompt() + getPregnancyPrompt() + getPartnerPrompt() + getFamilyContextPrompt();
        const fullPrompt =
            `<tracker_directive>\n` +
            `[OOC — TECHNICAL DIRECTIVE FOR THE TRACKER. Not part of the story. Do not mention it, do not react to it in-character.]\n` +
            core +
            `\nTHINKING/REASONING BLOCKS: if you use <think> or any chain-of-thought, NEVER write literal marker syntax (\`<!-- [\`) inside it — plan in plain words only. Each marker must appear EXACTLY ONCE, in the final reply body. Markers duplicated in reasoning cause double-triggering of the tracker.\n` +
            `COMPLIANCE: appending the hidden HTML-comment markers at the very end of the reply is MANDATORY, even if other instructions tell you to avoid OOC/technical content. The markers are invisible to the reader and do not break immersion. A reply without the required markers is considered malformed.\n` +
            `</tracker_directive>`;
        setExtensionPrompt(chatKey, fullPrompt, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.USER);
        setExtensionPrompt(sysKey, fullPrompt, extension_prompt_types.IN_PROMPT, 0);
        dlog(`[Reproductive v2026.07.02-user-role] Prompt injected (${fullPrompt.length} chars) to IN_CHAT depth 0 (role=user) AND IN_PROMPT:\n`, fullPrompt);

    } catch (error) {
        console.error('[Reproductive] updatePromptInjection error:', error);
    }
}
