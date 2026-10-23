import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const original = '1188cd11468f1322572bd0615847bac94bbf94e0';
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', original], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((p) => /\.tsx?$/.test(p));
function names(code) {
  const sf = ts.createSourceFile('source.ts', code, ts.ScriptTarget.Latest, true);
  const set = new Set();
  function walk(n) {
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) set.add(n.name.text);
    ts.forEachChild(n, walk);
  }
  walk(sf);
  return set;
}
let checked = 0;
const missing = [];
for (const file of files) {
  const before = names(execFileSync('git', ['show', original + ':' + file], { encoding: 'utf8' })),
    after = names(fs.readFileSync(file, 'utf8'));
  for (const name of before) {
    checked++;
    if (!after.has(name)) missing.push({ file, name });
  }
}
console.log(JSON.stringify({ checked, missing }, null, 2));
if (missing.length) process.exitCode = 1;
