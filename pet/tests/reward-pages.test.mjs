import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardPage, REWARDS_PER_PAGE } from '../rewardPages.mjs';
const items=Array.from({length:20},(_,i)=>({id:`reward-${i}`,category:i%2?'coat':'shape',owned:i<8}));
test('奖励分页默认六项，末页完整覆盖，没有重复或遗漏',()=>{
  assert.equal(REWARDS_PER_PAGE,6);
  const pages=Array.from({length:4},(_,page)=>rewardPage(items,{page}));
  assert.deepEqual(pages.map(p=>p.items.length),[6,6,6,2]);
  assert.deepEqual(pages.flatMap(p=>p.items.map(r=>r.id)),items.map(r=>r.id));
});
test('分页在分类和收藏过滤后计算；过滤缩小后页码夹紧',()=>{
  const result=rewardPage(items,{category:'shape',ownedOnly:true,page:3});
  assert.equal(result.total,4);assert.equal(result.pages,1);assert.equal(result.page,0);
  assert.ok(result.items.every(r=>r.owned&&r.category==='shape'));
});
test('空目录和超出范围页码不会出现空白错误页，不修改原列表',()=>{
  assert.deepEqual(rewardPage([]),{items:[],page:0,pages:1,total:0});
  assert.equal(rewardPage(items,{page:-1}).page,0);
  assert.equal(rewardPage(items,{page:99}).page,3);
  assert.equal(rewardPage(items,{page:NaN}).page,0);
  assert.equal(rewardPage(items,{size:5}).pages,4);assert.equal(items.length,20);
  assert.throws(()=>rewardPage(items,{size:0}),RangeError);
});
