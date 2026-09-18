/** Source-level scenario estimate only: Tavern activation and macro expansion
 * require a separate wire capture. A constant entry is counted exactly once. */
export function estimateWorldbookScenario(rows, config, extraNames = [], role = 'update') {
  const names = new Set(rows.filter(row => row.role === role && config[row.name]?.constant === true
    && config[row.name]?.enabled !== false).map(row => row.name));
  for (const name of extraNames) names.add(name);
  return rows.filter(row => row.role === role && names.has(row.name) && config[row.name]?.enabled !== false);
}
