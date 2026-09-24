# 叶猫外观：原版猫的组件扩展

基线为 main 的 `9fd0729bddee1825de0a184f850cdb956ea52747`，未合入旧独立叶猫模型。参考图是原版猫坐下后的外观，不是另一种身体结构或绑定姿态。

原编辑器或家长创作页：**体型 → 外观 → 小猫外观 → 叶猫外观（原版身体与动作）**。切换外观只修改 `catAppearance`，不改变当前姿势、身体比例、尾巴和动作。正常坐下使用原 `sit` 动作；退出动态模式恢复原静态姿势。

所有猫进入 `src/catBuilder.js::buildCat`。身体、头部底形、四肢和尾巴沿用 main；叶猫只附加耳朵覆盖层、脸颊毛簇、叶片领结和花纹，并改变五官颜色。复用原 SDF/曲面投影组件，附加部件通过原 `face`/`innerEar*` 入口随现有头部骨骼运动。

新版口型由动作和姿势自动确定，删除独立口型选项与手动控制接口。闭口沿用原两段嘴线，开口复用原曲面投影显示口腔、舌头和尖牙，不添加下颌骨。普通猫和叶猫共用原 19 骨骼的动作优化，见 [动作优化说明](motion-refinement.md)。

```js
const cat = buildCat({ ...existingParams, catAppearance: 'leaf' });
// 继续使用原骨骼与动作接口，叫唤等动作会自动带出口型。
// 口型诊断只读，不是控制接口。
cat.userData.getMouthState(); // { binding: 'action-pose', openness, source, atlasFrame }
```

旧作品没有 `catAppearance` 时仍显示原版猫；叶猫参考配色不会覆盖保存的原花色与眼色，切回原版可以恢复。历史 `mouthMode` 兼容读取但失去控制作用，新作品不再保存该字段。
