# 叶猫外观：原版猫的组件扩展

基线为 `main` 的 `9fd0729bddee1825de0a184f850cdb956ea52747`。本实现从 main 开始，未合入旧的 `feature/leaf-cat-model-20260924` 独立模型。参考图表示原版猫坐下后的外观，不是另一种身体结构或绑定姿态。

## 使用

在原编辑器或家长创作页的「体型 → 外观 → 小猫外观」选择「叶猫外观（原版身体与动作）」。该操作只写入 `catAppearance: 'leaf'`，不改变当前 `pose`、身体比例、尾巴参数、动作或动作强度。普通坐下仍选原动作 `sit`；启动和停止动画仍走 main 的 standing 绑定与原姿势恢复流程。

口型选择 `auto`（跟随原版叫唤/仰头叫）、`closed`（闭口）、`open`（开口）或 `meow`（连续开合）。编辑器切换口型时只更新表情控制器，不重建身体。外观和口型使用已有严格参数校验、作品保存和奖励配置流程，不写入积分或加分记录。

旧作品缺少 `catAppearance` 时仍是原版猫。叶猫采用固定参考配色；原花色、异色瞳等参数保留在作品参数中，切回原版恢复，未破坏原预设。

## 结构边界

所有猫仍进入 `src/catBuilder.js::buildCat`。原版 SDF 先完整生成，叶猫只在末尾叠加装饰：

- 身体、头部底形、四肢和尾巴沿用 main。fur/outline 的位置、法线、索引、蒙皮语义和身体碰撞数据不因外观改变。
- 耳朵覆盖层沿用 main 的 roundCone、meshFromSDF 和内耳投影组件；原耳网格不改。脸颊毛簇、叶片领结是附加小几何体。
- 脸部花纹、口腔、舌头与尖牙复用原眼睛的曲面投影/纹理组件。鼻子与眼睛直接改原组件颜色。闭口仍显示原来的两段 omega 嘴线。开口是投影口型，不是假称新增下颌骨骼。
- 脸颊、领结和嘴属于原 `face`；耳朵装饰使用原 `innerEar*` 挂接入口。原骨骼绑定器无需修改就会把它们挂到现有头部骨骼。
- 不增加尾巴模型、骨骼、身体姿势、动作轨道、独立查看器或另一个 buildLeafCat。

`src/sdf.js`、`src/coats.js`、`src/mesh2motionRig.js`、`src/mesh2motionSkinRig.js`、`src/mesh2motionSource.js`、`src/mesh2motionClips.json`、`src/staticIdle.js`、`src/softPoke.js` 和整个 `src/catMotion/` 保持 main 版本。

新增文件的职责：`src/catAppearance/catalog.js` 是无 WebGL 依赖的选项和颜色；`leaf.js` 只装配外观；`mouth.js` 只管理口型。服务器增量更新清单补充 catalog.js，避免新参数校验模块缺少依赖。

## 组件接口

```js
const cat = buildCat({ ...existingParams, catAppearance: 'leaf', mouthMode: 'auto' });
// 原有骨骼及动作调用保持不变。
cat.userData.setMouthMode('open');   // auto | closed | open | meow
cat.userData.setMouthOpen(0.65);     // 手动控制 0～1；null 释放手动控制
cat.userData.updateMouthAnimation(elapsedSeconds); // 已接入原有两个渲染循环
cat.userData.getMouthState();       // { mode, openness, manual }
```

口型独立于身体动作。`auto` 读取原 `animationState.actionId/progress`，不启动第二个身体时间轴。非法模式或非有限时间会被拒绝。

## 验证

```sh
npm ci
npm run test:pet
npm run test:motion
npm run test:poke
npm run build
npm run pet:build
# 浏览器验收额外使用 Playwright，不增加生产依赖。
npm install --no-save --package-lock=false playwright@1.55.0
npx playwright install --with-deps chromium
node pet/tests/browser-leaf-native.mjs
```

浏览器测试逐项比较原版/叶猫 10 种静态姿势的身体网格、索引与语义属性，再比较全部 20 个现有动作的 19 根骨骼矩阵、根运动及蒙皮权重。编辑器测试检查切换外观保留姿势/比例、口型不触发身体重建、坐下/退出动画恢复原姿势、切回原版移除装饰，以及 WebGL 错误。报告输出至 `pet/test-results/leaf-native/verification.json`。

这属于同一原版模型上的外观扩展，不承诺新增饰物在所有极端参数下完全不穿插。实体 iPad 的性能与触摸验收另行进行。GLB 的原导出路径未被改造成口型动画烘焙器；浏览器口型控制器不是新增的 GLB 骨骼动画。
