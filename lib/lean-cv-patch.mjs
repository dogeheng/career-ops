// Reuse an approved base payload; the model emits only changed fields.
export function applyCvPatch(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('CV patch must be a JSON object');
  const result = structuredClone(base || {});
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe patch key');
    if (value === null) delete result[key];
    else if (typeof value === 'object' && !Array.isArray(value)) result[key] = applyCvPatch(result[key], value);
    else result[key] = structuredClone(value);
  }
  return result;
}
