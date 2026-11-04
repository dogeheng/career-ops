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
  if (job.citizenship === 'US' || lines.some(s => /(?:must be|requires?|only|limited to).{0,25}(?:a |an )?U\.?S\.? citizen|U\.?S\.? citizenship (?:is )?required/i.test(s))) {
    if (p.us_citizen === false) add(blockers, 'citizenship', 'US citizenship required');
    else if (p.us_citizen !== true) add(questions, 'citizenship_unknown', 'US citizenship required; do not infer citizenship from OPT');
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
