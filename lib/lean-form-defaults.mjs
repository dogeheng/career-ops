import { findExperienceSections, parseCompanyHeading } from './cv-markdown.mjs';
import { normalizeQuestion, questionIdentity } from './lean-question-keys.mjs';

export const formDefaultKeys = new Set(['relocation', 'prior_application', 'prior_employment', 'current_employment', 'relatives', 'military_service']);

export function lookupUSWorkAuthorization(profile, job, question) {
  if (job.country !== 'US') return null;
  const text = normalizeQuestion(question);
  const screening = profile?.screening;
  let value;
  if (questionIdentity(question).key === 'fact:sponsorship-now-or-future' ||
      /^(?:(?:do|will) you require (?:employment )?(?:visa )?sponsorship in the future|(?:do|will) you require (?:employment )?visa sponsorship|未来(?:是否)?需要(?:雇主)?(?:提供)?\s*h-?1b\s*(?:签证)?担保)$/.test(text)) {
    value = screening?.future_sponsorship_required?.US;
  } else if (/^are you (?:currently )?(?:legally )?authori[sz]ed to work in (?:the )?(?:united states(?: of america)?|u\.?s\.?a?|country (?:where this position is based|in which this position is based))$/.test(text) ||
      /^(?:是否)?(?:有|拥有)(?:美国|u\.?s\.?)\s*(?:的)?工作授权$/.test(text)) {
    value = screening?.work_authorization?.US;
  } else if (/^(?:do you (?:currently )?have opt(?: work authorization)?|are you currently on opt|现在(?:是否)?有\s*opt)$/.test(text) && screening?.us_work_authorization_type === 'OPT') {
    value = true;
  }
  if (typeof value !== 'boolean') return null;
  return { question, value: value ? 'Yes' : 'No', scope: 'country', target: 'US', expires: null, source: 'Confirmed US work authorization profile' };
}

export function requiresEmployerEvidence(question) {
  if (question.audience === 'employer') return true;
  const text = normalizeQuestion(question.text);
  if (!/\b(?:sponsor(?:ship)?|h-?1b|opt)\b|担保|工作授权/.test(text)) return false;
  if (/是否(?:明确|确认)?(?:接受|支持|提供|允许)|如有(?:雇主|招聘方)确认/.test(text) && !/^(?:你|您)/.test(text)) return true;
  return /^is (?:visa |employment visa |h-?1b )?sponsorship (?:available|offered|supported)\b/.test(text) ||
    /^(?:does|can|will) (?!you\b|your\b|the (?:candidate|applicant)\b).+\b(?:offer|support|accept|provide|allow|sponsor)\b/.test(text);
}

export function employerKey(name) {
  return String(name ?? '').normalize('NFKC').toLowerCase().trim()
    .replace(/[,\s]+(?:incorporated|inc\.?|corporation|corp\.?|llc|ltd\.?)$/, '').trim();
}

export function employmentHistory(cv) {
  const prior = new Set(), current = new Set();
  for (const section of findExperienceSections(cv)) {
    let names = [];
    for (const line of section) {
      if (line.startsWith('### ')) {
        const heading = parseCompanyHeading(line);
        names = heading ? [heading.company, heading.company.replace(/\s+\([^)]*\)$/, '')].map(employerKey) : [];
        for (const name of names) prior.add(name);
      } else if (/^\s*[A-Za-z]{3,9}\s+\d{4}\s*(?:-|–|—|to)\s*(?:present|current|now)\s*$/i.test(line)) {
        for (const name of names) current.add(name);
      }
    }
  }
  return { prior, current };
}

function employerSubjects(subject, company) {
  if (/^(?:here|us|this (?:company|organization|employer)|our (?:company|organization)|the company)$/.test(subject)) {
    return company ? [employerKey(company)] : [];
  }
  // Employer portals can ask about their parent company and its subsidiaries.
  const group = subject.match(/^(.+?) or any (?:of its |(?:.+? )?)subsidiar(?:y|ies)(?: \(outside of (.+)\))?$/);
  if (group) {
    const excluded = employerKey(group[2]);
    return [employerKey(group[1]), employerKey(company)].filter(name => name && name !== excluded);
  }
  if (employerKey(subject) === employerKey(company) && company) return [employerKey(company)];
  if (/\b(?:and|or|but|outside|except|excluding|without|through|via|during|within|after|before|since|last|past|including|in)\b|[?;()]/.test(subject)) return [];
  return subject ? [employerKey(subject)] : [];
}

const employerQuestions = [
  ['prior_application', /^have you (?:ever |previously )?applied (?:to |at |with |for (?:a (?:job|position|role)|employment) (?:at|with) )(.+?)(?: before| in the past)?$/],
  ['prior_application', /^have you applied (here) before$/],
  ['prior_employment', /^have you (?:ever |previously )?(?:been employed by|worked (?:for|at)) (.+?)(?: before| in the past)?$/],
  ['current_employment', /^are you (?:currently employed (?:by|at)|a current employee (?:of|with|at)) (.+)$/],
  ['current_employment', /^are you currently (?:an? )?(.+?) employee$/],
  ['relatives', /^do you have (?:any |a )?(?:relatives?|family members?) (?:currently )?(?:employed (?:by|at)|working (?:for|at)|at) (.+)$/],
  ['relatives', /^are any (?:of your )?(?:relatives|family members) (?:currently )?(?:employed (?:by|at)|working (?:for|at)) (.+)$/],
];

export function lookupFormDefault(defaults, history, job, question) {
  if (!defaults) return null;
  const text = normalizeQuestion(question);
  let key, employers = [];
  if (/^(?:relocation|willingness to relocate|(?:are you|would you be) (?:willing|open) to relocat(?:e|ion)|will you relocate)(?: for (?:this (?:position|role|job|opportunity)|work))?(?:,? if (?:needed|required|necessary))?$/.test(text)) {
    key = 'relocation';
  } else if (/^(?:veteran status|protected veteran status|are you (?:a |an )?(?:protected )?(?:military )?veteran|have you (?:ever )?served in (?:the )?(?:(?:u\.s\.|us) )?(?:military|armed forces)|do you have (?:any )?military service)$/.test(text)) {
    key = 'military_service';
  } else {
    for (const [candidate, pattern] of employerQuestions) {
      const match = text.match(pattern);
      if (!match) continue;
      employers = employerSubjects(match[1], job.company);
      if (employers.length) key = candidate;
      break;
    }
  }
  if (!formDefaultKeys.has(key) || typeof defaults[key] !== 'boolean') return null;

  // A confirmed submission supersedes the user's baseline “no prior application”.
  // Documented employment similarly supersedes the negative default for that employer.
  const known = { prior_application: history?.applied, prior_employment: history?.prior, current_employment: history?.current }[key];
  const recorded = employers.some(name => known?.has(name));
  return {
    question, value: recorded || defaults[key] ? 'Yes' : 'No',
    scope: employers.length ? 'employer' : 'global', target: employers[0] || '*',
    expires: null, confirmed_at: defaults.confirmed_at,
    source: recorded ? 'Recorded application or CV employment history' : 'Explicit user-confirmed form defaults',
    form_default: key,
  };
}
