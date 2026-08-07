// ═══════════════════════════════════════════
// PROMPTS — инъекция промптов для AI
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { extensionName } from './config.js';
import { getSettings, getPregnancyData, getPartnerData, getCycleDay, carrierName, isTracked } from './state.js';
import { isOmegaverse, designationOf, carrierAboStatus, getCfg, sexOf, hasMenstrualCycle, canCarry, hasAnyTracking } from './omegaverse.js';
import { pregnancyIsKnown, daysSinceConception, getPostpartum, monthsTrying } from './pregnancy.js';
import { fertileWindow, missedDays, conceptionStruggle } from './fertility.js';
import { getFlow, getHygieneState, realismPromptLine, hoursBetween, DISRUPTIONS } from './cycle-realism.js';
import { getPhaseInfo, calculateWeeksFromDates, getSymptomsForProgress, getRecommendationsForProgress, formatFetusCount, getHealthInfo, detectChatLanguage } from './helpers.js';
import { calculateDueDate } from './date-parser.js';
import { babyAgeDays, getCareNorms, getCareNeeds, getGrowthStage } from './baby-care.js';

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

// ─── Блок правил вселенной A/B/O + текущие статусы носителей ───
// Компактно: 4 строки правил + по строке на носителя.
function buildUniverseBlock(s) {
    if (!isOmegaverse(s)) return '';
    let b = `[UNIVERSE: OMEGAVERSE]\n`;
    b += `Alphas: dominant instincts, go into RUT, knot during sex, sire offspring, CANNOT get pregnant. Omegas: go into HEAT, produce slick, CAN conceive regardless of gender. Betas: baseline humans, regular cycle.\n`;
    b += `Heat/rut drive behaviour: scent, instinct, possessiveness. Play them physically, not as a label.\n`;

    const line = (who) => {
        const desig = designationOf(s, who);
        const carrier = who === 'char' ? getPartnerData() : getPregnancyData();
        const st = carrierAboStatus(carrier, desig, s);
        const nm = who === 'char' ? '{{char}}' : '{{user}}';
        const role = desig === 'alpha' ? 'ALPHA' : desig === 'omega' ? 'OMEGA' : 'BETA';
        let t = `${nm} is ${role} — ${st.labelEn}.`;
        if (st.phase === 'heat') t += ` Portray the heat: feverish arousal, slick, craving to be knotted; fertility EXTREMELY high.`;
        else if (st.phase === 'preheat') t += ` Restless, rising warmth, scent thickening.`;
        else if (st.inRut) t += ` Portray the rut: aggression, scent-marking, relentless drive to breed and knot.`;
        return t + `\n`;
    };
    if (isTracked('user')) b += line('user');
    // Роль {{char}} важна даже если он не отслеживается как носитель (альфа в гоне влияет на сцену)
    b += line('char');
    return b + `\n`;
}

// ─── Строка статуса цикла носителя (обычный мир или омегаверс) ───
function carrierCycleLine(who, s) {
    if (!hasAnyTracking(s, who)) return '';
    const carrier = who === 'char' ? getPartnerData() : getPregnancyData();
    const nm = who === 'char' ? '{{char}}' : '{{user}}';
    if (isOmegaverse(s)) {
        const st = carrierAboStatus(carrier, designationOf(s, who), s);
        const parts = [st.labelEn];
        // У женщин в омегаверсе месячные тоже идут — добавляем вторым пунктом
        if (hasMenstrualCycle(s, who)) {
            const d = who === 'char' ? (carrier.cycleDay || 1) : getCycleDay();
            const ph = d <= 5 ? 'Menstruation' : d <= 11 ? 'Follicular' : d <= 16 ? 'Ovulation' : 'Luteal';
            parts.push(`cycle day ${d}/28 (${ph})`);
        }
        return `${nm}: ${parts.join(', ')}`;
    }
    // Носитель без месячных (мужчина, которого игрок сделал носителем) — цикла нет,
    // но он всё равно может зачать: так и пишем, без выдуманного дня цикла
    if (!hasMenstrualCycle(s, who)) {
        return canCarry(s, who) ? `${nm}: no menstrual cycle, but CAN conceive` : '';
    }
    const day = who === 'char' ? (carrier.cycleDay || 1) : getCycleDay();
    const phase = day <= 5 ? 'Menstruation' : day <= 11 ? 'Follicular' : day <= 16 ? 'Ovulation' : 'Luteal';
    // Сбитый цикл: день ушёл за 28 — это задержка, а не 29-й день из ниоткуда
    if (day > 28) return `${nm}: period is ${day - 28} day(s) late (cycle disrupted)`;
    return `${nm}: cycle day ${day}/28 (${phase})`;
}

