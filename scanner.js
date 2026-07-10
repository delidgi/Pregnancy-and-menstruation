// ═══════════════════════════════════════════
// SCANNER — парсинг тегов (RP_DATE, RP_STATUS, CONCEPTION, BIRTH, SEX_REVEAL, BABY_TRAITS)
// ═══════════════════════════════════════════

import { dlog, dwarn } from './state.js';

// ─── Tag parsing — СТРОГО: теги распознаются ТОЛЬКО внутри HTML-комментариев <!-- ... -->
// Это предотвращает ложные срабатывания на случаи, когда модель цитирует/повторяет
// название тега в своём prose-ответе. Расширка инжектит инструкции вида
// «add tag <!-- [CONCEPTION_CHECK] --> if ejaculation occurred» — если модель просто
// перепишет «CONCEPTION_CHECK» в тексте без обёртки в комментарий, это НЕ должно срабатывать.

// Тег срабатывает ТОЛЬКО если находится внутри HTML-комментария <!-- ... -->
const CONCEPTION_RE_STRICT = /<!--[\s\S]*?\[CONCEPTION_CHECK\][\s\S]*?-->/i;
const BIRTH_RE_STRICT = /<!--[\s\S]*?\[BIRTH\][\s\S]*?-->/i;

// Партнёрские варианты (этап 2 «носители»): суффикс :PARTNER означает, что
// беременеет/рожает ПАРТНЁР ({{char}}), а не юзер. Юзерские регекспы выше эти
// теги НЕ ловят (после CONCEPTION_CHECK/BIRTH идёт ':', а не ']').
const CONCEPTION_PARTNER_RE = /<!--[\s\S]*?\[CONCEPTION_CHECK:PARTNER\][\s\S]*?-->/i;
const BIRTH_PARTNER_RE = /<!--[\s\S]*?\[BIRTH:PARTNER\][\s\S]*?-->/i;
const SEX_REVEAL_PARTNER_RE = /<!--[\s\S]*?\[SEX_REVEAL:PARTNER\][\s\S]*?-->/i;

// CYCLE_DAY — тоже только в комментарии (с группой захвата числа)
const CYCLE_DAY_RE = /<!--[\s\S]*?\[CYCLE_DAY[:\s]+(\d+)\][\s\S]*?-->/i;

// RP_DATE — тоже только в комментарии (это важно — модель часто пишет даты в prose)
// Поддержка опционального времени HH:MM после даты (разделитель: пробел, T, запятая)
const RP_DATE_RE_DOT = /<!--[\s\S]*?\[RP_DATE[:\s]+\s*(\d{1,2})\.(\d{1,2})\.(\d{1,4})(?:[\s,T]+(\d{1,2}):(\d{2}))?\s*\][\s\S]*?-->/i;
const RP_DATE_RE_SLASH = /<!--[\s\S]*?\[RP_DATE[:\s]+\s*(\d{1,2})\/(\d{1,2})\/(\d{1,4})(?:[\s,T]+(\d{1,2}):(\d{2}))?\s*\][\s\S]*?-->/i;
const RP_DATE_RE_ISO = /<!--[\s\S]*?\[RP_DATE[:\s]+\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[\s,T]+(\d{1,2}):(\d{2}))?\s*\][\s\S]*?-->/i;

// Sex reveal — только в HTML-комментарии
const SEX_REVEAL_RE_STRICT = /<!--[\s\S]*?\[SEX_REVEAL\][\s\S]*?-->/i;

function extractRevealedSexes(text) {
    if (!text) return null;
    const found = [];
    const re = /(мальчик|девочк|сын|доч(?:ь|ка|енька|ери|еньки)|boy|girl|son|daughter|male|female)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        const w = m[1].toLowerCase();
        let sex = null;
        if (/^(?:мальчик|сын|boy|son|male)/.test(w)) sex = 'M';
        else if (/^(?:девочк|доч|girl|daughter|female)/.test(w)) sex = 'F';
        if (sex && (found.length === 0 || found[found.length - 1] !== sex)) {
            found.push(sex);
        }
        if (found.length >= 4) break;
    }
    return found.length > 0 ? found : null;
}

