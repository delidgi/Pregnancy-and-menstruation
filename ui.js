// UI v5 — compact, minimal icons, visual infoblock
import { saveSettingsDebounced } from '../../../../script.js';
import { getSettings, getPregnancyData, getCycleDay, setCycleDay, getCurrentChatId, L, dlog, dwarn } from './state.js';
import { getPhaseInfo, calculateWeeksFromDates, getSymptomsForProgress, getRecommendationsForProgress, getFetusSizeForProgress, formatSexIcons, formatFetusCount, getHealthInfo, detectChatLanguage, translateStatusValue } from './helpers.js';
import { babyAgeDays, getCareNorms, getCareNeeds } from './baby-care.js';
import { calculateDueDate } from './date-parser.js';
import { resetPregnancy, resetBaby, visitDoctor, applyScanResult, startManualPregnancy, startManualBaby } from './pregnancy.js';
import { getStageOf } from './family.js';
import { getPartner, getPartnerName, startManualPartnerPregnancy, resetPartnerPregnancy, applyPartnerBirth } from './partner.js';
import { isOmegaverse, ensureOmegaFields, getHeatPhase, getRutPhase, getCfg } from './omegaverse.js';
import { updatePromptInjection } from './prompts.js';
import { showNotification } from './notifications.js';

function ic(n) { return `<i class="fa-solid ${n}"></i>`; }

// Фолбэк-перевод: модели иногда пишут значения по-английски ("High"/"Anxious")
// несмотря на требование языка. В русском чате известные значения переводим.
function tr(v) {
    return detectChatLanguage() === 'ru' ? translateStatusValue(v) : v;
}

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
    const cls = status === 'critical' ? 'critical' : status === 'warning' ? 'warning' : 'normal';
    const txt = status === 'critical' ? 'Критич.' : status === 'warning' ? 'Внимание' : 'Норма';
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