// ─── Шкала срока ───
// Беременность может длиться не 40 недель (короткий сеттинг, нечеловеческий вид).
// Без явного пересчёта модель описывает плод по реальным неделям: «4 недели —
// маковое зёрнышко», хотя 4 из 24 — это уже треть пути.
function termScaleBlock(duration, weeks, progressPercent) {
    if (!duration || duration === 40) return '';
    const humanEq = Math.max(1, Math.round((progressPercent / 100) * 40));
    let b = `[TERM SCALE — READ BEFORE DESCRIBING THE PREGNANCY]\n`;
    b += `A full pregnancy in this setting lasts ${duration} weeks, NOT the real-life 40. `;
    b += `Week ${weeks} of ${duration} is ${Math.round(progressPercent)}% of the way — developmentally that matches about week ${humanEq} of a real 40-week pregnancy.\n`;
    b += `Scale EVERYTHING to this timeline: fetal size and development, belly, symptoms, what doctors say, how far along she looks. `;
    b += `Never describe the fetus as if it were at real-life week ${weeks}.\n`;
    return b;
}

// ─── Реализм цикла ───
// Тело носителя как часть сцены: самочувствие по фазе, гигиена в месячные,
// сбои цикла. Держим коротко — это идёт в каждый ответ.
function realismBlock(s, p) {
    if (!s.realism || p.isPregnant) return '';
    if (!hasMenstrualCycle(s, 'user') || !isTracked('user')) return '';
    const day = getCycleDay();
    const flow = getFlow(day);
    const hy = flow.factor > 0
        ? getHygieneState(p.hygieneType || 'pad', hoursBetween(p.hygieneChangedRpDate, p.rpDate), flow)
        : null;

    let b = `\n[BODY]\n`;
    b += `{{user}} right now: ${realismPromptLine(day, hy, { lang: 'en' })}.\n`;
    b += `Let this colour the scene — energy, patience, appetite, what she wants or avoids — without turning it into the plot.\n`;
    // Органичность: партнёр не телепат
    b += `Others know ONLY what is visible or told: a hand pressed to her back, painkillers, a hot-water bottle, a stain, her saying so. Nobody senses a phase or a fertile day.\n`;
    if (hy && (hy.overdue || hy.type.id === 'none')) {
        b += `If the scene allows, she would deal with it — stepping out, checking, asking for a spare. Play it plainly, no euphemisms and no drama.\n`;
    }
    b += `[CYCLE EVENT] Only if something in THIS reply would genuinely disrupt a cycle (severe stress, illness, starvation, long-haul travel, overtraining), add to RP_STATUS: "cycle_event":"stress|illness|starvation|travel|overtrain". Otherwise omit the field.\n`;
    return b;
}

