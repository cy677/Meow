/** Parent-only metadata form. Captures the current result once; it never rerolls on equip. */
export function createCreationEditor({runtime,request,onSaved,onError}) {
  const dialog=document.createElement('dialog');dialog.className='creation-dialog';dialog.setAttribute('aria-labelledby','creation-title');
  dialog.innerHTML=`<form id="creation-form"><h2 id="creation-title">保存为解锁奖励</h2>
    <p>保存当前小猫和场景，孩子解锁后可以使用这个作品。</p>
    <label>奖励名称<input name="title" required maxlength="30"></label>
    <label>奖励说明<textarea name="description" required maxlength="140" rows="2"></textarea></label>
    <div class="creation-fields"><label>解锁成长积分<input name="unlockAt" type="number" min="0" max="1000000" step="1" required></label>
    <label>兑换价格<input name="cost" type="number" min="0" max="1000000" step="1" required></label></div>
    <p class="creation-help">兑换价格为 0 时，达到成长门槛后自动获得。作品保存后可在家长页修改。</p>
    <p role="alert" id="creation-error" hidden></p>
    <div class="creation-actions"><button type="button" data-cancel>继续调整</button><button type="submit">保存奖励</button></div>
    </form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),error=dialog.querySelector('[role=alert]');
  let id,revision,preset,editing=null,busy=false;
  dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;busy=true;error.hidden=true;
    for(const b of dialog.querySelectorAll('button'))b.disabled=true;
    const reward={id,category:'creation',title:form.elements.title.value.trim(),description:form.elements.description.value.trim(),
      cost:Number(form.elements.cost.value),unlockAt:Number(form.elements.unlockAt.value),preset};
    try{
      const saved=await request('/api/parent/presets','PUT',{reward,expectedRevision:revision});
      editing=reward;revision=saved.catalogRevision;dialog.close();onSaved(reward);
    }catch(e){error.textContent=e.message;error.hidden=false;onError?.(e);}
    finally{busy=false;for(const b of dialog.querySelectorAll('button'))b.disabled=false;}
  });
  return {
    async load(rewardId,copy=false){
      const data=await request('/api/parent/presets');
      const reward=data.catalog.rewards.find(r=>r.id===rewardId&&r.category==='creation');
      if(!reward)throw new Error('没有找到这个家长作品，请返回家长页重新选择');
      runtime.restore(reward.preset);editing=copy?{...reward,id:null,title:`${reward.title.slice(0,25)} 副本`}:reward;
      revision=data.revision;
    },
    async open(asNew=false){
      // Keep the revision used to load an existing work, preventing silent lost updates.
      if(!editing?.id||asNew)revision=(await request('/api/parent/presets')).revision;
      const item=editing||{};id=asNew||!item.id?`creation-${crypto.randomUUID()}`:item.id;
      form.elements.title.value=asNew?'新小猫作品':item.title||'我的小猫作品';
      form.elements.description.value=item.description||'家长亲手准备的小猫与场景，解锁后永久使用。';
      form.elements.unlockAt.value=item.unlockAt??50;form.elements.cost.value=item.cost??0;
      preset=runtime.capture();error.hidden=true;dialog.showModal();form.elements.title.focus();
    },
  };
}
