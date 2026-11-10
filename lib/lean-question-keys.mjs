export function normalizeQuestion(text) {
  return text.normalize('NFKC').trim().toLowerCase()
    .replace(/\s+/g, ' ').replace(/[?*.:]+$/, '').trim()
    .replace(/\s*\(select (?:one|an option)\)$/, '').replace(/[?*.:]+$/, '').trim();
}

// Curated equivalents preserve the question's subject, time frame and legal qualifiers.
// A country name is a different fact from eligibility under an export-control rule.
const facts = [
  ['citizenship-country', 'global', [
    'In which country/region do you have citizenship?',
    'What is your country of citizenship?',
    'Country/region of citizenship',
  ]],
  ['permanent-residence-after-citizenship', 'global', [
    'Since obtaining your most recent citizenship, did you afterwards become a permanent resident in any other country/region? This does not include temporary statuses such as student visas or time-limited work permits.',
    'Since obtaining your most recent citizenship, did you become a permanent resident in another country or region? This excludes temporary statuses such as student visas or time-limited work permits.',
  ], true],
  ['latest-citizenship-or-residence-for-export', 'employer', [
    'For the sole purpose of determining export licensing requirements, please provide your country of citizenship or legal permanent residence, whichever was obtained last.',
    'For export licensing purposes, what is your country of citizenship or legal permanent residence, whichever was obtained most recently?',
  ]],
  ['sponsorship-now-or-future', 'country', [
    'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status, spouse visa, etc)?',
    'Will you now or in the future require visa sponsorship?',
    'Do you require visa sponsorship now or in the future?',
  ], true],
  ['platform-years-active', 'employer', ['How many years have you been active on the platform?'], false, 30],
  ['creator-economy-experience-beyond-twitch', 'employer', ['Do you have experience in the Creator Economy beyond Twitch?'], true],
  ['amazon-employment-restriction', 'employer', ['Are you subject to a non-competition agreement or other agreement that would preclude or restrict your employment at Amazon?'], true, 30],
  ['prior-h1b-within-six-years', 'employer', ['Have you held H-1B status, or had an H-1B petition approved on your behalf, within the preceding 6 years for an employer other than a cap exempt institution?'], true, 30],
  ['twitch-future-opportunities', 'employer', ['Would you like to be considered for future opportunities at Twitch when you apply?'], true],
  ['amazon-leo-export-control', 'employer', ['Do you satisfy Amazon Leo export control eligibility: U.S. citizen or national, U.S. permanent resident, lawfully admitted refugee, or granted asylum?'], true],
];

const aliases = new Map(facts.flatMap(([key, scope, labels, boolean = false, maxAgeDays]) =>
  labels.map(label => [normalizeQuestion(label), { key: `fact:${key}`, scope, boolean, maxAgeDays }])));

export function questionIdentity(text) {
  const normalized = normalizeQuestion(text);
  return aliases.get(normalized) || { key: `text:${normalized}` };
}

export function reusableFactKey(job, text) {
  const { key, scope } = questionIdentity(text);
  const target = { global: '*', employer: job.company, country: job.country }[scope];
  return target ? JSON.stringify([key, target]) : null;
}

export function reusableValue(identity, value) {
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (identity.boolean) {
    if (/^(?:yes|是|有|是的)$/.test(normalized)) return 'yes';
    if (/^(?:no|否|没有|不是)$/.test(normalized)) return 'no';
    return null;
  }
  if (!normalized || /^(?:n\/?a|unknown|not sure|i don't know|prefer not to (?:disclose|answer)|decline to (?:disclose|answer)|不知道|不确定|不愿透露|我自己填)$/.test(normalized)) return null;
  return normalized;
}