// ── Партнёрская карточка инфоблока (этап 2) — добавляется к любому режиму ──
function buildPartnerInfoCard(s, p) {
    const pp = p.partner;
    if (!pp || !pp.enabled || !pp.isPregnant) return '';

    const dur = s.pregnancyDuration || 40;
    const { weeks } = calculateWeeksFromDates(pp.conceptionDate, p.rpDate, pp.pregnancyWeeks);
    const pct = Math.min(100, Math.round((weeks / dur) * 100));
    const trimester = weeks <= 12 ? 1 : weeks <= 27 ? 2 : 3;
    const sexStr = pp.fetusSexRevealed && pp.fetusSex?.length
        ? pp.fetusSex.map(x => x === 'M' ? '♂ мальчик' : '♀ девочка').join(', ')
        : 'неизвестно';
    const fetusSize = getFetusSizeForProgress(pct, false);
    const name = getPartnerName(p);

    let conceptionStr = '—';
    let dueStr = '—';
    if (pp.conceptionDate) {
        conceptionStr = new Date(pp.conceptionDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const dd = calculateDueDate(pp.conceptionDate);
        if (dd) dueStr = dd.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    const pd = pp._dynamic || {};

    return `<details class="repro">
        <summary><div class="repro-header">
            <div class="repro-icon pregnancy">${ic('fa-heart')}</div>
            <span class="repro-title">${name} — беременность</span>
            <span class="repro-badge pregnancy">${weeks}/${dur} нед. · ${trimester} трим.</span>
            <div class="repro-chev">${ic('fa-chevron-down')}</div>
        </div></summary>
        <div class="repro-c">
            <div class="repro-bar"><div class="repro-bar-fill pregnancy" style="width:${pct}%"></div></div>
            <div class="repro-grid">
                ${stat('fa-calendar-day', 'pink', 'Зачатие', conceptionStr)}
                ${stat('fa-calendar', 'purple', 'ПДР', dueStr)}
                ${stat('fa-baby', 'pink', 'Плод', `${formatFetusCount(pp.fetusCount)} (${sexStr})`)}
                ${pp.fatherName ? stat('fa-user', 'blue', 'Отец', pp.fatherName) : ''}
                ${stat('fa-ruler', 'blue', 'Размер', fetusSize)}
                ${stat('fa-heart-pulse', 'green', 'Здоровье', hpBadge(pp.healthStatus))}
                ${pp.mood ? stat('fa-face-smile', 'purple', 'Настроение', tr(pp.mood)) : ''}
                ${pp.weightGain ? stat('fa-weight-scale', 'orange', 'Вес', tr(pp.weightGain)) : ''}
                ${pp.babyActivity ? stat('fa-person-running', 'blue', 'Активность', tr(pp.babyActivity)) : ''}
                ${pd.note ? `<div class="repro-note">${pd.note}</div>` : ''}
            </div>
        </div>
    </details>`;
}

// ── Омегаверс: описание фаз течки для инфоблока ──
function getOmegaDetails(phase, suppressed) {
    if (suppressed) return { fertility: 'Подавлена', libido: 'Обычное', physical: 'Стабильно', note: 'Супрессанты: течка химически подавлена — симптомов нет, фертильность низкая.' };
    if (phase === 'heat') return { fertility: 'Экстремальная', libido: 'Неудержимое', physical: 'Жар, слик, чувствительность', note: 'Течка — пик фертильности. Жар, инстинктивная потребность, обострённые ощущения.' };
    if (phase === 'preheat') return { fertility: 'Растёт', libido: 'Повышенное', physical: 'Беспокойство, накатывает жар', note: 'Пред-течка — течка начнётся через 1-2 дня, симптомы нарастают.' };
    return { fertility: 'Низкая', libido: 'Обычное', physical: 'Стабильно', note: 'Спокойная фаза — до течки далеко, фертильность низкая.' };
}

// ── Карточка цикла юзера в омегаверсе (течка омеги / гон альфы) ──
function buildOmegaCycleCard(s, p) {
    const cfg = getCfg(s);
    const desig = p.designation || 'omega';
    const d = p._dynamic || {};

    if (desig === 'alpha') {
        const rut = getRutPhase(p.rutCycleDay || 30, cfg);
        return `<details class="repro">
            <summary><div class="repro-header">
                <div class="repro-icon cycle">${ic('fa-fire')}</div>
                <span class="repro-title">Альфа</span>
                <span class="repro-badge cycle">День ${rut.day}/${cfg.rutCycleLength} · ${rut.labelRu}</span>
                <div class="repro-chev">${ic('fa-chevron-down')}</div>
            </div></summary>
            <div class="repro-c"><div class="repro-grid">
                ${stat('fa-fire', 'pink', 'Гон', rut.inRut ? 'Активен' : 'Нет')}
                ${stat('fa-face-smile', 'purple', 'Настроение', d.mood || (rut.inRut ? 'Взвинченное' : 'Ровное'))}
                <div class="repro-note">${d.note || (rut.inRut ? 'Гон: обострённые инстинкты, собственничество, высокое либидо.' : 'Спокойная фаза — гон ещё не скоро.')}</div>
            </div></div>
        </details>`;
    }

    // Омега: цикл течки
    const ph = getHeatPhase(p.heatCycleDay || 20, cfg);
    const suppressed = !!p.heatSuppressant;
    const od = getOmegaDetails(ph.phase, suppressed);
    const pct = Math.round(ph.day / cfg.heatCycleLength * 100);
    const phaseLabel = suppressed ? 'Подавлена' : ph.labelRu;
    return `<details class="repro">
        <summary><div class="repro-header">
            <div class="repro-icon ${ph.phase === 'heat' && !suppressed ? 'pregnancy' : 'cycle'}">${ic('fa-fire')}</div>
            <span class="repro-title">Течка (омега)</span>
            <span class="repro-badge cycle">День ${ph.day}/${cfg.heatCycleLength} · ${phaseLabel}</span>
            <div class="repro-chev">${ic('fa-chevron-down')}</div>
        </div></summary>
        <div class="repro-c">
            <div class="repro-bar"><div class="repro-bar-fill cycle" style="width:${pct}%"></div></div>
            <div class="repro-grid">
                ${stat('fa-droplet', 'green', 'Фертильность', tr(d.fertility) || od.fertility)}
                ${stat('fa-fire', 'pink', 'Либидо', tr(d.libido) || od.libido)}
                ${stat('fa-face-smile', 'purple', 'Настроение', tr(d.mood) || '—')}
                ${stat('fa-heart', 'blue', 'Физически', tr(d.physical) || od.physical)}
                <div class="repro-note">${d.note || od.note}</div>
            </div>
        </div>
    </details>`;
}

// ── Infoblock: glassmorphism card for chat messages ──
export function buildInfoblockHtml() {
    const s = getSettings();
    const p = getPregnancyData();
    if (!s.isEnabled) return '';

    // Карточка партнёра добавляется к любому режиму (baby/pregnancy/cycle)
    const partnerHtml = buildPartnerInfoCard(s, p);

    // ── BABY MODE ──
    if (p.hasBaby) {
        const babies = getBabies(p);
        if (babies.length === 0) return partnerHtml; // fallthrough safety

        // Хелпер: возраст ребёнка ЖИВЫМ расчётом от birthRpDate до текущей RP-даты
        // (пока RP-даты в чате нет — до реального «сейчас»: ручные малыши без
        // RP_DATE якорятся к реальным часам). Статичная строка baby.age — только
        // фолбэк для детей без дат: она пишется один раз и сама не обновляется.
        const nowRefIso = p.rpDate || new Date().toISOString();
        const calcAge = (baby) => {
            if (baby.birthRpDate) {
                const birthMs = new Date(baby.birthRpDate).getTime();
                const nowMs = new Date(nowRefIso).getTime();
                if (!isNaN(birthMs) && !isNaN(nowMs) && nowMs >= birthMs) {
                    const days = Math.floor((nowMs - birthMs) / 86400000);
                    if (days > 36500) return baby.age || '—'; // битые даты из другой эпохи
                    if (days < 30) return days <= 7 ? 'новорожд.' : `${days} дн.`;
                    const months = Math.floor(days / 30);
                    if (months < 12) return `${months} мес.`;
                    const years = Math.floor(months / 12);
                    const remMonths = months % 12;
                    return remMonths > 0 ? `${years} г. ${remMonths} мес.` : `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
                }
            }
            return baby.age || p.babyAge || 'новорожд.';
        };

        let html = '';
        babies.forEach((baby, i) => {
            const sexIcon = baby.sex === 'M' ? '♂' : baby.sex === 'F' ? '♀' : '?';
            const sexColor = baby.sex === 'F' ? 'pink' : 'blue';
            const label = baby.name || (babies.length > 1 ? `Малыш ${i + 1}` : 'Малыш');
            const milestones = (baby.milestones || []).slice(-2).map(m => m.text).join(', ');
            const ageStr = calcAge(baby);
            const stage = getStageOf(baby, p.rpDate);
            const stageStr = stage && stage.id !== 'newborn' ? ` · ${stage.label}` : '';

            // Возрастные нормы ухода (симуляция): кормление/сон/подгузники + зубки
            let careNote = '';
            const ageDays = babyAgeDays(baby, p);
            // Потребности по времени суток (fallback если модель не прислала RP_STATUS)
            let needs = { feeding: null, diaper: null, sleep: null, careNote: null };
            if (ageDays !== null) {
                needs = getCareNeeds(ageDays, p.rpTime, baby);
                const care = getCareNorms(ageDays, baby);
                const parts = [care.feeding, care.sleep, care.diaper];
                if (care.teething) parts.push(`🦷 ${care.teething}`);
                if (care.upcoming) parts.push(`скоро: ${care.upcoming}`);
                careNote = `<div class="repro-note"><i class="fa-solid fa-clipboard-list" style="margin-right:4px;opacity:0.5"></i>${parts.join(' · ')}</div>`;
            }

            // Кормление: приоритет — данные от модели, потом fallback из getCareNeeds
            const feedingVal = tr(baby.feeding) || tr(baby.feedingType) || (needs.feeding) || '—';
            // Подгузник: текст от модели (diaperStatus) или fallback по времени
            const diaperText = baby.diaperStatus ? tr(baby.diaperStatus) : (needs.diaper || (baby.diaperClean ? 'Чистый' : 'Требует смены'));
            const diaperIsClean = baby.diaperStatus
                ? /^(?:чист|clean|dry|сух)/i.test(baby.diaperStatus)
                : (baby.diaperClean !== false && needs.diaper !== 'Требует смены');
            // Рекомендация: от модели (care_note из RP_STATUS) или fallback по времени
            const careRec = baby.careNote || needs.careNote;

            html += `<details class="repro">
                <summary><div class="repro-header">
                    <div class="repro-icon baby">${ic('fa-baby')}</div>
                    <span class="repro-title repro-baby-name" data-baby-idx="${i}" title="Клик для переименования" style="cursor:pointer">${label}</span>
                    <span class="repro-badge baby" style="color:var(--rp-${sexColor})">${sexIcon} · ${ageStr}${stageStr}</span>
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
                    ${careNote}
                </div></div>
            </details>`;
        });

        return html + partnerHtml;
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
        </details>` + partnerHtml;
    }

    // ── CYCLE MODE ──
    // Юзер-носитель выключен — карточка цикла не нужна, показываем только партнёра
    if (p.userCanCarry === false) return partnerHtml;

    // Омегаверс: у омеги карточка течки, у альфы — гона (28-дневный цикл только у бет)
    if (isOmegaverse(p) && (p.designation || 'omega') !== 'beta') {
        return buildOmegaCycleCard(s, p) + partnerHtml;
    }

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
    </details>` + partnerHtml;
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

    const famEvChance = el('repro-family-event-chance');
    if (famEvChance && document.activeElement !== famEvChance) {
        famEvChance.value = Math.max(0, Math.min(50, parseInt(s.familyEventChance ?? 15) || 0));
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

    const treeBtn = el('repro-family-tree-btn');
    const chronBtn = el('repro-chronicle-btn');
    {
        const hasFamily = p.hasBaby || p.isPregnant || (Array.isArray(p.grownChildren) && p.grownChildren.length > 0)
            || !!(p.partner?.enabled && p.partner.isPregnant);
        if (treeBtn) treeBtn.style.display = hasFamily ? 'block' : 'none';
        // Хроника видна и после «сброса» семьи — журнал мог остаться
        const hasChronicle = hasFamily || (Array.isArray(p.familyChronicle) && p.familyChronicle.length > 0);
        if (chronBtn) chronBtn.style.display = hasChronicle ? 'block' : 'none';
    }

    // ── Носители (этап 2) ──
    const userCarry = el('repro-user-carry');
    if (userCarry) userCarry.checked = p.userCanCarry !== false;

    const pp = p.partner;
    const ppEnabled = el('repro-partner-enabled');
    if (ppEnabled) ppEnabled.checked = !!pp?.enabled;
    const ppPanel = el('repro-partner-panel');
    if (ppPanel) ppPanel.style.display = pp?.enabled ? 'flex' : 'none';
    if (pp?.enabled) {
        const ppName = el('repro-partner-name');
        if (ppName && document.activeElement !== ppName) {
            ppName.value = pp.name || '';
            if (!pp.name) {
                try {
                    const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
                    if (ctx?.name2) ppName.placeholder = ctx.name2;
                } catch (e) { /* ignore */ }
            }
        }
        const ppContra = el('repro-partner-contraception');
        if (ppContra) ppContra.value = pp.contraception || 'none';
        const ppCycle = el('repro-partner-cycleday');
        if (ppCycle && document.activeElement !== ppCycle) {
            ppCycle.value = Math.max(1, Math.min(28, parseInt(pp.cycleDay) || 1));
        }
    }

    // ── Монитор беременности партнёра ──
    const ppMon = el('repro-partner-mon');
    const ppForceBirth = el('repro-partner-force-birth');
    const ppReset = el('repro-partner-reset');
    if (ppMon) {
        if (pp?.enabled && pp.isPregnant) {
            ppMon.style.display = 'block';
            if (ppForceBirth) ppForceBirth.style.display = 'block';
            if (ppReset) ppReset.style.display = 'block';

            const dur = s.pregnancyDuration || 40;
            const { weeks } = calculateWeeksFromDates(pp.conceptionDate, p.rpDate, pp.pregnancyWeeks);
            const pct = Math.min(100, Math.round((weeks / dur) * 100));
            const sexStr = pp.fetusSexRevealed && pp.fetusSex?.length
                ? pp.fetusSex.map(x => x === 'M' ? 'М' : 'Д').join(', ') : '—';
            const health = getHealthInfo(pp.healthStatus);
            const hCls = pp.healthStatus === 'critical' ? 'crit' : pp.healthStatus === 'warning' ? 'warn' : 'ok';
            let conceptionStr = '—';
            let dueStr = '—';
            if (pp.conceptionDate) {
                conceptionStr = new Date(pp.conceptionDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const dd = calculateDueDate(pp.conceptionDate);
                if (dd) dueStr = dd.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }

            ppMon.innerHTML = `
                <div class="rp-m-head pink">${getPartnerName(p)} — ${weeks}/${dur} нед.</div>
                <div class="rp-m-progress"><div class="rp-m-progress-fill pink" style="width:${pct}%"></div></div>
                <div class="rp-m-grid">
                    <div class="rp-m-cell"><span class="rp-m-lbl">Зачатие</span><span class="rp-m-val">${conceptionStr}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">ПДР</span><span class="rp-m-val">${dueStr}</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Плод</span><span class="rp-m-val">${formatFetusCount(pp.fetusCount)} (${sexStr})</span></div>
                    <div class="rp-m-cell"><span class="rp-m-lbl">Здоровье</span><span class="rp-m-val rp-m-hp-${hCls}">${health.text}</span></div>
                    ${pp.fatherName ? `<div class="rp-m-cell"><span class="rp-m-lbl">Отец</span><span class="rp-m-val">${pp.fatherName}</span></div>` : ''}
                </div>
                <div style="display:flex;gap:4px;align-items:center;margin-top:6px">
                    <span style="font-size:9px;opacity:0.5">Срок:</span>
                    <input type="number" id="repro-partner-set-weeks" min="1" max="42" value="${weeks}" class="text_pole" style="width:50px">
                    <span style="font-size:9px;opacity:0.5">нед.</span>
                    <button id="repro-partner-apply-weeks" class="rp-m-btn" style="flex:1">Установить</button>
                </div>`;

            setTimeout(() => {
                const ab = el('repro-partner-apply-weeks');
                if (ab) ab.onclick = () => {
                    const input = el('repro-partner-set-weeks');
                    const newWeeks = Math.max(0, Math.min(42, parseInt(input?.value) || 0));
                    const anchor = p.rpDate ? new Date(p.rpDate) : new Date();
                    pp.conceptionDate = new Date(anchor.getTime() - newWeeks * 7 * 86400000).toISOString();
                    pp.pregnancyWeeks = newWeeks;
                    pp._conceptionAnchored = true;
                    pp._userSetWeeksAt = Date.now();
                    import('./message-handler.js').then(m => m.refreshRegenSnapshot && m.refreshRegenSnapshot());
                    saveSettingsDebounced();
                    showNotification(`${getPartnerName(p)}: срок установлен — ${newWeeks} нед.`, 'success');
                    syncUI();
                    updatePromptInjection();
                    setTimeout(() => {
                        import('./message-handler.js').then(m => m.renderInfoblock());
                    }, 100);
                };
            }, 10);
        } else {
            ppMon.style.display = 'none';
            if (ppForceBirth) ppForceBirth.style.display = 'none';
            if (ppReset) ppReset.style.display = 'none';
        }
    }

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

    // ── Омегаверс (этап 3) ──
    const uniSel = el('repro-universe');
    if (uniSel) uniSel.value = p.universe || 'realism';
    const omegaOn = isOmegaverse(p);
    const omegaPanel = el('repro-omega-panel');
    if (omegaPanel) omegaPanel.style.display = omegaOn ? 'flex' : 'none';

    // 28-дневный цикл юзера скрываем, когда юзер — омега/альфа (у них течка/гон)
    const userDesig = omegaOn ? (p.designation || 'omega') : null;
    const hideRealismCycle = omegaOn && userDesig !== 'beta';
    const cycleRow = el('repro-cycle-row');
    if (cycleRow) cycleRow.style.display = hideRealismCycle ? 'none' : 'flex';
    if (cycleInfo) cycleInfo.style.display = hideRealismCycle ? 'none' : '';

    // То же для партнёра: его 28-дневный «День цикла» прячем, если он омега/альфа
    const partnerCycleRow = el('repro-partner-cycle-row');
    if (partnerCycleRow) {
        const pDesig = omegaOn ? (p.partner?.designation || 'alpha') : 'beta';
        partnerCycleRow.style.display = (omegaOn && pDesig !== 'beta') ? 'none' : 'flex';
    }

    if (omegaOn) {
        const cfg = getCfg(s);
        const dSel = el('repro-user-designation');
        if (dSel) dSel.value = userDesig;
        const partnerDesig = p.partner?.designation || 'alpha';
        const pdSel = el('repro-partner-designation');
        if (pdSel) pdSel.value = partnerDesig;

        // Ряд дня течки/гона юзера (бета пользуется обычным циклом выше)
        const uRow = el('repro-user-omega-cycle');
        if (uRow) uRow.style.display = userDesig === 'beta' ? 'none' : 'flex';
        if (userDesig !== 'beta') {
            const lbl = el('repro-user-omega-lbl');
            const inp = el('repro-user-heatday');
            const phaseEl = el('repro-user-omega-phase');
            if (userDesig === 'omega') {
                if (lbl) lbl.textContent = 'День течки:';
                if (inp && document.activeElement !== inp) inp.value = p.heatCycleDay || 20;
                if (phaseEl) phaseEl.textContent = p.heatSuppressant ? 'подавлена' : getHeatPhase(p.heatCycleDay || 20, cfg).labelRu;
            } else {
                if (lbl) lbl.textContent = 'День гона:';
                if (inp && document.activeElement !== inp) inp.value = p.rutCycleDay || 30;
                if (phaseEl) phaseEl.textContent = getRutPhase(p.rutCycleDay || 30, cfg).labelRu;
            }
        }

        // Ряд партнёра
        const pRow = el('repro-partner-omega-cycle');
        if (pRow) pRow.style.display = partnerDesig === 'beta' ? 'none' : 'flex';
        if (partnerDesig !== 'beta') {
            const lblP = el('repro-partner-omega-lbl');
            const inpP = el('repro-partner-heatday');
            const phaseP = el('repro-partner-omega-phase');
            const ppo = p.partner || {};
            if (partnerDesig === 'omega') {
                if (lblP) lblP.textContent = 'День течки:';
                if (inpP && document.activeElement !== inpP) inpP.value = ppo.heatCycleDay || 20;
                if (phaseP) phaseP.textContent = ppo.heatSuppressant ? 'подавлена' : getHeatPhase(ppo.heatCycleDay || 20, cfg).labelRu;
            } else {
                if (lblP) lblP.textContent = 'День гона:';
                if (inpP && document.activeElement !== inpP) inpP.value = ppo.rutCycleDay || 30;
                if (phaseP) phaseP.textContent = getRutPhase(ppo.rutCycleDay || 30, cfg).labelRu;
            }
        }

        const usC = el('repro-user-suppressant');
        if (usC) usC.checked = !!p.heatSuppressant;
        const ubC = el('repro-user-blockers');
        if (ubC) ubC.checked = !!p.scentBlockers;
        const psC = el('repro-partner-suppressant');
        if (psC) psC.checked = !!p.partner?.heatSuppressant;
        const pbC = el('repro-partner-blockers');
        if (pbC) pbC.checked = !!p.partner?.scentBlockers;

        const hlIn = el('repro-heat-length');
        if (hlIn && document.activeElement !== hlIn) hlIn.value = cfg.heatCycleLength;
        const hdIn = el('repro-heat-duration');
        if (hdIn && document.activeElement !== hdIn) hdIn.value = cfg.heatDuration;
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
            <div style="display:flex;gap:4px;align-items:center" title="Шанс случайного события у каждого ребёнка за RP-день: простуда, первый зуб, двойка, первая влюблённость… Событие уходит в промпт — модель вплетает его в сцену. 0 = выключить.">
                <span style="font-size:9px;opacity:0.5">События детей:</span>
                <input type="number" id="repro-family-event-chance" min="0" max="50" class="text_pole" style="width:48px">
                <span style="font-size:9px;opacity:0.5">% в день</span>
            </div>
            <hr>
            <div style="display:flex;gap:4px;align-items:center">
                <span style="font-size:9px;opacity:0.5">Вселенная:</span>
                <select id="repro-universe" class="text_pole" style="flex:1">
                    <option value="realism">Реализм</option>
                    <option value="omegaverse">Омегаверс (A/B/O)</option>
                </select>
            </div>
            <div id="repro-omega-panel" style="display:none;flex-direction:column;gap:4px">
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5" title="Альфа не беременеет (гон). Омега — цикл течки. Бета — обычный 28-дневный цикл.">Я:</span>
                    <select id="repro-user-designation" class="text_pole" style="flex:1">
                        <option value="omega">Омега</option>
                        <option value="beta">Бета</option>
                        <option value="alpha">Альфа</option>
                    </select>
                </div>
                <div id="repro-user-omega-cycle" style="display:flex;gap:4px;align-items:center">
                    <span id="repro-user-omega-lbl" style="font-size:9px;opacity:0.5">День течки:</span>
                    <input type="number" id="repro-user-heatday" min="1" max="180" class="text_pole" style="width:45px">
                    <button id="repro-user-heatday-set" class="menu_button">${ic('fa-check')}</button>
                    <span id="repro-user-omega-phase" style="font-size:9px;opacity:0.6;flex:1"></span>
                </div>
                <label class="checkbox_label" title="Подавители течки: течка не проявляется, фертильность ровно низкая"><input type="checkbox" id="repro-user-suppressant"><span style="font-size:11px">Подавители течки (я)</span></label>
                <label class="checkbox_label" title="Блокаторы запаха — скрывают запах, чисто RP-эффект"><input type="checkbox" id="repro-user-blockers"><span style="font-size:11px">Блокаторы запаха (я)</span></label>
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5">Партнёр:</span>
                    <select id="repro-partner-designation" class="text_pole" style="flex:1">
                        <option value="alpha">Альфа</option>
                        <option value="beta">Бета</option>
                        <option value="omega">Омега</option>
                    </select>
                </div>
                <div id="repro-partner-omega-cycle" style="display:flex;gap:4px;align-items:center">
                    <span id="repro-partner-omega-lbl" style="font-size:9px;opacity:0.5">День гона:</span>
                    <input type="number" id="repro-partner-heatday" min="1" max="180" class="text_pole" style="width:45px">
                    <button id="repro-partner-heatday-set" class="menu_button">${ic('fa-check')}</button>
                    <span id="repro-partner-omega-phase" style="font-size:9px;opacity:0.6;flex:1"></span>
                </div>
                <label class="checkbox_label"><input type="checkbox" id="repro-partner-suppressant"><span style="font-size:11px">Подавители течки (партнёр)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="repro-partner-blockers"><span style="font-size:11px">Блокаторы запаха (партнёр)</span></label>
                <div style="display:flex;gap:4px;align-items:center" title="Длина цикла течки в днях и длительность самой течки. Общие для всех чатов.">
                    <span style="font-size:9px;opacity:0.5">Цикл течки:</span>
                    <input type="number" id="repro-heat-length" min="14" max="180" class="text_pole" style="width:48px">
                    <span style="font-size:9px;opacity:0.5">дн., течка</span>
                    <input type="number" id="repro-heat-duration" min="1" max="14" class="text_pole" style="width:40px">
                    <span style="font-size:9px;opacity:0.5">дн.</span>
                </div>
            </div>
            <hr>
            <label class="checkbox_label" title="Выключи, если твой персонаж не может беременеть (носитель — только партнёр). RP-дата и семья продолжают отслеживаться."><input type="checkbox" id="repro-user-carry" checked><span>Я могу забеременеть</span></label>
            <div id="repro-currentcycle" class="rp-cycle-info"></div>
            <div id="repro-cycle-row" style="display:flex;gap:4px;align-items:center">
                <span style="font-size:9px;opacity:0.5">День цикла:</span>
                <input type="number" id="repro-cycleday" min="1" max="28" value="${getCycleDay()}" class="text_pole" style="width:45px">
                <button id="repro-setcycle" class="menu_button">${ic('fa-check')}</button>
            </div>
            <hr>
            <label class="checkbox_label" title="Партнёр ({{char}}) получает свой цикл, контрацепцию и может забеременеть. Дети попадают в общую семью."><input type="checkbox" id="repro-partner-enabled"><span>Партнёр может забеременеть</span></label>
            <div id="repro-partner-panel" style="display:none;flex-direction:column;gap:4px">
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5">Имя:</span>
                    <input type="text" id="repro-partner-name" class="text_pole" style="flex:1" maxlength="60" placeholder="имя персонажа (авто)">
                </div>
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5">Контрацепция:</span>
                    <select id="repro-partner-contraception" class="text_pole" style="flex:1">
                        <option value="none">Нет</option>
                        <option value="condom">Презерватив</option>
                        <option value="pill">Таблетки</option>
                        <option value="iud">ВМС</option>
                    </select>
                </div>
                <div id="repro-partner-cycle-row" style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5">День цикла:</span>
                    <input type="number" id="repro-partner-cycleday" min="1" max="28" class="text_pole" style="width:45px">
                    <button id="repro-partner-setcycle" class="menu_button">${ic('fa-check')}</button>
                </div>
                <div id="repro-partner-mon" class="rp-m" style="display:none"></div>
                <button id="repro-partner-force-birth" class="menu_button" style="width:100%;display:none">🍼 Роды партнёра сейчас</button>
                <button id="repro-partner-reset" class="menu_button redWarningBG" style="width:100%;display:none">Сброс берем. партнёра</button>
            </div>
            <hr>
            <div style="font-size:10px;opacity:0.7">Статус: <span id="repro-status"></span></div>
            <div id="repro-preg-mon" class="rp-m" style="display:none"></div>
            <div id="repro-baby-mon" class="rp-m" style="display:none"></div>
            <button id="repro-force-birth-btn" class="menu_button" style="width:100%;display:none">🍼 Принять роды сейчас</button>
            <button id="repro-family-tree-btn" class="menu_button" style="width:100%;display:none">🌳 Семейное древо</button>
            <button id="repro-chronicle-btn" class="menu_button" style="width:100%;display:none">📖 Семейная хроника</button>
            <hr>
            <div id="repro-manual-toggle" class="menu_button" style="font-size:10px;text-align:center;cursor:pointer">Ручная беременность / малыш ▼</div>
            <div id="repro-manual-panel" style="display:none;gap:4px;flex-direction:column">
                <small style="opacity:0.5;font-size:9px;font-weight:600">Беременность</small>
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="font-size:9px;opacity:0.5;min-width:62px">Кто:</span>
                    <select id="repro-manual-carrier" class="text_pole" style="flex:1">
                        <option value="user">Я</option>
                        <option value="partner">Партнёр</option>
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
        $('#repro-family-event-chance').on('change', function() {
            const v = Math.max(0, Math.min(50, parseInt(this.value) || 0));
            this.value = v;
            getSettings().familyEventChance = v;
            saveSettingsDebounced();
        });

        // Семейное древо — модалка династии (модуль грузим лениво)
        $('#repro-family-tree-btn').on('click', function() {
            import('./family-ui.js')
                .then(m => m.showFamilyTree())
                .catch(e => dwarn('[Reproductive] family tree open failed:', e));
        });
        $('#repro-chronicle-btn').on('click', function() {
            import('./family-ui.js')
                .then(m => m.showFamilyChronicle())
                .catch(e => dwarn('[Reproductive] chronicle open failed:', e));
        });

        // ── Носители (этап 2): юзер-переключатель ──
        $('#repro-user-carry').on('change', function() {
            const p = getPregnancyData();
            if (!getCurrentChatId()) {
                showNotification('Чат не определён — открой чат и повтори', 'warning');
                this.checked = p.userCanCarry !== false;
                return;
            }
            p.userCanCarry = this.checked;
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });

        // ── Партнёр может забеременеть ──
        $('#repro-partner-enabled').on('change', function() {
            const p = getPregnancyData();
            if (!getCurrentChatId()) {
                showNotification('Чат не определён — открой чат и повтори', 'warning');
                this.checked = !!p.partner?.enabled;
                return;
            }
            const pp = getPartner(p);
            pp.enabled = this.checked;
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });
        $('#repro-partner-name').on('change blur', function() {
            const p = getPregnancyData();
            if (!p.partner) return;
            p.partner.name = $(this).val().trim().slice(0, 60);
            saveSettingsDebounced();
            updatePromptInjection();
        });
        $('#repro-partner-contraception').on('change', function() {
            const p = getPregnancyData();
            if (!p.partner) return;
            p.partner.contraception = this.value;
            saveSettingsDebounced();
            updatePromptInjection();
        });
        const applyPartnerCycle = (v) => {
            if (warnIfNoChat()) return;
            const p = getPregnancyData();
            const pp = getPartner(p);
            v = Math.max(1, Math.min(28, parseInt(v) || 14));
            $('#repro-partner-cycleday').val(v);
            pp.cycleDay = v;
            pp.lastCycleUpdate = Date.now();
            pp._userSetCycleAt = Date.now(); // защита от auto-advance (как у юзера)
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
            saveSettingsDebounced();
            setTimeout(() => { updatePromptInjection(); syncUI(); }, 50);
        };
        $('#repro-partner-setcycle').on('click', () => applyPartnerCycle($('#repro-partner-cycleday').val()));
        $('#repro-partner-cycleday').on('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); applyPartnerCycle($(this).val()); }
        });
        $('#repro-partner-cycleday').on('change', function() { applyPartnerCycle($(this).val()); });
        $('#repro-partner-force-birth').on('click', function() {
            const p = getPregnancyData();
            if (!p.partner?.isPregnant) { showNotification('Партнёр не беременна', 'warning'); return; }
            if (!confirm(`Принять роды у «${getPartnerName(p)}» прямо сейчас? Запустится диалог именования, малыши добавятся в общую семью.`)) return;
            applyPartnerBirth({ _source: 'manual' });
        });
        $('#repro-partner-reset').on('click', function() {
            if (confirm('Сбросить беременность партнёра?')) {
                resetPartnerPregnancy();
                showNotification('Сброшено', 'info');
            }
        });

        // ── Омегаверс (этап 3) ──
        $('#repro-universe').on('change', function() {
            const p = getPregnancyData();
            if (!getCurrentChatId()) {
                showNotification('Чат не определён — открой чат и повтори', 'warning');
                this.value = p.universe || 'realism';
                return;
            }
            p.universe = this.value;
            if (p.universe === 'omegaverse') {
                // Дефолтная пара: юзер-омега × партнёр-альфа (меняется селектами ниже)
                ensureOmegaFields(p, true);
                ensureOmegaFields(getPartner(p), false);
            }
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });
        $('#repro-user-designation').on('change', function() {
            const p = getPregnancyData();
            ensureOmegaFields(p, true);
            p.designation = this.value;
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });
        $('#repro-partner-designation').on('change', function() {
            const p = getPregnancyData();
            const pp = getPartner(p);
            ensureOmegaFields(pp, false);
            pp.designation = this.value;
            // QoL: партнёр-омега — носитель; включаем трекинг его беременности сам,
            // иначе «омега не беременеет» и юзер ищет причину по всем настройкам
            if (this.value === 'omega' && !pp.enabled) {
                pp.enabled = true;
                showNotification('<i class="fa-solid fa-venus"></i> Партнёр — омега: трекинг беременности партнёра включён автоматически', 'info');
            }
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });
        // День течки (омега) / гона (альфа) — поле подстраивается под роль
        const applyOmegaDay = (who, v) => {
            if (warnIfNoChat()) return;
            const p = getPregnancyData();
            const target = who === 'user' ? p : getPartner(p);
            ensureOmegaFields(target, who === 'user');
            const cfg = getCfg(getSettings());
            const d = target.designation || (who === 'user' ? 'omega' : 'alpha');
            if (d === 'alpha') {
                target.rutCycleDay = Math.max(1, Math.min(cfg.rutCycleLength, parseInt(v) || 1));
            } else {
                target.heatCycleDay = Math.max(1, Math.min(cfg.heatCycleLength, parseInt(v) || 1));
            }
            target._userSetCycleAt = Date.now(); // защита от auto-advance на 30 минут
            import('./message-handler.js').then(m => m.refreshRegenSnapshot());
            saveSettingsDebounced();
            setTimeout(() => { updatePromptInjection(); syncUI(); }, 50);
        };
        $('#repro-user-heatday-set').on('click', () => applyOmegaDay('user', $('#repro-user-heatday').val()));
        $('#repro-user-heatday').on('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); applyOmegaDay('user', $(this).val()); }
        });
        $('#repro-partner-heatday-set').on('click', () => applyOmegaDay('partner', $('#repro-partner-heatday').val()));
        $('#repro-partner-heatday').on('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); applyOmegaDay('partner', $(this).val()); }
        });
        // Супрессанты и блокаторы
        const bindOmegaFlag = (sel, who, field) => {
            $(sel).on('change', function() {
                const p = getPregnancyData();
                const target = who === 'user' ? p : getPartner(p);
                ensureOmegaFields(target, who === 'user');
                target[field] = this.checked;
                saveSettingsDebounced();
                updatePromptInjection();
                syncUI();
            });
        };
        bindOmegaFlag('#repro-user-suppressant', 'user', 'heatSuppressant');
        bindOmegaFlag('#repro-user-blockers', 'user', 'scentBlockers');
        bindOmegaFlag('#repro-partner-suppressant', 'partner', 'heatSuppressant');
        bindOmegaFlag('#repro-partner-blockers', 'partner', 'scentBlockers');
        // Глобальные длины циклов
        $('#repro-heat-length').on('change', function() {
            const v = Math.max(14, Math.min(180, parseInt(this.value) || 42));
            this.value = v;
            getSettings().heatCycleLength = v;
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });
        $('#repro-heat-duration').on('change', function() {
            const v = Math.max(1, Math.min(14, parseInt(this.value) || 5));
            this.value = v;
            getSettings().heatDuration = v;
            saveSettingsDebounced();
            updatePromptInjection();
            syncUI();
        });

        // Принудительно вызвать роды СЕЙЧАС — если модель описала роды но не поставила тег
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
            const carrier = $('#repro-manual-carrier').val();
            if (carrier === 'partner') {
                // startManualPartnerPregnancy сама включает трекинг партнёра
                startManualPartnerPregnancy(conceptionDate.toISOString(), fetus, sexArr);
            } else {
                startManualPregnancy(conceptionDate.toISOString(), fetus, sexArr);
            }
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