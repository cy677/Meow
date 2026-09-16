import { parameterDescription } from './presetSchema.mjs';
const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const kinds = { all:'全部记录', earn:'加分理由', adjustment:'更正理由', purchase:'兑换记录', gift:'成长礼物', catalog:'预设修改' };

export function createHistoryView(root, { api, parent, onError }) {
  root.replaceChildren();
  const form = node('form', 'history-filters'), search = node('input'), filter = node('select'), submit = node('button', 'button small', '查询');
  search.type = 'search'; search.maxLength = 120; search.placeholder = '查询加分理由或兑换名称'; search.setAttribute('aria-label', '查询理由'); search.id = 'history-search';
  filter.id = 'history-kind'; filter.setAttribute('aria-label', '记录类型');
  for (const [value, label] of Object.entries(kinds)) { const option = node('option', '', label); option.value = value; filter.append(option); }
  submit.type = 'submit'; form.append(search, filter, submit);
  const info = node('p', 'note'), fresh = node('button', 'button small', '有新记录，点击刷新'), list = node('div', 'history-list'), more = node('button', 'button small', '加载更早记录');
  fresh.type = more.type = 'button'; fresh.hidden = more.hidden = true; more.id = 'history-more'; list.id = 'history-entries';
  root.append(form, info, fresh, list, more);
  let entries = [], cursor = null, total = 0, newest, sequence = 0, loaded = false, busy = false, active = { q:'', kind:'all' };
  function render() {
    list.replaceChildren();
    if (!entries.length) list.append(node('p', 'empty', '没有符合条件的记录。'));
    for (const record of entries) {
      const row = node('div', 'ledger-row'), content = node('div'), amount = node('span', record.delta < 0 ? 'minus' : 'plus', record.delta > 0 ? `+${record.delta}` : record.delta < 0 ? String(record.delta) : '记录');
      row.dataset.recordId = record.id;
      content.append(node('strong', '', record.reason), node('small', '', `${kinds[record.kind] || '记录'} · ${new Date(record.createdAt).toLocaleString('zh-CN')}`));
      if (record.rewardId) {
        const detail = node('details', 'history-detail'); detail.append(node('summary', '', '查看当时的奖励内容'));
        const reward = record.rewardSnapshot;
        detail.append(node('p', 'note', reward ? `${reward.title} · 当时价格 ${reward.cost} 分 · 解锁门槛 ${reward.unlockAt} 分` : `奖励 ID：${record.rewardId}。这是旧版记录，未保存当时参数；不会用新预设冒充历史。`));
        if (reward) detail.append(node('p', 'note', parameterDescription(reward)));
        content.append(detail);
      }
      row.append(content, amount); list.append(row);
    }
    info.textContent = `本地共 ${total} 条匹配记录，已显示 ${entries.length} 条。`; more.hidden = cursor === null;
  }
  async function load(reset = true) {
    const ticket = ++sequence; busy = true; more.disabled = submit.disabled = true;
    const query = new URLSearchParams({ ...active, limit:'40' });
    if (!reset && cursor !== null) query.set('before', cursor);
    try {
      const result = await api(`${parent ? '/api/parent/history' : '/api/history'}?${query}`);
      if (ticket !== sequence) return;
      entries = reset ? result.entries : [...entries, ...result.entries.filter(r => !entries.some(e => e.id === r.id))];
      cursor = result.nextCursor; total = result.total; loaded = true; fresh.hidden = true; render();
    } catch (error) { if (ticket === sequence) { info.textContent = '记录读取失败，可重新查询；本地已保存的数据不会删除。'; onError(error); } }
    finally { if (ticket === sequence) { busy = false; more.disabled = submit.disabled = false; } }
  }
  form.addEventListener('submit', event => { event.preventDefault(); active = { q:search.value.trim(), kind:filter.value }; load(); });
  filter.addEventListener('change', () => { active = { q:search.value.trim(), kind:filter.value }; load(); });
  more.addEventListener('click', () => { if (!busy && cursor !== null) load(false); });
  fresh.addEventListener('click', () => load());
  return {
    update(latestId) {
      if (latestId === newest && loaded) return;
      newest = latestId;
      if (busy) { fresh.hidden = false; return; }
      if (!loaded || (entries.length <= 40 && !active.q && active.kind === 'all')) load(); else fresh.hidden = false;
    },
    reset() { sequence++; busy = loaded = false; newest = undefined; entries = []; cursor = null; active = { q:'',kind:'all' }; form.reset(); list.replaceChildren(); info.textContent = ''; fresh.hidden = more.hidden = true; more.disabled = submit.disabled = false; },
  };
}
