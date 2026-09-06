import { setManualCycleDay, setManualPregnancyWeeks, setSecondParent } from './message-handler.js';
import { reportError } from './diagnostics.js';
function cycleSummary(who, c, s) {
    if (!hasCycle(s, who) && !c.isPregnant) return isOmegaverse(s) ? roleLabel(s, who) : 'Состояние';
    if (c.isPregnant && pregnancyIsKnown(c, s)) return `Беременность — ${c.pregnancyWeeks || 0} нед.`;
    const pp = getPostpartum(c, getPregnancyData());
    if (pp && !pp.cycleReturned) return 'После родов · цикл не вернулся';
    const day = (who === 'char' ? (c.cycleDay || 1) : getCycleDay()) + (c.isPregnant ? daysSinceConception(c, getPregnancyData()) : 0);
    if (day > 28) return `Задержка ${day - 28} дн.`;
    if (c.isPregnant) return `День ${day}/28 · состояние по сцене`;
    return `День ${day}/28 · ${getPhaseInfo(day, 'ru', who).name}`;
}
function getPhaseInfo(day, lang = 'ru', who = 'user') { return cyclePhase(getSettings(), who, day, lang); }
// UI v5 — compact, minimal icons, visual infoblock
import { saveSettingsDebounced } from '../../../../script.js';
import { getSettings, getPregnancyData, getPartnerData, getCarriers, carrierName, isTracked, getCycleDay, setCycleDay, getCurrentChatId, L, getContraception, syncBabyLegacyFields } from './state.js';
import { isOmegaverse, hasMenstrualCycle, canCarry, hasAnyTracking, hasCycle, designationOf, roleLabel, cyclePhase } from './omegaverse.js';
import { missedDays, fertileWindow } from './fertility.js';
import { HYGIENE, getFlow, getHygieneState, getPhaseEffects, hoursBetween } from './cycle-realism.js';
import { getPhaseInfo as phaseInfo, calculateWeeksFromDates, getSymptomsForProgress, getRecommendationsForProgress, formatSexIcons, formatFetusCount, getHealthInfo, detectChatLanguage, translateStatusValue } from './helpers.js';
import { babyAgeDays, getCareNeeds, getGrowthStage, MILESTONE_ICONS, milestonesTotal } from './baby-care.js';
import { calculateDueDate } from './date-parser.js';
import { resetPregnancy, resetBaby, visitDoctor, applyScanResult, startManualPregnancy, startManualBaby, startPartnerPregnancy, resetPartnerPregnancy, takePregnancyTest, revealPregnancy, getPostpartum, pregnancyIsKnown, daysSinceConception, setLactating, setTrying, monthsTrying, createUndoCheckpoint, undoLastDestructiveChange } from './pregnancy.js';
import { updatePromptInjection } from './prompts.js';
import { showNotification } from './notifications.js';

function ic(n) { return `<i class="fa-solid ${n}"></i>`; }

// ── Default infoblock CSS (shown in editor for customization) ──
const DEFAULT_INFOBLOCK_CSS = `/* === Инфоблок: основной контейнер === */
details.repro {
  margin: 0 auto 12px;
  max-width: 420px;
  font: 12px system-ui, sans-serif;
  color: rgba(255,255,255,.85);
}

/* === Шапка === */
details.repro .repro-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  background: transparent;
  border: 1.5px solid rgba(255,255,255,.18);
  border-radius: 14px;
  transition: border-radius .2s;
}
details.repro[open] .repro-header {
  border-radius: 14px 14px 0 0;
  border-bottom-color: transparent;
}

/* === Иконка в круге === */
details.repro .repro-icon {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
details.repro .repro-icon i { font-size: 11px; }
details.repro .repro-icon.cycle      { border: 1.5px solid rgba(180,120,255,.4); }
details.repro .repro-icon.cycle i    { color: rgba(180,120,255,.8); }
details.repro .repro-icon.pregnancy  { border: 1.5px solid rgba(255,120,180,.4); }
details.repro .repro-icon.pregnancy i{ color: rgba(255,120,180,.8); }
details.repro .repro-icon.baby       { border: 1.5px solid rgba(130,200,255,.4); }
details.repro .repro-icon.baby i     { color: rgba(130,200,255,.8); }

/* === Заголовок и бейдж === */
details.repro .repro-title { font-weight: 600; font-size: 13px; }
details.repro .repro-badge {
  margin-left: auto; font-size: 10px; padding: 2px 8px;
  border-radius: 50px; font-weight: 600;
}
details.repro .repro-badge.cycle     { border: 1px solid rgba(180,120,255,.3); color: rgba(180,120,255,.9); }
details.repro .repro-badge.pregnancy { border: 1px solid rgba(255,120,180,.3); color: rgba(255,120,180,.9); }
details.repro .repro-badge.baby      { border: 1px solid rgba(130,200,255,.3); color: rgba(130,200,255,.9); }

/* === Шеврон === */
details.repro .repro-chev {
  width: 16px; height: 16px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: transform .25s;
}
details.repro .repro-chev i { font-size: 10px; color: rgba(255,255,255,.3); }
details.repro[open] .repro-chev { transform: rotate(180deg); }

/* === Тело карточки === */
details.repro .repro-c {
  padding: 12px 16px;
  background: transparent;
  border: 1.5px solid rgba(255,255,255,.18);
  border-top: none;
  border-radius: 0 0 14px 14px;
}

/* === Прогресс-бар === */
details.repro .repro-bar {
  height: 3px; background: rgba(255,255,255,.08);
  border-radius: 50px; overflow: hidden; margin-bottom: 10px;
}
details.repro .repro-bar-fill { height: 100%; border-radius: 50px; }
details.repro .repro-bar-fill.cycle     { background: #b478ff; }
details.repro .repro-bar-fill.pregnancy { background: #ff9eb4; }
details.repro .repro-bar-fill.baby      { background: #82c8ff; }

/* === Сетка статов === */
details.repro .repro-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

/* === Карточка стата === */
details.repro .repro-stat {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  background: transparent;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px;
}
details.repro .repro-wide { grid-column: 1 / -1; }

/* === Иконки статов === */
details.repro .rp-si {
  width: 20px; height: 20px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
}
details.repro .rp-si i { font-size: 10px; }
details.repro .rp-si.green  i { color: rgba(0,200,130,.7); }
details.repro .rp-si.pink   i { color: rgba(255,100,150,.7); }
details.repro .rp-si.purple i { color: rgba(180,120,255,.7); }
details.repro .rp-si.blue   i { color: rgba(130,200,255,.7); }
details.repro .rp-si.orange i { color: rgba(255,180,60,.7); }
details.repro .rp-si.red    i { color: rgba(255,80,80,.7); }

/* === Текст статов === */
details.repro .rp-lbl { color: rgba(255,255,255,.35); font-size: 9px; }
details.repro .rp-val { color: rgba(255,255,255,.85); font-size: 11px; font-weight: 600; }
details.repro .rp-val-warn { color: rgba(255,170,0,.9) !important; }

/* === Заметка === */
details.repro .repro-note {
  grid-column: 1 / -1; margin-top: 6px; padding: 8px 12px;
  background: transparent;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px; font-size: 10px; color: rgba(255,255,255,.5);
  line-height: 1.5; font-style: italic;
}
details.repro .repro-rec { font-style: normal; color: rgba(255,215,64,.6); }
details.repro .repro-rec i { margin-right: 4px; opacity: .7; }

/* === Бейдж здоровья === */
details.repro .repro-health {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 6px; border-radius: 8px; font-size: 9px; font-weight: 600;
}
details.repro .repro-health.normal   { border: 1px solid rgba(0,200,100,.3);  color: rgba(0,200,100,.9); }
details.repro .repro-health.warning  { border: 1px solid rgba(255,170,0,.3);  color: rgba(255,170,0,.9); }
details.repro .repro-health.critical { border: 1px solid rgba(255,60,60,.3);  color: rgba(255,60,60,.9); }

/* === Объединённая карточка (двое носителей) === */
details.repro.repro-multi .repro-multi-body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
/* Вложенные карточки носителей становятся секциями: без внешних рамок */
details.repro.repro-multi details.repro { margin: 0; max-width: none; }
details.repro.repro-multi details.repro .repro-header {
  border: none; border-radius: 10px; padding: 6px 10px;
  background: rgba(255,255,255,.03);
}
details.repro.repro-multi details.repro[open] .repro-header { border-radius: 10px 10px 0 0; }
details.repro.repro-multi details.repro .repro-c { border: none; padding: 8px 4px 4px; }
details.repro.repro-multi .repro-badge { font-size: 9px; }

/* Подпись внутри стата (день цикла и т.п.) */
details.repro .rp-sub { opacity: .5; font-weight: 400; font-size: 10px; }`;

// ── Custom CSS for infoblock ──
// Пользовательский CSS должен побеждать тему, а у темы селекторы вида
// body[data-rp-theme="..."] — специфичнее обычных. Поэтому каждому правилу
// юзера дописываем :root:not(#_):not(#_) — специфичность растёт, смысл нет.
const CSS_BOOST = ':root:not(#_):not(#_) ';

// Комментарии режем до разбора: внутри них могут быть скобки
function stripCssComments(css) {
    let out = '', quote = null;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (quote) {
            out += c;
            if (c === '\\') { out += css[++i] || ''; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'") { quote = c; out += c; continue; }
        if (c === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            i = end === -1 ? css.length : end + 1;
            continue;
        }
        out += c;
    }
    return out;
}

function boostCss(css) {
    const src = stripCssComments(String(css || ''));
    let out = '', i = 0;

    const readBlock = (start) => {
        let depth = 0;
        for (let j = start; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') { depth--; if (depth === 0) return j; }
        }
        return src.length - 1;
    };

    while (i < src.length) {
        const brace = src.indexOf('{', i);
        if (brace === -1) { out += src.slice(i); break; }

        const head = src.slice(i, brace);
        const end = readBlock(brace);
        const body = src.slice(brace + 1, end);
        const sel = head.trim();

        if (sel.startsWith('@')) {
            // @media/@supports — бустим содержимое; @keyframes/@font-face оставляем как есть
            const nested = /^@(media|supports|layer|container)/i.test(sel);
            out += head + '{' + (nested ? boostCss(body) : body) + '}';
        } else if (sel) {
            const boosted = sel.split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => CSS_BOOST + s)
                .join(', ');
            out += (head.startsWith('\n') ? '\n' : '') + boosted + ' {' + body + '}';
        } else {
            out += head + '{' + body + '}';
        }
        i = end + 1;
    }
    return out;
}

// Скелет в поле — это не «свой стиль»: если его применили как есть,
// он перекрывал бы выбранный стиль и инфоблок переставал меняться.
function isSkeletonCss(css) {
    const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    return norm(css) === norm(DEFAULT_INFOBLOCK_CSS);
}

