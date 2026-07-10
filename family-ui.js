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
    if ($('#repro-family-style').length > 0) return;
    $('head').append(`<style id="repro-family-style">
/* ── Общий оверлей семейных диалогов ── */
.rf-overlay {
    position: fixed; inset: 0; z-index: 1000000;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    animation: rfFadeIn .3s ease-out;
}
@keyframes rfFadeIn { from { opacity: 0; } to { opacity: 1; } }
.rf-card {
    position: relative;
    /* Плотный тёмный фон: прозрачное «стекло» было нечитаемым поверх чата */
    background: linear-gradient(160deg, #262b3d 0%, #2e2745 100%);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 24px;
    padding: 26px 30px;
    min-width: 340px; max-width: 640px;
    max-height: 82vh; overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    color: rgba(255, 255, 255, 0.97);
    animation: rfPop .45s cubic-bezier(.34,1.56,.64,1);
}
@keyframes rfPop { from { transform: scale(.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.rf-title {
    font-size: 20px; font-weight: 700; text-align: center;
    margin-bottom: 4px;
    background: linear-gradient(135deg, #82c8ff 0%, #b478ff 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
}
.rf-subtitle { font-size: 12px; opacity: .7; text-align: center; margin-bottom: 16px; line-height: 1.4; }
.rf-btn {
    display: block; margin: 14px auto 0;
    background: linear-gradient(135deg, rgba(130, 200, 255, 0.3), rgba(180, 120, 255, 0.3));
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: rgba(255, 255, 255, 0.95);
    padding: 9px 26px; border-radius: 50px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    transition: all .2s;
}
.rf-btn:hover {
    background: linear-gradient(135deg, rgba(130, 200, 255, 0.5), rgba(180, 120, 255, 0.5));
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(120, 160, 255, 0.3);
}
.rf-close {
    position: absolute; top: 12px; right: 16px;
    background: none; border: none; color: rgba(255,255,255,.6);
    font-size: 20px; cursor: pointer; line-height: 1;
}
.rf-close:hover { color: #fff; }

/* ── Диалог взросления ── */
.rf-stageup {
    border: 1px solid rgba(255,255,255,.15); border-radius: 16px;
    padding: 14px 16px; margin-bottom: 12px;
    background: rgba(255,255,255,.05);
}
.rf-stageup-head { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
.rf-stageup-head i { margin-right: 6px; opacity: .8; }
.rf-stageup-head .m { color: #4dabf7; }
.rf-stageup-head .f { color: #ff9ff3; }
.rf-stageup-lbl { font-size: 10px; opacity: .55; margin-bottom: 6px; }
.rf-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.rf-chip {
    padding: 4px 12px; border-radius: 50px; font-size: 11px; cursor: pointer;
    border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06);
    transition: all .15s; user-select: none;
}
.rf-chip:hover { border-color: rgba(130,200,255,.6); }
.rf-chip.selected {
    border-color: #82c8ff; color: #82c8ff;
    background: rgba(130,200,255,.15); font-weight: 600;
}
.rf-chip.rf-reroll { opacity: .6; }
.rf-trait-input {
    width: 100%; box-sizing: border-box;
    background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.15);
    border-radius: 10px; color: #fff; padding: 6px 10px; font-size: 12px;
}
.rf-trait-input:focus { outline: none; border-color: rgba(130,200,255,.6); }

/* ── Семейное древо ── */
.rf-tree-card { min-width: 420px; }
.rf-union { margin-bottom: 20px; }
.rf-parents { display: flex; align-items: center; justify-content: center; gap: 10px; }
.rf-parent {
    display: flex; align-items: center; gap: 7px;
    padding: 7px 16px; border-radius: 50px; font-size: 12px; font-weight: 600;
    border: 1.5px solid rgba(255,215,64,.4); color: rgba(255,235,180,.95);
    background: rgba(255,215,64,.07);
}
.rf-parent i { font-size: 11px; opacity: .8; }
.rf-heart { color: #ff6b9d; font-size: 13px; }
.rf-tree-connector {
    width: 2px; height: 14px; margin: 0 auto;
    background: rgba(255,255,255,.2);
}
.rf-children { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.rf-child {
    flex: 0 1 185px; min-width: 160px;
    border-radius: 14px; padding: 11px 13px;
    border: 1.5px solid rgba(255,255,255,.22);
    background: rgba(255,255,255,.09);
}
.rf-child[data-origin] { cursor: pointer; transition: all .15s; }
.rf-child[data-origin]:hover {
    background: rgba(130,200,255,.14);
    border-color: rgba(130,200,255,.7);
    transform: translateY(-2px);
}
.rf-child[data-origin]:hover .rf-child-edit { opacity: .9; }
.rf-child-edit {
    position: absolute; top: 7px; right: 9px;
    font-size: 10px; opacity: .35; transition: opacity .15s;
}
.rf-child { position: relative; }
.rf-child.m { border-color: rgba(77,171,247,.55); }
.rf-child.f { border-color: rgba(255,159,243,.55); }
.rf-child.expected { border-style: dashed; opacity: .85; }
.rf-child-head { font-size: 14px; font-weight: 700; margin-bottom: 3px; }
.rf-child-head .sx { margin-right: 4px; }
.rf-child.m .sx { color: #4dabf7; }
.rf-child.f .sx { color: #ff9ff3; }
.rf-child-stage { font-size: 11px; opacity: .8; margin-bottom: 6px; }
.rf-child-stage i { margin-right: 4px; opacity: .7; }
.rf-child-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.rf-child-chip {
    font-size: 10px; padding: 2px 9px; border-radius: 50px;
    border: 1px solid rgba(255,255,255,.22); opacity: .9;
}
.rf-twin-chip { border-color: rgba(255,215,64,.4); color: #ffd740; }
.rf-desig-chip { border-color: rgba(180,120,255,.5); color: #c9a0ff; font-weight: 600; }
/* Знаки зодиака — не во всех UI-шрифтах есть ♈..♓: подставляем символьный шрифт */
.rf-zsym { font-family: "Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Color Emoji", sans-serif; }
.rf-title i { margin-right: 8px; }
.rf-btn i { margin-right: 6px; }
.rf-child-look { font-size: 10px; opacity: .65; line-height: 1.4; }
.rf-child-event { margin-top: 5px; font-size: 10px; color: #82c8ff; }
.rf-child-event i { margin-right: 3px; }
.rf-child-special {
    margin-top: 5px; font-size: 10px; color: #ffd740;
}
.rf-child-special i { margin-right: 3px; }
.rf-grown-badge {
    display: inline-block; margin-top: 5px; font-size: 9px; padding: 1px 8px;
    border-radius: 50px; border: 1px solid rgba(130,230,120,.4); color: rgba(130,230,120,.95);
}
.rf-tree-stats { text-align: center; font-size: 11px; opacity: .55; margin-top: 6px; }
.rf-tree-hint { text-align: center; font-size: 10px; opacity: .45; margin-top: 3px; }
.rf-actions { display: flex; gap: 10px; justify-content: center; margin-top: 14px; }
.rf-actions .rf-btn { display: inline-block; margin: 0; }

/* ── Хроника ── */
.rf-chron-list { max-height: 56vh; overflow-y: auto; padding-right: 6px; }
.rf-chron-year {
    font-size: 12px; font-weight: 700; opacity: .6; letter-spacing: 2px;
    text-align: center; margin: 12px 0 6px;
}
.rf-chron-item {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 7px 4px; border-bottom: 1px solid rgba(255,255,255,.08);
}
.rf-chron-item:last-child { border-bottom: none; }
.rf-chron-item i { width: 18px; text-align: center; margin-top: 2px; color: #82c8ff; opacity: .9; }
.rf-chron-date { flex: 0 0 68px; font-size: 11px; opacity: .6; padding-top: 1px; }
.rf-chron-text { font-size: 13px; line-height: 1.45; }

/* ── Профиль ребёнка ── */
.rf-prof-grid {
    display: grid; grid-template-columns: 92px 1fr;
    gap: 8px 10px; align-items: center; margin-bottom: 4px;
}
.rf-prof-grid label { font-size: 11px; opacity: .7; text-align: right; }
.rf-prof-input, .rf-prof-select, .rf-prof-textarea {
    width: 100%; box-sizing: border-box;
    background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.18);
    border-radius: 10px; color: #fff; padding: 6px 10px; font-size: 12px;
    font-family: inherit;
}
.rf-prof-textarea { resize: vertical; min-height: 64px; line-height: 1.4; }
.rf-prof-input:focus, .rf-prof-select:focus, .rf-prof-textarea:focus {
    outline: none; border-color: rgba(130,200,255,.6);
}
.rf-prof-select option { background: #262b3d; }
.rf-prof-meta { text-align: center; font-size: 12px; opacity: .8; margin-bottom: 12px; }
.rf-prof-note { font-size: 10px; opacity: .45; grid-column: 2; margin-top: -4px; }
</style>`);
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
            <div class="rf-title"><i class="fa-solid fa-seedling"></i>Время летит!</div>
            <div class="rf-subtitle">${events.length === 1 ? 'Ребёнок переходит на новую стадию жизни' : 'Дети переходят на новые стадии жизни'}</div>
            ${cardsHtml}
            <button class="rf-btn rf-confirm"><i class="fa-solid fa-heart"></i> Принять</button>
        </div>
    </div>`);

    $('body').append(overlay);

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

    // Группируем детей по «второму родителю»: для юзерских детей это отец,
    // для рождённых партнёром — мать (отец там обычно сам игрок).
    const otherParentOf = (child) => (child.motherName || child.fatherName || '').trim();
    const groups = new Map();
    for (const entry of all) {
        const key = otherParentOf(entry.child);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    }
    // Ожидаемые малыши: юзерская беременность → группа отца, партнёрская → группа партнёра
    if (p.isPregnant) {
        const key = (p.fatherName || '').trim();
        if (!groups.has(key)) groups.set(key, []);
    }
    const pp = p.partner;
    const partnerPregnant = !!(pp && pp.enabled && pp.isPregnant);
    const partnerName = partnerPregnant ? (pp.name || charName || 'Партнёр') : '';
    if (partnerPregnant && !groups.has(partnerName)) {
        groups.set(partnerName, []);
    }

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

    let unionsHtml = '';
    for (const [father, entries] of groups.entries()) {
        // Сортируем детей по дате рождения (старшие слева)
        entries.sort((a, b) => {
            const am = a.child.birthRpDate ? new Date(a.child.birthRpDate).getTime() : 0;
            const bm = b.child.birthRpDate ? new Date(b.child.birthRpDate).getTime() : 0;
            return am - bm;
        });
        let childrenHtml = entries.map(childCard).join('');
        if (p.isPregnant && (p.fatherName || '').trim() === father) {
            childrenHtml += expectedCard(p, '');
        }
        if (partnerPregnant && partnerName === father) {
            childrenHtml += expectedCard(pp, partnerName);
        }
        if (!childrenHtml) continue;
        unionsHtml += `<div class="rf-union">
            <div class="rf-parents">
                <span class="rf-parent"><i class="fa-solid fa-user"></i>${escapeHtml(playerName)}</span>
                ${father ? `<span class="rf-heart">♥</span><span class="rf-parent"><i class="fa-solid fa-user"></i>${escapeHtml(father)}</span>` : ''}
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
        <div class="rf-card rf-tree-card">
            <button class="rf-close">×</button>
            <div class="rf-title"><i class="fa-solid fa-tree"></i>Семейное древо</div>
            <div class="rf-subtitle">Династия этого чата</div>
            ${unionsHtml}
            ${statsBits.length ? `<div class="rf-tree-stats">${statsBits.join(' · ')}</div>` : ''}
            ${all.length ? `<div class="rf-tree-hint"><i class="fa-solid fa-pen"></i> нажми на карточку ребёнка — профиль: внешность, черты, лор</div>` : ''}
            <div class="rf-actions">
                <button class="rf-btn rf-open-chronicle"><i class="fa-solid fa-book-open"></i>Хроника</button>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);

    const close = () => {
        overlay.css({ opacity: 0, transition: 'opacity .25s' });
        setTimeout(() => overlay.remove(), 260);
    };
    overlay.find('.rf-close').on('click', close);
    overlay.on('click', (e) => { if (e.target === overlay[0]) close(); });
    $(document).one('keydown.rfTree', (e) => { if (e.key === 'Escape') close(); });

    // Клик по карточке ребёнка → профиль (у «ожидается…» нет data-origin)
    overlay.on('click', '.rf-child[data-origin]', function() {
        const origin = $(this).attr('data-origin');
        const index = parseInt($(this).attr('data-index'));
        if (isNaN(index)) return;
        overlay.remove();
        $(document).off('keydown.rfTree');
        showChildProfile(origin, index);
    });
    overlay.find('.rf-open-chronicle').on('click', () => {
        overlay.remove();
        $(document).off('keydown.rfTree');
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
        <div class="rf-card rf-tree-card">
            <button class="rf-close">×</button>
            <div class="rf-title"><i class="fa-solid fa-book-open"></i>Семейная хроника</div>
            <div class="rf-subtitle">Вся история семьи по RP-датам${entries.length ? ` · записей: ${entries.length}` : ''}</div>
            <div class="rf-chron-list">${listHtml}</div>
            <div class="rf-actions">
                <button class="rf-btn rf-open-tree"><i class="fa-solid fa-tree"></i>Древо</button>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);
    // Свежее — внизу: мотаем ленту в конец
    const list = overlay.find('.rf-chron-list')[0];
    if (list) list.scrollTop = list.scrollHeight;

    const close = () => {
        overlay.css({ opacity: 0, transition: 'opacity .25s' });
        setTimeout(() => overlay.remove(), 260);
    };
    overlay.find('.rf-close').on('click', close);
    overlay.on('click', (e) => { if (e.target === overlay[0]) close(); });
    $(document).one('keydown.rfChron', (e) => { if (e.key === 'Escape') close(); });
    overlay.find('.rf-open-tree').on('click', () => {
        overlay.remove();
        $(document).off('keydown.rfChron');
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
            <button class="rf-close">×</button>
            <div class="rf-title"><i class="fa-solid ${child.sex === 'F' ? 'fa-child-dress' : 'fa-child'}"></i>Профиль: ${v(child.name) || 'без имени'}</div>
            <div class="rf-prof-meta">${stage ? `${stage.label} · ` : ''}${formatAgeRu(ageDays)}<span class="rf-prof-zodiac">${zodiac ? ` · <span class="rf-zsym">${zodiac.symbol}</span> ${zodiac.name}` : ''}</span></div>
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
                <button class="rf-btn rfp-back"><i class="fa-solid fa-arrow-left"></i>Древо</button>
            </div>
        </div>
    </div>`);

    $('body').append(overlay);

    // Живой пересчёт зодиака при смене даты рождения
    overlay.find('#rfp-birth').on('change', function() {
        const z = getZodiac(this.value);
        overlay.find('.rf-prof-zodiac').html(z ? ` · <span class="rf-zsym">${z.symbol}</span> ${escapeHtml(z.name)}` : '');
    });

    const close = () => {
        overlay.css({ opacity: 0, transition: 'opacity .25s' });
        setTimeout(() => overlay.remove(), 260);
    };
    overlay.find('.rf-close').on('click', close);
    overlay.on('click', (e) => { if (e.target === overlay[0]) close(); });
    $(document).one('keydown.rfProf', (e) => { if (e.key === 'Escape') close(); });

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