// ─── Блок беременности партнёра ({{char}}) для промпта ───
function partnerPregnancyBlock(s) {
    if (!isTracked('char')) return '';
    // Носителем {{char}} может и не быть (мужчина, альфа) — но статус для него
    // всё равно нужен, иначе инфоблок бота остаётся с зашитыми заглушками.
    const carries = canCarry(s, 'char');
    const c = getPartnerData();
    const p = getPregnancyData();
    const langReq = langRequirement();
    let b = '';

    if (c.isPregnant && carries) {
        const dur = s.pregnancyDuration || 40;
        const { weeks } = calculateWeeksFromDates(c.conceptionDate, p.rpDate, c.pregnancyWeeks);
        const pct = (weeks / dur) * 100;
        b += `\n[{{char}} IS PREGNANT — carrier: {{char}}]\n`;
        b += `Term: ${weeks}/${dur} weeks | Fetus: ${formatFetusCount(c.fetusCount, 'full', 'en')}`;
        if (c.fetusSexRevealed && c.fetusSex?.length) b += ` | Sex: ${sexToText(c.fetusSex)}`;
        else b += ` | Sex: unknown yet`;
        if (c.fatherName) b += ` | Father: ${c.fatherName}`;
        b += `\n${termScaleBlock(dur, weeks, pct)}`;
        b += `Symptoms now: ${getSymptomsForProgress(pct, weeks, 'en')}\n`;
        b += `[BIRTH:CHAR TAG] If {{char}} ACTUALLY GIVES BIRTH in this reply (baby is out, first cry — not just labor), add at the END:\n`;
        b += `<!-- [BIRTH:CHAR] -->\n`;
        b += `plus <!-- [BABY_TRAITS:{"babies":[{"name":"...","fatherName":"...","personality":["..."],"appearance":["..."]}]}] -->\n`;
        if (!c.fetusSexRevealed) {
            b += `[SEX_REVEAL:CHAR] If the baby's sex is medically revealed this reply: <!-- [SEX_REVEAL:CHAR] -->\n`;
        }
    } else if (carries) {
        b += `\n[{{char}} IS A CARRIER — can get pregnant]\n`;
        b += `[CONCEPTION:CHAR TAG] If in THIS reply someone finishes INSIDE {{char}} (internal release / creampie${isOmegaverse(s) ? ' / knotting' : ''}), add at the END:\n`;
        b += `<!-- [CONCEPTION_CHECK:CHAR] -->\n`;
        b += `Same rules as the {{user}} conception tag: HTML comment, verbatim, never paraphrased. Do NOT add it for {{user}}'s scenes — this tag is ONLY about {{char}} being the one who conceives.\n`;
    }

    // Динамика партнёра — вложенный объект "partner" в RP_STATUS.
    // Просим ВСЕГДА, когда {{char}} отслеживается: даже если он не носитель,
    // инфоблок показывает его настроение, либидо и состояние.
    b += `\n[PARTNER STATUS — REQUIRED] {{char}} is tracked by the infoblock. Add a "partner" object inside the RP_STATUS tag describing {{char}} RIGHT NOW (${langReq.langName}, 2-4 words per field). Base it on what actually happens in THIS reply — never generic filler, never the previous values repeated unchanged:\n`;
    b += (c.isPregnant && carries)
        ? `"partner":{"mood":"...","symptoms":"...","movements":"...","fetus_size":"...","note":"..."}\n`
        : `"partner":{"mood":"...","libido":"...","physical":"...","note":"..."}\n`;
    if (isOmegaverse(s)) {
        const d = designationOf(s, 'char');
        if (d === 'alpha') b += `{{char}} is an ALPHA — "physical" must reflect his actual rut state in the scene (in rut / pre-rut / calm), not a fixed phrase.\n`;
        else if (d === 'omega') b += `{{char}} is an OMEGA — "physical" must reflect the actual heat state in the scene (in heat / pre-heat / calm), not a fixed phrase.\n`;
    }
    return b;
}