function applyCustomCss(cssRaw) {
    const css = isSkeletonCss(cssRaw) ? '' : cssRaw;
    let styleEl = document.getElementById('repro-custom-infoblock-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'repro-custom-infoblock-css';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = css ? boostCss(css) : '';
}

// ─── Стиль оформления: стекло или минимализм ───
export const THEMES = [
    { id: 'glass',   name: 'Стекло',    icon: 'fa-wand-magic-sparkles' },
    { id: 'minimal', name: 'Минимализм', icon: 'fa-align-left' },
];

// Старые id из ранних версий
const THEME_ALIASES = { aurora: 'glass', editorial: 'minimal', scrapbook: 'glass', pastel: 'glass' };

export function normalizeTheme(id) {
    const mapped = THEME_ALIASES[id] || id;
    return THEMES.some(t => t.id === mapped) ? mapped : 'glass';
}

export function applyTheme(id, light) {
    document.body.setAttribute('data-rp-theme', normalizeTheme(id));
    const isLight = light === undefined ? !!getSettings().lightMode : !!light;
    if (isLight) document.body.setAttribute('data-rp-light', '1');
    else document.body.removeAttribute('data-rp-light');
}

// Мини-превью стиля: пара + две карточки детей в миниатюре
function themePreview(id) {
    return `<div class="rp-th-prev" data-rp-theme="${id}">
        <div class="rp-th-couple">
            <span class="rp-th-pill mom"></span>
            <span class="rp-th-heart"><i class="fa-solid fa-heart"></i></span>
            <span class="rp-th-pill dad"></span>
        </div>
        <div class="rp-th-kids">
            <span class="rp-th-kid girl"><span class="rp-th-av"></span><i></i></span>
            <span class="rp-th-kid boy"><span class="rp-th-av"></span><i></i></span>
        </div>
    </div>`;
}

export function showThemePicker() {
    const s = getSettings();
    const cur = normalizeTheme(s.theme);

    const cards = THEMES.map(t => `
        <button class="rp-th-card${t.id === cur ? ' on' : ''}" data-theme="${t.id}">
            ${themePreview(t.id)}
            <span class="rp-th-name"><i class="fa-solid ${t.icon}"></i>${t.name}</span>
            <span class="rp-th-check"><i class="fa-solid fa-check"></i></span>
        </button>`).join('');

    const overlay = $(`
    <dialog id="rp-theme-overlay" aria-modal="true" aria-labelledby="rp-theme-title">
        <div class="rp-th-dialog">
            <div class="rp-th-head">
                <span class="rp-th-head-icon"><i class="fa-solid fa-palette"></i></span>
                <span id="rp-theme-title" class="rp-th-title">Стиль</span>
                <button class="rp-th-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rp-th-body">${cards}</div>
        </div>
    </dialog>`);

    $('body').append(overlay);
    const el = overlay[0];
    if (el.showModal) el.showModal(); else overlay.show();

    const close = () => { try { el.close(); } catch (e) { /* ignore */ } overlay.remove(); };
    overlay.on('click', function(e) { if (e.target === el) close(); });
    overlay.find('.rp-th-close').on('click', close);

    overlay.find('.rp-th-card').on('click', function() {
        const id = $(this).attr('data-theme');
        getSettings().theme = id;
        applyTheme(id);
        saveSettingsDebounced();
        overlay.find('.rp-th-card').removeClass('on');
        $(this).addClass('on');
        setTimeout(close, 180);
    });
}

function stat(icon, color, label, value, wide) {
    return `<div class="repro-stat${wide ? ' repro-wide' : ''}"><div class="rp-si ${color}">${ic(icon)}</div><div><div class="rp-lbl">${label}</div><div class="rp-val">${value}</div></div></div>`;
}

function hpBadge(status) {
    const normalized = String(status || '').trim().toLowerCase();
    const isCritical = /^(?:critical|критич)/i.test(normalized);
    const isWarning = /^(?:warning|attention|вниман|тревож|плох)/i.test(normalized);
    const cls = isCritical ? 'critical' : isWarning ? 'warning' : 'normal';
    const txt = isCritical ? 'Критич.' : isWarning ? 'Внимание' : 'Норма';
    return `<span class="repro-health ${cls}">${txt}</span>`;
}

function getCycleDetails(day) {
    if (day <= 5) return { fertility: 'Низкая', libido: 'Низкое', mood: 'Усталость', physical: 'Спазмы', note: 'Менструация — низкая фертильность. Спазмы, усталость, перепады настроения.' };
    if (day <= 11) return { fertility: 'Средняя', libido: 'Среднее', mood: 'Энергичное', physical: 'Энергия растёт', note: 'Фолликулярная фаза — фертильность растёт. Энергия и настроение улучшаются.' };
    if (day <= 16) return { fertility: 'Высокая', libido: 'Высокое', mood: 'Кокетливое', physical: 'Чувствительность', note: 'Овуляция — пик фертильности. Повышенная чувствительность, лёгкая влажность, кокетливое настроение.' };
    return { fertility: 'Низкая', libido: 'Низкое', mood: 'ПМС', physical: 'Вздутие', note: 'Лютеиновая фаза — низкая фертильность. Возможны ПМС, вздутие, раздражительность.' };
}

function getBabies(p) {
    if (p.babies && p.babies.length > 0) return p.babies;
    if (!p.hasBaby || !p.babyCount) return [];
    const babies = [];
    for (let i = 0; i < (p.babyCount || 1); i++) {
        babies.push({
            name: i === 0 ? (p.babyName || '') : '',
            sex: p.babySex?.[i] || '?',
            health: p.babyHealth || 'normal',
            mood: p.babyMood || '—',
            sleep: p.babySleep || '—',
            diaperClean: p.babyDiaperClean !== false,
            teething: !!p.babyTeething,
            colicky: !!p.babyColicky,
            feedingType: p.babyFeedingType || '—',
            milestones: i === 0 ? [...(p.babyMilestones || [])] : [],
        });
    }
    return babies;
}

// ── Infoblock: glassmorphism card for chat messages ──
export function buildInfoblockHtml() {
    const s = getSettings();
    const p = getPregnancyData();
    if (!s.isEnabled) return '';

    // Фолбэк-перевод: модели иногда пишут значения по-английски ("High"/"Anxious")
    // несмотря на требование языка. В русском чате известные значения переводим.
    const isRuChat = detectChatLanguage() === 'ru';
    const tr = (v) => (isRuChat ? translateStatusValue(v) : typeof v === 'string' && /[а-яё]/i.test(v) ? '' : v);

    // ── BABY MODE ──
    if (p.hasBaby) {
        const babies = getBabies(p);
        if (babies.length === 0) return ''; // fallthrough safety

        // Хелпер: считаем возраст ребёнка от birthRpDate до текущей p.rpDate
        const calcAge = (baby) => {
            // baby.age — старый статичный снимок возраста. Для вручную добавленного
            // малыша он не менялся при продвижении RP-даты, поэтому при наличии дат
            // всегда рассчитываем актуальный возраст заново.
            if (!baby.birthRpDate || !p.rpDate) return baby.age || p.babyAge || 'новорожд.';
            const birthMs = new Date(baby.birthRpDate).getTime();
            const nowMs = new Date(p.rpDate).getTime();
            if (isNaN(birthMs) || isNaN(nowMs)) return baby.age || p.babyAge || 'новорожд.';
            const days = Math.max(0, Math.floor((nowMs - birthMs) / 86400000));
            if (days < 30) return days <= 7 ? 'новорожд.' : `${days} дн.`;
            const months = Math.floor(days / 30);
            if (months < 12) return `${months} мес.`;
            const years = Math.floor(months / 12);
            const remMonths = months % 12;
            return remMonths > 0 ? `${years} г. ${remMonths} мес.` : `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
        };

        let html = '';
        babies.forEach((baby, i) => {
            const sexIcon = baby.sex === 'M' ? '<i class="fa-solid fa-mars"></i>' : baby.sex === 'F' ? '<i class="fa-solid fa-venus"></i>' : '<i class="fa-solid fa-genderless"></i>';
            const sexColor = baby.sex === 'F' ? 'pink' : 'blue';
            const label = baby.name || (babies.length > 1 ? `Малыш ${i + 1}` : 'Малыш');
            const milestones = (baby.milestones || []).slice(-2).map(m => m.text).join(', ');
            const ageStr = calcAge(baby);

            const ageDays = babyAgeDays(baby, p);
            // Потребности по времени суток (fallback если модель не прислала RP_STATUS)
            let needs = { feeding: null, diaper: null, sleep: null, careNote: null };
            if (ageDays !== null) {
                needs = getCareNeeds(ageDays, p.rpTime, baby);
            }

            // Кормление: показываем только фактическое состояние из RP_STATUS/данных малыша.
            // Возрастной fallback («кормление каждые 2–3 часа») в инфоблок не выводим.
            const feedingVal = tr(baby.feeding) || tr(baby.feedingType) || '—';
            // Подгузник: текст от модели (diaperStatus) или fallback по времени
            const diaperText = baby.diaperStatus ? tr(baby.diaperStatus) : (needs.diaper || (baby.diaperClean ? 'Чистый' : 'Требует смены'));
            const diaperIsClean = baby.diaperStatus
                ? /^(?:чист|clean|dry|сух)/i.test(baby.diaperStatus)
                : (baby.diaperClean !== false && needs.diaper !== 'Требует смены');
            // В инфоблок выводим только конкретную рекомендацию из текущего
            // RP_STATUS. Автоматические возрастные нормы/советы сюда не добавляем.
            // Также скрываем старые сохранённые строки из предыдущей версии расширения,
            // чтобы они исчезли сразу, не дожидаясь нового статуса от модели.
            const rawCareRec = tr(baby.careNote);
            const isGenericCareNorm = rawCareRec && (
                /кормлен\w*\s+(?:по\s+требованию\s+)?каждые\s*2\s*[–—-]\s*3\s*(?:ч|час)/i.test(rawCareRec) ||
                /сон\s*16\s*[–—-]\s*18\s*(?:ч|час)/i.test(rawCareRec) ||
                /колик\w*.*(?:пик|6\s*нед)/i.test(rawCareRec) ||
                /(?:памперс|подгузник)\w*\s*8\s*[–—-]\s*10\s*раз/i.test(rawCareRec)
            );
            const careRec = isGenericCareNorm ? null : (rawCareRec || null);

            html += `<details class="repro">
                <summary><div class="repro-header">
                    <div class="repro-icon baby">${ic('fa-baby')}</div>
                    <span class="repro-title repro-baby-name" data-baby-idx="${i}" title="Клик для переименования" style="cursor:pointer">${label}</span>
                    <span class="repro-badge baby" style="color:var(--rp-${sexColor})">${sexIcon} · ${ageStr}${(() => { const st = getGrowthStage(ageDays); return (st && st.key !== 'newborn') ? ' · ' + st.label : ''; })()}</span>
                    <div class="repro-chev">${ic('fa-chevron-down')}</div>
                </div></summary>
                <div class="repro-c"><div class="repro-grid">
                    ${stat('fa-heart-pulse', 'green', 'Здоровье', hpBadge(baby.health || 'normal'))}
                    ${stat('fa-face-smile', 'purple', 'Настроение', tr(baby.mood) || '—')}
                    ${stat('fa-bottle-water', 'blue', 'Кормление', feedingVal)}
                    ${stat('fa-moon', 'purple', 'Сон', tr(baby.sleep) || (needs.sleep) || '—')}
                    ${stat('fa-baby-carriage', diaperIsClean ? 'green' : 'orange', 'Подгузник', diaperIsClean ? diaperText : `<span class="rp-val-warn">${diaperText}</span>`)}
                    ${baby.teething ? stat('fa-tooth', 'blue', 'Зубки', 'Режутся') : ''}
                    ${baby.colicky ? stat('fa-face-sad-tear', 'pink', 'Колики', 'Да') : ''}
                    ${baby.fatherName ? stat('fa-user', 'blue', 'Второй родитель', escapeLabel(baby.fatherName)) : ''}
                    ${baby.personality?.length ? `<div class="repro-note"><i class="fa-solid fa-brain" style="margin-right:4px;opacity:0.5"></i>${baby.personality.join(', ')}</div>` : ''}
                    ${baby.appearance?.length ? `<div class="repro-note"><i class="fa-solid fa-eye" style="margin-right:4px;opacity:0.5"></i>${baby.appearance.join(', ')}</div>` : ''}
                    ${baby.special ? `<div class="repro-note" style="border-color:rgba(255,215,64,.35);background:rgba(255,215,64,.06)"><i class="fa-solid fa-star" style="margin-right:4px;color:#ffd740"></i><b>${baby.special.name || baby.special}</b>${baby.special.desc ? ` — ${baby.special.desc}` : ''}</div>` : ''}
                    ${milestones ? `<div class="repro-note"><i class="fa-solid fa-star" style="margin-right:4px;opacity:0.5"></i>${milestones}</div>` : ''}
                    ${careRec ? `<div class="repro-note repro-rec"><i class="fa-solid fa-lightbulb" style="margin-right:4px;opacity:0.7"></i>${careRec}</div>` : ''}
                </div></div>
            </details>`;
        });

        // Дети — общие. Дальше добавляем карточки носителей (беременность/цикл).
        return html + carriersHtml(tr);
    }

    return carriersHtml(tr);
}

// ── Карточки всех отслеживаемых носителей (беременность или цикл/течка) ──
// Один носитель → обычная карточка. Двое → ОДНА объединённая карточка,
// внутри которой оба идут секциями (CSS убирает у них внешние рамки).
function carriersHtml(tr) {
    const s = getSettings();
    const cards = [];
    for (const { who, data } of getCarriers()) {
        // Пока о беременности не знают (нет теста, срок не очевиден), инфоблок
        // показывает обычный цикл — иначе смысл скрытой беременности теряется.
        const showPreg = data.isPregnant && pregnancyIsKnown(data, s);
        // Нечего показывать (мужчина-бета в обычном мире и не беременный) — карточку пропускаем
        if (!showPreg && !hasAnyTracking(s, who)) continue;
        cards.push(showPreg ? pregnancyCardHtml(who, data, tr) : cycleCardHtml(who, data, tr));
    }
    if (cards.length <= 1) return cards[0] || '';

    // Сводка в шапке объединённой карточки: коротко о каждом
    const brief = getCarriers().map(({ who, data }) => {
        const nm = carrierName(who);
        if (data.isPregnant && pregnancyIsKnown(data, s)) return `${nm} · ${data.pregnancyWeeks || 0} нед.`;
        return `${nm} · ${cycleSummary(who, data, s)}`;
    }).join('  ·  ');

    return `<details class="repro repro-multi">
        <summary><div class="repro-header">
            <div class="repro-icon cycle">${ic('fa-venus-mars')}</div>
            <span class="repro-title">Репродукция</span>
            <span class="repro-badge cycle">${brief}</span>
            <div class="repro-chev">${ic('fa-chevron-down')}</div>
        </div></summary>
        <div class="repro-c repro-multi-body">${cards.join('')}</div>
    </details>`;
}

// Префикс имени носителя в заголовке — только когда отслеживаются оба
function carrierTag(who) {
    return (getSettings()?.trackFor === 'both') ? `${carrierName(who)} · ` : '';
}

function pregnancyCardHtml(who, c, tr) {
    return buildPregnancyCard(who, c, getPregnancyData(), getSettings(), tr);
}

// p — данные носителя (юзер: корень, персонаж: p.partner), root — корневой объект чата (rpDate, дети)
function buildPregnancyCard(who, p, root, s, tr) {
    {
        const dur = s.pregnancyDuration || 40;
        // RP-дата всегда в корне (одна на чат), у партнёра своего rpDate нет
        const { weeks } = calculateWeeksFromDates(p.conceptionDate, root.rpDate, p.pregnancyWeeks);
        const pct = Math.min(100, Math.round((weeks / dur) * 100));
        // Триместр — по доле срока: беременность может длиться не 40 недель
        const trimester = pct <= 33 ? 1 : pct <= 67 ? 2 : 3;
        const sexRevealed = !!p.fetusSexRevealed;
        const sexStr = sexRevealed && p.fetusSex?.length ? p.fetusSex.map(s => s === 'M' ? '<i class="fa-solid fa-mars"></i> мальчик' : '<i class="fa-solid fa-venus"></i> девочка').join(', ') : 'неизвестно';
        // Размер плода целиком за моделью (fetus_size в RP_STATUS): своей таблицы
        // у трекера нет — она всё равно врала при нестандартном сроке.
        const fetusSize = tr((p._dynamic || {}).fetusSize) || '';
        const symptoms = getSymptomsForProgress(pct, weeks);
        const recs = getRecommendationsForProgress(pct);
        let dueStr = '—';
        if (p.conceptionDate) {
            const dd = calculateDueDate(p.conceptionDate);
            if (dd) dueStr = dd.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
        let conceptionStr = '—';
        if (p.conceptionDate) {
            conceptionStr = new Date(p.conceptionDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
        const pd = p._dynamic || {};
        let noteLines = [];
        if (pd.symptoms || symptoms) noteLines.push(tr(pd.symptoms) || tr(symptoms));
        if (pd.note || recs) noteLines.push(tr(pd.note) || tr(recs));

        return `<details class="repro">
            <summary><div class="repro-header">
                <div class="repro-icon pregnancy">${ic('fa-heart')}</div>
                <span class="repro-title">${carrierTag(who)}Беременность</span>
                <span class="repro-badge pregnancy">${weeks}/${dur} нед. · ${trimester} трим.</span>
                <div class="repro-chev">${ic('fa-chevron-down')}</div>
            </div></summary>
            <div class="repro-c">
                <div class="repro-bar"><div class="repro-bar-fill pregnancy" style="width:${pct}%"></div></div>
                <div class="repro-grid">
                    ${stat('fa-calendar-day', 'pink', 'Зачатие', conceptionStr)}
                    ${stat('fa-calendar', 'purple', 'ПДР', dueStr)}
                    ${stat('fa-baby', 'pink', 'Плод', `${formatFetusCount(p.fetusCount)} (${sexStr})`)}
                    ${p.fatherName ? stat('fa-user', 'blue', 'Второй родитель', escapeLabel(p.fatherName)) : ''}
                    ${fetusSize ? stat('fa-ruler', 'blue', 'Размер', fetusSize) : ''}
                    ${stat('fa-heart-pulse', 'green', 'Здоровье', hpBadge(p.healthStatus))}
                    ${p.mood ? stat('fa-face-smile', 'purple', 'Настроение', tr(p.mood)) : ''}
                    ${p.weightGain ? stat('fa-weight-scale', 'orange', 'Вес', tr(p.weightGain)) : ''}
                    ${p.babyActivity ? stat('fa-person-running', 'blue', 'Активность', tr(p.babyActivity)) : ''}
                    ${p.libido ? stat('fa-fire', 'pink', 'Либидо', tr(p.libido)) : ''}
                    ${pd.movements ? stat('fa-hand', 'purple', 'Шевеления', tr(pd.movements)) : ''}
                    ${pd.swelling ? stat('fa-droplet', 'orange', 'Отёки', tr(pd.swelling)) : ''}
                    ${pd.braxton_hicks ? stat('fa-bolt', 'pink', 'Схватки', tr(pd.braxton_hicks)) : ''}
                    ${pd.fetal_position ? stat('fa-baby', 'blue', 'Положение', tr(pd.fetal_position)) : ''}
                    ${pd.recommendations ? `<div class="repro-note repro-rec">${ic('fa-lightbulb')} ${tr(pd.recommendations)}</div>` : ''}
                    ${noteLines.length ? `<div class="repro-note">${noteLines.join(' · ')}</div>` : ''}
                </div>
            </div>
        </details>`;
    }
}

// ── Карточка цикла: обычный 28-дневный ИЛИ A/B/O (течка/гон) ──
function cycleCardHtml(who, c, tr) {
    const s = getSettings();
    const d = c._dynamic || {};


    // ── ОБЫЧНЫЙ 28-ДНЕВНЫЙ ЦИКЛ ──
    const p0 = getPregnancyData();
    // При беременности цикл заморожен на дне зачатия. Пока о ней не знают,
    // карточка показывает цикл — и день должен идти дальше, превращаясь в задержку.
    const hidden = c.isPregnant && !pregnancyIsKnown(c, s);
    const frozenDay = who === 'char' ? Math.max(1, c.cycleDay || 1) : getCycleDay();
    const rawDay = hidden ? frozenDay + daysSinceConception(c, p0) : frozenDay;
    const day = Math.max(1, Math.min(28, rawDay));
    const phase = hidden ? { name: 'Состояние по сцене' } : getPhaseInfo(day, 'ru', who);
    const cycling = hasCycle(s, who);
    const carries = canCarry(s, who);
    const role = isOmegaverse(s) ? roleLabel(s, who) : '';
    const hot = isOmegaverse(s) && designationOf(s, who) !== 'beta' && day >= 12 && day <= 16;
    const cyclePct = Math.min(100, Math.round(rawDay / 28 * 100));
    const cd = carries ? getCycleDetails(s.menstruationEnabled === false && day <= 5 ? 6 : day) : { fertility:'—', libido:hot?'Высокое':'Обычное', mood:hot?'Возбуждение':'Спокойное', physical:hot?'Жар, чувствительность':'Норма', note:'' };

    // Задержка / скрытая беременность: героиня не знает, но задержку видит
    const delay = missedDays(rawDay, 28);
    const pp = getPostpartum(c, p0);
    const win = carries && s.tryingToConceive ? fertileWindow(day, 28) : null;
    const testRes = c.lastTestResult;

    let extraRows = '';
    let hygieneReminder = false;

    // ── Реализм: гигиена и протечки в дни менструации ──
    if (carries && s.menstruationEnabled !== false && day <= 5 && (!pp || pp.cycleReturned) && !hidden) {
        const flow = getFlow(day);
        const hrs = hoursBetween(c.hygieneChangedRpDate, p0.rpDate);
        const hy = getHygieneState(c.hygieneType || 'pad', hrs, flow);
        hygieneReminder = hy.needsChange;
        const worn = hrs === null ? '' : ` · ${Math.round(hrs)} ч`;
        const hygieneText = hy.type.id === 'none' ? 'Средство не используется' : hy.needsChange ? 'Пора сменить' : hrs === null ? 'Смена не отмечена' : `Смена через ${hy.hoursLeft} ч`;
        extraRows += stat('fa-shield-heart', hy.needsChange ? 'orange' : 'green', 'Гигиена', hygieneText, true);
        if (hy.health === 'tampon-too-long') {
            extraRows += stat('fa-kit-medical', 'red', 'Внимание', 'Тампон дольше 8 часов', true);
        }
    }

    if (carries && delay > 0 && !pp) {
        extraRows += stat('fa-calendar-xmark', 'orange', 'Задержка', `${delay} дн.`);
    }
    if (testRes && carries) {
        const tLabel = testRes === 'positive' ? 'Две полоски' : testRes === 'faint' ? 'Слабая вторая' : 'Отрицательный';
        extraRows += stat('fa-vial', testRes === 'negative' ? 'blue' : 'pink', 'Тест', tLabel);
    }
    if (win) {
        extraRows += stat('fa-bullseye', win.fertile ? 'pink' : 'blue', 'Планируем',
            win.fertile ? (win.peak ? 'Пик — сегодня' : 'Фертильное окно') : `Окно через ${win.daysToPeak} дн.`);
    }
    if (pp) {
        extraRows += stat('fa-heart-pulse', 'green', 'После родов', `${pp.days} дн.`);
        if (pp.lactating) extraRows += stat('fa-bottle-droplet', 'blue', 'Лактация', 'Кормит');
        if (pp.healing) extraRows += stat('fa-bandage', 'orange', 'Заживление', pp.healing);
        if (!pp.cycleReturned) extraRows += stat('fa-clock-rotate-left', 'purple', 'Цикл', 'Не вернулся');
    }

    const badge = !cycling ? (role || 'По сцене') : pp && !pp.cycleReturned
        ? `После родов · ${pp.days} дн.`
        : delay > 0
            ? `Задержка ${delay} дн.`
            : `День ${day}/28 · ${phase.name}`;

    return `<details class="repro">
        <summary><div class="repro-header">
            <div class="repro-icon cycle">${ic(pp ? 'fa-heart-pulse' : 'fa-clock')}</div>
            <span class="repro-title">${carrierTag(who)}${pp ? 'Восстановление' : role || (cycling ? 'Цикл' : 'Состояние')}</span>
            <span class="repro-badge cycle">${badge}${hygieneReminder ? ' · Сменить средство' : ''}</span>
            <div class="repro-chev">${ic('fa-chevron-down')}</div>
        </div></summary>
        <div class="repro-c">
            ${cycling ? `<div class="repro-bar"><div class="repro-bar-fill cycle" style="width:${cyclePct}%"></div></div>` : ''}
            <div class="repro-grid">
                ${carries ? stat('fa-droplet', 'green', 'Фертильность', hidden || delay > 0 ? 'Не определена' : pp && !pp.cycleReturned ? 'Очень низкая' : cd.fertility) : stat('fa-clock', 'purple', 'Фаза', phase.name)}
                ${stat('fa-fire', 'pink', 'Либидо', tr(d.libido) || cd.libido)}
                ${stat('fa-face-smile', 'purple', 'Настроение', tr(d.mood) || cd.mood)}
                ${stat('fa-heart', 'blue', 'Физически', tr(d.physical) || cd.physical)}
                ${extraRows}
                <div class="repro-note">${tr(d.note) || (hidden || delay > 0 ? 'Ориентируйтесь на самочувствие и факты сцены.' : pp && !pp.cycleReturned ? 'Цикл ещё не возобновился.' : cd.note)}</div>
            </div>
        </div>
    </details>`;
}

// ── Семейное древо: классическая раскладка (мама → пары → дети) ──
function formatAgeStr(days) {
    if (days === null || days === undefined || isNaN(days)) return '—';
    if (days < 30) return days <= 7 ? 'новорожд.' : `${days} дн.`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} мес.`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem > 0 ? `${years} г. ${rem} мес.` : `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
}

function fmtRpDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Пилюля родителя: имя + роль (без инициала — он только шумит)
function escapeLabel(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function parentPill(name, cls, roleLabel, unknown = false) {
    return `<span class="rp-pill ${cls}${unknown ? ' unknown' : ''}">
        <span class="rp-pill-tx"><b>${escapeLabel(name)}</b></span>
    </span>`;
}

// Плитка факта (bento)
function bentoTile(label, value, gold = false) {
    return `<div class="rp-bento-tile${gold ? ' gold' : ''}">
        <div class="rp-bento-lbl">${label}</div>
        <div class="rp-bento-val">${value}</div>
    </div>`;
}

// Кольцо прогресса развития вокруг инициала
function progressRing(pct, initial, sexCls) {
    const r = 18, circ = 2 * Math.PI * r;
    const dash = Math.max(0, Math.min(circ, (pct / 100) * circ));
    return `<span class="rp-ring ${sexCls}">
        <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="${r}" class="rp-ring-bg"></circle>
            <circle cx="20" cy="20" r="${r}" class="rp-ring-fg" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"></circle>
        </svg>
        <span class="rp-ring-tx">${initial}</span>
    </span>`;
}

// Достижения чипами, сгруппированные по возрасту на момент вехи
function milestoneChips(k, p) {
    const ms = k.milestones || [];
    if (!ms.length) return `<div class="rp-tree-ms-empty">достижений пока нет</div>`;

    const birthMs = k.birthRpDate ? new Date(k.birthRpDate).getTime() : NaN;
    const groupOf = (m) => {
        const t = m.rpDate ? new Date(m.rpDate).getTime() : NaN;
        if (isNaN(birthMs) || isNaN(t)) return { key: 'z', label: '', date: fmtRpDate(m.rpDate) };
        const days = Math.max(0, Math.floor((t - birthMs) / 86400000));
        if (days < 30) return { key: 'a', label: 'первый месяц', date: fmtRpDate(m.rpDate) };
        if (days < 183) return { key: 'b', label: 'до полугода', date: fmtRpDate(m.rpDate) };
        if (days < 365) return { key: 'c', label: 'до года', date: fmtRpDate(m.rpDate) };
        const years = Math.floor(days / 365);
        return { key: 'd' + years, label: `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`, date: fmtRpDate(m.rpDate) };
    };

    const groups = new Map();
    for (const m of ms) {
        const g = groupOf(m);
        if (!groups.has(g.key)) groups.set(g.key, { label: g.label, date: g.date, items: [] });
        groups.get(g.key).items.push(m);
    }

    let out = `<div class="rp-tree-ms-title"><i class="fa-solid fa-award"></i>Достижения · ${ms.length}</div>`;
    for (const g of [...groups.values()].reverse()) {
        out += `<div class="rp-ms-group">
            <span class="rp-ms-group-lbl">${g.label || 'вехи'}</span>
            <span class="rp-ms-group-line"></span>
            <span class="rp-ms-group-date">${g.date || ''}</span>
        </div><div class="rp-ms-chips">`;
        for (const m of g.items.slice().reverse()) {
            const story = m.source === 'story';
            const icon = story ? 'fa-trophy' : (MILESTONE_ICONS[m.key] || 'fa-star');
            out += `<span class="rp-ms-chip${story ? ' story' : ''}"><i class="fa-solid ${icon}"></i>${m.text}</span>`;
        }
        out += `</div>`;
    }
    return out;
}

export function showFamilyTree() {
    $('#rp-tree-overlay').remove();

    const p = getPregnancyData();
    const s = getSettings();
    const carrierRole = '';
    const partnerRole = '';

    let momName = carrierName(s.carrierMode === 'char' ? 'char' : 'user');
    try {
        const ctx = SillyTavern.getContext();
        if (s.carrierMode !== 'char' && ctx?.name1) momName = ctx.name1;
    } catch (e) { /* ignore */ }

    const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';

    // Собираем всех детей: активные малыши + выросшие (архив)
    const kids = [];
    (p.babies || []).forEach(b => kids.push({ ...b, _grown: false }));
    (p.grownChildren || []).forEach(c => kids.push({ ...c, _grown: true }));

    const pregnancies = [
        { state: p, name: carrierName('user') },
        { state: getPartnerData(), name: carrierName('char') },
    ].filter(x => x.state.isPregnant);
    const pairKey = (name, second) => JSON.stringify([name, (second || '').trim() || '—']);
    const groups = new Map();
    for (const k of kids) {
        const key = pairKey(k.motherName || (k.bornBy ? carrierName(k.bornBy) : momName), k.fatherName);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(k);
    }
    for (const pending of pregnancies) {
        const key = pairKey(pending.name, pending.state.fatherName);
        if (!groups.has(key)) groups.set(key, []);
    }

    // Детальные панели детей (по клику на карточку)
    const detailPanels = [];
    const detailKids = []; // параллельно detailPanels — объект ребёнка для удаления

    const kidCard = (k) => {
        const days = babyAgeDays(k, p);
        const stage = getGrowthStage(days);
        const sexCls = k.sex === 'F' ? 'girl' : 'boy';
        const sexIcon = k.sex === 'F' ? 'fa-venus' : 'fa-mars';
        const ageStr = k._grown && days === null ? 'вырос(ла)' : formatAgeStr(days);
        // Для новорождённого возраст уже говорит «новорожд.» — стадию не дублируем.
        const stageStr = stage ? (stage.key === 'newborn' ? '' : stage.label) : (k._grown ? 'взрослый' : '');
        const msCount = (k.milestones || []).length;

        // ── Достижения: группируем по возрасту на момент вехи, показываем чипами ──
        const msHtml = milestoneChips(k, p);

        // Bento-плитки фактов
        const tiles = [];
        const birthStr = fmtRpDate(k.birthRpDate);
        if (birthStr) tiles.push(bentoTile('Родился(ась)', birthStr));
        if (k.personality?.length) tiles.push(bentoTile('Характер', k.personality.join(', ')));
        if (k.appearance?.length) tiles.push(bentoTile('Внешность', k.appearance.join(', ')));
        if (k.special) tiles.push(bentoTile('Особенность', k.special.name || k.special, true));

        // Прогресс развития: сколько вех пройдено из каталога
        const total = milestonesTotal();
        const done = Math.min(total, (k.milestones || []).filter(m => m.source !== 'story').length);
        const pctDone = total ? Math.round((done / total) * 100) : 0;
        const ring = progressRing(pctDone, initialOf(k.name), sexCls);

        const idx = detailPanels.length;
        detailKids.push(k);
        detailPanels.push(`
            <div class="rp-tree-det-head">
                ${ring}
                <div class="rp-tree-det-tx">
                    <div class="rp-tree-det-name">${k.name || 'без имени'}</div>
                    <div class="rp-tree-det-sub">${ageStr}${stageStr ? ' · ' + stageStr : ''}${k._grown ? ' · вырос(ла)' : ''} · развитие ${done} из ${total}</div>
                </div>
                <button class="rp-tree-del" data-del="${idx}" title="Удалить из семьи"><i class="fa-solid fa-trash"></i></button>
            </div>
            ${tiles.length ? `<div class="rp-tree-bento">${tiles.join('')}</div>` : ''}
            ${msHtml}`);

        return `<div class="rp-tree-cell">
            <div class="rp-node kid ${sexCls}" data-det="${idx}" title="Нажми — профиль и достижения">
                <span class="rp-node-ava">${initialOf(k.name)}<i class="fa-solid ${sexIcon} rp-node-sex"></i></span>
                <span class="rp-node-name">${k.name || 'без имени'}</span>
                <span class="rp-node-sub">${ageStr}${stageStr ? ` · ${stageStr}` : ''}</span>
                <span class="rp-node-badges">
                    ${msCount ? `<span class="rp-node-badge gold" title="Достижения"><i class="fa-solid fa-trophy"></i>${msCount}</span>` : ''}
                    ${k._grown ? `<span class="rp-node-badge green" title="Вырос(ла)"><i class="fa-solid fa-check"></i></span>` : ''}
                </span>
            </div>
        </div>`;
    };

    let branchesHtml = '';
    for (const [key, children] of groups) {
        const [birthParentName, father] = JSON.parse(key);
        // Старшие слева
        children.sort((a, b) => {
            const am = a.birthRpDate ? new Date(a.birthRpDate).getTime() : 0;
            const bm = b.birthRpDate ? new Date(b.birthRpDate).getTime() : 0;
            return am - bm;
        });
        let cells = children.map(kidCard).join('');

        for (const pending of pregnancies.filter(x => pairKey(x.name, x.state.fatherName) === key)) {
            const carrier = pending.state;
            const w = carrier.pregnancyWeeks || 0;
            const cnt = carrier.fetusCount || 1;
            const sexStr = carrier.fetusSexRevealed && carrier.fetusSex?.length
                ? carrier.fetusSex.map(s => s === 'M' ? 'мальчик' : 'девочка').join(', ')
                : 'сюрприз';
            cells += `<div class="rp-tree-cell">
                <div class="rp-node kid expecting">
                    <span class="rp-node-ava"><i class="fa-solid fa-heart"></i></span>
                    <span class="rp-node-name">Ожидается</span>
                    <span class="rp-node-sub">${cnt > 1 ? cnt + ' малыша' : sexStr}</span>
                    <span class="rp-node-sub dim">${w} нед.</span>
                </div>
            </div>`;
        }

        const isUnknown = father === '—';

        // Пара: мама ♥ папа компактными пилюлями, дети — под ними
        branchesHtml += `<div class="rp-tree-union">
            <div class="rp-couple">
                ${parentPill(birthParentName, 'mom', carrierRole)}
                <span class="rp-couple-line"></span>
                <span class="rp-couple-link" title="${isUnknown ? 'второй родитель не указан' : 'пара'}"><i class="fa-solid ${isUnknown ? 'fa-question' : 'fa-heart'}"></i></span>
                <span class="rp-couple-line"></span>
                ${parentPill(isUnknown ? 'неизвестен' : father, 'dad', partnerRole, isUnknown)}
            </div>
            ${cells ? `<div class="rp-tree-kids-wrap"><div class="rp-tree-row">${cells}</div></div>` : ''}
        </div>`;
    }

    const canvasHtml = branchesHtml
        ? `<div class="rp-tree-canvas">
              <div class="rp-tree-rail">${branchesHtml}</div>
           </div>
           <div class="rp-tree-details" style="display:none"></div>`
        : `<div class="rp-tree-canvas">
              <div class="rp-tree-root no-line">${parentPill(momName, 'mom', carrierRole)}</div>
           </div>
           <div class="rp-tree-empty"><i class="fa-solid fa-seedling"></i>Детей пока нет — древо ждёт свою историю</div>`;

    const overlay = $(`
    <dialog id="rp-tree-overlay" aria-modal="true" aria-labelledby="rp-tree-title">
        <div class="rp-tree-dialog">
            <div class="rp-tree-head">
                <span class="rp-tree-head-icon"><i class="fa-solid fa-people-roof"></i></span>
                <span class="rp-tree-title" id="rp-tree-title">Семейное древо</span>
                <button class="rp-tree-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rp-tree-body">${canvasHtml}</div>
        </div>
    </dialog>`);

    $('body').append(overlay);
    const dialog = overlay[0];
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else overlay.attr('open', '');

    const close = () => {
        if (typeof dialog.close === 'function' && dialog.open) dialog.close();
        overlay.remove();
    };
    // Клики не должны «протекать» в документ — иначе ST сворачивает свои панели
    overlay.on('mousedown mouseup click touchstart touchend', (e) => e.stopPropagation());
    overlay.on('cancel', (e) => { e.preventDefault(); close(); });
    overlay.on('click', function(e) { if (e.target === this) close(); });
    overlay.find('.rp-tree-close').on('click', close);

    // Клик по карточке ребёнка → панель деталей под древом
    overlay.find('.rp-node.kid[data-det]').on('click', function() {
        const idx = parseInt($(this).attr('data-det'));
        const panel = overlay.find('.rp-tree-details');
        const wasSel = $(this).hasClass('sel');
        overlay.find('.rp-node.kid').removeClass('sel');
        if (wasSel) {
            panel.slideUp(150);
        } else {
            $(this).addClass('sel');
            panel.html(detailPanels[idx] || '').slideDown(150);
        }
    });

    // Удаление одного ребёнка из семьи (например, ошибочно созданного дубля)
    overlay.on('click', '.rp-tree-del', function(e) {
        e.stopPropagation();
        const idx = parseInt($(this).attr('data-del'));
        const k = detailKids[idx];
        if (!k) return;
        if (!confirm(`Удалить ${k.name || 'этого ребёнка'} из семьи? Остальные дети останутся. Отменить нельзя.`)) return;
        const pd = getPregnancyData();
        createUndoCheckpoint(`Удаление ребёнка: ${k.name || 'без имени'}`);
        const same = (b) => (b.name || '') === (k.name || '')
            && String(b.birthRpDate || '') === String(k.birthRpDate || '')
            && (b.sex || '') === (k.sex || '');
        if (k._grown) {
            pd.grownChildren = (pd.grownChildren || []).filter(b => !same(b));
        } else {
            pd.babies = (pd.babies || []).filter(b => !same(b));
            pd.babyCount = pd.babies.length;
            if (pd.babies.length === 0) {
                pd.hasBaby = false;
                pd.babyName = '';
                pd.babySex = [];
            } else {
                pd.babyName = pd.babies[0].name || '';
                pd.babySex = pd.babies.map(b => b.sex);
            }
        }
        syncBabyLegacyFields(pd);
        saveSettingsDebounced();
        showNotification(`${k.name || 'Ребёнок'} удалён(а) из семьи`, 'info');
        import('./message-handler.js').then(m => m.refreshRegenSnapshot && m.refreshRegenSnapshot());
        close();
        syncUI();
        updatePromptInjection();
        setTimeout(() => { import('./message-handler.js').then(m => m.renderInfoblock()); showFamilyTree(); }, 100);
    });
}

// ── Быстрая панель («волшебная палочка»): смена цикла, древо, роды в один тап ──
export function showQuickBar() {
    $('#rp-quick-overlay').remove();
    const s = getSettings();
    const p = getPregnancyData();

    // Статус: по строке на каждого отслеживаемого носителя + дети
    const both = s.trackFor === 'both';
    const rows = [];
    if (p.hasBaby) {
        const n = (p.babies?.length || p.babyCount || 1);
        rows.push(`${n > 1 ? n + ' малыша' : 'Малыш'} в семье`);
    }
    for (const { who, data } of getCarriers()) {
        const nm = both ? `<b>${carrierName(who)}:</b> ` : '';
        rows.push(`${nm}${cycleSummary(who, data, s)}`);
    }
    const statusHtml = rows.join('<br>');

    const day = getCycleDay();

    // ── Реализм: смена средства гигиены в дни менструации ──
    let realismRow = '';
    if (s.menstruationEnabled !== false && isTracked('user') && !p.isPregnant && hasMenstrualCycle(s, 'user') && day <= 5) {
        const hrs = hoursBetween(p.hygieneChangedRpDate, p.rpDate);
        const hy = getHygieneState(p.hygieneType || 'pad', hrs, getFlow(day));
        const opts = Object.values(HYGIENE)
            .map(h => `<option value="${h.id}"${(p.hygieneType || 'pad') === h.id ? ' selected' : ''}>${h.label}</option>`)
            .join('');
        realismRow = `<div class="rp-quick-cycle">
            <span class="rp-quick-lbl">Гигиена</span>
            <select id="rp-quick-hygiene" class="text_pole" style="flex:1">${opts}</select>
            <button class="rp-quick-set" id="rp-quick-changed">${hy.needsChange ? 'Сменить' : 'Сменила'}</button>
        </div>`;
    }

    const overlay = $(`
    <dialog id="rp-quick-overlay" aria-modal="true" aria-labelledby="rp-quick-title">
        <div class="rp-quick-dialog">
            <div class="rp-tree-head">
                <span class="rp-tree-title" id="rp-quick-title">Репродукция</span>
                <button class="rp-tree-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rp-quick-body">
                <div class="rp-quick-status">${statusHtml}</div>
                ${(!isTracked('user')) ? '' : `<div class="rp-quick-cycle">
                    <span class="rp-quick-lbl">День цикла</span>
                    <button class="rp-quick-step" data-d="-1"><i class="fa-solid fa-minus"></i></button>
                    <input type="number" id="rp-quick-cycleday" min="1" max="28" value="${day}" class="text_pole">
                    <button class="rp-quick-step" data-d="1"><i class="fa-solid fa-plus"></i></button>
                    <button class="rp-quick-set" id="rp-quick-setcycle">Установить</button>
                </div>`}
                ${realismRow}
                <div class="rp-quick-actions">
                    ${(!p.isPregnant || !pregnancyIsKnown(p, s)) && !p.hasBaby
                        ? `<button class="rp-quick-btn" id="rp-quick-test">Сделать тест на беременность</button>` : ''}
                    ${!p.isPregnant && !p.hasBaby
                        ? `<button class="rp-quick-btn" id="rp-quick-trying">${s.tryingToConceive ? 'Перестать планировать' : 'Планируем ребёнка'}</button>` : ''}
                    <button class="rp-quick-btn" id="rp-quick-tree">Семейное древо</button>
                    ${p.isPregnant ? `<button class="rp-quick-btn" id="rp-quick-birth">Принять роды</button>` : ''}
                    <button class="rp-quick-btn" id="rp-quick-settings">Все настройки</button>
                </div>
            </div>
        </div>
    </dialog>`);

    $('body').append(overlay);
    const dialog = overlay[0];
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else overlay.attr('open', '');
    overlay.on('mousedown mouseup click touchstart touchend', (e) => e.stopPropagation());
    const close = () => {
        if (typeof dialog.close === 'function' && dialog.open) dialog.close();
        overlay.remove();
    };
    overlay.on('cancel', (e) => { e.preventDefault(); close(); });
    overlay.on('click', function(e) { if (e.target === this) close(); });
    overlay.find('.rp-tree-close').on('click', close);

    overlay.find('#rp-quick-hygiene').on('change', function() {
        const pd = getPregnancyData();
        pd.hygieneType = this.value;
        pd.hygieneChangedRpDate = pd.rpDate || null;
        saveSettingsDebounced();
        syncUI();
        updatePromptInjection();
    });
    overlay.find('#rp-quick-changed').on('click', function() {
        const pd = getPregnancyData();
        pd.hygieneChangedRpDate = pd.rpDate || null;
        saveSettingsDebounced();
        syncUI();
        updatePromptInjection();
        showNotification('<i class="fa-solid fa-shield-heart"></i> Средство сменено', 'success');
        close();
    });

    const applyCycle = (v) => {
        v = Math.max(1, Math.min(28, parseInt(v) || 1));
        overlay.find('#rp-quick-cycleday').val(v);
        setManualCycleDay('user', v);
        saveSettingsDebounced();
        setTimeout(() => { updatePromptInjection(); syncUI(); }, 30);
        // Обновляем строку статуса
        const ph = getPhaseInfo(v);
        overlay.find('.rp-quick-status').html(`Цикл: день ${v}/28 · <span style="color:${ph.color}">${ph.name}</span>`);
        showNotification(`День цикла: ${v}`, 'success');
    };
    overlay.find('.rp-quick-step').on('click', function() {
        const cur = parseInt(overlay.find('#rp-quick-cycleday').val()) || 1;
        let nv = cur + parseInt($(this).attr('data-d'));
        if (nv < 1) nv = 28; if (nv > 28) nv = 1;
        overlay.find('#rp-quick-cycleday').val(nv);
    });
    overlay.find('#rp-quick-setcycle').on('click', () => applyCycle(overlay.find('#rp-quick-cycleday').val()));
    overlay.find('#rp-quick-cycleday').on('keydown', function(e) { if (e.key === 'Enter') applyCycle($(this).val()); });

    // Нативный modal находится в top layer, поэтому перед открытием древа закрываем его.
    overlay.find('#rp-quick-test').on('click', () => {
        takePregnancyTest('user');
        close();
        setTimeout(() => { import('./message-handler.js').then(m => m.renderInfoblock()); }, 80);
    });
    overlay.find('#rp-quick-trying').on('click', () => {
        setTrying(!getSettings().tryingToConceive);
        close();
        showNotification(getSettings().tryingToConceive
            ? 'Планируем ребёнка — модель знает про фертильные дни'
            : 'Планирование выключено', 'success');
    });
    overlay.find('#rp-quick-tree').on('click', () => { close(); showFamilyTree(); });
    overlay.find('#rp-quick-birth').on('click', () => {
        close();
        if (!confirm('Принять роды прямо сейчас? Это запустит диалог именования малыша(ей).')) return;
        applyScanResult({ vaginal_ejaculation_occurred: false, birth_occurred: true, sex_revealed: false, revealed_sexes: null, baby_traits: null, cycle_day: null, _source: 'manual' });
    });
    overlay.find('#rp-quick-settings').on('click', () => {
        close();
        // Панель расширений — это ВНЕШНИЙ drawer ST (#extensions-settings-button).
        // Сначала открываем его, потом разворачиваем наш inline-drawer и скроллим.
        setTimeout(() => {
            const block = document.querySelector('#rm_extensions_block');
            if (block && block.classList.contains('closedDrawer')) {
                document.querySelector('#extensions-settings-button .drawer-toggle')?.click();
            }
            setTimeout(() => {
                const our = document.querySelector('#extensions_settings2 .reproductive-system-settings');
                const drawer = our?.closest('.inline-drawer');
                if (!drawer) return;
                const content = drawer.querySelector('.inline-drawer-content');
                const closed = content && (content.style.display === 'none' || getComputedStyle(content).display === 'none');
                if (closed) drawer.querySelector('.inline-drawer-toggle')?.click();
                drawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 280);
        }, 60);
    });
}

// ── syncUI ──
export function syncUI() {
    const s = getSettings();
    const p = getPregnancyData();

    const el = (id) => document.getElementById(id);

    const enabled = el('repro-enabled');
    const notify = el('repro-notify');
    if (enabled) enabled.checked = s.isEnabled;
    if (notify) notify.checked = s.showNotifications;

    const contraUser = el('repro-contraception-user');
    const contraChar = el('repro-contraception-char');
    if (contraUser) contraUser.value = getContraception('user');
    if (contraChar) contraChar.value = getContraception('char');
    const contraUserBox = el('repro-contraception-user-box');
    const contraCharBox = el('repro-contraception-char-box');
    if (contraUserBox) contraUserBox.style.display = isTracked('user') && canCarry(s, 'user') ? 'flex' : 'none';
    if (contraCharBox) contraCharBox.style.display = isTracked('char') && canCarry(s, 'char') ? 'flex' : 'none';
    const contraUserLabel = el('repro-contra-user-label');
    const contraCharLabel = el('repro-contra-char-label');
    if (contraUserLabel) contraUserLabel.textContent = `Контрацепция ${carrierName('user')}:`;
    if (contraCharLabel) contraCharLabel.textContent = `Контрацепция ${carrierName('char')}:`;

    const hiddenPreg = el('repro-hidden-preg');
    if (hiddenPreg) hiddenPreg.checked = s.hiddenPregnancy !== false;

    // ── Носители / вселенная ──
    const roleSettings = el('repro-role-settings');
    if (roleSettings) roleSettings.style.display = isOmegaverse(s) ? '' : 'none';
    for (const who of ['user','char']) {
        const roleSel = el(`repro-${who}-desig`);
        if (roleSel) roleSel.value = designationOf(s, who);
        const data = who === 'char' ? getPartnerData() : p;
        const row = el(`repro-hygiene-${who}`);
        if (row) row.style.display = isTracked(who) && canCarry(s, who) && s.menstruationEnabled !== false ? 'flex' : 'none';
        const type = el(`repro-hygiene-type-${who}`);
        if (type) type.value = data.hygieneType || 'pad';
    }
    const menstruationToggle = el('repro-menstruation-enabled');
    if (menstruationToggle) menstruationToggle.checked = s.menstruationEnabled !== false;
    const trackSel = el('repro-trackfor');
    if (trackSel) trackSel.value = s.trackFor || 'user';
    const carrierSel = el('repro-carrier-mode');
    if (carrierSel) carrierSel.value = s.carrierMode || 'user';
    const uniSel = el('repro-universe');
    if (uniSel) uniSel.value = s.universe || 'normal';
    const cycInfo = el('repro-currentcycle');
    const cycRow = el('repro-cycle-row');
    if (cycInfo) cycInfo.style.display = isTracked('user') ? '' : 'none';
    if (cycRow) cycRow.style.display = isTracked('user') && hasCycle(s, 'user') ? 'flex' : 'none';
    const partnerRow = el('repro-partner-cycle-row');
    if (partnerRow) partnerRow.style.display = isTracked('char') && hasCycle(s, 'char') ? '' : 'none';
    const partnerDay = getPartnerData().cycleDay || 1;
    const partnerInput = el('repro-partner-cycle-day');
    if (partnerInput) partnerInput.value = partnerDay;
    const partnerInfo = el('repro-partner-cycle-info');
    if (partnerInfo) {
        partnerInfo.textContent = cycleSummary('char', getPartnerData(), s);
        partnerInfo.style.color = getPartnerData().isPregnant ? 'var(--rp-pink)' : getPhaseInfo(partnerDay, 'ru', 'char').color;
    }

    const babyMaxAge = el('repro-baby-max-age');
    if (babyMaxAge) {
        const v = s.babyMaxAgeDays || 730;
        const validOptions = ['180', '365', '730', '1095', '1825', '0'];
        babyMaxAge.value = validOptions.includes(String(v)) ? String(v) : '730';
    }

    const durSel = el('repro-duration');
    const durCust = el('repro-duration-custom');
    if (durSel) {
        const dur = s.pregnancyDuration || 40;
        const std = ['12','16','20','24','28','32','36','40'];
        if (std.includes(String(dur))) {
            durSel.value = String(dur);
            if (durCust) durCust.style.display = 'none';
        } else {
            durSel.value = 'custom';
            if (durCust) { durCust.style.display = 'inline-block'; durCust.value = dur; }
        }
    }

    const cycleIn = el('repro-cycleday');
    const cycleInfo = el('repro-currentcycle');
    const _cd = getCycleDay();
    if (cycleIn) cycleIn.value = _cd;
    if (cycleInfo) {
        const ph = getPhaseInfo(_cd);
        cycleInfo.textContent = cycleSummary('user', p, s);
        cycleInfo.style.color = p.isPregnant ? 'var(--rp-pink)' : ph.color;
    }

    const status = el('repro-status');
    if (status) {
        if (p.isPregnant) status.innerHTML = `<span style="color:var(--rp-pink)">Беременна</span>`;
        else if (p.hasBaby) status.innerHTML = `<span style="color:var(--rp-blue)">Малыш</span>`;
        else status.innerHTML = `<span style="opacity:0.5">Нет</span>`;
    }

    const ibSel = el('repro-infoblock');
    if (ibSel) ibSel.value = s.infoblockPosition || 'off';

    // ── Pregnancy monitor ──
    const pregMon = el('repro-preg-mon');
    if (pregMon) {
        if (p.isPregnant && (p.pregnancyWeeks > 0 || p.conceptionDate)) {
            pregMon.style.display = 'block';
            const dur = s.pregnancyDuration || 40;
            const { weeks, days } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
            const pct = Math.min(100, Math.round((weeks / dur) * 100));
            const sexVis = (weeks / dur) * 100 >= 50;
            const sexStr = sexVis && p.fetusSex?.length ? p.fetusSex.map(s => s === 'M' ? 'М' : 'Д').join(', ') : '—';
            const health = getHealthInfo(p.healthStatus);
            const hCls = p.healthStatus === 'critical' ? 'crit' : p.healthStatus === 'warning' ? 'warn' : 'ok';

            let dueStr = '—';
            if (p.conceptionDate) {
                const dd = calculateDueDate(p.conceptionDate);
                if (dd) dueStr = dd.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            let conceptionStr = '—';
            if (p.conceptionDate) {
                conceptionStr = new Date(p.conceptionDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }

            const symptoms = getSymptomsForProgress(pct, weeks);
            const recs = getRecommendationsForProgress(pct);
            const fetusSize = (p._dynamic || {}).fetusSize || '';

            let compsHtml = '';
            if (p.complications?.length > 0) {
                const unres = p.complications.filter(c => !c.resolved);
                compsHtml = `<div class="rp-m-warn">${unres.length > 0 ? unres.map(c => c.type).join(', ') : 'Все решены'}</div>`;
                if (unres.length > 0) {
                    compsHtml += `<button id="repro-doctor-btn" class="rp-m-btn">К врачу (${unres.length})</button>`;
                }
            }

            pregMon.innerHTML = `
                <div class="rp-m-head pink">Беременность — ${weeks}/${dur} нед.</div>
                <div class="rp-m-progress"><div class="rp-m-progress-fill pink" style="width:${pct}%"></div></div>
                <div class="rp-m-grid">
                    <div class="rp-m-cell"><span class="rp-m-lbl">Зачатие</span><span class="rp-m-val">${conceptionStr}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">ПДР</span><span class="rp-m-val">${dueStr}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Плод</span><span class="rp-m-val">${formatFetusCount(p.fetusCount)} (${sexStr})</span></div>
                    ${fetusSize ? `<div class="rp-m-cell"><span class="rp-m-lbl">Размер</span><span class="rp-m-val">${fetusSize}</span></div>` : ''}
                    <div class="rp-m-cell"><span class="rp-m-lbl">Здоровье</span><span class="rp-m-val rp-m-hp-${hCls}">${health.text}</span></div>
                    ${p.fatherName ? `<div class="rp-m-cell"><span class="rp-m-lbl">Второй родитель</span><span class="rp-m-val">${escapeLabel(p.fatherName)}</span></div>` : ''}
                </div>
                <div class="rp-m-text"><b>Симптомы:</b> ${symptoms}</div>
                <div class="rp-m-text"><b>Рек-ции:</b> ${recs}</div>
                ${compsHtml}
                <div style="display:flex;gap:4px;align-items:center;margin-top:6px">
                    <span style="font-size:9px;opacity:0.5">Срок:</span>
                    <input type="number" id="repro-set-weeks" min="1" max="42" value="${weeks}" class="text_pole" style="width:50px">
                    <span style="font-size:9px;opacity:0.5">нед.</span>
                    <button id="repro-apply-weeks" class="rp-m-btn" style="flex:1">Установить</button>
                </div>
                <button id="repro-reanchor-btn" class="rp-m-btn" style="margin-top:6px;background:rgba(255,255,255,0.05)">Пересчитать недели от RP-даты</button>`;

            setTimeout(() => {
                const db = el('repro-doctor-btn'); if (db) db.onclick = visitDoctor;
                const rb = el('repro-reanchor-btn');
                if (rb) rb.onclick = () => {
                    if (!p.rpDate) { showNotification('Нет RP-даты в чате', 'warning'); return; }
                    if (!p.conceptionDate) {
                        showNotification('Нет даты зачатия — поставь её через "Ручная беременность"', 'warning');
                        return;
                    }
                    // Пересчитываем НЕДЕЛИ от текущей RP-даты, conceptionDate НЕ трогаем —
                    // это «твоя реальная дата зачатия», она не должна меняться.
                    const conceptionMs = new Date(p.conceptionDate).getTime();
                    const rpMs = new Date(p.rpDate).getTime();
                    if (rpMs < conceptionMs) {
                        showNotification('RP-дата раньше даты зачатия — пересчёт невозможен', 'warning');
                        return;
                    }
                    const newWeeks = Math.floor((rpMs - conceptionMs) / (7 * 86400000));
                    p.pregnancyWeeks = newWeeks;
                    p._conceptionAnchored = true;
                    p._userSetWeeksAt = Date.now();
                    import('./message-handler.js').then(m => m.refreshRegenSnapshot && m.refreshRegenSnapshot());
                    saveSettingsDebounced();
                    const cDateStr = new Date(p.conceptionDate).toLocaleDateString('ru-RU');
                    const rDateStr = new Date(p.rpDate).toLocaleDateString('ru-RU');
                    showNotification(`Недели пересчитаны: ${cDateStr} → ${rDateStr} = ${newWeeks} нед.`, 'success');
                    syncUI();
                    updatePromptInjection();
                };
                // Установка срока вручную: пересчитываем conceptionDate так чтобы (rpDate - conception) = N недель
                const ab = el('repro-apply-weeks');
                if (ab) ab.onclick = () => {
                    const input = el('repro-set-weeks');
                    const newWeeks = Math.max(0, Math.min(42, parseInt(input?.value) || 0));
                    setManualPregnancyWeeks('user', newWeeks);
                    saveSettingsDebounced();
                    showNotification(`Срок установлен: ${newWeeks} нед.`, 'success');
                    syncUI();
                    updatePromptInjection();
                    setTimeout(() => {
                        import('./message-handler.js').then(m => m.renderInfoblock());
                    }, 100);
                };
            }, 10);
        } else {
            pregMon.style.display = 'none';
        }
    }

    // ── Монитор беременности ПАРТНЁРА ──
    const partnerMon = el('repro-partner-mon');
    if (partnerMon) {
        const c = isTracked('char') ? getPartnerData() : null;
        if (c && c.isPregnant) {
            partnerMon.style.display = 'block';
            const dur = s.pregnancyDuration || 40;
            const { weeks } = calculateWeeksFromDates(c.conceptionDate, p.rpDate, c.pregnancyWeeks);
            const pct = Math.min(100, Math.round((weeks / dur) * 100));
            const sexStr = c.fetusSexRevealed && c.fetusSex?.length ? c.fetusSex.map(x => x === 'M' ? 'М' : 'Д').join(', ') : '—';
            let dueStr = '—';
            if (c.conceptionDate) {
                const dd = calculateDueDate(c.conceptionDate);
                if (dd) dueStr = dd.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            partnerMon.innerHTML = `
                <div class="rp-m-head pink">${carrierName('char')} — ${weeks}/${dur} нед.</div>
                <div class="rp-m-progress"><div class="rp-m-progress-fill pink" style="width:${pct}%"></div></div>
                <div class="rp-m-grid">
                    <div class="rp-m-cell"><span class="rp-m-lbl">ПДР</span><span class="rp-m-val">${dueStr}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Плод</span><span class="rp-m-val">${formatFetusCount(c.fetusCount)} (${sexStr})</span></div>
                    ${c.fatherName ? `<div class="rp-m-cell"><span class="rp-m-lbl">Второй родитель</span><span class="rp-m-val">${escapeLabel(c.fatherName)}</span></div>` : ''}
                </div>
                <div style="display:flex;gap:4px;margin-top:6px">
                    <button id="repro-partner-birth" class="rp-m-btn" style="flex:1">Принять роды</button>
                    <button id="repro-partner-reset" class="rp-m-btn" style="flex:1;background:rgba(255,80,80,0.12)">Сброс</button>
                </div>`;
            setTimeout(() => {
                const bb = el('repro-partner-birth');
                if (bb) bb.onclick = () => {
                    if (!confirm(`Принять роды у ${carrierName('char')}? Запустится диалог именования.`)) return;
                    import('./pregnancy.js').then(m => m.partnerBirth(null, { source: 'manual' }));
                };
                const rb2 = el('repro-partner-reset');
                if (rb2) rb2.onclick = () => {
                    if (!confirm(`Сбросить беременность у ${carrierName('char')}?`)) return;
                    resetPartnerPregnancy();
                    showNotification('Сброшено', 'info');
                };
            }, 10);
        } else {
            partnerMon.style.display = 'none';
        }
    }

    // Строка выбора носителя в ручной панели — только когда отслеживаются оба
    const manualWhoRow = el('repro-manual-who-row');
    if (manualWhoRow) manualWhoRow.style.display = (s.trackFor === 'both') ? 'flex' : 'none';
    const manualWhoSel = el('repro-manual-who');
    if (manualWhoSel && s.trackFor !== 'both') manualWhoSel.value = (s.trackFor === 'char') ? 'char' : 'user';

    const manualParent = el('repro-manual-second-parent');
    const manualCarrier = manualWhoSel?.value === 'char' ? getPartnerData() : p;
    if (manualParent && document.activeElement !== manualParent && manualCarrier.isPregnant) manualParent.value = manualCarrier.fatherName || '';

    const resetBtn = el('repro-reset');
    if (resetBtn) resetBtn.style.display = p.isPregnant ? 'block' : 'none';

    const forceBirthBtn = el('repro-force-birth-btn');
    if (forceBirthBtn) forceBirthBtn.style.display = p.isPregnant ? 'block' : 'none';

    // ── Baby monitor ──
    const babyMon = el('repro-baby-mon');
    const resetBabyBtn = el('repro-reset-baby');
    if (babyMon) {
        if (p.hasBaby) {
            babyMon.style.display = 'block';
            if (resetBabyBtn) resetBabyBtn.style.display = 'block';
            const babies = p.babies && p.babies.length > 0 ? p.babies : [{ name: p.babyName, health: p.babyHealth || 'normal', mood: p.babyMood, sleep: p.babySleep, feedingType: p.babyFeedingType, diaperClean: p.babyDiaperClean, sex: p.babySex?.[0] }];
            let monHtml = '';
            babies.forEach((baby, i) => {
                const bh = getHealthInfo(baby.health || 'normal');
                const bhCls = (baby.health === 'critical') ? 'crit' : (baby.health === 'warning') ? 'warn' : 'ok';
                const sexIcon = baby.sex === 'M' ? '<i class="fa-solid fa-mars"></i>' : baby.sex === 'F' ? '<i class="fa-solid fa-venus"></i>' : '';
                const headColor = baby.sex === 'F' ? 'pink' : 'blue';
                const label = baby.name || (babies.length > 1 ? `Малыш ${i + 1}` : 'без имени');
                monHtml += `
                <div class="rp-m-head ${headColor}">${sexIcon} ${label} — ${p.babyAge || 'новорожд.'}</div>
                <div class="rp-m-grid">
                    <div class="rp-m-cell"><span class="rp-m-lbl">Здоровье</span><span class="rp-m-val rp-m-hp-${bhCls}">${bh.text}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Настроение</span><span class="rp-m-val">${baby.mood || '—'}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Сон</span><span class="rp-m-val">${baby.sleep || '—'}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Кормление</span><span class="rp-m-val">${baby.feedingType || '—'}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Подгузник</span><span class="rp-m-val" style="color:${baby.diaperClean !== false ? 'var(--rp-green)' : 'var(--rp-yellow)'}">${baby.diaperClean !== false ? 'Чистый' : 'Смена!'}</span></div>
                    ${baby.fatherName ? `<div class="rp-m-cell"><span class="rp-m-lbl">Второй родитель</span><span class="rp-m-val">${escapeLabel(baby.fatherName)}</span></div>` : ''}
                </div>`;
            });
            babyMon.innerHTML = monHtml;
        } else {
            babyMon.style.display = 'none';
            if (resetBabyBtn) resetBabyBtn.style.display = 'none';
        }
    }

    const stats = el('repro-stats');
    if (stats) {
        const clock = p.rpDate ? new Date(p.rpDate).toLocaleString('ru-RU', {dateStyle:'short', timeStyle:'short'}) : 'нет отметки';
        stats.textContent = `${s.totalChecks} проверок / ${s.totalConceptions} зачатий · Время РП: ${clock}`;
    }
}

// ── setupUI ──
export function setupUI() {
    try {
        const s = getSettings();
        const html = `
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>${L('title')}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div class="reproductive-system-settings">
            <label class="checkbox_label"><input type="checkbox" id="repro-enabled"><span>${L('enabled')}</span></label>
            <label class="checkbox_label"><input type="checkbox" id="repro-notify"><span>${L('notifications')}</span></label>
            <hr>
            <div style="display:flex;gap:4px;align-items:center">
                <label for="repro-trackfor">Отслеживать:</label>
                <select id="repro-trackfor" class="text_pole">
                    <option value="user">Меня</option><option value="char">Бота</option><option value="both">Обоих</option>
                </select>
            </div>
            <div style="display:flex;gap:4px;align-items:center">
                <span>Вынашивание:</span>
                <select id="repro-carrier-mode" class="text_pole">
                    <option value="user">Вынашиваю я</option>
                    <option value="char">Вынашивает бот</option>
                    <option value="both">Вынашиваем оба</option>
                    <option value="none">Никто</option>
                </select>
            </div>
            <div style="display:flex;gap:4px;align-items:center">
                <label for="repro-universe">Вселенная:</label>
                <select id="repro-universe" class="text_pole" title="В омегаверсе течка совпадает с овуляторной фазой цикла">
                    <option value="normal">Обычная</option>
                    <option value="omegaverse">Омегаверс</option>
                </select>
            </div>
            <div id="repro-role-settings">
                <div class="rp-setting-row"><label for="repro-user-desig">Я:</label><select id="repro-user-desig" class="text_pole"><option value="alpha">Альфа</option><option value="beta">Бета</option><option value="omega">Омега</option></select></div>
                <div class="rp-setting-row"><label for="repro-char-desig">Бот:</label><select id="repro-char-desig" class="text_pole"><option value="alpha">Альфа</option><option value="beta">Бета</option><option value="omega">Омега</option></select></div>
            </div>
            <label class="checkbox_label"><input type="checkbox" id="repro-menstruation-enabled"><span>Месячные включены</span></label>
            <div id="repro-partner-cycle-row">
                <span id="repro-partner-cycle-info"></span>
                <input id="repro-partner-cycle-day" class="text_pole" type="number" min="1" max="28">
                <button id="repro-partner-cycle-set" class="menu_button">Установить день бота</button>
            </div>
            <hr>
            <label class="checkbox_label" title="Скрывать неподтверждённую беременность; учитывать тесты, раскрытие и факты текущей сцены"><input type="checkbox" id="repro-hidden-preg"><span>Скрытая беременность (тест)</span></label>
            <div id="repro-contraception-user-box" style="display:flex;gap:4px;align-items:center">
                <span id="repro-contra-user-label" style="font-size:9px;opacity:0.5">Контрацепция {{user}}:</span>
                <select id="repro-contraception-user" class="text_pole" style="flex:1">
                    <option value="none">Нет</option><option value="condom">Презерватив</option><option value="pill">Таблетки</option><option value="iud">ВМС</option>
                </select>
            </div>
            <div id="repro-contraception-char-box" style="display:none;gap:4px;align-items:center">
                <span id="repro-contra-char-label" style="font-size:9px;opacity:0.5">Контрацепция {{char}}:</span>
                <select id="repro-contraception-char" class="text_pole" style="flex:1">
                    <option value="none">Нет</option><option value="condom">Презерватив</option><option value="pill">Таблетки</option><option value="iud">ВМС</option>
                </select>
            </div>
            <div style="display:flex;gap:4px;align-items:center">
                <span style="font-size:9px;opacity:0.5">Длит. берем.:</span>
                <select id="repro-duration" class="text_pole" style="flex:1">
                    <option value="12">12 нед.</option><option value="16">16</option>
                    <option value="20">20</option><option value="24">24</option>
                    <option value="28">28</option><option value="32">32</option>
                    <option value="36">36</option><option value="40" selected>40 (стд)</option>
                    <option value="custom">Своё</option>
                </select>
                <input type="number" id="repro-duration-custom" class="text_pole" style="width:45px;display:none" min="4" max="100">
            </div>
            <div style="display:flex;gap:4px;align-items:center" title="После этого возраста ребёнок «выпускается» из инфоблока — остаётся в семье, но без отслеживания подгузников/кормления.">
                <span style="font-size:9px;opacity:0.5">Малыш до:</span>
                <select id="repro-baby-max-age" class="text_pole" style="flex:1">
                    <option value="180">6 мес.</option>
                    <option value="365">1 год</option>
                    <option value="730">2 года</option>
                    <option value="1095">3 года</option>
                    <option value="1825">5 лет</option>
                    <option value="0">Никогда (вручную)</option>
                </select>
            </div>
            <hr>
            <div id="repro-currentcycle" class="rp-cycle-info"></div>
            <div id="repro-cycle-row" style="display:flex;gap:4px;align-items:center">
                <span style="font-size:9px;opacity:0.5">День цикла:</span>
                <input type="number" id="repro-cycleday" min="1" max="28" value="${getCycleDay()}" class="text_pole" style="width:45px">
                <button id="repro-setcycle" class="menu_button">${ic('fa-check')}</button>
            </div>
            <hr>
            <div style="font-size:10px;opacity:0.7">Статус: <span id="repro-status"></span></div>
            <div id="repro-preg-mon" class="rp-m" style="display:none"></div>
            <div id="repro-partner-mon" class="rp-m" style="display:none"></div>
            <div id="repro-baby-mon" class="rp-m" style="display:none"></div>
            <button id="repro-family-tree-btn" class="menu_button" style="width:100%"><i class="fa-solid fa-people-roof" style="margin-right:6px;color:rgba(130,200,255,.8)"></i>Семейное древо</button>
            <button id="repro-force-birth-btn" class="menu_button" style="width:100%;display:none"><i class="fa-solid fa-baby" style="margin-right:6px;color:rgba(255,120,180,.8)"></i>Принять роды сейчас</button>
            <hr>
            <div style="display:flex;gap:4px;align-items:stretch">
                <div id="repro-manual-toggle" class="menu_button" style="flex:1;font-size:10px;text-align:center;cursor:pointer">Ручная беременность / малыш ▼</div>
                <div id="repro-css-toggle" class="menu_button" style="flex:1;font-size:10px;text-align:center;cursor:pointer">CSS инфоблока ▼</div>
                <div id="repro-theme-btn" class="menu_button" style="flex:0 0 auto;font-size:10px;padding:0 9px;text-align:center;cursor:pointer" title="Стиль"><i class="fa-solid fa-palette"></i></div>
            </div>
            <div id="repro-manual-panel" style="display:none;gap:4px;flex-direction:column">
                <small style="opacity:0.5;font-size:9px;font-weight:600">Беременность</small>
                <div style="display:flex;gap:4px;align-items:center" id="repro-manual-who-row">
                    <span style="font-size:9px;opacity:0.5;min-width:62px">Носитель:</span>
                    <select id="repro-manual-who" class="text_pole" style="flex:1">
                        <option value="user">Я</option>
                        <option value="char">Персонаж</option>
                    </select>
                </div>
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5;min-width:62px">Зачатие:</span>
                    <input type="date" id="repro-manual-conception-date" class="text_pole" style="flex:1" title="RP-дата (не реальная). Недели посчитаются от этой даты до текущего RP_DATE в чате.">
                </div>
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5;min-width:62px">Плодов:</span>
                    <input type="number" id="repro-manual-fetus" min="1" max="4" value="1" class="text_pole" style="width:42px">
                    <select id="repro-manual-sex" class="text_pole" style="flex:1">
                        <option value="random">Пол: случайно</option>
                        <option value="M">Все мальчики</option>
                        <option value="F">Все девочки</option>
                    </select>
                </div>
                <label for="repro-manual-second-parent" style="font-size:11px">Второй родитель</label>
                <input type="text" id="repro-manual-second-parent" class="text_pole" maxlength="80" placeholder="Имя второго родителя" title="Для текущей беременности имя сохраняется при завершении ввода; для новой — при нажатии «Начать беременность».">
                <button id="repro-manual-start" class="menu_button" style="width:100%">Начать беременность</button>
                <small style="opacity:0.5;font-size:9px;font-weight:600;margin-top:4px">Малыш <span style="font-weight:400;opacity:0.7">(добавляется к существующим)</span></small>
                <div style="display:flex;gap:4px;align-items:center">
                    <input type="text" id="repro-mb-name" class="text_pole" style="flex:1" maxlength="60" placeholder="Имя">
                    <select id="repro-mb-sex" class="text_pole" style="width:80px">
                        <option value="M">Мальчик</option>
                        <option value="F">Девочка</option>
                    </select>
                </div>
                <div style="display:flex;gap:4px;align-items:center">
                    <input type="number" id="repro-mb-age-days" class="text_pole" style="width:52px" min="0" max="999" value="0" title="Возраст малыша">
                    <select id="repro-mb-age-unit" class="text_pole" style="width:74px">
                        <option value="d">дней</option>
                        <option value="m">мес.</option>
                        <option value="y">лет</option>
                    </select>
                    <input type="text" id="repro-mb-father" class="text_pole" style="flex:1" maxlength="60" placeholder="Второй родитель (необязательно)">
                </div>
                <input type="text" id="repro-mb-personality" class="text_pole" maxlength="200" placeholder="Характер: спокойный, любопытный (через запятую)" title="Черты характера через запятую — попадут в инфоблок и в промпт для модели">
                <input type="text" id="repro-mb-appearance" class="text_pole" maxlength="200" placeholder="Внешность: мамины глаза, тёмные волосы (через запятую)" title="Черты внешности через запятую — попадут в инфоблок и в промпт для модели">
                <button id="repro-manual-baby-add" class="menu_button" style="width:100%">Добавить малыша</button>
                <button id="repro-reset" class="menu_button redWarningBG" style="width:100%;display:none">Сброс берем.</button>
                <button id="repro-reset-baby" class="menu_button redWarningBG" style="width:100%;display:none">Сброс малыша</button>
                <button id="repro-undo" class="menu_button" style="width:100%">↶ Отменить последний сброс/удаление</button>
            </div>
            <hr>
            <div style="display:flex;gap:4px;align-items:center">
                <span style="font-size:9px;opacity:0.5">Инфоблок:</span>
                <select id="repro-infoblock" class="text_pole" style="flex:1">
                    <option value="off">Выкл.</option>
                    <option value="top">Вверху</option>
                    <option value="bottom">Внизу</option>
                </select>
            </div>
            <label style="display:flex;gap:6px;align-items:center;font-size:10px;cursor:pointer">
                <input type="checkbox" id="repro-light-mode">
                <span>Светлая тема</span>
            </label>
            <label style="display:flex;gap:6px;align-items:center;font-size:10px;cursor:pointer" title="Цикл становится частью РП: гигиена и протечки в месячные, самочувствие по фазам, сбои цикла от стресса или болезни">
                <input type="checkbox" id="repro-realism">
                <span>Реализм цикла</span>
            </label>
            <button id="repro-purge-tags" class="menu_button" style="width:100%;font-size:10px" title="Убрать технические теги из текста сообщений этого чата — модель перестанет их видеть">Вычистить теги из чата</button>
            <div id="repro-css-panel" style="display:none;flex-direction:column;gap:4px">
                <textarea id="repro-custom-css" class="text_pole" rows="10" style="font-family:monospace;font-size:10px;resize:vertical;min-height:80px;white-space:pre;tab-size:2" placeholder="/* Свой CSS для инфоблока */\ndetails.repro { ... }"></textarea>
                <div style="display:flex;gap:4px">
                    <button id="repro-css-apply" class="menu_button" style="flex:1">Применить</button>
                    <button id="repro-css-reset" class="menu_button" style="flex:0 0 auto">Сброс</button>
                </div>
                <small style="opacity:0.35;font-size:8px">Селекторы: details.repro, .repro-header, .repro-c, .repro-stat, .rp-val, .repro-bar-fill и др. Правила отсюда сильнее выбранного стиля.</small>
            </div>
            <hr>
            <small id="repro-stats" style="opacity:0.3;font-size:8px">0 / 0</small>
        </div>
    </div>
</div>`;

        $('#extensions_settings2').append(html);

        // ── Пункт в «волшебной палочке» ST (меню расширений у поля ввода) ──
        // Открывает быструю панель: смена цикла, древо, роды — не лазая в настройки.
        // Меню #extensionsMenu создаётся асинхронно из шаблона wandMenu, поэтому
        // регистрируемся с ретраем, пока контейнер не появится.
        const registerWandItem = (attempt = 0) => {
            if ($('#repro_wand_open').length > 0) return;
            const menu = $('#extensionsMenu');
            if (menu.length === 0) {
                if (attempt < 30) setTimeout(() => registerWandItem(attempt + 1), 400);
                return;
            }
            const wandItem = $(`
                <div id="repro_wand_open" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Репродукция — быстрая панель">
                    <div class="fa-solid fa-dna extensionsMenuExtensionButton"></div>
                    <span>Репродукция</span>
                </div>`);
            menu.append(wandItem);
            wandItem.on('click', () => { menu.hide(); showQuickBar(); });
        };
        registerWandItem();

        // Events
        $('#repro-enabled').on('change', function() {
            getSettings().isEnabled = this.checked;
            saveSettingsDebounced();
            updatePromptInjection();
            // Выключили — теги из прошлых сообщений всё ещё в контексте и тянут сюжет.
            // Расширение их больше не обслуживает, так что предлагаем убрать.
            if (!this.checked) {
                import('./message-handler.js').then(m => {
                    if (!m.chatHasTags()) return;
                    if (!confirm('Расширение выключено, но в сообщениях остались его технические теги — модель их видит и продолжает по ним сюжет. Убрать теги из этого чата?')) return;
                    const n = m.purgeChatTags();
                    showNotification(`Теги убраны из ${n} сообщ.`, 'success');
                });
            }
        });
        $('#repro-notify').on('change', function() { getSettings().showNotifications = this.checked; saveSettingsDebounced(); });
        $('#repro-baby-max-age').on('change', function() {
            const v = parseInt(this.value) || 730;
            getSettings().babyMaxAgeDays = v;
            saveSettingsDebounced();
            updatePromptInjection();
        });

        // Принудительно вызвать роды СЕЙЧАС — если модель описала роды но не поставила тег
        $('#repro-family-tree-btn').on('click', function() {
            showFamilyTree();
        });

        $('#repro-force-birth-btn').on('click', function() {
            const p = getPregnancyData();
            if (!p.isPregnant) {
                showNotification('Беременности нет', 'warning');
                return;
            }
            if (!confirm('Принять роды прямо сейчас? Это запустит диалог именования малыша(ей) и переведёт состояние из беременности в режим «малыш».')) return;
            applyScanResult({
                vaginal_ejaculation_occurred: false,
                birth_occurred: true,
                sex_revealed: false,
                revealed_sexes: null,
                baby_traits: null,
                cycle_day: null,
                _source: 'manual',
            });
        });

        // ── Носители и вселенная ──
        const refreshAll = () => {
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
            setTimeout(() => { import('./message-handler.js').then(m => m.renderInfoblock()); }, 60);
        };
        for (const who of ['user','char']) {
            $(`#repro-${who}-desig`).on('change', function() {
                getSettings()[who === 'char' ? 'charDesignation' : 'userDesignation'] = this.value;
                (who === 'char' ? getPartnerData() : getPregnancyData())._dynamic = {};
                refreshAll();
            });
        }
        $('#repro-trackfor').on('change', function() { getSettings().trackFor = this.value; refreshAll(); });
        $('#repro-menstruation-enabled').on('change', function() {
            getSettings().menstruationEnabled = this.checked;
            getPregnancyData()._dynamic = {}; getPartnerData()._dynamic = {};
            refreshAll();
        });
        $('#repro-carrier-mode').on('change', function() { getSettings().carrierMode = this.value; getPregnancyData(); getPartnerData(); refreshAll(); });
        $('#repro-universe').on('change', function() { getSettings().universe = this.value; refreshAll(); });
        const applyPartnerCycle = () => {
            setManualCycleDay('char', $('#repro-partner-cycle-day').val());
            refreshAll();
        };
        $('#repro-partner-cycle-set').on('click', applyPartnerCycle);
        $('#repro-partner-cycle-day').on('change', applyPartnerCycle).on('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); applyPartnerCycle(); }
        });
        $('#repro-hidden-preg').on('change', function() { getSettings().hiddenPregnancy = this.checked; refreshAll(); });
        $('#repro-contraception-user').on('change', function() { const s = getSettings(); s.contraceptionUser = this.value; s.contraception = this.value; saveSettingsDebounced(); updatePromptInjection(); syncUI(); });
        $('#repro-contraception-char').on('change', function() { const s = getSettings(); s.contraceptionChar = this.value; saveSettingsDebounced(); updatePromptInjection(); syncUI(); });

        $('#repro-duration').on('change', function() {
            const v = $(this).val();
            if (v === 'custom') { $('#repro-duration-custom').show().focus(); }
            else { $('#repro-duration-custom').hide(); getSettings().pregnancyDuration = parseInt(v); saveSettingsDebounced(); updatePromptInjection(); syncUI(); }
        });
        $('#repro-duration-custom').on('change', function() {
            const v = Math.max(4, Math.min(100, parseInt($(this).val()) || 40));
            $(this).val(v); getSettings().pregnancyDuration = v; saveSettingsDebounced(); updatePromptInjection(); syncUI();
        });

        // Гвард: если чат ещё не определён, ручные изменения уйдут во временный fallback
        // и потеряются. Предупреждаем юзера вместо тихой потери.
        const warnIfNoChat = () => {
            if (!getCurrentChatId()) {
                showNotification('Чат не определён — открой чат и повтори, иначе изменения не сохранятся', 'warning');
                return true;
            }
            return false;
        };

        const applyManualCycle = (v) => {
            if (warnIfNoChat()) return;
            v = Math.max(1, Math.min(28, parseInt(v) || 14));
            $('#repro-cycleday').val(v);
            setManualCycleDay('user', v);

            saveSettingsDebounced();
            setTimeout(() => { updatePromptInjection(); syncUI(); }, 50);
        };
        $('#repro-setcycle').on('click', function() {
            applyManualCycle($('#repro-cycleday').val());
        });
        // Сохранение на Enter или blur (фокус ушёл из поля) — чтобы не зависеть от галочки.
        // Многие забывают тыкнуть кнопку, набирают число и шлют сообщение → значение терялось.
        $('#repro-cycleday').on('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyManualCycle($(this).val());
            }
        });
        $('#repro-cycleday').on('change blur', function() {
            applyManualCycle($(this).val());
        });

        $('#repro-reset').on('click', function() { if (confirm('Сбросить беременность?')) { resetPregnancy(); showNotification('Сброшено', 'info'); } });
        $('#repro-reset-baby').on('click', function() { if (confirm('Сбросить малыша?')) { resetBaby(); showNotification('Сброшено', 'info'); } });
        $('#repro-undo').on('click', function() {
            const label = undoLastDestructiveChange();
            showNotification(label ? `Отменено: ${label}` : 'Нечего отменять', label ? 'success' : 'info');
        });

        // Manual pregnancy/baby toggle (объединённая панель)
        $('#repro-manual-toggle').on('click', function() {
            const panel = $('#repro-manual-panel');
            const visible = panel.is(':visible');
            panel.css('display', visible ? 'none' : 'flex');
            $(this).text(visible ? 'Ручная беременность / малыш ▼' : 'Ручная беременность / малыш ▲');
        });

        $('#repro-manual-baby-add').on('click', function() {
            if (warnIfNoChat()) return;
            const name = $('#repro-mb-name').val().trim();
            const sex = $('#repro-mb-sex').val();
            // Возраст: число + единица (дни / месяцы / годы) → в дни
            const ageUnit = $('#repro-mb-age-unit').val() || 'd';
            const ageRaw = Math.max(0, parseInt($('#repro-mb-age-days').val()) || 0);
            const unitMul = ageUnit === 'y' ? 365 : ageUnit === 'm' ? 30 : 1;
            const ageDays = Math.min(36500, ageRaw * unitMul);
            const father = $('#repro-mb-father').val().trim();
            // Характер/внешность: строка через запятую → массив черт (пустые отбрасываем)
            const splitTraits = (v) => String(v || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
            const personality = splitTraits($('#repro-mb-personality').val());
            const appearance = splitTraits($('#repro-mb-appearance').val());
            startManualBaby([{
                name: name,
                sex: sex,
                ageDays: ageDays,
                personality: personality,
                appearance: appearance,
                fatherName: father,
            }]);
            // Очищаем поля
            $('#repro-mb-name').val('');
            $('#repro-mb-father').val('');
            $('#repro-mb-age-days').val('0');
            $('#repro-mb-personality').val('');
            $('#repro-mb-appearance').val('');
            syncUI();
            updatePromptInjection();
            setTimeout(() => {
                import('./message-handler.js').then(m => m.renderInfoblock());
            }, 200);
        });

        // Manual pregnancy: prefill дату последним RP_DATE из чата (если есть) минус 4 недели
        const manualDateInput = $('#repro-manual-conception-date');
        if (manualDateInput.length && !manualDateInput.val()) {
            const p = getPregnancyData();
            let prefill = null;
            if (p.rpDate) {
                // RP-дата минус 4 недели как разумный дефолт
                prefill = new Date(new Date(p.rpDate).getTime() - 4 * 7 * 86400000);
            } else {
                // Real-world сегодня минус 4 недели — пользователь подправит
                prefill = new Date(Date.now() - 4 * 7 * 86400000);
            }
            // YYYY-MM-DD формат для input[type=date]
            const iso = prefill.toISOString().slice(0, 10);
            manualDateInput.val(iso);
        }

        $('#repro-manual-who').on('change', () => {
            const who = $('#repro-manual-who').val() || 'user';
            $('#repro-manual-second-parent').val((who === 'char' ? getPartnerData() : getPregnancyData()).fatherName || '');
        });
        $('#repro-manual-second-parent').on('change', function() {
            setSecondParent($('#repro-manual-who').val() || 'user', $(this).val());
        });

        // Manual pregnancy start
        $('#repro-manual-start').on('click', function() {
            if (warnIfNoChat()) return;
            const dateStr = $('#repro-manual-conception-date').val();
            if (!dateStr) {
                showNotification('Укажи дату зачатия', 'warning');
                return;
            }
            const conceptionDate = new Date(dateStr + 'T00:00:00');
            if (isNaN(conceptionDate.getTime())) {
                showNotification('Неверная дата', 'warning');
                return;
            }
            const fetus = Math.max(1, Math.min(4, parseInt($('#repro-manual-fetus').val()) || 1));
            const sexMode = $('#repro-manual-sex').val();
            let sexArr = null;
            if (sexMode === 'M' || sexMode === 'F') {
                sexArr = new Array(fetus).fill(sexMode);
            }
            // Носитель: я или персонаж
            const who = $('#repro-manual-who').val() || 'user';
            const secondParent = String($('#repro-manual-second-parent').val() || '').trim();
            if (who === 'char') startPartnerPregnancy(conceptionDate.toISOString(), fetus, sexArr, secondParent);
            else startManualPregnancy(conceptionDate.toISOString(), fetus, sexArr, secondParent);
            syncUI();
            updatePromptInjection();
            setTimeout(() => { import('./message-handler.js').then(m => m.renderInfoblock()); }, 100);
        });

        // Infoblock
        $('#repro-infoblock').on('change', function() { getSettings().infoblockPosition = this.value; saveSettingsDebounced(); });

        // Чистка тегов из истории чата
        $('#repro-purge-tags').on('click', function() {
            if (!confirm('Убрать технические теги из текста сообщений этого чата? Они переедут в служебное поле: расширение их по-прежнему читает, а модель — больше нет. Видимый текст не меняется.')) return;
            // Динамический импорт: message-handler сам тянет ui.js, статический импорт замкнул бы круг
            import('./message-handler.js').then(m => {
                const n = m.purgeChatTags();
                showNotification(n ? `Теги убраны из ${n} сообщ.` : 'Тегов в этом чате нет', n ? 'success' : 'info');
            });
        });

        // Реализм цикла
        $('#repro-realism').prop('checked', !!s.realism).on('change', function() {
            getSettings().realism = this.checked;
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });

        // Светлая тема таверны
        $('#repro-light-mode').prop('checked', !!s.lightMode).on('change', function() {
            getSettings().lightMode = this.checked;
            applyTheme(getSettings().theme, this.checked);
            saveSettingsDebounced();
        });

        // CSS editor
        $('#repro-css-toggle').on('click', function() {
            const panel = $('#repro-css-panel');
            const visible = panel.is(':visible');
            panel.css('display', visible ? 'none' : 'flex');
            $(this).text(visible ? 'CSS инфоблока ▼' : 'CSS инфоблока ▲');
            if (!visible) {
                const ta = $('#repro-custom-css');
                if (!ta.val()) {
                    ta.val(getSettings().customInfoblockCss || DEFAULT_INFOBLOCK_CSS);
                }
            }
        });
        $('#repro-css-apply').on('click', function() {
            const css = $('#repro-custom-css').val() || '';
            const skeleton = isSkeletonCss(css);
            getSettings().customInfoblockCss = skeleton ? '' : css;
            saveSettingsDebounced();
            applyCustomCss(css);
            showNotification(skeleton ? 'Скелет без правок — оставлен стиль расширения' : 'CSS применён', skeleton ? 'info' : 'success');
        });
        $('#repro-css-reset').on('click', function() {
            if (!confirm('Сбросить кастомный CSS?')) return;
            getSettings().customInfoblockCss = '';
            $('#repro-custom-css').val(DEFAULT_INFOBLOCK_CSS);
            saveSettingsDebounced();
            applyCustomCss('');
            showNotification('CSS сброшен (стандартный стиль)', 'info');
        });

        // Выбор стиля
        $('#repro-theme-btn').on('click', showThemePicker);

        // Раньше «Применить» сохраняло скелет как кастом — он перекрывал стиль.
        // Разово вычищаем такие настройки.
        if (s.customInfoblockCss && isSkeletonCss(s.customInfoblockCss)) {
            s.customInfoblockCss = '';
            saveSettingsDebounced();
        }
        if (s.customInfoblockCss) {
            applyCustomCss(s.customInfoblockCss);
        }
        s.theme = normalizeTheme(s.theme);
        applyTheme(s.theme);

        syncUI();
    } catch (error) {
        reportError('[Reproductive] setupUI error:', error);
    }
}
