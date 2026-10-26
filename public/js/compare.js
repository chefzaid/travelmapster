// Comparing two travelers' countries (ADR 0028): been to by both, by one only, by the other
// only, each list sorted by name. Pure, unit tested in Node.

/** `mine` and `theirs` are sets of map codes; `nameOf(id)` names a country. */
export function compareCountries(mine, theirs, nameOf) {
    const byName = ids => [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return {
        both: byName([...mine].filter(id => theirs.has(id))),
        onlyMine: byName([...mine].filter(id => !theirs.has(id))),
        onlyTheirs: byName([...theirs].filter(id => !mine.has(id)))
    };
}
