# 原生骨骼动作优化与口型绑定

基线：main `9fd0729bddee1825de0a184f850cdb956ea52747`，在原生叶猫外观修订 `a46ce84d39879b89169d16ebe71f0e14d550b98e` 上继续。未使用旧独立叶猫模型。普通猫与叶猫共用同一优化链路；原身体网格、蒙皮权重算法、19 根骨骼名称/层级、14 个源片段和 6 个自制片段不变。

## 本次行为

- 直接编辑器/键盘播放采用累计相位，改变速度不会把全部历史时间乘以新速度。切换动作或行进方向时，从实际显示的姿态做四元数与根变换过渡；同动作显式重播仍有效。
- 脚本中的同片段连续循环不再彼此提前重叠，避免循环相位冲突及请求 4 秒却提前结束。不同动作继续使用原脚本过渡；零重叠边界选择下一段，消除零除。
- 站立绑定下的待机、警觉、行走、潜行、叫唤、咬咬和仰头叫增加有限幅度的平面足端修正。两段式 IK 使用原绑定骨长和当前膝/肘方向，目标限制在可达范围；关节修正仍受原版关节角限制。修正距离按本模型实测腿长确定，不使用鹿、马的米制步幅。
- 奔跑、跳跃、落下、坐下、休息、倒地和攀爬等不套用这层贴地修正，避免把腾空/特殊姿势错误拉向地面。
- 口型在片段采样时确定，用与骨骼相同的混合权重过渡。只在最终姿态发布时更新五官，隐藏的两个采样结果不会各自覆盖嘴部。暂停脚本、改变速度、停止和恢复姿势均使用同一播放状态。
- 叶猫嘴部保留原曲面投影方式，使用 32 档口型图集，一次建模绘制/上传；帧间仅切换纹理坐标，不重复绘制整幅 Canvas。没有新增下颌骨，也没有改变身体拓扑。

## 口型规则（作者编排的动画，不是生理模型）

| 动作或姿势 | 口型 |
| --- | --- |
| 叫唤 bark | 在该片段两个发声区间开合 |
| 仰头叫 howl | 预备时闭口，发声阶段张口，恢复时闭口 |
| 咬咬 bite | 先张口，在原 `bite_contact` 相位 0.5 前闭合 |
| 扑接 fetch | 扑接中段小幅张口，完成后闭合 |
| 舒展身体 stretch 动作 | 中段张口，结束闭合 |
| 伸懒腰 stretch 静态姿势 | 固定小幅张口，不运行独立口型时钟 |
| 其余当前动作、站立/面包/侧卧等静态姿势 | 闭口 |

删除编辑器与家长表单中的“口型动作”，不再提供 `setMouthOpen`、`setMouthMode`。`updateMouthAnimation()` 仅消费模型当前发布状态，没有单独口型参数或时钟。`getMouthState()` 是只读诊断。历史作品中的 `mouthMode` 白名单值允许兼容读取但不参与动画；新作品捕获及规范化保存时移除，不批量重写历史积分/作品数据库。

## 参考项目与落实范围

只参考设计思想，本次 JS 实现为 Meow 的独立实现，没有复制第三方源代码、动物骨架或动画数据，也未增加 Blender/Qt/Python 运行依赖。

1. mortgoldman/deer_me，参考版本 `2416f1bda2c4ef25906f7d10fee31fdf48ba34f1`。
   - `src/deer_me/core/ik_solver.py`：两段式 IK、可达性和弯曲平面。
   - `src/deer_me/core/state_machine.py`：按状态过渡，而非直接跳到下一个片段。
   - `src/deer_me/core/gaits.py`：支撑/摆动阶段区分。Meow 保留猫原片段相位，不照搬鹿的步序或 27 骨骼。
   - https://github.com/mortgoldman/deer_me
2. huxingyi/dust3d，参考版本 `44b4503d93198a1cab493f936e53d875d8f7848b`。
   - `dust3d/rig/rig_generator.h`：绑定空间、骨骼语义、基于原结构处理。
   - `dust3d/animation/quadruped/roar.cc`：预备、发声、恢复阶段统一驱动头部与嘴部。
   - https://github.com/huxingyi/dust3d
3. houskan/morph，参考版本 `b0c429f93050ad07c33ee6098d78a44b45427d6f`。
   - `morph_animal/gait.py`：从当前骨架测量尺寸，按体型组织运动参数。
   - 本次只用于本猫的修正尺度；没有引入解剖 PCA、其他物种网格或 Blender 插件。
   - https://github.com/houskan/morph

## 文件职责

`src/catMotion/kinematics.js` 是解析两段 IK；`grounding.js` 是原骨架上的平面接触修正；`realtimePlayer.js` 是原编辑器的相位/过渡适配；`expression.js` 是动作/姿势到口型的纯函数。`clipPlayer.js` 统一混合身体与表情，`mesh2motionSkinRig.js` 继续唯一负责原版绑定与姿态采样。`src/catAppearance/mouth.js` 只显示采样后的口型。

## 验证和边界

```sh
npm ci
npm run test:pet
npm run test:motion
npm run test:poke
npm run build
npm run pet:build
# 另需测试环境安装 Playwright 与 Chromium
node pet/tests/browser-leaf-native.mjs
node pet/tests/browser-cat-motion-stage1.mjs
```

数值测试检查三组体型、20 个动作、固定骨长、普通猫与叶猫的同骨架/同蒙皮/同骨骼姿态、接触参考间隙、循环边界、速度变化、重播及表情暂停/混合。Canvas 桩仅用于非可视数值测试；真实 Canvas/WebGL 由浏览器测试另行检查，不把数值测试描述成真机视觉验收。

接触指标是原绑定足端中心相对平面的参考间隙，不是逐顶点碰撞检测。没有地形采样、世界坐标足部锁定、楼梯或真实爬架 IK，因此不声称消除全部滑步/穿插。保留原 `targetsApplied:false` 语义；目标 API 并未接入这层平面修正。尚未进行 iPad 真机性能验收。