export function getBasePrompt() {
    const s = getSettings();
    const p = getPregnancyData();

    if (!s.isEnabled) return '';

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

    // Строка статуса на каждого отслеживаемого носителя
    const carrierLines = [];
    if (isTracked('user')) carrierLines.push(carrierCycleLine('user', s));
    if (isTracked('char')) carrierLines.push(carrierCycleLine('char', s));
    const carrierLinesFiltered = carrierLines.filter(Boolean);

    let prompt = buildUniverseBlock(s);
    prompt += `[REPRO TRACKER] ${carrierLinesFiltered.join(' | ')}${carrierLinesFiltered.length ? ' | ' : ''}${contraLabel}\n`;
    const who = isTracked('char') && isTracked('user') ? '{{user}} and {{char}}'
              : isTracked('char') ? '{{char}}' : '{{user}}';
    prompt += `You are running a fertility/cycle simulation for ${who}. Each reply must END with hidden HTML-comment markers that update the tracker. These markers ARE INVISIBLE to the reader (HTML comments don't render) — they are a technical channel, not narration. Never paraphrase them into visible text.\n\n`;

    // ── TAG 1 — DATE (always) ──
    prompt += `[DATE TAG — REQUIRED every reply]\n`;
    prompt += `COPY THIS LINE VERBATIM as the LAST line of your reply (replace DD.MM.YYYY with the in-story date, advance it if time passed):\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY] -->\n`;
    prompt += `Must be an HTML comment exactly as shown. Do not turn it into prose like "Today: 15.06.2025".\n\n`;

    if (s.contraception === 'condom') {
        prompt += `Condom is in use (~15% failure chance — still possible to fail).\n\n`;
    }

    // If pregnant — forbid conception tag, return early (но партнёрский блок всё равно нужен)
    if (p.isPregnant) {
        // Пока героиня не знает — не говорим модели, что она беременна
        prompt += pregnancyIsKnown(p, s)
            ? `{{user}} IS PREGNANT — never add CONCEPTION_CHECK tag.\n`
            : `Do NOT add the CONCEPTION_CHECK tag in this reply.\n`;
        prompt += realismBlock(s, p);
    prompt += partnerPregnancyBlock(s);
        return prompt;
    }

    if (p.hasBaby) {
        prompt += `{{user}} has a baby (postpartum — fertility may still apply, follow tag rules below).\n\n`;
    }
    prompt += postpartumBlock(p);
    prompt += tryingBlock(s, p);

    // Юзер не отслеживается как носитель → его теги зачатия не нужны
    if (!isTracked('user')) {
        prompt += partnerPregnancyBlock(s);
        const lr = langRequirement();
        prompt += `\n[STATUS TAG — REQUIRED every reply]\n<!-- [RP_STATUS:{"note":"..."}] -->\n${lr.line}\n`;
        prompt += `\n[DATE TAG — REQUIRED every reply, very last line]\n<!-- [RP_DATE:DD.MM.YYYY] -->\n`;
        return prompt;
    }

    // ── TAG 2 — CONCEPTION (conditional) ──
    prompt += `[CONCEPTION TAG — conditional]\n`;
    prompt += `Trigger — ALL of these must be true in THIS reply's narrative:\n`;
    prompt += `  1. Semen is actually released INSIDE {{user}} — internal release / creampie / condom failing with release inside. Real semen from a body.\n`;
    prompt += `  2. The receiving person is {{user}}, nobody else. If the scene is between {{char}} and some other character (an NPC, a memory, a story someone tells), do NOT add the tag${isTracked('char') ? ' — that is what the :CHAR tag is for, and only when {{char}} is the one receiving' : ''}.\n`;
    prompt += `  3. It happens NOW, in this reply — not remembered, planned, imagined, feared or talked about.\n`;
    prompt += `NEVER add the tag for: toys of any kind (dildo, vibrator, plug, strap-on), fingers, oral, anal without internal release, dry humping, an orgasm with no semen inside, a condom that held, or a scene that merely mentions sex. When unsure — leave the tag out. A missed tag costs nothing; a false one starts a pregnancy that did not happen.\n`;
    prompt += `\n`;
    prompt += `When triggered, COPY THIS LINE VERBATIM at the END of your reply (after all the prose, on its own line):\n`;
    prompt += `<!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->\n`;
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
    prompt += `<!-- [RP_STATUS:{"libido":"...","mood":"...","physical":"...","note":"..."}] -->\n`;
    prompt += `"note" = 1 short sentence about {{user}}'s sensations from THIS scene. Must be an HTML comment; do NOT replace with a visible status block.\n`;
    prompt += `${langReq.line}\n\n`;

    prompt += partnerPregnancyBlock(s);

    prompt += `[ORDER OF TAGS — at the END of your reply, after all the prose, each on its own line]\n`;
    prompt += `Line N-2 (only if creampie this reply): <!-- [CYCLE_DAY:${day}][CONCEPTION_CHECK] -->\n`;
    if (isTracked('char')) prompt += `(+ <!-- [CONCEPTION_CHECK:CHAR] --> or <!-- [BIRTH:CHAR] --> when the event happens to {{char}})\n`;
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
        return postpartumBlock(p) + birthdayBlock(p) + getBabyPrompt(p);
    }

    // ── СКРЫТАЯ БЕРЕМЕННОСТЬ ──
    // Героиня ещё не знает: модель НЕ должна знать срок, пол и ПДР — только симптомы.
    if (!pregnancyIsKnown(p, s)) {
        return hiddenPregnancyPrompt(p, s);
    }

    const duration = s.pregnancyDuration || 40;
    const { weeks } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
    const progressPercent = (weeks / duration) * 100;

    const symptoms = getSymptomsForProgress(progressPercent, weeks, 'en');
    const recommendations = getRecommendationsForProgress(progressPercent, 'en');
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
    prompt += termScaleBlock(duration, weeks, progressPercent);
    prompt += `Due date: ${dueDateStr}\n`;
    prompt += `Fetus: ${fetusCountText}`;
    if (p.fetusSexRevealed && sexText) prompt += ` | Sex: ${sexText}`;
    else prompt += ` | Sex: unknown yet`;
    prompt += `Health: ${healthInfo.text}${healthDetails}\n`;
    prompt += `Symptoms: ${symptoms}\n`;
    prompt += `Recommendations: ${recommendations}\n`;

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

    // Miscarriage / abortion — прерывание беременности по сюжету
    {
        prompt += `\n[PREGNANCY LOSS TAGS — conditional]\n`;
        prompt += `If a MISCARRIAGE actually happens in this reply's narrative (the pregnancy is LOST: heavy bleeding with confirmed loss, doctor confirms fetal demise, etc. — NOT mere pain, fear or a threat), COPY THIS LINE VERBATIM at the END of your reply (HTML comment, hidden from reader):\n`;
        prompt += `<!-- [MISCARRIAGE] -->\n`;
        prompt += `If an ABORTION is actually performed on {{user}} in this reply (procedure completed — NOT just discussed, planned, or on the way to the clinic), add instead:\n`;
        prompt += `<!-- [ABORTION] -->\n`;
        prompt += `Either tag ENDS the pregnancy in the tracker. Never output them for scares, arguments, threats or intentions — only when the loss/procedure truly happens in this scene. Do NOT also output BIRTH.\n`;
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
        optFields.push('"fetus_size"');
        // Пороги — по ДОЛЕ срока, а не по абсолютной неделе: при короткой
        // беременности 20-я неделя может быть уже финишем, а не серединой.
        if (progressPercent >= 40) optFields.push('"movements"');
        if (progressPercent >= 50) optFields.push('"swelling" (or null)');
        if (progressPercent >= 70) optFields.push('"braxton_hicks" (or null)');
        if (progressPercent >= 80) optFields.push('"fetal_position"');
        optFields.push('"note"');
        const langReqP = langRequirement();
        prompt += `\n[STATUS TAG — REQUIRED every reply]\n`;
        prompt += `COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, ${langReqP.langName} 2-5 words/field, null if irrelevant, describes {{user}}):\n`;
        prompt += `<!-- [RP_STATUS:{${optFields.join(',')}}] -->\n`;
        prompt += `"note" = 1 short sentence about {{user}}'s state from THIS scene. Must be HTML comment, not a visible status block.\n`;
        prompt += `"fetus_size" = how big the baby is NOW — your call, with a rough length and weight. Pick whatever comparison fits this story and this character: a fruit if you like, but just as easily a coin, a kitten, a clenched fist, a paperback, a tool from her trade, something from the setting. Vary it between replies instead of walking down the same produce aisle. Fit it to the ${duration}-week term above (${Math.round(progressPercent)}% of the way), NOT to real-life week ${weeks}. The tracker has no size table — this field is the only source.\n`;
        prompt += `${langReqP.line}\n`;
    }

    // Партнёр-носитель (когда отслеживаются оба)
    prompt += partnerPregnancyBlock(s);

    prompt += `\n[DATE TAG — REQUIRED every reply]\n`;
    prompt += `COPY THIS LINE VERBATIM as the LAST line of your reply:\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY] -->\n\n`;

    prompt += `[ORDER OF TAGS — at the END of your reply, after all the prose, each on its own line]\n`;
    prompt += `<!-- [PREGNANCY_STATE:{...}] -->\n`;
    if (!p.fetusSexRevealed) prompt += `<!-- [SEX_REVEAL] --> (if sex revealed this reply)\n`;
    prompt += `<!-- [BIRTH] --> + <!-- [BABY_TRAITS:{...}] --> (if birth this reply)\n`;
    prompt += `<!-- [MISCARRIAGE] --> or <!-- [ABORTION] --> (if the pregnancy ends this reply)\n`;
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

    // Хелпер: считаем возраст в днях/месяцах/годах от birthRpDate до p.rpDate
    const ageOf = (baby) => {
        if (!baby.birthRpDate || !p.rpDate) return 'newborn';
        const ms = new Date(p.rpDate).getTime() - new Date(baby.birthRpDate).getTime();
        if (isNaN(ms) || ms < 0) return 'newborn';
        const days = Math.floor(ms / 86400000);
        if (days < 30) return `${days}d`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months}m`;
        const years = Math.floor(months / 12);
        const rem = months % 12;
        return rem > 0 ? `${years}y ${rem}m` : `${years}y`;
    };

    let prompt = `\n[FAMILY — CHILDREN]\n`;

    // Активные дети (в инфоблоке)
    if (p.babies && p.babies.length > 0) {
        p.babies.forEach((baby, i) => {
            const sexT = baby.sex === 'M' ? 'boy' : baby.sex === 'F' ? 'girl' : 'unknown';
            const age = ageOf(baby);
            const stage = getGrowthStage(babyAgeDays(baby, p));
            prompt += `Child ${i + 1}: ${baby.name || 'unnamed'} (${sexT}, ${age}${stage ? `, стадия: ${stage.label}` : ''})`;
            if (baby.personality?.length > 0) prompt += ` | Personality: ${baby.personality.join(', ')}`;
            if (baby.appearance?.length > 0) prompt += ` | Appearance: ${baby.appearance.join(', ')}`;
            if (baby.fatherName) prompt += ` | Father: ${baby.fatherName}`;
            prompt += `\n`;

            // ── Возрастные нормы ухода (симуляция) ──
            const ageDays = babyAgeDays(baby, p);
            if (ageDays !== null) {
                const care = getCareNorms(ageDays, baby);
                prompt += `  Care norms (age ${ageDays}d): кормление — ${care.feeding} | сон — ${care.sleep} | ${care.diaper}`;
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
        });

        prompt += `\n[INFANT NEEDS — play them proactively]\n`;
        prompt += `The baby has REAL needs on a realistic schedule (see care norms and RIGHT NOW status above): gets hungry, needs diaper changes, gets tired and fussy, wakes at night, feels teething pain. In your replies the baby ACTS on these needs UNPROMPTED — cries when hungry/wet/tired, demands feeding on schedule, refuses to sleep, drools and chews things while teething, shows off new skills from "Recent development". Caring for the baby takes {{user}}'s real time and attention in scenes. Update ALL fields in RP_STATUS (mood/sleep/feeding/diaper/care_note) accordingly.\n`;
    } else {
        const sexText = p.babySex?.length > 0 ? sexToText(p.babySex) : 'unknown';
        prompt += `Name: ${p.babyName || 'not named yet'}\n`;
        prompt += `Sex: ${sexText}\n`;
    }

    // Архив старших детей (выросших) — для контекста
    if (Array.isArray(p.grownChildren) && p.grownChildren.length > 0) {
        prompt += `\n[OLDER CHILDREN — grown, no infant tracking but still in the family]\n`;
        p.grownChildren.forEach((c, i) => {
            const sexT = c.sex === 'M' ? 'son' : c.sex === 'F' ? 'daughter' : 'child';
            const cAge = ageOf(c);
            const cStage = getGrowthStage(babyAgeDays(c, p));
            prompt += `${i + 1}: ${c.name || 'unnamed'} (${sexT}${cAge !== 'newborn' ? `, ${cAge}` : ''}${cStage ? `, стадия: ${cStage.label}` : ''})`;
            if (c.personality?.length > 0) prompt += ` | ${c.personality.join(', ')}`;
            if (c.fatherName) prompt += ` | Father: ${c.fatherName}`;
            prompt += `\n`;
        });
        prompt += `Play older children ACCORDING TO their growth stage: тоддлер лепечет и везде лезет, дошкольник задаёт бесконечные «почему», школьник имеет своих друзей и секреты, подросток — своё мнение и бунт.\n`;
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

    // RP_STATUS для baby mode: только динамика (настроение/сон/кормление).
    // Поле "name" НЕ включаем — имя задаётся через диалог именования или BABY_TRAITS.
    {
        let babyKeys = '';
        if (p.babies && p.babies.length > 0) {
            babyKeys = p.babies.map((baby, i) => {
                // Идентифицируем малыша по имени/индексу для модели, но НЕ просим её возвращать имя
                const label = baby.name || `Baby${i+1}`;
                return `{"label":"${label}","mood":"...","sleep":"...","feeding":"...","diaper":"...","care_note":"...","milestone":null}`;
            }).join(',');
        } else {
            babyKeys = `{"label":"Baby","mood":"...","sleep":"...","feeding":"...","diaper":"...","care_note":"...","milestone":null}`;
        }
        const langReqB = langRequirement();
        prompt += `\n[STATUS TAG — REQUIRED every reply]\n`;
        prompt += `COPY THIS LINE VERBATIM at the END of your reply, on its own line (HTML comment, ${langReqB.langName} 2-4 words/field; "label" identifies the baby — keep as-is, do NOT rename):\n`;
        prompt += `<!-- [RP_STATUS:{"babies":[${babyKeys}],"note":"..."}] -->\n`;
        prompt += `"feeding" = what the baby is doing NOW with food (e.g. "Хочет есть", "Накормлен", "Сосёт грудь", "Сыт").\n`;
        prompt += `"diaper" = current diaper state ("Чистый", "Мокрый", "Требует смены", "Сменили").\n`;
        prompt += `"care_note" = 1 short care recommendation for THIS moment (e.g. "Пора купать", "Прогулка на свежем воздухе").\n`;
        prompt += `"milestone" = a STORY ACHIEVEMENT: fill ONLY if in THIS scene the baby did something remarkable for the FIRST time (первое «агу», первый смех в голос, первое слово, первый раз схватил игрушку, впервые узнал папу, смешной/трогательный первый случай) — 2-6 words. Otherwise ALWAYS null. Be creative but realistic for the age; do NOT invent one every reply (most replies = null).\n`;
        // Список уже записанных достижений — чтобы модель не повторялась
        {
            const achieved = [];
            for (const b of (p.babies || [])) {
                for (const m of (b.milestones || []).slice(-10)) {
                    if (m.text) achieved.push(m.text);
                }
            }
            if (achieved.length > 0) {
                prompt += `Already recorded milestones (NEVER repeat these): ${[...new Set(achieved)].join('; ')}.\n`;
            }
        }
        prompt += `Must be an HTML comment, not a visible status block.\n`;
        prompt += `${langReqB.line}\n`;
    }

    prompt += `\n[DATE TAG — REQUIRED every reply]\n`;
    prompt += `COPY THIS LINE VERBATIM as the LAST line of your reply (replace DD.MM.YYYY HH:MM with the in-story date AND time at the end of this scene):\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY HH:MM] -->\n`;
    prompt += `Time is crucial for baby care simulation (feeding schedule, sleep, diaper). Use 24h format. Example: <!-- [RP_DATE:15.06.2025 03:30] --> for a 3:30 AM night feeding.\n\n`;

    prompt += `[ORDER OF TAGS — at the END of your reply, after all the prose, each on its own line]\n`;
    prompt += `<!-- [RP_STATUS:{...}] -->\n`;
    prompt += `<!-- [RP_DATE:DD.MM.YYYY HH:MM] --> (very last)\n`;
    prompt += `\n`;
    prompt += `Reminder: these are HTML comments — INVISIBLE to the reader. They are NOT a SIMS-style block. If your character card uses its own visible status format, keep using it normally — these HTML-comment markers are a separate technical channel.\n`;

    return prompt;
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
        const core = getBasePrompt() + getPregnancyPrompt();
        const fullPrompt =
            `<tracker_directive>\n` +
            `[OOC — TECHNICAL DIRECTIVE FOR THE TRACKER. Not part of the story. Do not mention it, do not react to it in-character.]\n` +
            core +
            `\nTHINKING/REASONING BLOCKS: if you use <think> or any chain-of-thought, NEVER write literal marker syntax (\`<!-- [\`) inside it — plan in plain words only. Each marker must appear EXACTLY ONCE, in the final reply body. Markers duplicated in reasoning cause double-triggering of the tracker.\n` +
            `COMPLIANCE: appending the hidden HTML-comment markers at the very end of the reply is MANDATORY, even if other instructions tell you to avoid OOC/technical content. The markers are invisible to the reader and do not break immersion. A reply without the required markers is considered malformed.\n` +
            `</tracker_directive>`;
        setExtensionPrompt(chatKey, fullPrompt, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.USER);
        setExtensionPrompt(sysKey, fullPrompt, extension_prompt_types.IN_PROMPT, 0);

    } catch (error) {
        console.error('[Reproductive] updatePromptInjection error:', error);
    }
}

