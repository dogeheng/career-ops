// Normalize abbreviations before sentence splitting: "U.S. citizen" is one clause.
export function restrictedEligibility(job) {
  const found = [];
  const add = (type, evidence, ambiguous = false) => found.push({ type, evidence, ambiguous });
  if (job.citizenship === 'US' || job.requires_us_citizenship === true) add('citizenship', 'US citizenship explicitly required');
  if (job.requires_green_card === true) add('permanent_residency', 'US permanent residency explicitly required');
  if (job.citizenship === 'US_or_permanent_resident') add('citizenship_or_permanent_residency', 'US citizen or permanent resident explicitly required');
  if (job.requires_security_clearance === true) add('security_clearance', 'Security clearance explicitly required');
  const clauses = String(job.text || '').replace(/\bU\.S\.(?:A\.)?/gi, 'US').split(/\n|(?<=[.!?;])\s+|\s+but\s+/i);
  for (const text of clauses) {
    const citizen = /\b(?:US\s+)?citizen(?:ship|s)?\b/i.test(text);
    const resident = /green[- ]?card|(?:lawful\s+)?permanent\s+residen(?:t|ts|cy|ce)/i.test(text);
    const clearance = /(?:(?:security|safety|secret|top[- ]secret|TS\/SCI)\s+clearance|\bTS\/SCI\b)/i.test(text);
    if (!citizen && !resident && !clearance) continue;
    const required = /\bmust\b|\brequir(?:e[sd]?|ement)\b|\bonly\b|\blimited to\b|\brestricted to\b|\bneed(?:s|ed)?\b|\b(?:ability|able) to (?:obtain|hold|maintain)\b|\bsecurity clearance(?: level)?\s*:\s*(?:active|secret|top secret|TS\/SCI)\b/i.test(text);
    const optional = /\bpreferred\b|nice[- ]to[- ]have|\boptional\b|not (?:a )?(?:requirement|necessary|required)|(?:no|not)\s+(?:\w+\s+){0,3}require(?:d|ment)?\b|\b(?:None|N\/A)\s*$/i.test(text);
    if (!required || optional) continue;
    const ambiguous = /\bmay\b|\bcould\b|depending|\brefugee|\basylee|\basylum|\bprotected individual|\bOPT\b|\bEAD\b|\bvisa holders?\b|\binternational (?:students?|applicants?)\b|\bor\b.{0,35}\bwork authori[sz]ation\b/i.test(text);
    if (citizen && resident) add('citizenship_or_permanent_residency', text.trim(), ambiguous);
    else if (citizen) add('citizenship', text.trim(), ambiguous);
    else if (resident) add('permanent_residency', text.trim(), ambiguous);
    if (clearance) add('security_clearance', text.trim(), ambiguous);
  }
  return found;
}

