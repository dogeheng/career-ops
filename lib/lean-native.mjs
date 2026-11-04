import { shortlist } from '../lean-ingest.mjs';

export const NATIVE_LABEL = 'io.careerops.job-ingestion';
export const NEW_YORK_TIMES = [[10, 20], [13, 30]];

// launchd calendar intervals use the system zone; convert the requested NY wall times.
export function localSchedule(zone, date = new Date()) {
  const parts = (timeZone, value) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const d = parts('America/New_York', date);
  return NEW_YORK_TIMES.map(([hour, minute]) => {
    let instant = new Date(Date.UTC(d.year, d.month - 1, d.day, hour, minute));
    for (let i = 0; i < 3; i++) {
      const ny = parts('America/New_York', instant);
      const delta = Date.UTC(d.year, d.month - 1, d.day, hour, minute) - Date.UTC(ny.year, ny.month - 1, ny.day, ny.hour, ny.minute);
      instant = new Date(instant.getTime() + delta);
    }
    const local = parts(zone, instant);
    return { Hour: local.hour, Minute: local.minute };
  });
}

export function nativeManifest({ node, codeRoot, dataRoot, logDir, zone }) {
  return {
    Label: NATIVE_LABEL,
    ProgramArguments: [node, codeRoot + '/lean-native-run.mjs'],
    WorkingDirectory: codeRoot,
    EnvironmentVariables: { CAREER_OPS_ROOT: dataRoot, PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' },
    StartCalendarInterval: localSchedule(zone),
    ProcessType: 'Background', LowPriorityIO: true,
    RunAtLoad: false, KeepAlive: false,
    StandardOutPath: logDir + '/stdout.log', StandardErrorPath: logDir + '/stderr.log',
  };
}

export function collectNewCandidates(previous, queue, now = new Date().toISOString()) {
  const seen = new Set(previous.seen_keys || []);
  const candidates = shortlist(queue);
  const eligible = new Map(candidates.map(j => [j.key, j]));
  const pending = new Map((previous.pending || []).filter(j => eligible.has(j.key)).map(j => [j.key, j]));
  for (const j of candidates) if (!seen.has(j.key)) pending.set(j.key, { key: j.key, company: j.company, title: j.title, country: j.country, url: j.url });
  return { ...previous, seen_keys: queue.map(j => j.key), pending: [...pending.values()], last_success_at: now };
}
