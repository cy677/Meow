import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isLeafCat, CAT_APPEARANCES, MOUTH_MODES } from '../../src/catAppearance/catalog.js';
import { sampleMouth } from '../../src/catAppearance/mouth.js';
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
test('appearance and mouth settings use the existing strict preset/studio schema', () => {
  for(const item of MOUTH_MODES){
    const params={catAppearance:'leaf',mouthMode:item.id,pose:'loaf',headSize:1.3};
    assert.deepEqual(validateStudio({params}), {params});
    assert.doesNotThrow(()=>validateFields({catAppearance:'leaf',mouthMode:item.id},PARAM_FIELDS.shape));
  }
  assert.throws(()=>validateStudio({params:{catAppearance:'foreign-body'}}));
  assert.throws(()=>validateStudio({params:{mouthMode:'execute-script'}}));
  assert.equal(fieldVisible('shape','mouthMode',{}),false);
  assert.equal(fieldVisible('shape','mouthMode',{catAppearance:'leaf'}),true);
});
test('facial channel handles open/closed, smooth cycles, clip gating and invalid data', () => {
  for(const t of [0,.1,.7,2.2,5]){
    assert.equal(sampleMouth('closed',t),0); assert.equal(sampleMouth('open',t),1);
    assert.equal(sampleMouth('auto',t,'walk',.25),0);
    const value=sampleMouth('meow',t); assert.ok(value>=0&&value<=1);
  }
  assert.ok(sampleMouth('auto',.5,'bark',.25)>.5);
  assert.ok(sampleMouth('auto',.5,'howl',.4)>.5);
  assert.equal(sampleMouth('meow',0),sampleMouth('meow',2.2));
  assert.ok(Math.abs(sampleMouth('meow',2.2-1e-6)-sampleMouth('meow',2.2+1e-6))<1e-4);
  assert.throws(()=>sampleMouth('script',0));
  assert.throws(()=>sampleMouth('open',NaN));
  assert.throws(()=>sampleMouth('open',0,'idle',Infinity));
});
test('server release includes the appearance schema dependency, without model/WebGL dependencies',()=>{
  const files=runtimeFiles(fileURLToPath(new URL('../../',import.meta.url)));
  assert.ok(files.includes('src/catAppearance/catalog.js'));
  assert.ok(!files.includes('src/catAppearance/leaf.js'));
  const updater=readFileSync(new URL('../../scripts/apply_ubuntu_update.mjs',import.meta.url),'utf8');
  assert.ok(updater.includes("'src/catAppearance/catalog.js'"));
});
