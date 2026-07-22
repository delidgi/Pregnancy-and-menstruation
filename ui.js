// UI v5 — compact, minimal icons, visual infoblock
import { saveSettingsDebounced } from '../../../../script.js';
import { getSettings, getPregnancyData, getCycleDay, setCycleDay, getCurrentChatId, L } from './state.js';
import { getPhaseInfo, calculateWeeksFromDates, getSymptomsForProgress, getRecommendationsForProgress, getFetusSizeForProgress, formatSexIcons, formatFetusCount, getHealthInfo, detectChatLanguage, translateStatusValue } from './helpers.js';
import { babyAgeDays, getCareNeeds, getGrowthStage } from './baby-care.js';
import { calculateDueDate } from './date-parser.js';
import { resetPregnancy, resetBaby, visitDoctor, applyScanResult, startManualPregnancy, startManualBaby } from './pregnancy.js';
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
details.repro .repro-health.critical { border: 1px solid rgba(255,60,60,.3);  color: rgba(255,60,60,.9); }`;

// ── Custom CSS for infoblock ──
function applyCustomCss(css) {
    let styleEl = document.getElementById('repro-custom-infoblock-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'repro-custom-infoblock-css';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = css || '';
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
    const tr = (v) => (isRuChat ? translateStatusValue(v) : v);

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
            const sexIcon = baby.sex === 'M' ? '♂' : baby.sex === 'F' ? '♀' : '?';
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
                    <span class="repro-badge baby" style="color:var(--rp-${sexColor})">${sexIcon} · ${ageStr}${(() => { const st = getGrowthStage(ageDays); return st ? ' · ' + st.label : ''; })()}</span>
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
                    ${baby.fatherName ? stat('fa-user', 'blue', 'Отец', baby.fatherName) : ''}
                    ${baby.personality?.length ? `<div class="repro-note"><i class="fa-solid fa-brain" style="margin-right:4px;opacity:0.5"></i>${baby.personality.join(', ')}</div>` : ''}
                    ${baby.appearance?.length ? `<div class="repro-note"><i class="fa-solid fa-eye" style="margin-right:4px;opacity:0.5"></i>${baby.appearance.join(', ')}</div>` : ''}
                    ${baby.special ? `<div class="repro-note" style="border-color:rgba(255,215,64,.35);background:rgba(255,215,64,.06)"><i class="fa-solid fa-star" style="margin-right:4px;color:#ffd740"></i><b>${baby.special.name || baby.special}</b>${baby.special.desc ? ` — ${baby.special.desc}` : ''}</div>` : ''}
                    ${milestones ? `<div class="repro-note"><i class="fa-solid fa-star" style="margin-right:4px;opacity:0.5"></i>${milestones}</div>` : ''}
                    ${careRec ? `<div class="repro-note repro-rec"><i class="fa-solid fa-lightbulb" style="margin-right:4px;opacity:0.7"></i>${careRec}</div>` : ''}
                </div></div>
            </details>`;
        });

        return html;
    }

    // ── PREGNANCY MODE ──
    if (p.isPregnant) {
        const dur = s.pregnancyDuration || 40;
        const { weeks } = calculateWeeksFromDates(p.conceptionDate, p.rpDate, p.pregnancyWeeks);
        const pct = Math.min(100, Math.round((weeks / dur) * 100));
        const trimester = weeks <= 12 ? 1 : weeks <= 27 ? 2 : 3;
        const sexRevealed = !!p.fetusSexRevealed;
        const sexStr = sexRevealed && p.fetusSex?.length ? p.fetusSex.map(s => s === 'M' ? '♂ мальчик' : '♀ девочка').join(', ') : 'неизвестно';
        const fetusSize = getFetusSizeForProgress(pct, false);
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
        if (pd.symptoms || symptoms) noteLines.push(pd.symptoms || symptoms);
        if (pd.note || recs) noteLines.push(pd.note || recs);

        return `<details class="repro">
            <summary><div class="repro-header">
                <div class="repro-icon pregnancy">${ic('fa-heart')}</div>
                <span class="repro-title">Беременность</span>
                <span class="repro-badge pregnancy">${weeks}/${dur} нед. · ${trimester} трим.</span>
                <div class="repro-chev">${ic('fa-chevron-down')}</div>
            </div></summary>
            <div class="repro-c">
                <div class="repro-bar"><div class="repro-bar-fill pregnancy" style="width:${pct}%"></div></div>
                <div class="repro-grid">
                    ${stat('fa-calendar-day', 'pink', 'Зачатие', conceptionStr)}
                    ${stat('fa-calendar', 'purple', 'ПДР', dueStr)}
                    ${stat('fa-baby', 'pink', 'Плод', `${formatFetusCount(p.fetusCount)} (${sexStr})`)}
                    ${p.fatherName ? stat('fa-user', 'blue', 'Отец', p.fatherName) : ''}
                    ${stat('fa-ruler', 'blue', 'Размер', fetusSize)}
                    ${stat('fa-heart-pulse', 'green', 'Здоровье', hpBadge(p.healthStatus))}
                    ${p.mood ? stat('fa-face-smile', 'purple', 'Настроение', tr(p.mood)) : ''}
                    ${p.weightGain ? stat('fa-weight-scale', 'orange', 'Вес', tr(p.weightGain)) : ''}
                    ${p.babyActivity ? stat('fa-person-running', 'blue', 'Активность', tr(p.babyActivity)) : ''}
                    ${p.libido ? stat('fa-fire', 'pink', 'Либидо', tr(p.libido)) : ''}
                    ${pd.movements ? stat('fa-hand', 'purple', 'Шевеления', tr(pd.movements)) : ''}
                    ${pd.swelling ? stat('fa-droplet', 'orange', 'Отёки', tr(pd.swelling)) : ''}
                    ${pd.braxton_hicks ? stat('fa-bolt', 'pink', 'Схватки', tr(pd.braxton_hicks)) : ''}
                    ${pd.fetal_position ? stat('fa-baby', 'blue', 'Положение', tr(pd.fetal_position)) : ''}
                    ${pd.recommendations ? `<div class="repro-note repro-rec">${ic('fa-lightbulb')} ${pd.recommendations}</div>` : ''}
                    ${noteLines.length ? `<div class="repro-note">${noteLines.join(' · ')}</div>` : ''}
                </div>
            </div>
        </details>`;
    }

    // ── CYCLE MODE ──
    const day = getCycleDay();
    const phase = getPhaseInfo(day);
    const cyclePct = Math.round(day / 28 * 100);
    const cd = getCycleDetails(day);
    const d = p._dynamic || {};

    return `<details class="repro">
        <summary><div class="repro-header">
            <div class="repro-icon cycle">${ic('fa-clock')}</div>
            <span class="repro-title">Цикл</span>
            <span class="repro-badge cycle">День ${day}/28 · ${phase.name}</span>
            <div class="repro-chev">${ic('fa-chevron-down')}</div>
        </div></summary>
        <div class="repro-c">
            <div class="repro-bar"><div class="repro-bar-fill cycle" style="width:${cyclePct}%"></div></div>
            <div class="repro-grid">
                ${stat('fa-droplet', 'green', 'Фертильность', tr(d.fertility) || cd.fertility)}
                ${stat('fa-fire', 'pink', 'Либидо', tr(d.libido) || cd.libido)}
                ${stat('fa-face-smile', 'purple', 'Настроение', tr(d.mood) || cd.mood)}
                ${stat('fa-heart', 'blue', 'Физически', tr(d.physical) || cd.physical)}
                <div class="repro-note">${d.note || cd.note}</div>
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

export function showFamilyTree() {
    $('#rp-tree-overlay').remove();

    const p = getPregnancyData();
    let momName = 'Ты';
    try {
        const ctx = SillyTavern.getContext();
        if (ctx?.name1) momName = ctx.name1;
    } catch (e) { /* ignore */ }

    const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';

    // Собираем всех детей: активные малыши + выросшие (архив)
    const kids = [];
    (p.babies || []).forEach(b => kids.push({ ...b, _grown: false }));
    (p.grownChildren || []).forEach(c => kids.push({ ...c, _grown: true }));

    // Группировка по отцу
    const groups = new Map();
    for (const k of kids) {
        const f = (k.fatherName || '').trim() || '—';
        if (!groups.has(f)) groups.set(f, []);
        groups.get(f).push(k);
    }
    if (p.isPregnant) {
        const f = (p.fatherName || '').trim() || '—';
        if (!groups.has(f)) groups.set(f, []);
    }

    // Детальные панели детей (по клику на карточку)
    const detailPanels = [];

    const kidCard = (k) => {
        const days = babyAgeDays(k, p);
        const stage = getGrowthStage(days);
        const sexCls = k.sex === 'F' ? 'girl' : 'boy';
        const sexIcon = k.sex === 'F' ? 'fa-venus' : 'fa-mars';
        const ageStr = k._grown && days === null ? 'вырос(ла)' : formatAgeStr(days);
        const stageStr = stage ? stage.label : (k._grown ? 'взрослый' : '');
        const msCount = (k.milestones || []).length;

        // Панель деталей: дата рождения, черты, все достижения
        const ms = [...(k.milestones || [])].reverse();
        let msHtml = '';
        if (ms.length > 0) {
            msHtml = `<div class="rp-tree-ms-title"><i class="fa-solid fa-award"></i>Достижения · ${ms.length}</div>`;
            msHtml += `<div class="rp-tree-ms-list">` + ms.map(m => {
                const icon = m.source === 'story'
                    ? '<i class="fa-solid fa-trophy rp-tree-ms-story"></i>'
                    : '<i class="fa-solid fa-star rp-tree-ms-auto"></i>';
                const dateStr = fmtRpDate(m.rpDate);
                return `<div class="rp-tree-ms">${icon}<span class="rp-tree-ms-text">${m.text}</span>${dateStr ? `<span class="rp-tree-ms-date">${dateStr}</span>` : ''}</div>`;
            }).join('') + `</div>`;
        } else {
            msHtml = `<div class="rp-tree-ms-empty">достижений пока нет</div>`;
        }
        const traits = [];
        const birthStr = fmtRpDate(k.birthRpDate);
        if (birthStr) traits.push(`<div class="rp-tree-trait"><i class="fa-solid fa-cake-candles"></i>Родился(ась) ${birthStr}</div>`);
        if (k.personality?.length) traits.push(`<div class="rp-tree-trait"><i class="fa-solid fa-brain"></i>${k.personality.join(', ')}</div>`);
        if (k.appearance?.length) traits.push(`<div class="rp-tree-trait"><i class="fa-solid fa-eye"></i>${k.appearance.join(', ')}</div>`);
        if (k.special) traits.push(`<div class="rp-tree-trait gold"><i class="fa-solid fa-wand-magic-sparkles"></i>${k.special.name || k.special}</div>`);

        const idx = detailPanels.length;
        detailPanels.push(`
            <div class="rp-tree-det-head">
                <span class="rp-tree-ava ${sexCls}">${initialOf(k.name)}</span>
                <div>
                    <div class="rp-tree-det-name">${k.name || 'без имени'}</div>
                    <div class="rp-tree-det-sub">${ageStr}${stageStr ? ' · ' + stageStr : ''}${k._grown ? ' · вырос(ла)' : ''}</div>
                </div>
            </div>
            ${traits.join('')}
            ${msHtml}`);

        return `<div class="rp-tree-cell">
            <div class="rp-node kid ${sexCls}" data-det="${idx}" title="Нажми — профиль и достижения">
                <span class="rp-node-ava">${initialOf(k.name)}<i class="fa-solid ${sexIcon} rp-node-sex"></i></span>
                <span class="rp-node-name">${k.name || 'без имени'}</span>
                <span class="rp-node-sub">${ageStr}</span>
                <span class="rp-node-sub dim">${stageStr}</span>
                <span class="rp-node-badges">
                    ${msCount ? `<span class="rp-node-badge gold" title="Достижения"><i class="fa-solid fa-trophy"></i>${msCount}</span>` : ''}
                    ${k._grown ? `<span class="rp-node-badge green" title="Вырос(ла)"><i class="fa-solid fa-check"></i></span>` : ''}
                </span>
            </div>
        </div>`;
    };

    // Узел мамы (повторяется в каждой паре — как в генеалогических древах,
    // когда у одного родителя дети от разных партнёров).
    const momNode = `<div class="rp-node mom">
            <span class="rp-node-ava">${initialOf(momName)}</span>
            <span class="rp-node-name">${momName}</span>
            <span class="rp-node-sub dim">мама</span>
        </div>`;

    let branchesHtml = '';
    for (const [father, children] of groups) {
        // Старшие слева
        children.sort((a, b) => {
            const am = a.birthRpDate ? new Date(a.birthRpDate).getTime() : 0;
            const bm = b.birthRpDate ? new Date(b.birthRpDate).getTime() : 0;
            return am - bm;
        });
        let cells = children.map(kidCard).join('');

        if (p.isPregnant && ((p.fatherName || '').trim() || '—') === father) {
            const w = p.pregnancyWeeks || 0;
            const cnt = p.fetusCount || 1;
            const sexStr = p.fetusSexRevealed && p.fetusSex?.length
                ? p.fetusSex.map(s => s === 'M' ? 'мальчик' : 'девочка').join(', ')
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
        const fatherNode = `<div class="rp-node father${isUnknown ? ' unknown' : ''}">
                <span class="rp-node-ava">${isUnknown ? '?' : initialOf(father)}</span>
                <span class="rp-node-name">${isUnknown ? 'неизвестен' : father}</span>
                <span class="rp-node-sub dim">папа</span>
            </div>`;

        // Пара: мама ♥ папа бок о бок, дети — под ними
        branchesHtml += `<div class="rp-tree-union">
            <div class="rp-couple">
                ${momNode}
                <span class="rp-couple-link" title="${isUnknown ? 'отец неизвестен' : 'пара'}"><i class="fa-solid ${isUnknown ? 'fa-question' : 'fa-heart'}"></i></span>
                ${fatherNode}
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
              <div class="rp-tree-root no-line">${momNode}</div>
           </div>
           <div class="rp-tree-empty"><i class="fa-solid fa-seedling"></i>Детей пока нет — древо ждёт свою историю</div>`;

    const overlay = $(`
    <div id="rp-tree-overlay">
        <div class="rp-tree-dialog">
            <div class="rp-tree-head">
                <span class="rp-tree-head-icon"><i class="fa-solid fa-people-roof"></i></span>
                <span class="rp-tree-title">Семейное древо</span>
                <button class="rp-tree-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rp-tree-body">${canvasHtml}</div>
        </div>
    </div>`);

    $('body').append(overlay);
    // Клики не должны «протекать» в документ — иначе ST сворачивает свои панели
    overlay.on('mousedown mouseup click touchstart touchend', (e) => e.stopPropagation());
    overlay.on('click', function(e) { if (e.target === this) overlay.remove(); });
    overlay.find('.rp-tree-close').on('click', () => overlay.remove());

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
}

// ── Быстрая панель («волшебная палочка»): смена цикла, древо, роды в один тап ──
export function showQuickBar() {
    $('#rp-quick-overlay').remove();
    const s = getSettings();
    const p = getPregnancyData();

    // Текущий статус одной строкой
    let statusHtml;
    if (p.hasBaby) {
        const n = (p.babies?.length || p.babyCount || 1);
        statusHtml = `<i class="fa-solid fa-baby" style="color:rgba(130,200,255,.85)"></i> ${n > 1 ? n + ' малыша' : 'Малыш'} в семье`;
    } else if (p.isPregnant) {
        statusHtml = `<i class="fa-solid fa-heart" style="color:rgba(255,120,180,.85)"></i> Беременность — ${p.pregnancyWeeks || 0} нед.`;
    } else {
        const d = getCycleDay();
        const ph = getPhaseInfo(d);
        statusHtml = `<i class="fa-solid fa-clock" style="color:rgba(180,120,255,.85)"></i> Цикл: день ${d}/28 · <span style="color:${ph.color}">${ph.name}</span>`;
    }

    const day = getCycleDay();
    const overlay = $(`
    <div id="rp-quick-overlay">
        <div class="rp-quick-dialog">
            <div class="rp-tree-head">
                <span class="rp-tree-head-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span>
                <span class="rp-tree-title">Репродукция</span>
                <button class="rp-tree-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rp-quick-body">
                <div class="rp-quick-status">${statusHtml}</div>
                <div class="rp-quick-cycle">
                    <span class="rp-quick-lbl">День цикла</span>
                    <button class="rp-quick-step" data-d="-1"><i class="fa-solid fa-minus"></i></button>
                    <input type="number" id="rp-quick-cycleday" min="1" max="28" value="${day}" class="text_pole">
                    <button class="rp-quick-step" data-d="1"><i class="fa-solid fa-plus"></i></button>
                    <button class="rp-quick-set" id="rp-quick-setcycle">Установить</button>
                </div>
                <div class="rp-quick-actions">
                    <button class="rp-quick-btn" id="rp-quick-tree"><i class="fa-solid fa-people-roof"></i>Семейное древо</button>
                    ${p.isPregnant ? `<button class="rp-quick-btn" id="rp-quick-birth"><i class="fa-solid fa-baby"></i>Принять роды</button>` : ''}
                    <button class="rp-quick-btn" id="rp-quick-settings"><i class="fa-solid fa-sliders"></i>Все настройки</button>
                </div>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);
    overlay.on('mousedown mouseup click touchstart touchend', (e) => e.stopPropagation());
    const close = () => overlay.remove();
    overlay.on('click', function(e) { if (e.target === this) close(); });
    overlay.find('.rp-tree-close').on('click', close);

    const applyCycle = (v) => {
        v = Math.max(1, Math.min(28, parseInt(v) || 1));
        overlay.find('#rp-quick-cycleday').val(v);
        setCycleDay(v, true, true);
        import('./message-handler.js').then(m => m.refreshRegenSnapshot && m.refreshRegenSnapshot());
        saveSettingsDebounced();
        setTimeout(() => { updatePromptInjection(); syncUI(); }, 30);
        // Обновляем строку статуса
        const ph = getPhaseInfo(v);
        overlay.find('.rp-quick-status').html(`<i class="fa-solid fa-clock" style="color:rgba(180,120,255,.85)"></i> Цикл: день ${v}/28 · <span style="color:${ph.color}">${ph.name}</span>`);
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

    // Древо открывается ПОВЕРХ быстрой панели (z-index выше). Панель не закрываем —
    // закрыл древо → снова видишь быструю панель.
    overlay.find('#rp-quick-tree').on('click', () => { showFamilyTree(); });
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

    const debugLogs = el('repro-debuglogs');
    if (debugLogs) debugLogs.checked = !!s.debugLogs;

    const contra = el('repro-contraception');
    if (contra) contra.value = s.contraception;

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
        cycleInfo.innerHTML = `<span style="color:${ph.color}">${ph.name}</span> — день <b>${_cd}</b>/28`;
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
            const sexVis = weeks >= 20;
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
            const fetusSize = getFetusSizeForProgress(pct, false);

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
                    <div class="rp-m-cell"><span class="rp-m-lbl">Размер</span><span class="rp-m-val">${fetusSize}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Здоровье</span><span class="rp-m-val rp-m-hp-${hCls}">${health.text}</span></div>
                    ${p.fatherName ? `<div class="rp-m-cell"><span class="rp-m-lbl">Отец</span><span class="rp-m-val">${p.fatherName}</span></div>` : ''}
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
                    // Якорь: предпочитаем rpDate (RP-время чата), иначе сейчас (real-world)
                    const anchor = p.rpDate ? new Date(p.rpDate) : new Date();
                    p.conceptionDate = new Date(anchor.getTime() - newWeeks * 7 * 86400000).toISOString();
                    p.pregnancyWeeks = newWeeks;
                    p._conceptionAnchored = true;
                    // Метка ручной установки — защита от перезаписи парсером текста (30 минут)
                    p._userSetWeeksAt = Date.now();
                    import('./message-handler.js').then(m => m.refreshRegenSnapshot && m.refreshRegenSnapshot());
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
                const sexIcon = baby.sex === 'M' ? '♂' : baby.sex === 'F' ? '♀' : '';
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
                    ${baby.fatherName ? `<div class="rp-m-cell"><span class="rp-m-lbl">Отец</span><span class="rp-m-val">${baby.fatherName}</span></div>` : ''}
                </div>`;
            });
            babyMon.innerHTML = monHtml;
        } else {
            babyMon.style.display = 'none';
            if (resetBabyBtn) resetBabyBtn.style.display = 'none';
        }
    }

    const stats = el('repro-stats');
    if (stats) stats.textContent = `${s.totalChecks} проверок / ${s.totalConceptions} зачатий`;
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
            <label class="checkbox_label" title="Писать отладочные логи в консоль (F12). Держи выключенным — с логами заметная нагрузка."><input type="checkbox" id="repro-debuglogs"><span style="opacity:0.6">Debug-логи</span></label>
            <hr>
            <div style="display:flex;gap:4px;align-items:center">
                <span style="font-size:9px;opacity:0.5">Контрацепция:</span>
                <select id="repro-contraception" class="text_pole" style="flex:1">
                    <option value="none">Нет</option>
                    <option value="condom">Презерватив</option>
                    <option value="pill">Таблетки</option>
                    <option value="iud">ВМС</option>
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
            <div style="display:flex;gap:4px;align-items:center">
                <span style="font-size:9px;opacity:0.5">День цикла:</span>
                <input type="number" id="repro-cycleday" min="1" max="28" value="${getCycleDay()}" class="text_pole" style="width:45px">
                <button id="repro-setcycle" class="menu_button">${ic('fa-check')}</button>
            </div>
            <hr>
            <div style="font-size:10px;opacity:0.7">Статус: <span id="repro-status"></span></div>
            <div id="repro-preg-mon" class="rp-m" style="display:none"></div>
            <div id="repro-baby-mon" class="rp-m" style="display:none"></div>
            <button id="repro-family-tree-btn" class="menu_button" style="width:100%"><i class="fa-solid fa-people-roof" style="margin-right:6px;color:rgba(130,200,255,.8)"></i>Семейное древо</button>
            <button id="repro-force-birth-btn" class="menu_button" style="width:100%;display:none"><i class="fa-solid fa-baby" style="margin-right:6px;color:rgba(255,120,180,.8)"></i>Принять роды сейчас</button>
            <hr>
            <div id="repro-manual-toggle" class="menu_button" style="font-size:10px;text-align:center;cursor:pointer">Ручная беременность / малыш ▼</div>
            <div id="repro-manual-panel" style="display:none;gap:4px;flex-direction:column">
                <small style="opacity:0.5;font-size:9px;font-weight:600">Беременность</small>
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
                    <input type="number" id="repro-mb-age-days" class="text_pole" style="width:60px" min="0" max="730" value="0" title="Возраст в днях">
                    <span style="font-size:9px;opacity:0.4">дн.</span>
                    <input type="text" id="repro-mb-father" class="text_pole" style="flex:1" maxlength="60" placeholder="Отец (необязательно)">
                </div>
                <input type="text" id="repro-mb-personality" class="text_pole" maxlength="200" placeholder="Характер: спокойный, любопытный (через запятую)" title="Черты характера через запятую — попадут в инфоблок и в промпт для модели">
                <input type="text" id="repro-mb-appearance" class="text_pole" maxlength="200" placeholder="Внешность: мамины глаза, тёмные волосы (через запятую)" title="Черты внешности через запятую — попадут в инфоблок и в промпт для модели">
                <button id="repro-manual-baby-add" class="menu_button" style="width:100%">Добавить малыша</button>
                <button id="repro-reset" class="menu_button redWarningBG" style="width:100%;display:none">Сброс берем.</button>
                <button id="repro-reset-baby" class="menu_button redWarningBG" style="width:100%;display:none">Сброс малыша</button>
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
            <div id="repro-css-toggle" class="menu_button" style="font-size:10px;text-align:center;cursor:pointer">CSS инфоблока ▼</div>
            <div id="repro-css-panel" style="display:none;flex-direction:column;gap:4px">
                <textarea id="repro-custom-css" class="text_pole" rows="10" style="font-family:monospace;font-size:10px;resize:vertical;min-height:80px;white-space:pre;tab-size:2" placeholder="/* Свой CSS для инфоблока */\ndetails.repro { ... }"></textarea>
                <div style="display:flex;gap:4px">
                    <button id="repro-css-apply" class="menu_button" style="flex:1">Применить</button>
                    <button id="repro-css-reset" class="menu_button" style="flex:0 0 auto">Сброс</button>
                </div>
                <small style="opacity:0.35;font-size:8px">Селекторы: details.repro, .repro-header, .repro-c, .repro-stat, .rp-val, .repro-bar-fill и др.</small>
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
        $('#repro-enabled').on('change', function() { getSettings().isEnabled = this.checked; saveSettingsDebounced(); updatePromptInjection(); });
        $('#repro-notify').on('change', function() { getSettings().showNotifications = this.checked; saveSettingsDebounced(); });
        $('#repro-debuglogs').on('change', function() { getSettings().debugLogs = this.checked; saveSettingsDebounced(); });
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

        $('#repro-contraception').on('change', function() { getSettings().contraception = this.value; saveSettingsDebounced(); updatePromptInjection(); syncUI(); });

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
            setCycleDay(v, true, true);
            // ВАЖНО: обновляем regen-snapshot, иначе swipe/regen откатит ручное значение.
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
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
            const ageDays = Math.max(0, Math.min(730, parseInt($('#repro-mb-age-days').val()) || 0));
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
            startManualPregnancy(conceptionDate.toISOString(), fetus, sexArr);
            syncUI();
            updatePromptInjection();
        });

        // Infoblock
        $('#repro-infoblock').on('change', function() { getSettings().infoblockPosition = this.value; saveSettingsDebounced(); });

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
            getSettings().customInfoblockCss = css;
            saveSettingsDebounced();
            applyCustomCss(css);
            showNotification('CSS применён', 'success');
        });
        $('#repro-css-reset').on('click', function() {
            if (!confirm('Сбросить кастомный CSS?')) return;
            getSettings().customInfoblockCss = '';
            $('#repro-custom-css').val(DEFAULT_INFOBLOCK_CSS);
            saveSettingsDebounced();
            applyCustomCss('');
            showNotification('CSS сброшен (стандартный стиль)', 'info');
        });

        // Apply saved custom CSS on load
        if (s.customInfoblockCss) {
            applyCustomCss(s.customInfoblockCss);
        }

        syncUI();
    } catch (error) {
        console.error('[Reproductive] setupUI error:', error);
    }
}