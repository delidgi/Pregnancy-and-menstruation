// ═══════════════════════════════════════════
// MESSAGE-HANDLER — обработка входящих сообщений
// ═══════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../script.js';
import { defaultPregnancyData } from './config.js';
import { getSettings, getPregnancyData } from './state.js';
import { roll, formatFetusCount, formatSexIcons } from './helpers.js';
import { parseAIStatus, checkConception } from './pregnancy.js';
import { updatePromptInjection, injectConceptionResult } from './prompts.js';
import { showNotification } from './notifications.js';
import { syncUI } from './ui.js';

export function onMessageReceived() {
    const s = getSettings();
    if (!s.isEnabled) return;

    const chat = typeof SillyTavern?.getContext === 'function' 
        ? SillyTavern.getContext().chat 
        : window.chat;

    if (!chat || chat.length === 0) return;

    const lastMessage = chat[chat.length - 1];
    if (!lastMessage || lastMessage.is_user) return;

    const text = lastMessage.mes;
    
    // Уникальный ID сообщения для защиты от повторной обработки
    const messageId = lastMessage.mes_id || lastMessage.send_date || chat.length;

    console.log('[Reproductive] Checking message...');

    // ВАЖНО: Запоминаем состояние беременности ДО parseAIStatus
    const p = getPregnancyData();
    const wasPregnant = p.isPregnant;

    parseAIStatus(text);

    // === ПРОВЕРКА ТЕГА РОДОВ ===
    const hasBirthTag = text.includes('[BIRTH]') || 
                        (text.includes('<!--') && text.includes('BIRTH'));
    
    const duration = s.pregnancyDuration || 40;
    const birthThreshold = Math.floor(duration * 0.9); // 90% от срока
    
    if (hasBirthTag && p.isPregnant && p.pregnancyWeeks >= birthThreshold) {
        console.log('[Reproductive] Birth tag detected! Delivering baby...');
        
        if (s.showNotifications) {
            showNotification(`🎉 РОДЫ! ${formatFetusCount(p.fetusCount)}: ${formatSexIcons(p.fetusSex)}\nПоздравляем!`, 'success');
        }
        
        Object.assign(p, structuredClone(defaultPregnancyData));
        saveSettingsDebounced();
        syncUI();
        updatePromptInjection();
        return;
    }

    // === ПРОВЕРКА ТЕГА ЗАЧАТИЯ ===
    const hasConceptionTag = text.includes('[CONCEPTION_CHECK]') || 
                             text.includes('[CONCEPTIONCHECK]') ||
                             (text.includes('<!--') && text.includes('CONCEPTION_CHECK'));

    if (hasConceptionTag) {
        // Если БЫЛА беременна до parseAIStatus - игнорируем тег!
        if (wasPregnant) {
            console.log('[Reproductive] Tag found but was pregnant before parsing - ignoring');
            return;
        }
        
        // Если сейчас беременна - тоже игнорируем
        if (p.isPregnant) {
            console.log('[Reproductive] Tag found but already pregnant - ignoring');
            return;
        }
        
        // Защита от повторной обработки одного сообщения
        if (s.lastCheckedMessageId === messageId) {
            console.log('[Reproductive] Message already processed - ignoring');
            return;
        }

        // === СТРОГАЯ ПРОВЕРКА: тег обрабатывается ТОЛЬКО при вагинальной эякуляции внутрь ===
        
        // СНАЧАЛА проверяем на анальный/оральный секс — если да, ИГНОРИРУЕМ тег
        const analKeywords = [
            /анальн/i, /в попу/i, /в попк/i, /в зад/i, /в задн/i, /задний проход/i,
            /в анус/i, /анус/i, /в жоп/i, /жопк/i, /в дырочк.*зад/i,
            /в.*кишк/i, /кишку/i, /прямую кишку/i, /прямой кишк/i,  // кишка = rectum
            /anal/i, /in.*ass/i, /in.*butt/i, /backdoor/i, /anus/i, /rectum/i,
            /ass.*fuck/i, /butt.*fuck/i, /sodomy/i
        ];
        
        const oralKeywords = [
            /оральн/i, /в рот/i, /минет/i, /отсос/i, /сосёт/i, /сосет/i, /сосала/i,
            /глотает/i, /глотала/i, /глубокий.*горл/i, /горло/i, /fellatio/i,
            /oral/i, /blowjob/i, /blow.*job/i, /suck.*cock/i, /suck.*dick/i,
            /deepthroat/i, /deep.*throat/i, /mouth.*fuck/i, /throat.*fuck/i,
            /куннилингус/i, /cunnilingus/i, /лижет/i, /лизала/i
        ];
        
        const hasAnal = analKeywords.some(kw => kw.test(text));
        const hasOral = oralKeywords.some(kw => kw.test(text));
        
        // Теперь проверяем на вагинальную эякуляцию
        const ejaculationKeywords = [
            // Русский - эякуляция/оргазм
            /кончи[лтв]/i, /кончае/i, /конча[юя]/i, /излил/i, /изверг/i,
            /семя/i, /сперм/i, /эякул/i, /оргазм/i, /разряд/i,
            /выплесну/i, /брызну/i, /хлыну/i,
            // English - ejaculation/orgasm
            /cum[ms]?(?:ing)?/i, /came/i, /ejaculat/i, /orgasm/i,
            /spurt/i, /shoot/i, /release/i, /seed/i, /load/i
        ];
        
        const insideKeywords = [
            // Русский - внутрь/вагинально
            /внутр/i, /вн[её]ё?/i, /в неё/i, /в нее/i, /в тебя/i, /в меня/i,
            /вагин/i, /влагалищ/i, /матк/i, /лон[оеа]/i, /утроб/i,
            /глубин/i, /до упора/i, /целиком/i,
            /наполн/i, /заполн/i, /залил/i, /затопил/i, /заливая/i,
            // English - inside/vaginal
            /inside/i, /into her/i, /into you/i, /into me/i,
            /vagin/i, /womb/i, /deep/i, /depths/i,
            /fill(?:ed|ing)?/i, /flood/i, /pump/i
        ];
        
        // Специальные фразы которые сами по себе означают вагинальную эякуляцию
        const directPhrases = [
            /creampie/i, /cream\s*pie/i,
            /breed/i, /impregnate/i, /knock.*up/i,
            /кончил.*внутрь/i, /внутрь.*кончил/i,
            /кончил.*в.*(?:неё|нее|тебя|меня|вагин|влагалищ|киск|пизд)/i,
            /cum.*inside/i, /came.*inside/i, /cum.*in.*(?:her|you|me|pussy|vagina)/i,
            /filled.*(?:her|you|me).*with/i, /fill.*(?:her|you|me).*up/i,
            /семя.*внутр/i, /сперм.*внутр/i, /сперм.*(?:вагин|влагалищ)/i
        ];
        
        const hasEjaculation = ejaculationKeywords.some(kw => kw.test(text));
        const hasInside = insideKeywords.some(kw => kw.test(text));
        const hasDirectPhrase = directPhrases.some(kw => kw.test(text));
        
        // Проверка на БУДУЩЕЕ время — если только "кончу/хочу кончить" без "кончил" — игнорируем
        const futureTenseOnly = [
            /я кончу/i, /сейчас кончу/i, /хочу кончить/i, /буду кончать/i,
            /я изолью/i, /хочу излить/i, /сейчас изолью/i,
            /i will cum/i, /i'm going to cum/i, /gonna cum/i, /about to cum/i,
            /want to cum/i, /i'll cum/i
        ];
        const pastTenseEjaculation = [
            /кончил/i, /излил/i, /изверг/i, /выплесну[лв]/i, /брызну[лв]/i,
            /хлыну[лв]/i, /наполнил/i, /заполнил/i, /залил/i,
            /came/i, /cummed/i, /filled/i, /flooded/i, /pumped/i, /shot/i,
            /released/i, /spilled/i, /emptied/i
        ];
        
        const hasFutureTense = futureTenseOnly.some(kw => kw.test(text));
        const hasPastTense = pastTenseEjaculation.some(kw => kw.test(text));
        
        // Если есть только будущее время, но нет прошедшего — секс ещё не закончился!
        if (hasFutureTense && !hasPastTense && !hasDirectPhrase) {
            console.log('[Reproductive] Tag found but only FUTURE tense detected ("кончу/will cum") - ejaculation hasn\'t happened yet! Ignoring.');
            return;
        }
        
        // Логика валидации:
        // 1. Если есть directPhrase (явная вагинальная эякуляция типа "creampie", "cum inside pussy") — ОК
        // 2. Если есть anal/oral БЕЗ directPhrase — ИГНОРИРУЕМ (скорее всего анальный/оральный секс)
        // 3. Если есть ejaculation + inside БЕЗ anal/oral — ОК
        
        let isValidConception = false;
        
        if (hasDirectPhrase) {
            // Явная вагинальная эякуляция — всегда ОК
            isValidConception = true;
            console.log('[Reproductive] Direct vaginal phrase detected - valid');
        } else if (hasAnal || hasOral) {
            // Есть анальный/оральный контекст, но нет явной вагинальной фразы — ИГНОР
            console.log(`[Reproductive] Tag found but anal=${hasAnal}, oral=${hasOral} detected without explicit vaginal phrase - ignoring`);
            return;
        } else if (hasEjaculation && hasInside) {
            // Есть эякуляция + внутрь, нет анального/орального — ОК
            isValidConception = true;
            console.log('[Reproductive] Ejaculation + inside detected without anal/oral - valid');
        }
        
        if (!isValidConception) {
            console.log(`[Reproductive] Tag found but content check FAILED: ejaculation=${hasEjaculation}, inside=${hasInside}, direct=${hasDirectPhrase}, anal=${hasAnal}, oral=${hasOral} - ignoring`);
            return;
        }

        console.log('[Reproductive] Tag detected AND vaginal ejaculation confirmed! Rolling conception check...');

        const cycleDayMatch = text.match(/\[CYCLE_DAY:(\d+)\]/);
        if (cycleDayMatch) {
            const aiCycleDay = parseInt(cycleDayMatch[1]);
            if (aiCycleDay >= 1 && aiCycleDay <= 28) {
                s.cycleDay = aiCycleDay;
                s.lastCycleUpdate = Date.now();
            }
        }

        const result = checkConception();
        if (result) {
            injectConceptionResult(result);
        }
        
        // Запоминаем что обработали это сообщение
        s.lastCheckedMessageId = messageId;
        saveSettingsDebounced();
        syncUI();
    }
}
