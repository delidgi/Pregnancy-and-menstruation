// ═══════════════════════════════════════════
// FAMILY-UI — диалог взросления и семейное древо
// Стили инжектятся из модуля (как в graduation dialog) — блок самодостаточен.
// ═══════════════════════════════════════════

import { getPregnancyData } from './state.js';
import { getAllChildren, getAgeDays, getStageOf, formatAgeRu, suggestTraits, getZodiac, buildChronicleEntries, findTwinGroups, ageRefIso } from './family.js';
import { saveSettingsDebounced } from '../../../../script.js';

// Обновить промпт/инфоблок после правок профиля (динамически — во избежание циклов)
function refreshAfterEdit() {
    try {
        import('./prompts.js').then(m => m.updatePromptInjection && m.updatePromptInjection());
        import('./ui.js').then(m => m.syncUI && m.syncUI());
        import('./message-handler.js').then(m => {
            if (m.renderInfoblock) setTimeout(m.renderInfoblock, 300);
        });
    } catch (e) { /* ignore */ }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function injectStyles() {
    // v2: перезаливаем стили при обновлении версии дизайна
    if ($('#repro-family-style').attr('data-v') === '2') return;
    $('#repro-family-style').remove();
    $('head').append(`<style id="repro-family-style" data-v="2">
/* ═══ Семейные окна v2: плоский тёмный стиль, шапка + скролл-тело, мобильная вёрстка ═══ */
.rf-overlay {
    position: fixed; inset: 0; z-index: 1000000;
    background: rgba(8, 9, 14, 0.62);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    padding: 16px; box-sizing: border-box;
    animation: rfFadeIn .22s ease-out;
}
@keyframes rfFadeIn { from { opacity: 0; } to { opacity: 1; } }
.rf-card {
    position: relative;
    background: #1d2130;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 18px;
    width: min(620px, 100%);
    max-height: min(86vh, 900px);
    display: flex; flex-direction: column;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
    color: #e8eaf2;
    overflow: hidden;
    animation: rfPop .28s cubic-bezier(.22, 1.1, .36, 1);
}
@keyframes rfPop { from { transform: translateY(14px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }

/* ── Шапка: иконка-бейдж, заголовок слева, крестик ── */
.rf-head {
    display: flex; align-items: center; gap: 12px;
    padding: 15px 18px 13px;
    border-bottom: 1px solid rgba(255,255,255,.07);
    background: linear-gradient(180deg, rgba(130,160,255,.07), transparent);
    flex: 0 0 auto;
}
.rf-head-ic {
    width: 38px; height: 38px; border-radius: 12px; flex: 0 0 38px;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, rgba(100,160,255,.18), rgba(170,110,255,.22));
    border: 1px solid rgba(160,160,255,.25);
    color: #b9c8ff; font-size: 15px;
}
.rf-head-tx { flex: 1; min-width: 0; }
.rf-title { font-size: 15.5px; font-weight: 700; color: #fff; letter-spacing: .2px; }
.rf-subtitle { font-size: 11.5px; opacity: .6; margin-top: 2px; line-height: 1.35; }
.rf-close {
    flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
    color: rgba(255,255,255,.65); font-size: 13px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all .15s; padding: 0;
}
.rf-close:hover { background: rgba(255,90,110,.14); border-color: rgba(255,90,110,.4); color: #ff98a8; }

/* ── Скроллящееся тело ── */
.rf-body { padding: 16px 18px 18px; overflow-y: auto; flex: 1 1 auto; overscroll-behavior: contain; }
.rf-body::-webkit-scrollbar { width: 8px; }
.rf-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 4px; }

/* ── Кнопки ── */
.rf-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    background: linear-gradient(135deg, #5a8de8, #8a5ae8);
    border: none; color: #fff;
    padding: 9px 20px; border-radius: 11px;
    font-size: 12.5px; font-weight: 600; cursor: pointer;
    transition: filter .15s, transform .15s;
}
.rf-btn:hover { filter: brightness(1.18); transform: translateY(-1px); }
.rf-btn i { font-size: 11px; }
.rf-btn.ghost {
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.14);
    color: rgba(255,255,255,.85);
}
.rf-btn.ghost:hover { background: rgba(255,255,255,.11); }
.rf-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; }

/* ── Диалог взросления ── */
.rf-stageup {
    border: 1px solid rgba(255,255,255,.09); border-radius: 13px;
    padding: 13px 15px; margin-bottom: 10px;
    background: #252a3c;
}
.rf-stageup-head { font-size: 13.5px; font-weight: 700; margin-bottom: 9px; }
.rf-stageup-head i { margin: 0 5px; opacity: .8; }
.rf-stageup-head .m { color: #4dabf7; }
.rf-stageup-head .f { color: #ff9ff3; }
.rf-stageup-lbl { font-size: 10.5px; opacity: .55; margin-bottom: 6px; }
.rf-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.rf-chip {
    padding: 5px 12px; border-radius: 9px; font-size: 11.5px; cursor: pointer;
    border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05);
    transition: all .15s; user-select: none;
}
.rf-chip:hover { border-color: rgba(130,160,255,.55); }
.rf-chip.selected {
    border-color: #7ea0ff; color: #aabfff;
    background: rgba(110,140,255,.16); font-weight: 600;
}
.rf-chip.rf-reroll { opacity: .6; }
.rf-trait-input {
    width: 100%; box-sizing: border-box;
    background: #171a26; border: 1px solid rgba(255,255,255,.11);
    border-radius: 9px; color: #fff; padding: 7px 10px; font-size: 12px;
}
.rf-trait-input:focus { outline: none; border-color: rgba(130,160,255,.55); }

/* ── Семейное древо ── */
.rf-union { margin-bottom: 18px; }
.rf-union:last-of-type { margin-bottom: 6px; }
.rf-parents { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.rf-parent {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 14px; border-radius: 10px; font-size: 12px; font-weight: 600;
    border: 1px solid rgba(255,215,120,.25); color: #ffe9b8;
    background: rgba(255,215,120,.07);
}
.rf-parent i { font-size: 10px; opacity: .75; }
.rf-par-desig {
    margin-left: 6px; font-size: 11px; font-weight: 800;
    font-family: "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif;
}
.rf-par-desig.a { color: #ff8a8a; }
.rf-par-desig.b { color: #9fb6c9; }
.rf-par-desig.o { color: #c9a0ff; }
.rf-heart { color: #ff6b9d; font-size: 12px; }
.rf-tree-connector { width: 2px; height: 14px; margin: 0 auto; background: rgba(255,255,255,.14); }
.rf-children { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.rf-child {
    position: relative;
    flex: 1 1 180px; min-width: 150px; max-width: 250px;
    border-radius: 13px; padding: 11px 13px 12px;
    background: #252a3c;
    border: 1px solid rgba(255,255,255,.08);
    border-top: 2px solid rgba(255,255,255,.18);
    box-sizing: border-box;
}
.rf-child.m { border-top-color: #4dabf7; }
.rf-child.f { border-top-color: #ff9ff3; }
.rf-child.expected { border-style: dashed; opacity: .85; }
.rf-child[data-origin] { cursor: pointer; transition: transform .15s, box-shadow .15s, background .15s; }
.rf-child[data-origin]:hover, .rf-child[data-origin]:active {
    background: #2b3148;
    transform: translateY(-2px);
    box-shadow: 0 8px 22px rgba(0,0,0,.35);
}
.rf-child[data-origin]:hover .rf-child-edit { opacity: .9; }
.rf-child-edit {
    position: absolute; top: 8px; right: 10px;
    font-size: 10px; opacity: .3; transition: opacity .15s;
}
.rf-child-head { font-size: 13.5px; font-weight: 700; margin-bottom: 3px; }
.rf-child-head .sx { margin-right: 4px; }
.rf-child.m .sx { color: #4dabf7; }
.rf-child.f .sx { color: #ff9ff3; }
.rf-child-stage { font-size: 11px; opacity: .75; margin-bottom: 6px; }
.rf-child-stage i { margin-right: 4px; opacity: .7; }
.rf-child-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
.rf-child-chip {
    font-size: 10px; padding: 2px 8px; border-radius: 7px;
    border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); opacity: .95;
}
.rf-twin-chip { border-color: rgba(255,215,64,.35); color: #ffd740; }
.rf-twin-chip i { font-size: 8px; margin-right: 3px; }
.rf-desig-chip { border-color: rgba(180,120,255,.45); color: #c9a0ff; font-weight: 600; }
/* Знаки зодиака — не во всех UI-шрифтах есть ♈..♓: подставляем символьный шрифт */
.rf-zsym { font-family: "Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Color Emoji", sans-serif; }
.rf-child-look { font-size: 10.5px; opacity: .6; line-height: 1.4; }
.rf-child-event { margin-top: 5px; font-size: 10.5px; color: #8fb8ff; }
.rf-child-event i { margin-right: 3px; }
.rf-child-special { margin-top: 5px; font-size: 10.5px; color: #ffd740; }
.rf-child-special i { margin-right: 3px; }
.rf-grown-badge {
    display: inline-block; margin-top: 5px; font-size: 9px; padding: 1px 8px;
    border-radius: 7px; border: 1px solid rgba(130,230,120,.35); color: rgba(130,230,120,.95);
}
.rf-tree-stats { text-align: center; font-size: 11px; opacity: .5; margin-top: 10px; }
.rf-tree-hint { text-align: center; font-size: 10px; opacity: .4; margin-top: 3px; }

/* ── Хроника ── */
.rf-chron-year {
    font-size: 11px; font-weight: 700; opacity: .55; letter-spacing: 2px;
    text-align: center; margin: 12px 0 5px;
}
.rf-chron-item {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 7px 4px; border-bottom: 1px solid rgba(255,255,255,.06);
}
.rf-chron-item:last-child { border-bottom: none; }
.rf-chron-item i { width: 18px; text-align: center; margin-top: 2px; color: #8fb8ff; opacity: .9; flex: 0 0 18px; }
.rf-chron-date { flex: 0 0 64px; font-size: 11px; opacity: .55; padding-top: 1px; }
.rf-chron-text { font-size: 12.5px; line-height: 1.45; min-width: 0; }

/* ── Профиль ребёнка ── */
.rf-prof-grid {
    display: grid; grid-template-columns: 92px 1fr;
    gap: 8px 10px; align-items: center;
}
.rf-prof-grid label { font-size: 11px; opacity: .65; text-align: right; }
.rf-prof-input, .rf-prof-select, .rf-prof-textarea {
    width: 100%; box-sizing: border-box;
    background: #171a26; border: 1px solid rgba(255,255,255,.11);
    border-radius: 9px; color: #fff; padding: 7px 10px; font-size: 12px;
    font-family: inherit;
}
.rf-prof-textarea { resize: vertical; min-height: 64px; line-height: 1.4; }
.rf-prof-input:focus, .rf-prof-select:focus, .rf-prof-textarea:focus {
    outline: none; border-color: rgba(130,160,255,.55);
}
.rf-prof-select option { background: #1d2130; }
.rf-prof-note { font-size: 10px; opacity: .45; grid-column: 2; margin-top: -3px; }

/* ── Телефон ── */
@media (max-width: 540px) {
    .rf-overlay { padding: 8px; align-items: flex-start; padding-top: 20px; }
    .rf-card { width: 100%; max-height: calc(100dvh - 36px); border-radius: 15px; }
    .rf-head { padding: 12px 13px 11px; gap: 10px; }
    .rf-body { padding: 12px 13px 14px; }
    .rf-child { flex: 1 1 100%; max-width: none; }
    .rf-prof-grid { grid-template-columns: 1fr; gap: 3px 0; }
    .rf-prof-grid label { text-align: left; margin-top: 7px; }
    .rf-prof-note { grid-column: 1; }
    .rf-actions .rf-btn { flex: 1 1 auto; }
    .rf-chron-date { flex: 0 0 52px; font-size: 10px; }
}
</style>`);
}

// ── Клики внутри модалки не должны «протекать» в документ ──
// SillyTavern закрывает свои панели/дровер настроек по клику вне их (особенно
// на телефоне) — из-за всплытия любой тап в нашем окне выглядел «кликом мимо»,
// и после закрытия модалки интерфейс таверны оказывался свёрнут.
function guardOverlay(overlay) {
    overlay.on('mousedown mouseup click touchstart touchend pointerdown pointerup', (e) => {
        e.stopPropagation();
    });
}

// ═══ Диалог взросления: «X теперь тоддлер!» + выбор новой черты ═══
// events — из family.collectStageUps(); onConfirm(choices) — choices[i]: строка|null
export function showStageUpDialog(events, onConfirm) {
    if (!events || events.length === 0) {
        if (onConfirm) onConfirm([]);
        return;
    }
    injectStyles();
    $('#repro-stageup-overlay').remove();

    let cardsHtml = '';
    events.forEach((ev, i) => {
        const child = ev.child;
        const sxCls = child.sex === 'F' ? 'f' : 'm';
        const sxIcon = child.sex === 'F' ? '♀' : '♂';
        const traits = suggestTraits(ev.toStage.id, 3);
        const chipsHtml = traits.map(t =>
            `<span class="rf-chip" data-ev="${i}">${escapeHtml(t)}</span>`).join('')
            + `<span class="rf-chip rf-reroll" data-ev="${i}" data-stage="${ev.toStage.id}" title="Другие варианты"><i class="fa-solid fa-dice"></i></span>`;
        cardsHtml += `
        <div class="rf-stageup" data-ev="${i}">
            <div class="rf-stageup-head">
                <span class="${sxCls}">${sxIcon} ${escapeHtml(child.name || 'Малыш')}</span>
                — теперь <i class="fa-solid ${ev.toStage.icon}"></i>${ev.toStage.label}!
            </div>
            <div class="rf-stageup-lbl">Новая черта характера (по желанию):</div>
            <div class="rf-chips">${chipsHtml}</div>
            <input type="text" class="rf-trait-input" data-ev="${i}" maxlength="40" placeholder="…или своя черта">
        </div>`;
    });

    const overlay = $(`
    <div id="repro-stageup-overlay" class="rf-overlay">
        <div class="rf-card">
            <div class="rf-head">
                <div class="rf-head-ic"><i class="fa-solid fa-seedling"></i></div>
                <div class="rf-head-tx">
                    <div class="rf-title">Время летит!</div>
                    <div class="rf-subtitle">${events.length === 1 ? 'Ребёнок переходит на новую стадию жизни' : 'Дети переходят на новые стадии жизни'}</div>
                </div>
            </div>
            <div class="rf-body">
                ${cardsHtml}
                <div class="rf-actions"><button class="rf-btn rf-confirm"><i class="fa-solid fa-heart"></i> Принять</button></div>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);
    guardOverlay(overlay);

    // Выбор чипа (один на событие)
    overlay.on('click', '.rf-chip:not(.rf-reroll)', function() {
        const ev = $(this).attr('data-ev');
        overlay.find(`.rf-chip[data-ev="${ev}"]`).removeClass('selected');
        $(this).addClass('selected');
        overlay.find(`.rf-trait-input[data-ev="${ev}"]`).val('');
    });
    // Реролл предложений
    overlay.on('click', '.rf-reroll', function() {
        const ev = $(this).attr('data-ev');
        const stageId = $(this).attr('data-stage');
        const fresh = suggestTraits(stageId, 3);
        const reroll = $(this).detach();
        const wrap = overlay.find(`.rf-stageup[data-ev="${ev}"] .rf-chips`);
        wrap.empty();
        fresh.forEach(t => wrap.append(`<span class="rf-chip" data-ev="${ev}">${escapeHtml(t)}</span>`));
        wrap.append(reroll);
    });
    // Свой текст сбрасывает выбор чипа
    overlay.on('input', '.rf-trait-input', function() {
        if ($(this).val().trim()) {
            const ev = $(this).attr('data-ev');
            overlay.find(`.rf-chip[data-ev="${ev}"]`).removeClass('selected');
        }
    });

    const confirm = () => {
        const choices = events.map((_, i) => {
            const custom = overlay.find(`.rf-trait-input[data-ev="${i}"]`).val().trim();
            if (custom) return custom.slice(0, 40);
            const chip = overlay.find(`.rf-chip[data-ev="${i}"].selected`);
            return chip.length ? chip.text().trim() : null;
        });
        overlay.css({ opacity: 0, transition: 'opacity .25s' });
        setTimeout(() => {
            overlay.remove();
            if (onConfirm) onConfirm(choices);
        }, 260);
    };

    overlay.find('.rf-confirm').on('click', confirm);
    overlay.on('keydown', (e) => { if (e.key === 'Enter') confirm(); });
}

// ═══ Семейное древо ═══
export function showFamilyTree() {
    injectStyles();
    $('#repro-tree-overlay').remove();

    const p = getPregnancyData();

    let playerName = 'Ты';
    let charName = '';
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        if (ctx?.name1) playerName = ctx.name1;
        if (ctx?.name2) charName = ctx.name2;
    } catch (e) { /* ignore */ }

    const all = getAllChildren(p);
    const pp = p.partner;
    const partnerName = (pp?.name || charName || '').trim();
    const isOmegaUni = p.universe === 'omegaverse';

    // Роль (A/B/O) родителя по имени: совпало с юзером → его роль, с партнёром → его,
    // иначе — сохранённая при рождении роль из карточки ребёнка.
    const nameMatch = (a, b) => {
        a = String(a || '').trim().toLowerCase();
        b = String(b || '').trim().toLowerCase();
        return a && b && (a === b || a.startsWith(b) || b.startsWith(a));
    };
    const desigOf = (name, storedDesig) => {
        if (!isOmegaUni || !name) return storedDesig || null;
        if (nameMatch(name, playerName)) return p.designation || storedDesig || null;
        if (nameMatch(name, partnerName)) return pp?.designation || storedDesig || null;
        return storedDesig || null;
    };

    // Группируем детей по ПАРЕ родителей из их карточек (отец|мать) — раньше
    // древо всегда рисовало «юзер ♥ второй родитель» и теряло настоящую пару,
    // если в профиле вписаны оба (например папа-омега и мама-альфа).
    const groups = new Map(); // key → { father, mother, entries }
    const groupFor = (father, mother) => {
        father = String(father || '').trim();
        mother = String(mother || '').trim();
        // Ни одного родителя не вписано — считаем, что растит юзер
        if (!father && !mother) mother = playerName;
        const key = `${father.toLowerCase()}|${mother.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { father, mother, entries: [] });
        return groups.get(key);
    };
    for (const entry of all) {
        const c = entry.child;
        // Старые записи: только отец вписан → мать по умолчанию юзер
        const mother = (c.motherName || '').trim() || playerName;
        groupFor(c.fatherName, mother).entries.push(entry);
    }
    // Ожидаемые малыши: юзерская беременность → пара (отец, юзер);
    // партнёрская → пара (отец из pp, партнёр-носитель)
    if (p.isPregnant) groupFor(p.fatherName, playerName);
    const partnerPregnant = !!(pp && pp.enabled && pp.isPregnant);
    if (partnerPregnant) groupFor(pp.fatherName || playerName, partnerName || 'Партнёр');

    // Близнецы: набор ключей origin:index всех детей из близнецовых групп
    const twinKeys = new Set(findTwinGroups(p).flat().map(e => `${e.origin}:${e.index}`));
    // «Сейчас» для возраста: RP-дата, а до первого RP_DATE — реальное время
    const nowRef = ageRefIso(p);

    const childCard = ({ child, origin, index }) => {
        const sxCls = child.sex === 'F' ? 'f' : child.sex === 'M' ? 'm' : '';
        const sxIcon = child.sex === 'F' ? '♀' : child.sex === 'M' ? '♂' : '?';
        const ageDays = getAgeDays(child, nowRef);
        const stage = getStageOf(child, nowRef);
        const zodiac = getZodiac(child.birthRpDate);
        const isTwin = twinKeys.has(`${origin}:${index}`);
        const desigLabel = { alpha: 'α альфа', beta: 'β бета', omega: 'Ω омега' }[child.designation] || '';
        const chips = (child.personality || []).slice(0, 4)
            .map(t => `<span class="rf-child-chip">${escapeHtml(t)}</span>`).join('')
            + (isTwin ? `<span class="rf-child-chip rf-twin-chip"><i class="fa-solid fa-user-group"></i> близнец</span>` : '')
            + (desigLabel ? `<span class="rf-child-chip rf-desig-chip">${desigLabel}</span>` : '');
        const lookBits = [];
        if (child.eyes) lookBits.push(`глаза: ${child.eyes}`);
        if (child.hair) lookBits.push(`волосы: ${child.hair}`);
        lookBits.push(...(child.appearance || []).slice(0, 3));
        const look = lookBits.join(', ');
        const specialName = child.special?.name || (typeof child.special === 'string' ? child.special : '');
        return `<div class="rf-child ${sxCls}" data-origin="${origin}" data-index="${index}" title="Нажми — профиль и лор">
            <i class="fa-solid fa-pen rf-child-edit"></i>
            <div class="rf-child-head"><span class="sx">${sxIcon}</span>${escapeHtml(child.name || 'без имени')}</div>
            <div class="rf-child-stage">${stage ? `<i class="fa-solid ${stage.icon}"></i>${stage.label} · ` : ''}${formatAgeRu(ageDays)}${zodiac ? ` · <span class="rf-zsym">${zodiac.symbol}</span> ${zodiac.name}` : ''}</div>
            ${chips ? `<div class="rf-child-chips">${chips}</div>` : ''}
            ${look ? `<div class="rf-child-look">${escapeHtml(look)}</div>` : ''}
            ${specialName ? `<div class="rf-child-special"><i class="fa-solid fa-star"></i>${escapeHtml(specialName)}</div>` : ''}
            ${child.activeEvent?.ru ? `<div class="rf-child-event"><i class="fa-solid fa-dice"></i>${escapeHtml(child.activeEvent.ru)}</div>` : ''}
            ${origin === 'grown' ? `<div class="rf-grown-badge">вырос(ла)</div>` : ''}
        </div>`;
    };

    // c — объект носителя (p для юзера, p.partner для партнёра)
    const expectedCard = (c, carrierLabel) => {
        const count = c.fetusCount || 1;
        const sexStr = c.fetusSexRevealed && c.fetusSex?.length
            ? c.fetusSex.map(x => x === 'M' ? '♂' : '♀').join(' ')
            : '?';
        return `<div class="rf-child expected">
            <div class="rf-child-head"><span class="sx">${sexStr}</span>Ожидается…</div>
            <div class="rf-child-stage"><i class="fa-solid fa-heart"></i>${c.pregnancyWeeks || 0} нед.${count > 1 ? ` · ×${count}` : ''}${carrierLabel ? ` · носит ${escapeHtml(carrierLabel)}` : ''}</div>
        </div>`;
    };

    // Чип родителя: имя + значок роли (α/β/Ω) в омегаверсе
    const parentChip = (name, storedDesig) => {
        const d = desigOf(name, storedDesig);
        const mark = { alpha: '<span class="rf-par-desig a">α</span>', beta: '<span class="rf-par-desig b">β</span>', omega: '<span class="rf-par-desig o">Ω</span>' }[d] || '';
        return `<span class="rf-parent"><i class="fa-solid fa-user"></i>${escapeHtml(name)}${mark}</span>`;
    };

    let unionsHtml = '';
    for (const g of groups.values()) {
        const { father, mother, entries } = g;
        // Сортируем детей по дате рождения (старшие слева)
        entries.sort((a, b) => {
            const am = a.child.birthRpDate ? new Date(a.child.birthRpDate).getTime() : 0;
            const bm = b.child.birthRpDate ? new Date(b.child.birthRpDate).getTime() : 0;
            return am - bm;
        });
        let childrenHtml = entries.map(childCard).join('');
        if (p.isPregnant && nameMatch(mother, playerName) && String(p.fatherName || '').trim().toLowerCase() === father.toLowerCase()) {
            childrenHtml += expectedCard(p, '');
        }
        if (partnerPregnant && nameMatch(mother, partnerName)) {
            childrenHtml += expectedCard(pp, partnerName);
        }
        if (!childrenHtml) continue;
        // Роли из карточек детей группы (если имя не совпало с юзером/партнёром)
        const anyChild = entries[0]?.child || {};
        const chips = [];
        if (father) chips.push(parentChip(father, anyChild.fatherDesignation));
        if (mother) chips.push(parentChip(mother, anyChild.motherDesignation));
        unionsHtml += `<div class="rf-union">
            <div class="rf-parents">
                ${chips.join('<span class="rf-heart">♥</span>')}
            </div>
            <div class="rf-tree-connector"></div>
            <div class="rf-children">${childrenHtml}</div>
        </div>`;
    }

    if (!unionsHtml) {
        unionsHtml = `<div style="text-align:center;opacity:.5;font-size:12px;padding:20px 0">Пока никого — древо начнёт расти с первым малышом 🌱</div>`;
    }

    const activeCount = Array.isArray(p.babies) ? p.babies.length : 0;
    const grownCount = Array.isArray(p.grownChildren) ? p.grownChildren.length : 0;
    const statsBits = [];
    if (activeCount) statsBits.push(`малышей: ${activeCount}`);
    if (grownCount) statsBits.push(`выросло: ${grownCount}`);
    if (p.isPregnant || partnerPregnant) statsBits.push('ожидается пополнение');

    const overlay = $(`
    <div id="repro-tree-overlay" class="rf-overlay">
        <div class="rf-card">
            <div class="rf-head">
                <div class="rf-head-ic"><i class="fa-solid fa-tree"></i></div>
                <div class="rf-head-tx">
                    <div class="rf-title">Семейное древо</div>
                    <div class="rf-subtitle">Династия этого чата${statsBits.length ? ` · ${statsBits.join(' · ')}` : ''}</div>
                </div>
                <button class="rf-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rf-body">
                ${unionsHtml}
                ${all.length ? `<div class="rf-tree-hint"><i class="fa-solid fa-pen"></i> нажми на карточку ребёнка — профиль: внешность, черты, лор</div>` : ''}
                <div class="rf-actions">
                    <button class="rf-btn rf-open-chronicle"><i class="fa-solid fa-book-open"></i>Хроника</button>
                </div>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);
    guardOverlay(overlay);

    const close = () => {
        $(document).off('keydown.rfTree');
        overlay.css({ opacity: 0, transition: 'opacity .25s' });
        setTimeout(() => overlay.remove(), 260);
    };
    overlay.find('.rf-close').on('click', close);
    overlay.on('click', (e) => { if (e.target === overlay[0]) close(); });
    $(document).on('keydown.rfTree', (e) => { if (e.key === 'Escape') close(); });

    // Клик по карточке ребёнка → профиль (у «ожидается…» нет data-origin)
    overlay.on('click', '.rf-child[data-origin]', function() {
        const origin = $(this).attr('data-origin');
        const index = parseInt($(this).attr('data-index'));
        if (isNaN(index)) return;
        $(document).off('keydown.rfTree');
        overlay.remove();
        showChildProfile(origin, index);
    });
    overlay.find('.rf-open-chronicle').on('click', () => {
        $(document).off('keydown.rfTree');
        overlay.remove();
        showFamilyChronicle();
    });
}

// ═══ Семейная хроника: таймлайн всей истории семьи ═══
export function showFamilyChronicle() {
    injectStyles();
    $('#repro-chron-overlay').remove();

    const p = getPregnancyData();
    const entries = buildChronicleEntries(p);

    const fmtDay = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    };
    const yearOf = (iso) => {
        if (!iso) return null;
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d.getFullYear();
    };

    let listHtml = '';
    let lastYear = null;
    for (const e of entries) {
        const y = yearOf(e.rpDate);
        if (y !== null && y !== lastYear) {
            listHtml += `<div class="rf-chron-year">— ${y} —</div>`;
            lastYear = y;
        }
        listHtml += `<div class="rf-chron-item">
            <i class="fa-solid ${escapeHtml(e.icon || 'fa-star')}"></i>
            <span class="rf-chron-date">${fmtDay(e.rpDate) || '·'}</span>
            <span class="rf-chron-text">${escapeHtml(e.text)}</span>
        </div>`;
    }
    if (!listHtml) {
        listHtml = `<div style="text-align:center;opacity:.5;font-size:12px;padding:20px 0">Хроника пуста — история начнётся с первого события 📖</div>`;
    }

    const overlay = $(`
    <div id="repro-chron-overlay" class="rf-overlay">
        <div class="rf-card">
            <div class="rf-head">
                <div class="rf-head-ic"><i class="fa-solid fa-book-open"></i></div>
                <div class="rf-head-tx">
                    <div class="rf-title">Семейная хроника</div>
                    <div class="rf-subtitle">Вся история семьи по RP-датам${entries.length ? ` · записей: ${entries.length}` : ''}</div>
                </div>
                <button class="rf-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rf-body">
                <div class="rf-chron-list">${listHtml}</div>
                <div class="rf-actions">
                    <button class="rf-btn ghost rf-open-tree"><i class="fa-solid fa-tree"></i>Древо</button>
                </div>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);
    guardOverlay(overlay);
    // Свежее — внизу: мотаем тело окна в конец
    const body = overlay.find('.rf-body')[0];
    if (body) body.scrollTop = body.scrollHeight;

    const close = () => {
        $(document).off('keydown.rfChron');
        overlay.css({ opacity: 0, transition: 'opacity .25s' });
        setTimeout(() => overlay.remove(), 260);
    };
    overlay.find('.rf-close').on('click', close);
    overlay.on('click', (e) => { if (e.target === overlay[0]) close(); });
    $(document).on('keydown.rfChron', (e) => { if (e.key === 'Escape') close(); });
    overlay.find('.rf-open-tree').on('click', () => {
        $(document).off('keydown.rfChron');
        overlay.remove();
        showFamilyTree();
    });
}

// ═══ Профиль ребёнка: внешность/черты/лор — всё уходит в промпт автоматически ═══
// origin: 'active' (p.babies) | 'grown' (p.grownChildren), index — позиция в массиве.
export function showChildProfile(origin, index) {
    injectStyles();
    $('#repro-profile-overlay').remove();

    const p = getPregnancyData();
    const list = origin === 'grown' ? p.grownChildren : p.babies;
    const child = Array.isArray(list) ? list[index] : null;
    if (!child) return;

    const v = (s) => escapeHtml(s || '');
    const birthMs = child.birthRpDate ? new Date(child.birthRpDate).getTime() : NaN;
    const birthVal = isNaN(birthMs) ? '' : new Date(birthMs).toISOString().slice(0, 10);
    const specialName = child.special?.name || (typeof child.special === 'string' ? child.special : '');
    const nowRef = ageRefIso(p);
    const ageDays = getAgeDays(child, nowRef);
    const stage = getStageOf(child, nowRef);
    const zodiac = getZodiac(child.birthRpDate);

    const overlay = $(`
    <div id="repro-profile-overlay" class="rf-overlay">
        <div class="rf-card">
            <div class="rf-head">
                <div class="rf-head-ic"><i class="fa-solid ${child.sex === 'F' ? 'fa-child-dress' : 'fa-child'}"></i></div>
                <div class="rf-head-tx">
                    <div class="rf-title">${v(child.name) || 'Без имени'}</div>
                    <div class="rf-subtitle">${stage ? `${stage.label} · ` : ''}${formatAgeRu(ageDays)}<span class="rf-prof-zodiac">${zodiac ? ` · <span class="rf-zsym">${zodiac.symbol}</span> ${zodiac.name}` : ''}</span></div>
                </div>
                <button class="rf-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="rf-body">
            <div class="rf-prof-grid">
                <label>Имя</label>
                <input type="text" class="rf-prof-input" id="rfp-name" maxlength="60" value="${v(child.name)}">
                <label>Пол</label>
                <select class="rf-prof-select" id="rfp-sex">
                    <option value="M" ${child.sex !== 'F' ? 'selected' : ''}>Мальчик</option>
                    <option value="F" ${child.sex === 'F' ? 'selected' : ''}>Девочка</option>
                </select>
                ${p.universe === 'omegaverse' ? `
                <label>Вторичный пол</label>
                <select class="rf-prof-select" id="rfp-desig">
                    <option value="" ${!child.designation ? 'selected' : ''}>не презентовался</option>
                    <option value="alpha" ${child.designation === 'alpha' ? 'selected' : ''}>Альфа</option>
                    <option value="beta" ${child.designation === 'beta' ? 'selected' : ''}>Бета</option>
                    <option value="omega" ${child.designation === 'omega' ? 'selected' : ''}>Омега</option>
                </select>` : ''}
                <label>Род. (RP)</label>
                <input type="date" class="rf-prof-input" id="rfp-birth" value="${birthVal}">
                <label>Глаза</label>
                <input type="text" class="rf-prof-input" id="rfp-eyes" maxlength="80" value="${v(child.eyes)}" placeholder="зелёные, как у мамы">
                <label>Волосы</label>
                <input type="text" class="rf-prof-input" id="rfp-hair" maxlength="80" value="${v(child.hair)}" placeholder="тёмные кудри">
                <label>Внешность</label>
                <input type="text" class="rf-prof-input" id="rfp-look" maxlength="200" value="${v((child.appearance || []).join(', '))}" placeholder="ямочки, веснушки — через запятую">
                <label>Характер</label>
                <input type="text" class="rf-prof-input" id="rfp-traits" maxlength="200" value="${v((child.personality || []).join(', '))}" placeholder="упрямый, почемучка — через запятую">
                <label>Особая черта</label>
                <input type="text" class="rf-prof-input" id="rfp-special" maxlength="80" value="${v(specialName)}" placeholder="музыкальный слух">
                <label>Отец</label>
                <input type="text" class="rf-prof-input" id="rfp-father" maxlength="60" value="${v(child.fatherName)}">
                <label>Мать</label>
                <input type="text" class="rf-prof-input" id="rfp-mother" maxlength="60" value="${v(child.motherName)}">
                <label>Лор / заметки</label>
                <textarea class="rf-prof-textarea" id="rfp-notes" maxlength="400" placeholder="любые детали: любимая игрушка, шрам на коленке, боится грозы… Модель будет это помнить.">${v(child.notes)}</textarea>
                <span class="rf-prof-note">Всё из профиля автоматически попадает в промпт — лорбук не нужен.</span>
            </div>
            <div class="rf-actions">
                <button class="rf-btn rfp-save"><i class="fa-solid fa-check"></i>Сохранить</button>
                <button class="rf-btn ghost rfp-back"><i class="fa-solid fa-arrow-left"></i>Древо</button>
            </div>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);
    guardOverlay(overlay);

    // Живой пересчёт зодиака при смене даты рождения
    overlay.find('#rfp-birth').on('change', function() {
        const z = getZodiac(this.value);
        overlay.find('.rf-prof-zodiac').html(z ? ` · <span class="rf-zsym">${z.symbol}</span> ${escapeHtml(z.name)}` : '');
    });

    const close = () => {
        $(document).off('keydown.rfProf');
        overlay.css({ opacity: 0, transition: 'opacity .25s' });
        setTimeout(() => overlay.remove(), 260);
    };
    overlay.find('.rf-close').on('click', close);
    overlay.on('click', (e) => { if (e.target === overlay[0]) close(); });
    $(document).on('keydown.rfProf', (e) => { if (e.key === 'Escape') close(); });

    const toList = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);

    overlay.find('.rfp-save').on('click', () => {
        const g = (id) => overlay.find(`#${id}`).val().trim();
        child.name = g('rfp-name').slice(0, 60);
        child.sex = g('rfp-sex') === 'F' ? 'F' : 'M';
        // Вторичный пол (омегаверс): селект есть только когда вселенная включена
        const desigSel = overlay.find('#rfp-desig');
        if (desigSel.length) {
            const dv = desigSel.val();
            child.designation = ['alpha', 'beta', 'omega'].includes(dv) ? dv : null;
        }
        child.eyes = g('rfp-eyes').slice(0, 80);
        child.hair = g('rfp-hair').slice(0, 80);
        child.appearance = toList(g('rfp-look'));
        child.personality = toList(g('rfp-traits'));
        const sp = g('rfp-special').slice(0, 80);
        child.special = sp ? { ...(typeof child.special === 'object' && child.special ? child.special : {}), name: sp } : null;
        child.fatherName = g('rfp-father').slice(0, 60);
        child.motherName = g('rfp-mother').slice(0, 60);
        child.notes = g('rfp-notes').slice(0, 400);

        // Дата рождения: если изменилась — стадию и счётчик ДР приводим к новой дате
        // тихо, иначе на следующем сообщении посыпались бы диалоги взросления и «ДР!»
        const newBirth = g('rfp-birth');
        const changedBirth = newBirth && newBirth !== birthVal;
        if (changedBirth) {
            child.birthRpDate = new Date(`${newBirth}T12:00:00Z`).toISOString();
            const refIso = ageRefIso(p);
            const st = getStageOf(child, refIso);
            if (st) child.stage = st.id;
            const days = getAgeDays(child, refIso);
            if (days !== null) child._lastBdayCelebrated = Math.floor(days / 365.25);
        }

        saveSettingsDebounced();
        refreshAfterEdit();
        overlay.remove();
        $(document).off('keydown.rfProf');
        showFamilyTree();
    });

    overlay.find('.rfp-back').on('click', () => {
        overlay.remove();
        $(document).off('keydown.rfProf');
        showFamilyTree();
    });
}
