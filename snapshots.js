// Rollback state must never contain another rollback cache. In particular, do
// not deep-clone legacy caches before excluding them: they can be very large.
export const HISTORY_CAP = 25;
const CACHE_KEYS = ['_history', '_undoSnapshot', '_turnBaseline'];
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function withoutCaches(value) {
    const result = { ...value };
    for (const key of CACHE_KEYS) delete result[key];
    return result;
}

export function snapshotState(state) {
    const result = withoutCaches(state);
    if (isRecord(result.partner)) result.partner = withoutCaches(result.partner);
    return structuredClone(result);
}

function stripCaches(state) {
    if (!isRecord(state)) return false;
    let changed = false;
    for (const key of CACHE_KEYS) {
        if (Object.hasOwn(state, key)) {
            delete state[key];
            changed = true;
        }
    }
    return changed;
}

// Mutate only cache fields in known state records. Do not visit discarded
// subtrees or walk children/milestones: those are gameplay data, not caches.
export function compactRollbackData(state) {
    if (!isRecord(state)) return false;
    let changed = stripCaches(state.partner);
    if (Array.isArray(state._history) && state._history.length > HISTORY_CAP) {
        state._history.splice(0, state._history.length - HISTORY_CAP);
        changed = true;
    }
    const checkpoints = [state._undoSnapshot, state._turnBaseline];
    if (Array.isArray(state._history)) checkpoints.push(...state._history);
    for (const checkpoint of checkpoints) {
        // Guard malformed self-references without treating the live state as a snapshot.
        if (!isRecord(checkpoint?.state) || checkpoint.state === state) continue;
        changed = stripCaches(checkpoint.state) || changed;
        changed = stripCaches(checkpoint.state.partner) || changed;
    }
    return changed;
}

// Called once on settings load, including chats that are not currently open.
export function compactSettingsSnapshots(settings) {
    if (!isRecord(settings?.chatPregnancyData)) return false;
    let changed = false;
    for (const state of Object.values(settings.chatPregnancyData)) {
        changed = compactRollbackData(state) || changed;
    }
    return changed;
}