// Conservative, zero-model hard-constraint screen. Unknown is never a rejection.
export function screenJob(job, profile = {}) {
  const p = profile.screening || {};
  const blockers = [], questions = [];
  const add = (list, code, evidence) => list.push({ code, evidence });
  const country = job.country || null;
  const auth = country ? p.work_authorization?.[country] : null;
  const sponsor = country ? p.future_sponsorship_required?.[country] : null;
  const text = String(job.text || '');
  const lines = text.split(/\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  if (job.closed === true) add(blockers, 'closed', 'Source explicitly marks this posting closed');
  if (job.employment_type && p.employment_types?.length && !p.employment_types.includes(job.employment_type)) {
    add(blockers, 'employment_type', job.employment_type);
  }
  if (country && p.countries?.length && !p.countries.includes(country)) add(blockers, 'country', country);
  if (!country) add(questions, 'country_unknown', 'Confirm hiring country; remote is not worldwide authorization');
  // Source legends are evidence, not employer-verified facts. Recheck the JD before applying.
  const noSponsor = job.sponsorship === 'no' || lines.some(s =>
    /(?:no (?:visa )?sponsorship|(?:cannot|can\s*not|will not|do not|does not|unable to) (?:provide |offer )?sponsor|sponsorship (?:is )?(?:not available|unavailable|not (?:provided|offered))|without (?:current or future |now or in the future )?(?:visa )?sponsorship)/i.test(s));
  const noSponsorEvidence = job.sponsorship === 'no' ? 'Source legend: no sponsorship' : lines.find(s => /sponsor/i.test(s));
  if (noSponsor && sponsor === true) add(blockers, 'sponsorship', noSponsorEvidence);
  else if (noSponsor && sponsor !== false) add(questions, 'sponsorship_profile_unknown', noSponsorEvidence);
  else if (sponsor === true && job.sponsorship !== 'yes' && !lines.some(s => /(?:offer|provide|available|support).{0,25}(?:visa sponsorship|H-?1B)|(?:visa sponsorship|H-?1B).{0,25}(?:available|provided|offered|supported)/i.test(s))) {
    add(questions, 'sponsorship_unspecified', 'Future sponsorship needs confirmation; silence is not a refusal');
  }
  const localAuth = lines.find(s => /(?:must|require[sd]?|only).{0,60}(?:already|currently|existing|unrestricted).{0,30}(?:work authori[sz]ation|right to work|work permit)|(?:existing|current) (?:work permit|work authori[sz]ation).{0,30}(?:required|essential)/i.test(s));
  if (job.requires_existing_authorization === true || localAuth) {
    if (auth === false) add(blockers, 'work_authorization', localAuth || 'Existing local authorization required');
    else if (auth !== true) add(questions, 'work_authorization_unknown', localAuth || 'Existing local authorization required');
  }
  for (const r of restrictedEligibility(job)) {
    if (r.ambiguous) { add(questions, r.type + '_interpretation', r.evidence); continue; }
    if (r.type === 'citizenship') {
      if (p.exclude_citizen_only === true || ((country === 'US' || job.citizenship === 'US') && p.us_citizen === false)) add(blockers, r.type, r.evidence);
      else if (p.us_citizen !== true || country !== 'US') add(questions, 'citizenship_unknown', r.evidence);
    } else if (r.type === 'permanent_residency') {
      if (p.exclude_green_card_only === true || (country === 'US' && p.us_permanent_resident === false)) add(blockers, r.type, r.evidence);
      else if (p.us_permanent_resident !== true || country !== 'US') add(questions, 'permanent_residency_unknown', r.evidence);
    } else if (r.type === 'citizenship_or_permanent_residency') {
      if ((p.exclude_citizen_only === true && p.exclude_green_card_only === true) || (country === 'US' && p.us_citizen === false && p.us_permanent_resident === false)) add(blockers, r.type, r.evidence);
      else if (country !== 'US' || (p.us_citizen !== true && p.us_permanent_resident !== true)) add(questions, r.type + '_unknown', r.evidence);
    } else if (p.exclude_security_clearance === true) add(blockers, 'security_clearance', r.evidence);
    else add(questions, 'security_clearance_unknown', r.evidence);
  }
  if (job.min_experience_years != null) {
    if (typeof p.full_time_years !== 'number') add(questions, 'experience_profile_unknown', 'Full-time experience not confirmed');
    else if (job.min_experience_years > p.full_time_years) add(blockers, 'experience', `Explicit minimum: ${job.min_experience_years} full-time years`);
  }
  for (const line of lines) {
    const m = line.match(/(?:at least|minimum(?: of)?|must have|requires?)\s+(\d+(?:\.\d+)?)\+?\s+years?\s+(?:of\s+)?(?:(?:relevant|professional|full[- ]time|commercial|industry|non[- ]internship)\s+)*(?:work\s+)?experience/i)
      || line.match(/(\d+(?:\.\d+)?)\+?\s+years?\s+(?:of\s+)?(?:(?:relevant|professional|full[- ]time|commercial|industry|non[- ]internship)\s+)*(?:work\s+)?experience.{0,25}(?:required|minimum|essential)/i);
    if (!m) continue;
    // Preferred, degree alternatives, subject-specific and internship-counting requirements need a person.
    if (/preferred|nice[- ]to[- ]have|ideally|desirable/i.test(line)) continue;
    const ambiguous = /\bor\b|equivalent|internship|including|academic|research|with (?:a |an )?(?:master|bachelor|Ph\.?D)/i.test(line);
    if (ambiguous || !/(?:professional|full[- ]time|commercial|industry|non[- ]internship)/i.test(line)) {
      add(questions, 'experience_interpretation', line); continue;
    }
    if (typeof p.full_time_years !== 'number') add(questions, 'experience_profile_unknown', line);
    else if (Number(m[1]) > p.full_time_years) add(blockers, 'experience', line);
  }
  if (job.graduation_from || job.graduation_to) {
    if (!p.graduation_date) add(questions, 'graduation_unknown', 'Confirm graduation date');
    else if ((job.graduation_from && p.graduation_date < job.graduation_from) || (job.graduation_to && p.graduation_date > job.graduation_to)) {
      add(blockers, 'graduation_window', `${job.graduation_from || '*'} through ${job.graduation_to || '*'}`);
    }
  }
  if (job.latest_start_date && p.available_from && job.latest_start_date < p.available_from) add(blockers, 'start_date', `Must start by ${job.latest_start_date}`);
  if (job.metadata_only !== false) add(questions, 'jd_required', 'Repository metadata only; read the employer JD before building a CV');
  const unique = list => [...new Map(list.map(x => [`${x.code}:${x.evidence}`, x])).values()];
  return { status: blockers.length ? 'skip' : questions.length ? 'needs-review' : 'pass', blockers: unique(blockers), questions: unique(questions) };
}
