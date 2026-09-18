/** Child-only landscape shell. The original parent workspace is intentionally unchanged. */
export function childMarkup() {
  return `<section class="child-stage" aria-label="我的小猫">
    <div id="pet-scene"><p id="scene-loading" role="status">正在把你的小猫接过来…</p></div>
    <header class="child-hud">
      <div class="child-identity"><span class="child-mark" aria-hidden="true">m.</span><div><h1 id="pet-name"></h1><p id="greeting"></p></div></div>
      <div class="child-account"><div class="child-balance"><span aria-hidden="true">✦</span><strong id="balance">0</strong><span>积分</span></div><a href="./studio.html" class="child-studio">原版互动</a><a href="./parent.html" class="child-parent">家长</a><button type="button" class="button quiet" data-action="logout">退出</button></div>
    </header>
    <p id="network" class="network" role="status" hidden>连接暂时中断，正在重连。积分和收藏仍保存在电脑上。</p>
    <nav class="child-dock" aria-label="小猫的宝藏屋">
      <button type="button" class="button child-collection" data-action="collection" aria-haspopup="dialog" aria-controls="rewards-dialog"><span aria-hidden="true">♧</span> 我的收藏</button>
      <button type="button" class="button primary" data-action="open-rewards" aria-haspopup="dialog" aria-controls="rewards-dialog"><span aria-hidden="true">✦</span> 奖励小屋</button>
    </nav>
  </section>
  <dialog id="rewards-dialog" class="child-dialog" aria-labelledby="rewards-title">
    <header class="child-dialog-heading"><div><span class="eyebrow">给小猫挑一份喜欢的礼物</span><h2 id="rewards-title">小猫的宝藏屋</h2></div><button type="button" class="button" data-action="close-rewards" autofocus aria-label="关闭宝藏屋，回到小猫">回到小猫 ×</button></header>
    <nav class="section-tabs compact" role="tablist" aria-label="宝藏屋页面">
      <button type="button" id="tab-shop" data-view="shop" role="tab" aria-controls="reward-panel" aria-selected="true">发现奖励</button>
      <button type="button" id="tab-owned" data-view="owned" role="tab" aria-controls="reward-panel" aria-selected="false" tabindex="-1">我的收藏 <span id="owned-count">0</span></button>
      <button type="button" id="tab-history" data-view="history" role="tab" aria-controls="history-panel" aria-selected="false" tabindex="-1">成长记录</button>
      <span class="child-growth">累计 <strong id="lifetime">0</strong> 成长分</span>
    </nav>
    <section id="reward-panel" role="tabpanel" aria-labelledby="tab-shop">
      <div class="category-tabs" id="categories" aria-label="奖励分类"></div>
      <div id="reward-grid" class="reward-grid" aria-label="本页奖励"></div>
      <footer class="reward-pagination" aria-label="奖励翻页"><button type="button" id="reward-prev" class="button" data-action="reward-prev">‹ 上一页</button><p id="reward-page-status" role="status" aria-live="polite"></p><button type="button" id="reward-next" class="button" data-action="reward-next">下一页 ›</button></footer>
    </section>
    <section id="history-panel" role="tabpanel" aria-labelledby="tab-history" hidden><div id="ledger"></div></section>
    <p id="rewards-message" class="child-dialog-message" role="status" hidden></p>
  </dialog>
  <dialog id="purchase-dialog" class="child-purchase" aria-labelledby="purchase-title"><form method="dialog"><button class="dialog-close" aria-label="取消兑换，返回奖励列表">×</button></form><span class="eyebrow">一份新的小惊喜</span><h2 id="purchase-title"></h2><p id="purchase-description"></p><p id="purchase-balance" class="purchase-balance"></p><p class="note">兑换后永久拥有，累计成长积分不会减少。</p><p id="purchase-error" role="alert" hidden></p><button id="purchase-confirm" class="button primary" type="button" data-action="confirm-purchase">确认兑换</button></dialog>`;
}

export function createChildOverlay({ onOpen }) {
  const dialog = document.getElementById('rewards-dialog');
  const purchase = document.getElementById('purchase-dialog');
  let launcher = null, backdropDown = false;
  purchase.addEventListener('close', () => {
    if (dialog.open && !dialog.contains(document.activeElement)) dialog.querySelector('[data-action=close-rewards]').focus({ preventScroll:true });
  });
  const signal = open => document.getElementById('pet-scene')?.dispatchEvent(new CustomEvent('meow:overlay-change', { detail: open }));
  function close() { purchase.close(); if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => {
    signal(false);
    if (!document.getElementById('workspace').hidden && launcher?.isConnected) launcher.focus({ preventScroll: true });
  });
  // Only close after a complete outside tap, not after dragging a card/scrollbar outside.
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog && outside(event); });
  dialog.addEventListener('pointercancel', () => { backdropDown = false; });
  dialog.addEventListener('click', event => { if (backdropDown && event.target === dialog && outside(event)) close(); backdropDown = false; });
  return {
    open(view, source) {
      launcher = source || launcher;
      onOpen(view);
      if (!dialog.open) { dialog.showModal(); signal(true); }
    },
    close,
    get isOpen() { return dialog.open; },
  };
}
