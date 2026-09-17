import { parameterDescription } from './presetSchema.mjs';
const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const kinds = { all:'全部记录', earn:'加分理由', adjustment:'更正理由', purchase:'兑换记录', gift:'成长礼物', catalog:'预设修改' };

/** Parent keeps continuous history; the child's modal uses cursor-backed, five-item pages. */
export function createHistoryView(root, { api, parent, onError, paginated = false, pageSize = 40, isActive = () => true }) {
  root.replaceChildren();
  const form = node('form', 'history-filters'), search = node('input'), filter = node('select'), submit = node('button', 'button small', '查询');
  search.type = 'search'; search.maxLength = 120; search.placeholder = '查询加分理由或兑换名称'; search.setAttribute('aria-label', '查询理由'); search.id = 'history-search';
  filter.id = 'history-kind'; filter.setAttribute('aria-label', '记录类型');
  for (const [value, label] of Object.entries(kinds)) { const option = node('option', '', label); option.value = value; filter.append(option); }
  submit.type = 'submit'; form.append(search, filter, submit);
  const info = node('p', 'note'), fresh = node('button', 'button small', '有新记录，点击刷新'), list = node('div', 'history-list');
  const more = node('button', 'button small', paginated ? '下一页 ›' : '加载更早记录');
  const prev = node('button', 'button small', '‹ 上一页'), pageLabel = node('span'), pager = node('footer', 'history-pagination');
  fresh.type = more.type = prev.type = 'button'; fresh.hidden = true; more.hidden = !paginated;
  more.id = 'history-more'; prev.id = 'history-prev'; list.id = 'history-entries'; pageLabel.id = 'history-page';
  pageLabel.setAttribute('role', 'status'); pageLabel.setAttribute('aria-live', 'polite');
  pager.setAttribute('aria-label', '成长记录翻页'); pager.append(prev, pageLabel, more);
  root.append(form, info, fresh, list, paginated ? pager : more);
  let entries = [], cursor = null, total = 0, newest, sequence = 0, loaded = false, busy = false;
  let active = { q:'', kind:'all' }, page = 0, starts = [null], loadedNewest;
  function render() {
    list.replaceChildren();
    if (!entries.length) list.append(node('p', 'empty', '没有符合条件的记录。'));
    for (const record of entries) {
      const row = node('div', 'ledger-row'), content = node('div');
      const amount = node('span', record.delta < 0 ? 'minus' : 'plus', record.delta > 0 ? `+${record.delta}` : record.delta < 0 ? String(record.delta) : '记录');
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
    info.textContent = paginated ? `本地共 ${total} 条匹配记录，每页 ${pageSize} 条。` : `本地共 ${total} 条匹配记录，已显示 ${entries.length} 条。`;
    more.hidden = !paginated && cursor === null;
    more.disabled = busy || cursor === null; prev.disabled = busy || page === 0;
    pageLabel.textContent = `第 ${page + 1} / ${Math.max(1, Math.ceil(total / pageSize))} 页`;
    list.dataset.page = String(page + 1); list.scrollTop = 0;
  }
  async function load(reset = true, targetPage = page) {
    const ticket = ++sequence, requestedNewest = newest;
    busy = true; more.disabled = prev.disabled = submit.disabled = true;
    const query = new URLSearchParams({ ...active, limit: String(pageSize) });
    const before = reset ? null : paginated ? (targetPage > page ? cursor : starts[targetPage]) : cursor;
    if (before !== null && before !== undefined) query.set('before', before);
    try {
      const result = await api(`${parent ? '/api/parent/history' : '/api/history'}?${query}`);
      if (ticket !== sequence) return;
      if (reset) { starts = [null]; page = 0; }
      else if (paginated) { starts[targetPage] = before; page = targetPage; }
      entries = reset || paginated ? result.entries : [...entries, ...result.entries.filter(r => !entries.some(e => e.id === r.id))];
      cursor = result.nextCursor; total = result.total; loaded = true; loadedNewest = requestedNewest;
      fresh.hidden = newest === requestedNewest; busy = false; render();
    } catch (error) {
      if (ticket === sequence) { info.textContent = '记录读取失败，可重新查询；本地已保存的数据不会删除。'; onError(error); }
    } finally {
      if (ticket === sequence) { busy = false; submit.disabled = false; more.disabled = cursor === null; prev.disabled = page === 0; }
    }
  }
  function refresh() {
    if (!isActive() || busy) return;
    if (!loaded || (loadedNewest !== newest && page === 0 && entries.length <= pageSize && !active.q && active.kind === 'all')) void load();
    else if (loadedNewest !== newest) fresh.hidden = false;
  }
  form.addEventListener('submit', event => { event.preventDefault(); active = { q:search.value.trim(), kind:filter.value }; void load(); });
  filter.addEventListener('change', () => { active = { q:search.value.trim(), kind:filter.value }; void load(); });
  more.addEventListener('click', () => { if (!busy && cursor !== null) void load(false, page + 1); });
  prev.addEventListener('click', () => { if (!busy && page > 0) void load(false, page - 1); });
  fresh.addEventListener('click', () => { if (!busy) void load(); });
  return {
    update(latestId) { newest = latestId; refresh(); },
    refresh,
    reset() {
      sequence++; busy = loaded = false; newest = loadedNewest = undefined; entries = []; cursor = null; total = page = 0; starts = [null];
      active = { q:'',kind:'all' }; form.reset(); list.replaceChildren(); info.textContent = ''; fresh.hidden = true; more.hidden = !paginated;
      more.disabled = prev.disabled = true; submit.disabled = false; pageLabel.textContent = '';
    },
  };
}
