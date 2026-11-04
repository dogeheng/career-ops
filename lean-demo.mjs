#!/usr/bin/env node
// Offline fictional candidate: proves installation and PDF generation without private data.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const code = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'career-ops-demo-'));
for (const dir of ['config', 'output']) mkdirSync(join(root, dir));
const payload = {
  lang: 'en', candidate: { name: 'Alex Example', email: 'alex@example.com' },
  education: [{ title: 'MS in Computer Science', org: 'Example University', year: '2027' }],
  experience: [{ company: 'Example Systems', role: 'Software Engineering Intern', dates: 'Jun 2026 - Aug 2026', bullets: [
    'Built a Python service with request validation, structured logs and automated integration tests.',
    'Implemented a bounded work queue with retry handling and metrics for background tasks.'
  ] }],
  projects: [{ name: 'Packet Inspector', description: 'Built a C++ packet inspection tool with reproducible benchmarks and documented test fixtures.' }],
  skills: [{ category: 'Languages', items: ['Python', 'C++', 'SQL'] }]
};
writeFileSync(join(root, 'cv.md'), '# CV — Alex Example\n\nalex@example.com\n\n## Education\nMS in Computer Science, Example University, 2027\n\n## Work Experience\n\n### Example Systems\n\n**Software Engineering Intern**\nJun 2026 - Aug 2026\n\n' + payload.experience[0].bullets.map(b => '- ' + b).join('\n') + '\n\n## Projects\n\n### Packet Inspector\n\n' + payload.projects[0].description + '\n\n## Skills\nPython, C++, SQL\n');
writeFileSync(join(root, 'config/profile.yml'), 'candidate:\n  full_name: Alex Example\n  email: alex@example.com\npipeline:\n  mode: lean\ncv:\n  template: lean\n  max_pages: 1\n  strict_pages: true\n  sections: [education, experience, projects, skills]\n');
writeFileSync(join(root, 'config/cv-facts.json'), JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));
writeFileSync(join(root, 'output/demo.json'), JSON.stringify(payload));
const env = { ...process.env, CAREER_OPS_ROOT: root };
for (const key of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_TRACKER']) delete env[key];
execFileSync(process.execPath, [resolve(code, 'lean-buildcv.mjs'), join(root, 'output/demo.json'), 'output/demo'], { cwd: code, env, stdio: 'inherit' });
console.log(JSON.stringify({ fictional_demo: true, pdf: join(root, 'output/demo.pdf'), root }));
