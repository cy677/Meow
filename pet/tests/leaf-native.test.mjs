import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isLeafCat, CAT_APPEARANCES, LEGACY_MOUTH_VALUES } from '../../src/catAppearance/catalog.js';
import { sampleExpression } from '../../src/catMotion/expression.js';
import { validateStudio } from '../studioSchema.mjs';
import { PARAM_FIELDS, defaultsFor, fieldVisible } from '../presetSchema.mjs';
import { validateFields } from '../validation.mjs';
import { runtimeFiles } from '../../scripts/runtimeFiles.mjs';
import { fileURLToPath } from 'node:url';

test('leaf is an opt-in native appearance; legacy parameters remain native', () => {
  assert.equal(isLeafCat({}), false); assert.equal(isLeafCat({catAppearance:'native'}), false);
  assert.equal(isLeafCat({catAppearance:'leaf'}), true);
  assert.equal(defaultsFor('shape').catAppearance, 'native');
  assert.deepEqual(CAT_APPEARANCES.map(x=>x.id), ['native','leaf']);
  const source=readFileSync(new URL('../../src/catBuilder.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/return\s+buildLeafCat|pose\s*:\s*['"]reference/);
  assert.ok(source.includes('if (leafAppearance) decorateLeafCat(cat,'));
});
test('legacy mouth fields load but are removed from new studio output and never exposed', () => {
  assert.ok(!PARAM_FIELDS.shape.some(f=>f.key==='mouthMode'));
  assert.ok(!Object.hasOwn(defaultsFor('shape'), 'mouthMode'));
  for(const value of LEGACY_MOUTH_VALUES){
    const params={catAppearance:'leaf',mouthMode:value,pose:'loaf',headSize:1.3};
    assert.deepEqual(validateStudio({params}), {params:{catAppearance:'leaf',pose:'loaf',headSize:1.3}});
    assert.equal(params.mouthMode,value); // No mutation of old snapshots.
    assert.doesNotThrow(()=>validateFields({catAppearance:'leaf',mouthMode:value},PARAM_FIELDS.shape));
  }
  assert.throws(()=>validateStudio({params:{catAppearance:'foreign-body'}}));
  assert.throws(()=>validateStudio({params:{catAppearance:'leaf',mouthMode:'execute-script'}}));
  assert.equal(fieldVisible('shape','mouthMode',{}),false);
  assert.equal(fieldVisible('shape','mouthMode',{catAppearance:'leaf'}),false);
  const main=readFileSync(new URL('../../src/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/口型动作|mouthSelect|setMouthMode|mouthMode:/);
});
test('mouth comes from clip phases or closed static poses, never the wall clock', () => {
  for(const pose of ['sit','loaf','sleeping','standing']){
    assert.equal(sampleExpression(null,0,1,pose).mouthOpen,0);
  }
  assert.equal(sampleExpression(null,0,1,'stretch').mouthOpen,.25);
  for(const action of ['walk','run','sneak','sit','idle','jump','rest-pose']){
    for(let p=0;p<=1;p+=.05)assert.equal(sampleExpression(action,p).mouthOpen,0);
  }
  assert.ok(sampleExpression('bark',.2).mouthOpen>.5);
  assert.ok(sampleExpression('howl',.4).mouthOpen>.5);
  assert.ok(sampleExpression('bite',.25).mouthOpen>.5);
  assert.equal(sampleExpression('bite',.5).mouthOpen,0);
  assert.ok(sampleExpression('stretch',.5).mouthOpen>.4);
  for(const action of ['bark','howl','bite','fetch','stretch']){
    assert.equal(sampleExpression(action,0).mouthOpen,0);
    assert.equal(sampleExpression(action,1).mouthOpen,0);
    for(let p=0;p<=1;p+=.01)assert.ok(sampleExpression(action,p).mouthOpen>=0&&sampleExpression(action,p).mouthOpen<=1);
  }
  assert.throws(()=>sampleExpression('bark',NaN));
  assert.throws(()=>sampleExpression('bark',0,Infinity));
});
test('server release includes the appearance schema dependency, without model/WebGL dependencies',()=>{
  const files=runtimeFiles(fileURLToPath(new URL('../../',import.meta.url)));
  assert.ok(files.includes('src/catAppearance/catalog.js'));
  assert.ok(!files.includes('src/catAppearance/leaf.js'));
  const updater=readFileSync(new URL('../../scripts/apply_ubuntu_update.mjs',import.meta.url),'utf8');
  assert.ok(updater.includes("'src/catAppearance/catalog.js'"));
});
