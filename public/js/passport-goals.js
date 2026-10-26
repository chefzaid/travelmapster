// The passport's yearly goals: progress toward each, setting, changing and removing them, and
// the celebration when one is reached. The counting is in goals.js.
import { h, toast, formDialog } from './ui.js';
import { GOAL_KINDS, goalKey, goalLabel, goalProgress } from './goals.js';
import { celebrate } from './confetti.js';
import { t } from './i18n.js';

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
            toast(t('Goal reached: {goal}! 🎯', { goal: goalLabel(goal) }), { tone: 'success', duration: 5000 });
        }
    }
    return reached;
}

async function goalDialog(ctx, goal) {
    const goals = ctx.state.user.goals || [];
    const values = await formDialog({
        title: goal ? t('Change the goal') : t('Set a goal'),
        message: t('Goals count dated visits: countries and cities first visited in the year, or every trip begun in it.'),
        submitLabel: goal ? t('Save goal') : t('Set goal'),
        fields: [
            { name: 'target', label: t('How many?'), type: 'number', value: goal?.target ?? 3, required: true, min: 1, max: 999 },
            { name: 'kind', label: t('Of what?'), type: 'select', value: goal?.kind || 'countries',
                options: Object.entries(GOAL_KINDS).map(([value, words]) => ({ value, label: `${words.icon} ${words.name}` })) },
            { name: 'year', label: t('In which year?'), type: 'number', value: goal?.year ?? new Date().getFullYear(), required: true, min: 2000, max: 2100 }
        ]
    });
    if (!values) return;
    const next = { year: Number(values.year), kind: values.kind, target: Number(values.target) };
    // One goal per kind and year: a new one replaces the old.
    const kept = goals.filter(item => goalKey(item) !== goalKey(next) && (!goal || goalKey(item) !== goalKey(goal)));
    await ctx.saveSettings({ goals: [...kept, next] }, t('Goal set: {goal}.', { goal: goalLabel(next) }));
}

async function removeGoal(ctx, goal) {
    const goals = ctx.state.user.goals || [];
    await ctx.saveSettings({ goals: goals.filter(item => goalKey(item) !== goalKey(goal)) }, t('Goal removed.'));
}

function goalStatus(goal, thisYear) {
    const values = { count: goal.count, target: goal.target };
    if (goal.reached) return t('Reached: {count} of {target} 🎉', values);
    if (goal.year < thisYear) return t('{count} of {target}, the year is over', values);
    return t('{count} of {target} so far', values);
}

export function goalsSection(ctx) {
    const progress = progressOf(ctx);
    const thisYear = new Date().getFullYear();
    return h('section', { id: 'goals', 'aria-labelledby': 'goals-title' },
        h('h3', { class: 'section-title', id: 'goals-title' }, t('Goals'), h('span', { class: 'count' }, progress.length)),
        progress.length ? h('ul', { class: 'ledger-list' }, progress.map(goal => h('li', { class: 'ledger-item' },
            h('span', { class: 'ledger-item-text' },
                h('strong', {}, `${GOAL_KINDS[goal.kind].icon} ${goalLabel(goal)}`),
                h('span', {
                    class: 'meter',
                    role: 'progressbar',
                    'aria-valuemin': '0',
                    'aria-valuemax': String(goal.target),
                    'aria-valuenow': String(Math.min(goal.count, goal.target)),
                    'aria-label': t('{goal}: {count} so far', { goal: goalLabel(goal), count: goal.count })
                }, h('span', { style: `width:${goal.percent}%` })),
                h('small', {}, goalStatus(goal, thisYear))
            ),
            h('span', { class: 'ledger-item-actions' },
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Change the goal {goal}', { goal: goalLabel(goal) }), title: t('Change'), onclick: () => goalDialog(ctx, goal) }, '✏️'),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove the goal {goal}', { goal: goalLabel(goal) }), title: t('Remove'), onclick: () => removeGoal(ctx, goal) }, '🗑️')
            )
        ))) : h('p', { class: 'muted small' }, t('Set a goal for the year, such as three new countries, and watch it fill up.')),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => goalDialog(ctx) }, t('＋ Set a goal'))
    );
}
