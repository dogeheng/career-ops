import { decodeEntities } from '../providers/_html-entities.mjs';
import { normalizeUrl } from '../url-key.mjs';

export const JOB_SOURCES = [
  { id: '2027-swe-college-jobs', repo: 'https://github.com/speedyapply/2027-SWE-College-Jobs.git', branch: 'main', files: ['NEW_GRAD_USA.md', 'NEW_GRAD_INTL.md'] },
  { id: 'new-grad-positions', repo: 'https://github.com/SimplifyJobs/New-Grad-Positions.git', branch: 'dev', files: ['README.md'] },
];
export const clean = value => decodeEntities(String(value).replace(/<\/?br\s*\/?>/gi, ', ').replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '')).replace(/\s+/g, ' ').trim();
function links(s) {
  return [...s.matchAll(/href=["'](https?:\/\/[^"']+)["']|\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi)].map(m => decodeEntities(m[1] || m[2]));
}
export function countryOf(location, defaultCountry = null) {
  const rules = [
    ['US', /\b(?:USA|United States|US)\b|,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/],
    ['CA', /\b(?:Canada|Toronto|Vancouver|Montreal|Waterloo|Ottawa|Calgary)\b|,\s*(?:ON|BC|QC|AB)\b/],
    ['SG', /\bSingapore\b/], ['AU', /\b(?:Australia|Sydney|Melbourne|Brisbane|Canberra|Perth)\b/],
    ['GB', /\b(?:United Kingdom|UK|London|Cambridge, UK|Edinburgh|Manchester|Hatfield)\b/],
    ['IE', /\b(?:Ireland|Dublin)\b/], ['DE', /\b(?:Germany|Berlin|Munich|München|Hamburg)\b/],
    ['FR', /\b(?:France|Paris)\b/], ['NL', /\b(?:Netherlands|Amsterdam|Eindhoven)\b/],
    ['CH', /\b(?:Switzerland|Zurich|Zürich|Geneva)\b/], ['NZ', /\b(?:New Zealand|Auckland|Wellington)\b/],
    ['JP', /\b(?:Japan|Tokyo)\b/], ['DK', /\b(?:Denmark|Copenhagen)\b/], ['FI', /\b(?:Finland|Helsinki)\b/],
    ['IS', /\b(?:Iceland|Reykjavik)\b/], ['NO', /\b(?:Norway|Oslo)\b/], ['SE', /\b(?:Sweden|Stockholm)\b/],
    ['IN', /\b(?:India|Bangalore|Bengaluru|Hyderabad|Pune|Chennai|Mumbai|Gurugram)\b/],
    ['CN', /\b(?:China|Beijing|Shanghai|Shenzhen)\b/], ['MX', /\b(?:Mexico|Guadalajara)\b/],
    ['PL', /\b(?:Poland|Warsaw|Krakow)\b/], ['ES', /\b(?:Spain|Madrid|Barcelona)\b/],
  ];
  const matches = rules.filter(([, re]) => re.test(location)).map(([code]) => code);
  if (matches.length) return matches.length === 1 ? matches[0] : null;
  // Recognize explicit country names outside the shortlist too, without guessing from a city.
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const codes = 'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
  const named = codes.filter(code => {
    const name = names.of(code);
    return name && new RegExp('(?:^|[^A-Za-z])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^A-Za-z])', 'i').test(location);
  });
  return named.length === 1 ? named[0] : named.length ? null : defaultCountry;
}

// Handles both sources' current formats: SpeedyApply Markdown and Simplify HTML.
export function parseSource(text, source, filename) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('|')) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      const posting = cells.length === 5 ? 3 : 4;
      if (cells.length >= 5 && links(cells[posting]).length) rows.push(cells.length === 5 ? [cells[0], cells[1], cells[2], '', cells[3], cells[4]] : cells);
    }
  }
  for (const m of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
    if (cells.length >= 5) rows.push([cells[0], cells[1], cells[2], '', cells[3], cells[4]]);
  }
  let previousCompany = '';
  return rows.flatMap(cells => {
    let company = clean(cells[0]);
    if (company === '↳') company = previousCompany;
    else previousCompany = company;
    const urls = links(cells[4]);
    const url = urls.find(u => { try { return !/(?:^|\.)simplify\.jobs$/i.test(new URL(u).hostname); } catch { return false; } }) || urls[0];
    if (!url || !company) return [];
    const all = cells.join(' ');
    const location = clean(cells[2]);
    const title = clean(cells[1]);
    return [{ company: company.replace(/[🔥🛂🇺🇸🎓]/gu, '').trim(), title, location, url,
      key: normalizeUrl(url), country: countryOf(location, filename === 'NEW_GRAD_USA.md' ? 'US' : null),
      employment_type: /\bintern(?:ship)?\b/i.test(title) ? 'internship' : 'fulltime',
      sponsorship: all.includes('🛂') ? 'no' : 'unknown', citizenship: all.includes('🇺🇸') ? 'US' : null,
      closed: all.includes('🔒'), metadata_only: true,
      age_days: /^\d+d$/.test(clean(cells[5])) ? Number(clean(cells[5]).slice(0, -1)) : null,
      source: { id: source.id, file: filename },
    }];
  });
}

export function deduplicateJobs(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    if (!job.key) continue;
    const old = byKey.get(job.key);
    if (!old) byKey.set(job.key, { ...job, sources: [job.source] });
    else {
      old.sources.push(job.source);
      // A live entry in either source keeps this as unconfirmed rather than closed.
      old.closed = old.closed && job.closed;
      if (job.sponsorship === 'no') old.sponsorship = 'no';
      if (job.citizenship === 'US') old.citizenship = 'US';
      if (old.country !== job.country && job.country) old.country = null;
      if (old.age_days == null || (job.age_days != null && job.age_days < old.age_days)) old.age_days = job.age_days;
    }
  }
  return [...byKey.values()];
}