// Сканер: ловит ТОЛЬКО теги внутри HTML-комментариев. Никаких keyword fallback —
// если модель не поставила тег, расширка ничего не делает (это безопаснее для РП).
export function scanMessage(text) {
    if (!text) return null;

    let hasConception = CONCEPTION_RE_STRICT.test(text);
    const hasBirth = BIRTH_RE_STRICT.test(text);
    const hasSexReveal = SEX_REVEAL_RE_STRICT.test(text);
    let hasPartnerConception = CONCEPTION_PARTNER_RE.test(text);
    const hasPartnerBirth = BIRTH_PARTNER_RE.test(text);
    const hasPartnerSexReveal = SEX_REVEAL_PARTNER_RE.test(text);

    // Sanity check: если модель поставила CONCEPTION_CHECK, но в тексте нет ВООБЩЕ
    // никаких намёков на сексуальное окончание внутрь — это галлюцинация модели
    // (ставит тег по инерции, потому что инструкция мелькала в её контексте).
    // Грубый, но эффективный фильтр: проверяем минимальный набор слов которые ДОЛЖНЫ
    // присутствовать в сцене реального creampie. Если ни одного — отбрасываем тег.
    if (hasConception || hasPartnerConception) {
        // Очищаем текст от тегов в комментариях (иначе сам тег пройдёт регексп проверки)
        const textWithoutTags = text.replace(/<!--[\s\S]*?-->/g, '');
        // Минимальные индикаторы сексуального окончания/спермы/проникновения
        const sexIndicators = /(?:сперм|семен|семя|конч(?:ил|ила|ает|аю)|изли(?:л|ла|лся|лась|вшись|ть)|cum|creampie|semen|sperm|orgasm|оргазм|внутри\s+(?:неё|нее|тебя|меня)|кончать|conce(?:ption|ived)|залива(?:л|ть|ет)|заполн(?:ил|ила)|член|пенис|penis|cock|пизд|вагин|vagina|трах|fuck|секс|sex)/i;
        if (!sexIndicators.test(textWithoutTags)) {
            dwarn('[Reproductive] CONCEPTION_CHECK tag present but text has NO sex/ejaculation context — IGNORED as model hallucination.');
            dwarn('[Reproductive] Text snippet (no tags):', textWithoutTags.slice(0, 200));
            hasConception = false;
            hasPartnerConception = false;
        }
    }

    let cycleDay = null;
    const cycleMatch = text.match(CYCLE_DAY_RE);
    if (cycleMatch) {
        const day = parseInt(cycleMatch[1]);
        if (day >= 1 && day <= 28) cycleDay = day;
    }

    if (!hasConception && !hasBirth && !hasSexReveal
        && !hasPartnerConception && !hasPartnerBirth && !hasPartnerSexReveal
        && cycleDay === null) return null;

    const anySexReveal = hasSexReveal || hasPartnerSexReveal;
    const result = {
        vaginal_ejaculation_occurred: hasConception,
        birth_occurred: hasBirth,
        sex_revealed: hasSexReveal,
        // Партнёрские события (этап 2)
        partner_conception: hasPartnerConception,
        partner_birth: hasPartnerBirth,
        partner_sex_revealed: hasPartnerSexReveal,
        revealed_sexes: anySexReveal ? extractRevealedSexes(text) : null,
        baby_traits: (hasBirth || hasPartnerBirth) ? scanBabyTraitsTag(text) : null,
        cycle_day: cycleDay,
        _source: (hasConception || hasBirth || hasSexReveal || hasPartnerConception || hasPartnerBirth || hasPartnerSexReveal) ? 'tag' : 'cycle_only',
    };

    if (hasConception) dlog('[Reproductive] Conception detected via tag (sex context validated)');
    if (hasBirth) dlog('[Reproductive] Birth detected via tag');
    if (hasSexReveal) dlog('[Reproductive] Sex reveal detected via tag');
    if (hasPartnerConception) dlog('[Reproductive] PARTNER conception detected via tag');
    if (hasPartnerBirth) dlog('[Reproductive] PARTNER birth detected via tag');
    if (hasPartnerSexReveal) dlog('[Reproductive] PARTNER sex reveal detected via tag');

    return result;
}

// Parse RP_STATUS tag (JSON) — динамика от основной модели
const RP_STATUS_RE = /<!--\s*\[RP_STATUS:\s*(\{[\s\S]*?\})\s*\]\s*-->/i;
const RP_STATUS_RE_BARE = /\[RP_STATUS:\s*(\{[\s\S]*?\})\s*\]/i;

// BABY_TRAITS tag
const BABY_TRAITS_RE = /<!--\s*\[BABY_TRAITS:\s*(\{[\s\S]*?\})\s*\]\s*-->/i;
const BABY_TRAITS_RE_BARE = /\[BABY_TRAITS:\s*(\{[\s\S]*?\})\s*\]/i;

// PREGNANCY_STATE tag — иммутабельные данные беременности (дата зачатия, кол-во плодов, пол, отец).
// Ставится в КАЖДОМ ответе после успешного зачатия — это единый источник правды.
// Из него считаются недели (rpDate − conception_date), а UI/RP_STATUS только описывают
// динамику (шевеления, симптомы, настроение).
const PREGNANCY_STATE_RE = /<!--\s*\[PREGNANCY_STATE:\s*(\{[\s\S]*?\})\s*\]\s*-->/i;
const PREGNANCY_STATE_RE_BARE = /\[PREGNANCY_STATE:\s*(\{[\s\S]*?\})\s*\]/i;

function _safeParseJson(raw) {
    try { return JSON.parse(raw); } catch (e) {
        try {
            const fixed = raw.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
            return JSON.parse(fixed);
        } catch (e2) { return null; }
    }
}