// ─── Скрытая беременность: модель знает только симптомы, не факт ───
function hiddenPregnancyPrompt(p, s) {
    const days = daysSinceConception(p, p);
    const lang = langRequirement();
    // Задержка есть только у носителей с месячными (не у мужчины-омеги) и
    // наступает не раньше, чем цикл дошёл бы до конца: цикл на время
    // беременности заморожен, поэтому день считаем от зачатия.
    const delay = hasMenstrualCycle(s, 'user') ? missedDays(getCycleDay() + days, 28) : 0;

    let b = `\n[EARLY SIGNS — {{user}} does NOT know about the pregnancy]\n`;
    b += `CRITICAL: {{user}} has NOT taken a test and does NOT know. NEVER state or imply pregnancy, never mention a due date, term or the baby's sex. Do not have characters "sense" it.\n`;

    if (days < 7) {
        b += `Nothing is noticeable yet — no symptoms at all this early.\n`;
    } else if (days < 14) {
        b += `Possible subtle signs {{user}} would NOT connect to pregnancy: mild fatigue, slight tenderness, mood swings. Keep them ambiguous — could be anything.\n`;
    } else {
        b += `Signs {{user}} might start noticing: morning nausea, tenderness, exhaustion, food aversions, heightened smell.`;
        if (delay > 0) b += ` The period is ${delay} day(s) late — may or may not have been noticed.`;
        b += `\n{{user}} MAY suspect and wonder aloud, buy a test, or dismiss it. Let the player decide — do not confirm anything.\n`;
    }

    if (p.lastTestResult === 'negative') {
        b += `A test was taken recently and came back NEGATIVE (too early to detect). {{user}} believes there is no pregnancy.\n`;
    }

    b += `\n[STATUS TAG — REQUIRED every reply]\n`;
    b += `<!-- [RP_STATUS:{"libido":"...","mood":"...","physical":"...","note":"..."}] -->\n`;
    b += `Describe only what {{user}} actually feels. ${lang.line}\n`;
    b += `\n[DATE TAG — REQUIRED every reply, very last line]\n<!-- [RP_DATE:DD.MM.YYYY] -->\n`;
    return b;
}

