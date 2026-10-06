#!/usr/bin/env node
// Kiểm adapter còn khớp framework sau khi update/đổi:
//  1. root tồn tại; 2. version submodule khớp pinned_tag; 3. mọi đường dẫn trong mapping còn tồn tại.
// Dùng: node check-adapter.mjs   (chạy ở thư mục gốc repo)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const adapterDir = '.claude/sdlc/adapter';
const errors = [];

const active = readFileSync(join(adapterDir, 'active.md'), 'utf8');
const fm = Object.fromEntries(
  (active.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '')
    .split(/\r?\n/)
    .map((l) => l.match(/^(\w+):\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

for (const k of ['framework', 'mapping', 'root', 'pinned_tag']) {
  if (!fm[k]) errors.push(`active.md thiếu trường ${k}`);
}

if (fm.root) {
  if (!existsSync(fm.root)) {
    errors.push(`root không tồn tại: ${fm.root} (đã chạy git submodule update --init?)`);
  } else {
    let inGit = true;
    try {
      execFileSync('git', ['-C', fm.root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    } catch {
      inGit = false;
      console.warn(`CẢNH BÁO: ${fm.root} không phải git checkout, bỏ qua kiểm tag.`);
    }
    if (inGit) try {
      const tag = execFileSync('git', ['-C', fm.root, 'describe', '--tags', '--exact-match'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (tag !== fm.pinned_tag) errors.push(`submodule đang ở ${tag}, active.md ghi ${fm.pinned_tag}`);
    } catch {
      errors.push(`submodule không đứng đúng trên một tag (pinned_tag: ${fm.pinned_tag})`);
    }
  }
}

if (fm.mapping && fm.root) {
  const mappingPath = join(adapterDir, fm.mapping);
  if (!existsSync(mappingPath)) errors.push(`không thấy ${mappingPath}`);
  else {
    const paths = new Set();
    for (const line of readFileSync(mappingPath, 'utf8').split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const readCell = line.split('|')[2] ?? ''; // chỉ cột "Đọc"; cột "Kit tự làm" là file của kit
      for (const m of readCell.matchAll(/`([^`]+\.(?:md|json|yml|yaml|sh|ps1|py))`/g)) paths.add(m[1]);
    }
    for (const p of paths) {
      if (!existsSync(join(fm.root, p))) errors.push(`mapping trỏ tới file không còn: ${p}`);
    }
    console.log(`Đã kiểm ${paths.size} đường dẫn trong ${fm.mapping}.`);
  }
}

// tham chiếu phụ (luật giao diện): thư mục tồn tại và đứng đúng tag đã ghim
if (fm.ui_reference) {
  if (!existsSync(join(fm.ui_reference, 'skills/ui-ux/SKILL.md'))) {
    errors.push(`ui_reference không tồn tại hoặc thiếu skills/ui-ux/SKILL.md: ${fm.ui_reference} (đã chạy git submodule update --init?)`);
  } else if (fm.ui_reference_tag) {
    try {
      const tag = execFileSync('git', ['-C', fm.ui_reference, 'describe', '--tags', '--exact-match'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (tag !== fm.ui_reference_tag) errors.push(`ui_reference đang ở ${tag}, active.md ghi ${fm.ui_reference_tag}`);
    } catch {
      errors.push(`ui_reference không đứng đúng trên một tag (ui_reference_tag: ${fm.ui_reference_tag})`);
    }
  }
}

// cột Skill của mapping khớp các skill sdlc-* có thật, cả hai chiều
if (fm.mapping) {
  const mappingPath = join(adapterDir, fm.mapping);
  if (existsSync(mappingPath)) {
    const mapped = [];
    for (const line of readFileSync(mappingPath, 'utf8').split(/\r?\n/)) {
      if (!line.startsWith('|') || /^\|\s*(Phase của kit|-)/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length >= 5) mapped.push(cells.at(-1));
    }
    const skillsDir = '.claude/skills';
    for (const s of mapped) if (!existsSync(join(skillsDir, s, 'SKILL.md'))) errors.push(`mapping: cột Skill "${s}" không có ${skillsDir}/${s}/SKILL.md`);
    const dup = mapped.filter((s, i) => mapped.indexOf(s) !== i);
    if (dup.length) errors.push(`mapping: skill xuất hiện nhiều lần ở cột Skill: ${[...new Set(dup)].join(', ')}`);
    if (existsSync(skillsDir)) {
      for (const d of readdirSync(skillsDir)) {
        if (d.startsWith('sdlc-') && !mapped.includes(d)) errors.push(`skill ${d} chưa có dòng nào trong ${fm.mapping}`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: adapter ${fm.framework}@${fm.pinned_tag} khớp.`);
