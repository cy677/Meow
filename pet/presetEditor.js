import { DEFAULT_PARAMS, validateFields, validateCatalog } from './catalog.mjs';
import { PARAM_FIELDS, ACTION_FIELD, MOTION_FIELDS, CATEGORY_LABELS, defaultsFor, fieldVisible } from './presetSchema.mjs';
import './preset.css';

const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const newId = () => 'custom-' + Array.from(crypto.getRandomValues(new Uint8Array(10)), n => n.toString(16).padStart(2, '0')).join('');

/** The preview is isolated from the child's equipment and never writes until Save. */
export function createPresetEditor({ api, onSaved }) {
  const dialog = node('dialog', 'preset-dialog');
  dialog.id = 'preset-dialog'; dialog.setAttribute('aria-labelledby', 'preset-heading');
  dialog.innerHTML = `
    <header class="preset-heading"><div><span class="eyebrow">PARENT PRESET STUDIO</span><h2 id="preset-heading">奖励预设编辑器</h2></div><button type="button" class="button small" id="preset-close">关闭</button></header>
    <form id="preset-form"><fieldset id="preset-fieldset"><div class="preset-layout"><div class="preset-controls">
      <div class="form-grid"><label>奖励名称<input name="title" maxlength="30" required></label><label>奖励类别<select name="category"></select></label></div>
      <label>奖励说明<textarea name="description" maxlength="140" rows="2" required></textarea></label>
      <div class="form-grid"><label>解锁所需累计积分<input name="unlockAt" type="number" min="0" max="1000000" step="1" value="10" required></label><label>兑换消耗积分<input name="cost" type="number" min="0" max="1000000" step="1" value="10" required></label></div>
      <p id="preset-rule" class="note"></p>
      <div class="panel-title"><h3>调整小猫参数</h3><button type="button" id="preset-reset" class="button small">重置参数</button></div>
      <div id="preset-fields"></div>
      <p class="note">姿态使用原作已有造型；跳跃、转圈是整体互动，不是新骨骼动画。预览不会扣分或替孩子换装。</p>
      <label class="preset-id">固定 ID（自动生成）<input name="id" readonly></label>
    </div><aside class="preset-preview-panel"><div class="panel-title"><h3>三维预览</h3><span class="subtle">默认小猫 + 当前预设</span></div>
      <div id="preset-preview" class="preset-preview"></div><p id="preset-preview-status" class="note" role="status"></p>
      <button type="button" id="preset-play" class="button" hidden>试播动作</button>
      <p class="note">拖动旋转查看。预览未保存时，孩子页面和本地目录保持原样。</p>
    </aside></div></fieldset>
    <footer class="preset-footer"><div><p id="preset-status" role="status" aria-live="polite"></p><p class="note">保存到家长电脑的本地数据库。已兑换奖励不会回收；修改正在使用的预设后，孩子的小猫会随之更新。</p></div><button id="preset-save" class="button primary" type="submit">保存到本地</button></footer>
    <button type="button" class="button small" id="preset-reload" hidden>保留草稿，读取最新目录</button></form>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector), form = find('#preset-form'), controls = new Map(), wrappers = new Map();
  for (const [id, label] of Object.entries(CATEGORY_LABELS)) { const option = node('option', '', label); option.value = id; form.elements.category.append(option); }
  let loaded, original, dirty = false, saving = false, scene, previewTimer, previewSequence = 0, generation = 0;
  const status = (message, error = false) => { find('#preset-status').textContent = message; find('#preset-status').classList.toggle('error-text', error); };
  const markDirty = () => { dirty = true; status('尚未保存：当前是预览草稿'); };
  const category = () => form.elements.category.value;
  function values() {
    return Object.fromEntries([...controls].map(([key, input]) => [key, input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value === '' ? NaN : Number(input.value)) : input.value]));
  }
  function draft(validate = true) {
    const reward = { id: form.elements.id.value, title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), category: category(), unlockAt: Number(form.elements.unlockAt.value), cost: Number(form.elements.cost.value) };
    if (original?.starter) reward.starter = true;
    if (category() === 'trick') {
      const { action, ...motion } = values(); reward.action = action; reward.motion = motion;
      if (validate) { validateFields({ action }, [ACTION_FIELD]); validateFields(motion, MOTION_FIELDS); }
    } else {
      reward.params = values();
      if (validate) validateFields(reward.params, PARAM_FIELDS[category()]);
    }
    return reward;
  }
  function visibility() {
    const v = values();
    for (const [key, wrapper] of wrappers) wrapper.hidden = !fieldVisible(category(), key, v);
    find('#preset-play').hidden = category() !== 'trick';
    const cost = form.elements.cost.value, at = form.elements.unlockAt.value;
    find('#preset-rule').textContent = original?.starter ? '初始配置免费拥有，价格和门槛固定为 0。' : Number(cost) === 0 ? `累计达到 ${at || '0'} 分后，自动解锁，不扣积分。` : `累计达到 ${at || '0'} 分后开放兑换，孩子确认时消耗 ${cost || '0'} 分。`;
  }
  function schedulePreview() {
    clearTimeout(previewTimer); previewSequence++;
    find('#preset-preview-status').textContent = '正在更新预览…';
    previewTimer = setTimeout(() => updatePreview(), 240);
  }
  async function updatePreview() {
    clearTimeout(previewTimer);
    const ticket = ++previewSequence;
    try {
      const reward = draft();
      const { createPetScene } = await import('./scene.js');
      if (!dialog.open || ticket !== previewSequence) return false;
      if (!scene) scene = createPetScene(find('#preset-preview'));
      scene.setParams({ ...DEFAULT_PARAMS, ...(reward.params || {}) });
      find('#preset-preview-status').textContent = category() === 'trick' ? '点击“试播动作”查看效果；孩子只能播放已解锁动作。' : '预览已更新，保存后才加入本地奖励目录。';
      return true;
    } catch (error) {
      if (ticket === previewSequence && dialog.open) find('#preset-preview-status').textContent = `预览未更新：${error.message}`;
      return false;
    }
  }
  function renderFields(params = {}, motion = {}, action = 'jump') {
    controls.clear(); wrappers.clear(); find('#preset-fields').replaceChildren();
    const fields = category() === 'trick' ? [ACTION_FIELD, ...MOTION_FIELDS] : PARAM_FIELDS[category()];
    const data = category() === 'trick' ? { action, ...Object.fromEntries(MOTION_FIELDS.map(f => [f.key, f.value])), ...motion } : defaultsFor(category(), params);
    for (const field of fields) {
      const wrapper = node('div', `preset-field field-${field.type}`), label = node('label', '', field.label);
      const input = node(field.type === 'select' ? 'select' : 'input');
      input.id = `preset-param-${field.key}`; input.dataset.param = field.key; label.htmlFor = input.id;
      if (field.type === 'select') for (const [value, text] of field.choices) { const option = node('option', '', text); option.value = value; input.append(option); }
      else input.type = field.type;
      if (field.type === 'checkbox') input.checked = !!data[field.key]; else input.value = data[field.key];
      if (field.type === 'number') {
        input.min = field.min; input.max = field.max; input.step = field.step; input.required = true; input.className = 'param-number';
        const slider = node('input'); slider.type = 'range'; slider.min = field.min; slider.max = field.max; slider.step = field.step; slider.value = input.value;
        slider.setAttribute('aria-label', `${field.label}滑块`); slider.dataset.slider = field.key;
        slider.addEventListener('input', () => { input.value = slider.value; input.dispatchEvent(new Event('input', { bubbles: true })); });
        input.addEventListener('input', () => { if (input.value !== '' && input.checkValidity()) slider.value = input.value; });
        const row = node('div', 'range-row'); row.append(slider, input); wrapper.append(label, row);
      } else { wrapper.append(label, input); }
      controls.set(field.key, input); wrappers.set(field.key, wrapper); find('#preset-fields').append(wrapper);
      if (field.key === 'coatId') input.addEventListener('change', () => {
        const dynamicCoat = controls.get('dynamicCoat').checked;
        renderFields({ coatId: input.value, dynamicCoat }); markDirty();
      });
    }
    visibility(); schedulePreview();
  }
  const teardown = () => { clearTimeout(previewTimer); previewSequence++; generation++; scene?.dispose(); scene = null; find('#preset-preview').replaceChildren(); delete find('#preset-preview').dataset.ready; dirty = false; };
  const requestClose = () => { if (saving) return; if (!dirty || confirm('放弃尚未保存的预设草稿？')) dialog.close(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  dialog.addEventListener('close', teardown);
  find('#preset-close').addEventListener('click', requestClose);
  form.addEventListener('input', () => { markDirty(); visibility(); schedulePreview(); });
  form.elements.category.addEventListener('change', () => renderFields());
  find('#preset-reset').addEventListener('click', () => { renderFields(); markDirty(); });
  find('#preset-play').addEventListener('click', async () => {
    if (!await updatePreview()) return;
    const reward = draft(); scene.play(reward.action, reward.motion);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) find('#preset-preview-status').textContent = '已遵循系统的减少动态效果设置，不播放位移动画。';
  });
  find('#preset-reload').addEventListener('click', async () => {
    try {
      const next = await api('/api/parent/presets');
      const previous = loaded.catalog.rewards.find(r => r.id === form.elements.id.value), current = next.catalog.rewards.find(r => r.id === form.elements.id.value);
      if (JSON.stringify(previous) !== JSON.stringify(current) && !confirm('这个奖励也被其他页面修改了。继续会保留你的草稿，再次保存时用草稿替换最新预设。是否继续？')) return;
      loaded = next; status('已读取最新目录，当前草稿尚未保存。请检查后再次保存。'); find('#preset-reload').hidden = true;
    } catch (error) { status(error.message, true); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    const ticket = generation;
    try {
      const reward = draft(), next = structuredClone(loaded.catalog), index = next.rewards.findIndex(r => r.id === reward.id);
      if (index < 0) next.rewards.push(reward); else next.rewards[index] = reward;
      validateCatalog(next);
      saving = true; find('#preset-fieldset').disabled = true; find('#preset-save').disabled = true; find('#preset-close').disabled = true;
      status('正在保存到本地…');
      const state = await api('/api/parent/presets', 'PUT', { reward, expectedRevision: loaded.revision });
      if (ticket !== generation) return;
      dirty = false; onSaved(state, next); dialog.close();
    } catch (error) {
      if (ticket === generation) { status(error.message, true); find('#preset-reload').hidden = error.status !== 409; }
    } finally { saving = false; find('#preset-fieldset').disabled = false; find('#preset-save').disabled = false; find('#preset-close').disabled = false; }
  });
  window.addEventListener('beforeunload', event => { if (dirty && dialog.open) { event.preventDefault(); event.returnValue = ''; } });
  return {
    async open(id = null, duplicate = false) {
      const ticket = ++generation;
      const result = await api('/api/parent/presets');
      if (ticket !== generation) return;
      loaded = result; const item = id ? result.catalog.rewards.find(r => r.id === id) : null;
      if (id && !item) throw new Error('预设不存在，请重新读取目录');
      original = duplicate ? null : item;
      form.reset(); form.elements.category.disabled = !!original; form.elements.category.value = item?.category || 'coat';
      form.elements.id.value = original?.id || newId();
      form.elements.title.value = item ? (duplicate ? `${item.title.slice(0,24)}（副本）` : item.title) : '';
      form.elements.description.value = item?.description || '';
      for (const key of ['cost', 'unlockAt']) { form.elements[key].value = duplicate && item?.starter ? 10 : item?.[key] ?? 10; form.elements[key].disabled = !!original?.starter; }
      find('#preset-heading').textContent = original ? '编辑奖励预设' : '新增奖励预设'; find('#preset-reload').hidden = true;
      dirty = false; status('未保存的参数调整只影响预览。'); dialog.showModal();
      renderFields(item?.params, item?.motion, item?.action);
      form.elements.title.focus();
    },
    close() { generation++; if (dialog.open) dialog.close(); else teardown(); },
  };
}