// ─── Режим «планируем» + сложности с зачатием ───
function tryingBlock(s, p) {
    if (!s.tryingToConceive || p.isPregnant) return '';
    const w = fertileWindow(getCycleDay(), 28);
    const months = monthsTrying(p);
    const struggle = conceptionStruggle(months);

    let b = `\n[TRYING TO CONCEIVE]\n`;
    b += `{{user}} and her partner are actively trying for a baby. `;
    b += w.fertile
        ? `RIGHT NOW is her fertile window${w.peak ? ' — ovulation peak, the best possible timing' : ''}. She knows it and may initiate.\n`
        : `Not a fertile day — her next fertile window is in about ${w.daysToPeak} day(s).\n`;
    if (months > 0) b += `They have been trying for ${months} month(s).\n`;
    if (struggle) {
        b += `${struggle.label}. This weighs on her — play the quiet strain: hope each cycle, disappointment when her period comes, tension between the partners, thoughts about seeing a doctor.\n`;
    }
    return b;
}

// ─── Послеродовое восстановление ───
function postpartumBlock(p) {
    const pp = getPostpartum(p, p);
    if (!pp) return '';
    let b = `\n[POSTPARTUM — ${pp.days} days since birth]\n`;
    if (pp.healing) b += `Recovery: ${pp.healing}. `;
    if (pp.lochia) b += `Bleeding (lochia) still present. `;
    b += pp.lactating ? `She is breastfeeding: engorgement, leaking, night feeds, milk letdown when the baby cries.` : `She is not breastfeeding.`;
    b += `\n`;
    b += pp.cycleReturned
        ? `Her cycle has returned — she can conceive again.\n`
        : `Her cycle has NOT returned yet${pp.lactating ? ' (lactational amenorrhea)' : ''} — conception is very unlikely for now.\n`;
    if (pp.days < 42) b += `Sex is still physically uncomfortable or off the table; she tires fast and may feel touched-out.\n`;
    return b;
}

