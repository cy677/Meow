/** Use visible UI pagination rather than bypassing the child's interaction flow. */
export async function openChildPage(page, view = 'shop') {
  // A preceding equip/play click may still be awaiting its API response and auto-close.
  // Wait for that visible UI operation, not a fixed delay or a hidden-state shortcut.
  await page.waitForFunction(()=>!document.querySelector('#rewards-dialog button[data-busy="true"]')&&!document.querySelector('#purchase-dialog[open]'));
  const dialog=page.locator('#rewards-dialog');
  if (!await dialog.isVisible()) await page.locator('[data-action=open-rewards]').click();
  await dialog.waitFor({state:'visible'});
  await page.locator(`[data-view="${view}"]`).click();
}
export async function revealReward(page, id, view = 'shop') {
  await openChildPage(page, view);
  const card=page.locator(`.reward-card[data-reward-id="${id}"]`);
  for(let i=0;i<40;i++) {
    if(await card.count())return card;
    if(await page.locator('#reward-next').isDisabled())break;
    await page.locator('#reward-next').click();
  }
  throw new Error(`Reward ${id} not found in ${view}`);
}
