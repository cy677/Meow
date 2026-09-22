/** Read-only audit for the Stage1-to-main transplant.
 * Usage: node scripts/verify_cat_motion_port.mjs <main-commit> <stage1-commit>
 * Run in a full Git checkout. It compares tree objects, never a household DB.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Only these existing files may take the reviewed Stage1 version. The rest of
// main, including models, storage, APIs, configs and dependency lock, must match.
const stageFiles = [
  'package.json', 'pet/MOTION.md', 'pet/homeRuntime.js',
  'pet/motionPrograms.mjs', 'pet/motionTimeline.js', 'pet/scene.js',
  'pet/skeletalPlayer.js', 'pet/studio.js', 'pet/studioRuntime.txt',
  'pet/tests/browser-cat-motion-stage1.mjs',
  'pet/tests/cat-motion-runtime.test.mjs',
  'pet/tests/motion-programs.test.mjs', 'pet/tests/studio-lifecycle.test.mjs',
  'pet/upstreamRewards.mjs',
  'src/catMotion/authoredPoses.js', 'src/catMotion/clipCatalog.js',
  'src/catMotion/clipPlayer.js', 'src/catMotion/index.js',
  'src/catMotion/motionController.js', 'src/catMotion/motionEvents.js',
  'src/catMotion/motionScript.js', 'src/catMotion/skeleton.js',
  'src/catMotionStateMachine.js', 'src/main.js',
  'src/mesh2motionRig.js', 'src/mesh2motionSkinRig.js',
];
const portFiles = [
  '.github/workflows/cat-motion-stage1.yml',
  'docs/cat-motion-stage1.md', 'docs/stage1-main-migration.md',
  'scripts/verify_cat_motion_port.mjs',
];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const tree = ref => new Map(git('ls-tree', '-r', '-z', ref).split('\0').filter(Boolean).map(record => {
  const tab = record.indexOf('\t');
  return [record.slice(tab + 1), record.slice(0, tab)]; // mode + type + blob SHA
}));

const [mainCommit, stageCommit, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: verify_cat_motion_port.mjs <main-commit> <stage1-commit>');
for (const ref of [mainCommit, stageCommit]) {
  assert.match(ref ?? '', /^[0-9a-f]{40}$/, 'Supply immutable full commit SHAs');
  git('cat-file', '-e', `${ref}^{commit}`);
}
const head = git('rev-parse', 'HEAD');
git('merge-base', '--is-ancestor', mainCommit, head);
// A moving main invalidates this snapshot audit; re-audit instead of silently
// claiming compatibility with a different main after somebody pushes a change.
const observedMain = git('rev-parse', 'refs/remotes/origin/main');
assert.equal(observedMain, mainCommit, 'main advanced: re-audit the port against the new main');

const main = tree(mainCommit), source = tree(stageCommit), target = tree(head);
const allowed = new Set([...stageFiles, ...portFiles]);
const changed = [];
let retainedMainFiles = 0;
for (const [path, entry] of main) {
  assert.ok(target.has(path), `main file was deleted: ${path}`);
  if (!allowed.has(path)) {
    assert.equal(target.get(path), entry, `non-Stage1 main file was changed: ${path}`);
    retainedMainFiles++;
  }
}
for (const [path, entry] of target) {
  if (entry !== main.get(path)) {
    assert.ok(allowed.has(path), `unexpected change outside the migration: ${path}`);
    changed.push(path);
  }
}
for (const path of stageFiles) {
  assert.ok(source.has(path), `Stage1 source is missing: ${path}`);
  assert.equal(target.get(path), source.get(path), `Stage1 functionality was not fully preserved: ${path}`);
}
for (const path of portFiles) assert.ok(target.has(path), `port audit/documentation missing: ${path}`);
git('diff', '--check', mainCommit, head);
const report = {
  status: 'passed', mainCommit, stageCommit, head, observedMain,
  sourceFilesPreserved: stageFiles.length, retainedMainFiles,
  changedFileCount: changed.length, changed,
  notes: 'Git tree/content audit only. Build, functional and WebGL results are separate checks. No live database was opened.',
};
mkdirSync('pet/test-results', { recursive: true });
writeFileSync('pet/test-results/stage1-main-migration.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
