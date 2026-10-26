// The passport's yearly goals: progress toward each, setting, changing and removing them, and
// the celebration when one is reached. The counting is in goals.js.
import { h, toast, formDialog } from './ui.js';
import { GOAL_KINDS, goalKey, goalLabel, goalProgress } from './goals.js';
import { celebrate } from './confetti.js';

function progressOf(ctx) {
    const { markers, stats, user } = ctx.state;
    return goalProgress(user?.goals, markers, { countryOf: marker => stats.markerCountry.get(marker.id), countedIds: stats.countedIds });
}

/**
 * Celebrates goals reached since the last call; returns the keys reached now. The first call
 * after signing in (`previous` null) only records them.
 */
export function celebrateGoals(ctx, previous) {
    const progress = progressOf(ctx);
    const reached = new Set(progress.filter(goal => goal.reached).map(goalKey));
    if (previous) {
        for (const goal of progress.filter(item => item.reached && !previous.has(goalKey(item)))) {
            celebrate();
            toast(`Goal reached: ${goalLabel(goal)}! 🎯`, { tone: 'success', duration: 5000 });
        }
    }
    return reached;
}

async function goalDialog(ctx, goal) {
    const goals = ctx.state.user.goals || [];
    const values = await formDialog({
        title: goal ? 'Change the goal' : 'Set a goal',
        message: 'Goals count dated visits: countries and cities first visited in the year, or every trip begun in it.',
        submitLabel: goal ? 'Save goal' : 'Set goal',
        fields: [
            { name: 'target', label: 'How many?', type: 'number', value: goal?.target ?? 3, required: true, min: 1, max: 999 },
            { name: 'kind', label: 'Of what?', type: 'select', value: goal?.kind || 'countries',
                options: Object.entries(GOAL_KINDS).map(([value, words]) => ({ value, label: `${words.icon} ${words.many}` })) },
            { name: 'year', label: 'In which year?', type: 'number', value: goal?.year ?? new Date().getFullYear(), required: true, min: 2000, max: 2100 }
        ]
    });
    if (!values) return;
    const next = { year: Number(values.year), kind: values.kind, target: Number(values.target) };
    // One goal per kind and year: a new one replaces the old.
    const kept = goals.filter(item => goalKey(item) !== goalKey(next) && (!goal || goalKey(item) !== goalKey(goal)));
    await ctx.saveSettings({ goals: [...kept, next] }, `Goal set: ${goalLabel(next)}.`);
}

async function removeGoal(ctx, goal) {
    const goals = ctx.state.user.goals || [];
    await ctx.saveSettings({ goals: goals.filter(item => goalKey(item) !== goalKey(goal)) }, 'Goal removed.');
}

function goalStatus(goal, thisYear) {
    if (goal.reached) return `Reached: ${goal.count} of ${goal.target} 🎉`;
    if (goal.year < thisYear) return `${goal.count} of ${goal.target}, the year is over`;
    return `${goal.count} of ${goal.target} so far`;
}

export function goalsSection(ctx) {
    const progress = progressOf(ctx);
    const thisYear = new Date().getFullYear();
    return h('section', { id: 'goals', 'aria-labelledby': 'goals-title' },
        h('h3', { class: 'section-title', id: 'goals-title' }, 'Goals', h('span', { class: 'count' }, progress.length)),
        progress.length ? h('ul', { class: 'ledger-list' }, progress.map(goal => h('li', { class: 'ledger-item' },
            h('span', { class: 'ledger-item-text' },
                h('strong', {}, `${GOAL_KINDS[goal.kind].icon} ${goalLabel(goal)}`),
                h('span', {
                    class: 'meter',
                    role: 'progressbar',
                    'aria-valuemin': '0',
                    'aria-valuemax': String(goal.target),
                    'aria-valuenow': String(Math.min(goal.count, goal.target)),
                    'aria-label': `${goalLabel(goal)}: ${goal.count} so far`
                }, h('span', { style: `width:${goal.percent}%` })),
                h('small', {}, goalStatus(goal, thisYear))
            ),
            h('span', { class: 'ledger-item-actions' },
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Change the goal ${goalLabel(goal)}`, title: 'Change', onclick: () => goalDialog(ctx, goal) }, '✏️'),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove the goal ${goalLabel(goal)}`, title: 'Remove', onclick: () => removeGoal(ctx, goal) }, '🗑️')
            )
        ))) : h('p', { class: 'muted small' }, 'Set a goal for the year, such as three new countries, and watch it fill up.'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => goalDialog(ctx) }, '＋ Set a goal')
    );
}