export function scanBabyTraitsTag(text) {
    if (!text) return null;
    const m = text.match(BABY_TRAITS_RE) || text.match(BABY_TRAITS_RE_BARE);
    if (!m) return null;
    const json = _safeParseJson(m[1]);
    if (!json) {
        dwarn('[Reproductive] Failed to parse BABY_TRAITS JSON:', m[1]);
        return null;
    }
    dlog('[Reproductive] BABY_TRAITS tag parsed:', json);
    if (Array.isArray(json.babies)) return json;
    if (Array.isArray(json)) return { babies: json };
    return { babies: [json] };
}

// ═══ CHILD_UPDATE — модель сама дополняет профиль ребёнка ═══
// <!-- [CHILD_UPDATE:{"name":"Миша","add_personality":["упрямый"],"add_appearance":["ямочки"],
//                     "eyes":"зелёные","hair":"тёмные кудри","special":"муз. слух","note":"боится грозы"}] -->
// Тегов может быть несколько (по одному на ребёнка). Возвращает массив объектов или null.
const CHILD_UPDATE_RE = /<!--\s*\[CHILD_UPDATE:\s*(\{[\s\S]*?\})\s*\]\s*-->/gi;

export function scanChildUpdateTags(text) {
    if (!text) return null;
    const out = [];
    const re = new RegExp(CHILD_UPDATE_RE.source, 'gi');
    let m;
    while ((m = re.exec(text)) !== null && out.length < 6) {
        const json = _safeParseJson(m[1]);
        if (json && (json.name || json.label)) {
            out.push(json);
        } else if (json) {
            dwarn('[Reproductive] CHILD_UPDATE without child name — ignored');
        }
    }
    if (out.length) dlog('[Reproductive] CHILD_UPDATE tags parsed:', out);
    return out.length ? out : null;
}

// Парсер тега [PREGNANCY_STATE:{...}] — иммутабельные данные беременности.
// Возвращает {conceptionDate (ISO), fetusCount, fetusSex [array], fatherName, carrier} или null.
// Поддерживает форматы даты: DD.MM.YYYY, YYYY-MM-DD, ISO.
// carrier: 'user' (по умолчанию) или 'partner' — из поля "carrier" в JSON (этап 2).
//
// Когда беременны ОБА носителя, модель ставит ДВА тега — scanPregnancyStateTags
// (мн.ч.) находит все и возвращает массив.
export function scanPregnancyStateTags(text) {
    if (!text) return [];
    const results = [];
    const globalRe = new RegExp(PREGNANCY_STATE_RE.source, 'gi');
    let anyComment = false;
    for (const m of text.matchAll(globalRe)) {
        anyComment = true;
        const parsed = _parsePregStateJson(m[1]);
        if (parsed) results.push(parsed);
    }
    // Bare-фолбэк (без HTML-комментария) — только если в комментариях тегов не нашлось
    if (!anyComment) {
        const bare = text.match(PREGNANCY_STATE_RE_BARE);
        if (bare) {
            const parsed = _parsePregStateJson(bare[1]);
            if (parsed) results.push(parsed);
        }
    }
    return results;
}

// Совместимость: первый найденный тег (или null)
export function scanPregnancyStateTag(text) {
    const all = scanPregnancyStateTags(text);
    return all.length > 0 ? all[0] : null;
}

function _parsePregStateJson(raw) {
    const json = _safeParseJson(raw);
    if (!json || typeof json !== 'object') {
        dwarn('[Reproductive] Failed to parse PREGNANCY_STATE JSON:', raw);
        return null;
    }

    // Парсим дату зачатия из разных возможных полей
    let conceptionIso = null;
    const cdRaw = json.conception_date || json.conceptionDate || json.conception || json.date;
    if (typeof cdRaw === 'string' && cdRaw.length > 0) {
        let dt = null;
        // DD.MM.YYYY или DD/MM/YYYY
        const mm = cdRaw.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
        if (mm) {
            let y = parseInt(mm[3]);
            if (y < 100) y += 2000;
            dt = new Date(y, parseInt(mm[2]) - 1, parseInt(mm[1]));
        } else {
            // ISO YYYY-MM-DD или с временем
            const parsed = new Date(cdRaw);
            if (!isNaN(parsed.getTime())) dt = parsed;
        }
        if (dt && !isNaN(dt.getTime())) {
            conceptionIso = dt.toISOString();
        }
    }

    if (!conceptionIso) {
        dwarn('[Reproductive] PREGNANCY_STATE tag missing or invalid conception_date:', cdRaw);
        return null;
    }

    // Нормализуем остальные поля
    const fetusCount = Math.max(1, Math.min(4, parseInt(json.fetus_count || json.fetusCount || 1) || 1));
    let fetusSex = json.fetus_sex || json.fetusSex || json.sex;
    if (typeof fetusSex === 'string') {
        fetusSex = fetusSex.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(fetusSex)) fetusSex = [];
    fetusSex = fetusSex.map(s => {
        const u = String(s).toUpperCase();
        if (u === 'M' || u === 'MALE' || u === 'BOY' || u === 'МАЛЬЧИК' || u === 'М') return 'M';
        if (u === 'F' || u === 'FEMALE' || u === 'GIRL' || u === 'ДЕВОЧКА' || u === 'Д' || u === 'Ж') return 'F';
        return '?';
    });
    while (fetusSex.length < fetusCount) fetusSex.push('?');

    const father = (json.father || json.father_name || json.fatherName || '').toString().slice(0, 80);

    // Носитель: partner → партнёрская беременность, всё остальное → юзер
    const carrierRaw = String(json.carrier || json.носитель || '').toLowerCase();
    const carrier = (carrierRaw === 'partner' || carrierRaw === 'партнёр' || carrierRaw === 'партнер' || carrierRaw === 'char')
        ? 'partner' : 'user';

    const result = {
        conceptionDate: conceptionIso,
        fetusCount: fetusCount,
        fetusSex: fetusSex,
        fatherName: father,
        carrier: carrier,
    };
    dlog('[Reproductive] PREGNANCY_STATE tag parsed:', result);
    return result;
}