// ─── Дни рождения детей по RP-дате ───
function birthdayBlock(p) {
    if (!p.rpDate || !Array.isArray(p.babies)) return '';
    const now = new Date(p.rpDate);
    if (isNaN(now.getTime())) return '';
    const lines = [];
    const all = [...(p.babies || []), ...(p.grownChildren || [])];
    for (const k of all) {
        if (!k.birthRpDate) continue;
        const b = new Date(k.birthRpDate);
        if (isNaN(b.getTime())) continue;
        const years = now.getFullYear() - b.getFullYear();
        if (years < 1) continue;
        const sameDay = now.getDate() === b.getDate() && now.getMonth() === b.getMonth();
        if (sameDay) {
            lines.push(`TODAY is ${k.name || 'the child'}'s birthday — turning ${years}. The family would celebrate.`);
            continue;
        }
        const next = new Date(now.getFullYear(), b.getMonth(), b.getDate());
        if (next < now) next.setFullYear(now.getFullYear() + 1);
        const days = Math.round((next - now) / 86400000);
        if (days > 0 && days <= 3) {
            lines.push(`${k.name || 'A child'}'s birthday is in ${days} day(s) — turning ${years + (next.getFullYear() > now.getFullYear() ? 1 : 0)}.`);
        }
    }
    return lines.length ? `\n[BIRTHDAYS]\n${lines.join('\n')}\n` : '';
}