// ─── Парсер срока беременности из обычного текста (без тегов) ───
// Распознаёт фразы вида:
//   • "у меня 16 недель" / "16 недель беременности" / "срок 20 недель" / "беременность 12 недель"
//   • "I'm 16 weeks pregnant" / "20 weeks along" / "at 12 weeks"
//   • "прошло 3 месяца беременности" / "5 месяцев беременна" / "3 month pregnant"
//
// ВАЖНО: для надёжности проверяем что слово «недели/weeks/месяца» рядом с цифрой —
// это снижает ложные срабатывания на упоминания типа «16 этажей», «20 лет», «12 раз».
// Также проверяем что в радиусе ~80 символов есть слово «беременн/preg/срок» —
// без этого контекста число + «недель» может быть про что угодно (зарплата, отпуск).
export function scanWeeksFromText(text) {
    if (!text) return null;

    // Сначала ищем кандидатов: цифра + слово единицы времени
    const candidates = [];

    // Русский: "16 недель", "20-я неделя", "16-й неделе"
    // Без \b на конце (он не работает после кириллицы в JS без флага /u).
    // Используем отрицательный lookahead — после слова не должна идти буква.
    const ruWeekRe = /(\d{1,2})[\s\-—]?(?:й|я|ая|ой|ую|ью|ом)?\s*недел(?:ь|я|и|е|ю|ей|ям|ями|ях|ьку|ьки|ькой)?(?![а-яёa-z])/gi;
    let m;
    while ((m = ruWeekRe.exec(text)) !== null) {
        candidates.push({ value: parseInt(m[1]), unit: 'week', index: m.index, lang: 'ru' });
    }

    // Английский: "16 weeks", "16-week", "16th week"
    const enWeekRe = /(\d{1,2})[\s\-]?(?:th|st|nd|rd)?\s*week(?:s|ly)?\b/gi;
    while ((m = enWeekRe.exec(text)) !== null) {
        candidates.push({ value: parseInt(m[1]), unit: 'week', index: m.index, lang: 'en' });
    }

    // Русские месяцы: "3 месяца", "5 месяцев", "на 4-м месяце"
    const ruMonthRe = /(\d{1,2})[\s\-—]?(?:м|й|ой|ом)?\s*месяц(?:а|е|ев|у|ам|ах|ы)?(?![а-яёa-z])/gi;
    while ((m = ruMonthRe.exec(text)) !== null) {
        candidates.push({ value: parseInt(m[1]), unit: 'month', index: m.index, lang: 'ru' });
    }

    // Английские месяцы: "3 months pregnant"
    const enMonthRe = /(\d{1,2})\s*month(?:s)?\b/gi;
    while ((m = enMonthRe.exec(text)) !== null) {
        candidates.push({ value: parseInt(m[1]), unit: 'month', index: m.index, lang: 'en' });
    }

    if (candidates.length === 0) return null;

    // Контекстный фильтр: должно быть слово про беременность/срок ВБЛИЗИ числа
    const pregContextRe = /(?:беременн|преды?н|срок|положени|животик|пузо|gravid|pregnan|expect(?:ing|ant)|gestation|along|trimester|триместр)/i;

    // ── Чёрный список: маркеры будущего/гипотезы/чужого опыта ──
    // Если в окне рядом с числом есть эти слова → НЕ применяем (это обсуждение, не утверждение).
    // Покрывает: «когда будет 20 недель», «если бы 16 недель», «через 4 недели», «хочу чтобы», «не дай бог»
    const futureContextRe = /(?:когда|если\s+бы?|если\s+будут?|если\s+станет|будет|будут|станет|пойд[её]м|пойти|сходим|через\s+\d|спустя\s+\d|потом|после|позже|скоро|вот-вот|хочу\s+чтобы|хочется|мечтаю|планирую|собира[ею]мся|не\s+дай\s+бог|боюсь|страшно|опасно|нельзя|обсуди[мт]|поговорим|представь|вообрази|допустим|when\s+(?:i|we|she)|if\s+(?:i|we|she|only)|gonna|going\s+to|will\s+be|would\s+be|hope|wish|plan\s+to)/i;

    // ── Чёрный список: маркеры PROGRESS-ВЫВОДА ──
    // Это не текст «у меня X недель» — это вывод другого трекера/SIMS-блока в формате
    // «0/40 недель», «term: 0/40», «прогресс: 5/40», JSON структуры с term/duration.
    // Когда модель отзеркаливает SIMS-блок или придумывает свой [PREGNANCY:{...}],
    // парсер не должен считать вывод трекера за утверждение факта.
    const progressContextRe = /(?:\d+\s*\/\s*\d+\s*(?:недел|нед\.|week|month|мес)|term\s*[:=]|"term"|due[_\s]date|"due"|прогресс|\(\s*\d+\s*%\s*\)|\d+\s+из\s+\d+\s*(?:недел|нед)|fetus\s*:|"fetus"|размер\s+плода\s*[:=])/i;

    // ── Чёрный список: OOC/мета-комментарии ──
    // Если в окне есть OOC-маркеры — это инструкция автора модели, а не утверждение.
    const oocContextRe = /(?:\bOOC\s*[:!.,]|\(\s*OOC|\[\s*OOC|\bAN\s*[:=]|\bAuthor'?s?\s+Note|\bSystem\s*[:=])/i;

    for (const c of candidates) {
        // Проверяем окно ±100 символов вокруг числа
        const start = Math.max(0, c.index - 100);
        const end = Math.min(text.length, c.index + 100);
        const context = text.slice(start, end);

        if (!pregContextRe.test(context)) continue;

        // Проверка на «обсуждение/гипотезу/будущее»
        if (futureContextRe.test(context)) {
            dlog(`[Reproductive] Weeks "${c.value} ${c.unit}(s)" SKIPPED — future/hypothetical context: "${context.slice(0, 80)}..."`);
            continue;
        }

        // Проверка на «вывод другого трекера / X/Y форматы»
        if (progressContextRe.test(context)) {
            dlog(`[Reproductive] Weeks "${c.value} ${c.unit}(s)" SKIPPED — progress/tracker output (X/Y format detected): "${context.slice(0, 80)}..."`);
            continue;
        }

        // Проверка на OOC/мета
        if (oocContextRe.test(context)) {
            dlog(`[Reproductive] Weeks "${c.value} ${c.unit}(s)" SKIPPED — OOC/meta comment: "${context.slice(0, 80)}..."`);
            continue;
        }

        // Дополнительная проверка: число рядом с '/' (типа "0/40") — почти гарантированно
        // знаменатель/числитель прогресс-бара
        const localChars = text.slice(Math.max(0, c.index - 5), Math.min(text.length, c.index + 10));
        if (/\d\s*\/\s*\d/.test(localChars)) {
            dlog(`[Reproductive] Weeks "${c.value} ${c.unit}(s)" SKIPPED — looks like a fraction (X/Y): "${localChars}"`);
            continue;
        }

        // Конвертируем месяцы в недели (1 месяц ≈ 4.345 недели; беременный месяц = 4 недели)
        let weeks = c.value;
        if (c.unit === 'month') {
            // Беременные месяцы традиционно считаются как 4 недели каждый
            weeks = c.value * 4;
        }

        // Sanity check: беременность от 1 до 42 недель
        if (weeks < 1 || weeks > 42) continue;

        dlog(`[Reproductive] Pregnancy duration parsed from text: ${c.value} ${c.unit}(s) → ${weeks} weeks (${c.lang}, idx=${c.index})`);
        return { weeks, source: c.unit, sourceLang: c.lang };
    }

    return null;
}

export function scanStatusTag(text) {
    if (!text) return null;
    let m = text.match(RP_STATUS_RE) || text.match(RP_STATUS_RE_BARE);
    if (!m) return null;
    const json = _safeParseJson(m[1]);
    if (!json) {
        dwarn('[Reproductive] Failed to parse RP_STATUS JSON:', m[1]);
        return null;
    }
    dlog('[Reproductive] RP_STATUS tag parsed:', json);
    return json;
}

// Parse RP_DATE tag → Date or null
// Если тег содержит время (HH:MM), оно сохраняется в .rpTime результата.
export function scanDateTag(text) {
    if (!text) return null;
    let m = text.match(RP_DATE_RE_DOT);
    if (m) return _parseDate(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4], m[5]);
    m = text.match(RP_DATE_RE_SLASH);
    if (m) return _parseDate(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4], m[5]);
    m = text.match(RP_DATE_RE_ISO);
    if (m) return _parseDate(parseInt(m[3]), parseInt(m[2]), parseInt(m[1]), m[4], m[5]);
    return null;
}

function _parseDate(day, month, year, hourStr, minStr) {
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1) return null;
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (isNaN(d.getTime())) return null;
    // Прикрепляем время к объекту Date (не-стандартное свойство)
    if (hourStr !== undefined && minStr !== undefined) {
        const h = parseInt(hourStr);
        const mn = parseInt(minStr);
        if (h >= 0 && h <= 23 && mn >= 0 && mn <= 59) {
            d.setHours(h, mn, 0, 0);
            d.rpTime = `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
        }
    }
    return d;
}

// ── Вырезать CoT-блоки перед сканированием ──
// Reasoning-модели «репетируют» теги ([RP_DATE], [CONCEPTION_CHECK]...) в думалке →
// сканер видел их и срабатывал дважды/ложно. Семантика (как в GlassPhone):
//  • ЗАКРЫТЫЙ <think>...</think> — точно мысли, вырезается целиком;
//  • НЕЗАКРЫТЫЙ <think> С тегами внутри — это префилл пресета: маркер убираем,
//    содержимое СКАНИРУЕТСЯ;
//  • незакрытый без тегов — оборванная мысль, режется до конца.
export function stripThink(text) {
    if (!text) return '';
    let res = String(text);
    // Закрытые блоки — всегда мысли
    res = res.replace(/<(think|thinking|reasoning|analysis|reflection)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Незакрытый блок — решаем по позиции маркера:
    //  • в САМОМ НАЧАЛЕ сообщения С тегами внутри — префилл-обёртка пресета
    //    вокруг всего ответа: маркер убираем, содержимое СКАНИРУЕТСЯ;
    //  • В СЕРЕДИНЕ (или без тегов) — настоящий оборванный CoT (остановленная
    //    генерация): режем до конца, даже если внутри отрепетированы теги.
    const unclosed = res.match(/<(think|thinking|reasoning)[^>]*>/i);
    if (unclosed) {
        // Префилл-обёртка = до маркера нет никакого контента (только пробелы/переводы строк)
        const isPrefillWrapper = res.slice(0, unclosed.index).trim() === '';
        const inner = res.slice(unclosed.index + unclosed[0].length);
        if (isPrefillWrapper && /<!--\s*\[/.test(inner)) {
            res = res.slice(0, unclosed.index) + inner;
        } else {
            res = res.slice(0, unclosed.index);
        }
    }
    return res;
}

export function stripHiddenTags(text) {
    if (!text) return text;
    text = text.replace(/<!--\s*\[(?!RP_DATE)[\s\S]*?\]\s*-->/g, '');
    text = text.replace(/<repro_scan>[\s\S]*?<\/repro_scan>/gi, '');
    text = text.replace(/<!--\s*repro\b[\s\S]*?-->/gi, '');
    text = text.replace(/\[?CONCEPTION_CHECK(?::PARTNER)?\]?/gi, '');
    text = text.replace(/\[?BIRTH(?::PARTNER)?\]?(?!\w)/gi, '');
    text = text.replace(/\[?SEX_REVEAL(?::PARTNER)?\]?/gi, '');
    text = text.replace(/\[?CYCLE_DAY[:\s]*\d+\]?/gi, '');
    text = text.replace(/\[?RP_STATUS:\s*\{[\s\S]*?\}\s*\]?/gi, '');
    text = text.replace(/\[?BABY_TRAITS:\s*\{[\s\S]*?\}\s*\]?/gi, '');
    text = text.replace(/\[?CHILD_UPDATE:\s*\{[\s\S]*?\}\s*\]?/gi, '');
    return text.trim();
}

// Stub чтобы не ломать другие места, которые могли это импортировать. Всегда null.
export function isScanning() { return false; }

export async function scanChat() {
    const chat = typeof SillyTavern?.getContext === 'function'
        ? SillyTavern.getContext().chat
        : window.chat;
    if (!chat || chat.length === 0) return null;
    const lastMessage = chat[chat.length - 1];
    if (!lastMessage || lastMessage.is_user) return null;
    return scanMessage(lastMessage.mes);
}

// ─── Сканер всей истории чата: ВОССТАНАВЛИВАЕТ состояние с нуля ───
// 1) Сбрасывает per-chat состояние (cycleDay, isPregnant, hasBaby, rpDate, etc.)
// 2) Идёт от первого до последнего сообщения, применяя теги
// 3) Возвращает {processed, conceptions, births, dates, sexReveals} для отчёта
//
// ВАЖНО: на время сканирования глушит нотификации, иначе спам.
export async function scanFullHistory() {
    const chat = typeof SillyTavern?.getContext === 'function'
        ? SillyTavern.getContext().chat
        : window.chat;
    if (!chat || chat.length === 0) return { processed: 0, conceptions: 0, births: 0, dates: 0, sexReveals: 0 };

    // Динамические импорты, чтобы избежать циклов
    const { applyScanResult, createPregnancyFromWeeks, createPregnancyFromStateTag } = await import('./pregnancy.js');
    const { processDateTag } = await import('./message-handler.js');
    const { getPregnancyData, getSettings, setCycleDay } = await import('./state.js');
    const { defaultPregnancyData } = await import('./config.js');
    const partnerMod = await import('./partner.js');

    const s = getSettings();
    const stats = { processed: 0, conceptions: 0, births: 0, dates: 0, sexReveals: 0 };

    // ── СБРОС per-chat состояния ──
    // ВАЖНО что мы сохраняем:
    //   • grownChildren — выросшие дети (не пересоздаются из тегов)
    //   • babies + hasBaby + всё baby-состояние — если в истории чата нет тега [BIRTH]
    //     (например, юзер вручную нажал «принять роды» или поставил беременность через
    //     datepicker), то после сброса малыш бы исчез. Сохраняем и восстанавливаем потом,
    //     если за время скана не было найдено новых родов.
    const p = getPregnancyData();
    const savedGrown = Array.isArray(p.grownChildren) ? [...p.grownChildren] : [];
    const savedBabyState = p.hasBaby ? {
        hasBaby: true,
        babies: Array.isArray(p.babies) ? structuredClone(p.babies) : [],
        babyName: p.babyName || '',
        babyCount: p.babyCount || 0,
        babySex: Array.isArray(p.babySex) ? [...p.babySex] : [],
        babyBirthRpDate: p.babyBirthRpDate || null,
        babyHealth: p.babyHealth || 'normal',
        babyMood: p.babyMood || '',
        babyDiaperClean: p.babyDiaperClean !== false,
        babySleep: p.babySleep || '',
        babyAge: p.babyAge || '',
        babyFeedingType: p.babyFeedingType || '',
        babyTeething: !!p.babyTeething,
        babyColicky: !!p.babyColicky,
        babyMilestones: Array.isArray(p.babyMilestones) ? [...p.babyMilestones] : [],
        momState: p.momState || null,
    } : null;
    // Партнёр: настройки (enabled/имя/контрацепция) переживают сброс,
    // беременность сбрасывается — история восстановит её из тегов.
    // userCanCarry и омегаверс-поля (вселенная/роль/циклы) — тоже настройки
    // носителей, не производные от истории чата.
    const omegaMod = await import('./omegaverse.js');
    const savedPartner = p.partner ? structuredClone(p.partner) : null;
    const savedUserCanCarry = p.userCanCarry;
    // Семейная хроника — журнал истории, из тегов не восстанавливается
    const savedChronicle = Array.isArray(p.familyChronicle) ? structuredClone(p.familyChronicle) : null;
    const savedOmega = {};
    for (const k of omegaMod.OMEGA_USER_FIELDS) {
        if (p[k] !== undefined) savedOmega[k] = p[k];
    }
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, structuredClone(defaultPregnancyData));
    p.grownChildren = savedGrown;
    if (savedChronicle) p.familyChronicle = savedChronicle;
    if (savedPartner) {
        p.partner = savedPartner;
        partnerMod.resetPartnerPregnancyFields(p.partner);
    }
    if (savedUserCanCarry !== undefined) p.userCanCarry = savedUserCanCarry;
    Object.assign(p, savedOmega);
    // cycleDay начинаем с 14 (овуляция) как нейтрального дефолта — модель его передвинет
    setCycleDay(14, false);

    // Глушим нотификации на время скана
    const oldNotify = s.showNotifications;
    s.showNotifications = false;

    // Отключаем reset-protection
    const oldBlock = s._conceptionBlockedUntil;
    s._conceptionBlockedUntil = null;

    try {
        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg || !msg.mes || msg.is_system) continue;
            const text = stripThink(msg.mes);
            stats.processed++;

            // 1) RP_DATE — обновляем дату и продвигаем время/цикл/недели
            if (processDateTag(text)) stats.dates++;

            // 2) RP_STATUS — динамика
            const statusData = scanStatusTag(text);
            if (statusData) {
                const p2 = getPregnancyData();
                if (p2.hasBaby) {
                    p2._dynamic = { note: statusData.note || null };
                } else if (p2.isPregnant) {
                    p2._dynamic = {
                        symptoms: statusData.symptoms || null,
                        recommendations: statusData.recommendations || null,
                        movements: statusData.movements || null,
                        swelling: statusData.swelling || null,
                        braxton_hicks: statusData.braxton_hicks || null,
                        fetal_position: statusData.fetal_position || null,
                        note: statusData.note || null,
                    };
                    if (statusData.mood) p2.mood = statusData.mood;
                    if (statusData.libido) p2.libido = statusData.libido;
                    if (statusData.weight_gain) p2.weightGain = statusData.weight_gain;
                    if (statusData.baby_activity) p2.babyActivity = statusData.baby_activity;
                    if (statusData.father_name) p2.fatherName = String(statusData.father_name).slice(0, 80);
                } else {
                    p2._dynamic = {
                        fertility: statusData.fertility || null,
                        libido: statusData.libido || null,
                        mood: statusData.mood || null,
                        physical: statusData.physical || null,
                        note: statusData.note || null,
                    };
                }
            }

            // 3) CONCEPTION / BIRTH / SEX_REVEAL — только теги в HTML-комментариях
            const tagResult = scanMessage(text);
            if (tagResult) {
                // Не обрабатываем conception/birth на user-сообщениях через keyword
                if (tagResult.vaginal_ejaculation_occurred && tagResult._source === 'keyword' && msg.is_user) {
                    tagResult.vaginal_ejaculation_occurred = false;
                }
                if (tagResult.birth_occurred && tagResult._source === 'keyword' && msg.is_user) {
                    tagResult.birth_occurred = false;
                }
                const p2 = getPregnancyData();
                if (p2.isPregnant) tagResult.vaginal_ejaculation_occurred = false;

                // Партнёрские теги — независимо от юзерских (могут прийти в одном сообщении)
                if (p2.partner?.enabled) {
                    if (tagResult.partner_conception && !p2.partner.isPregnant) {
                        partnerMod.checkPartnerConception();
                        stats.conceptions++;
                    }
                    if (tagResult.partner_birth && p2.partner.isPregnant) {
                        partnerMod.applyPartnerBirth(tagResult);
                        stats.births++;
                    }
                    if (tagResult.partner_sex_revealed && p2.partner.isPregnant && !p2.partner.fetusSexRevealed) {
                        p2.partner.fetusSexRevealed = true;
                        stats.sexReveals++;
                    }
                }

                if (tagResult.vaginal_ejaculation_occurred) {
                    applyScanResult(tagResult);
                    stats.conceptions++;
                } else if (tagResult.birth_occurred && p2.isPregnant) {
                    applyScanResult(tagResult);
                    stats.births++;
                } else if (tagResult.sex_revealed && p2.isPregnant && !p2.fetusSexRevealed) {
                    if (tagResult.revealed_sexes && tagResult.revealed_sexes.length > 0) {
                        const need = p2.fetusCount || 1;
                        const newSex = [];
                        for (let j = 0; j < need; j++) {
                            newSex.push(tagResult.revealed_sexes[j] || tagResult.revealed_sexes[tagResult.revealed_sexes.length - 1]);
                        }
                        p2.fetusSex = newSex;
                    }
                    p2.fetusSexRevealed = true;
                    stats.sexReveals++;
                }
            }

            // 4) PREGNANCY_STATE теги — роутинг по носителю (carrier: user/partner).
            //    Если беременности носителя ещё нет — создаём из тега
            //    (кейс «играла уже беременная, расширка не была настроена»)
            {
                const p3 = getPregnancyData();
                const pregStates = scanPregnancyStateTags(text);
                for (const st of pregStates) {
                    if (st.carrier === 'partner') {
                        if (!p3.partner?.enabled) continue;
                        if (!p3.partner.isPregnant) {
                            if (partnerMod.createPartnerPregnancyFromStateTag(st, { notify: false })) stats.conceptions++;
                        } else {
                            partnerMod.applyPartnerPregnancyStateTag(st);
                        }
                    } else if (!p3.isPregnant) {
                        if (createPregnancyFromStateTag(st, { notify: false })) {
                            stats.conceptions++;
                        }
                    }
                }
            }

            // 5) Срок из обычного текста («на 16 неделе») — только для СОЗДАНИЯ беременности
            {
                const p4 = getPregnancyData();
                if (!p4.isPregnant) {
                    const weeksData = scanWeeksFromText(text);
                    if (weeksData && createPregnancyFromWeeks(weeksData.weeks, { notify: false })) {
                        stats.conceptions++;
                    }
                }
            }
        }
    } finally {
        // Восстанавливаем
        s.showNotifications = oldNotify;
        s._conceptionBlockedUntil = oldBlock;
        s._lastScannedPosition = chat.length;
    }

    // ── Восстановление baby-состояния ──
    // Если у юзера БЫЛ малыш до сканирования, и за время скана НЕ нашлось ни одного
    // тега [BIRTH] в истории чата → это значит малыш был добавлен вручную (через кнопку
    // «принять роды» или ручную беременность). После сброса он бы исчез, но мы сохранили
    // состояние и возвращаем его обратно.
    if (savedBabyState && stats.births === 0) {
        const pNow = getPregnancyData();
        // Сбрасываем pregnancy-флаги (на случай если скан нашёл зачатие в истории)
        pNow.isPregnant = false;
        pNow.conceptionDate = null;
        pNow.pregnancyWeeks = 0;
        pNow.fetusCount = 0;
        pNow.fetusSex = [];
        pNow.fetusSexRevealed = false;
        pNow.complications = [];
        pNow._plannedComplications = [];
        // Накатываем сохранённое baby-состояние
        Object.assign(pNow, savedBabyState);
        dlog('[Reproductive] Baby state restored after history scan (no [BIRTH] tags found in history).');
    }

    return stats;
}
