# 猫的动作框架一阶段

基于 `main` 提交 `345388baf405907199c815043ffbbbfd367a0ac0` 开发，分支为 `feature/cat-motion-stage1-20260922`。此阶段只负责骨骼动作，不把猫爬架、球或猫窝写进动作控制器。

## 实现与边界

保留原猫的参数化建模、19 骨固定 `SkinnedMesh`、蒙皮权重与骨长保护。20 个基础片段使用同一注册表，其中 14 个读取仓库原有 Mesh2Motion 采样；六个新增片段为 Meow 编写的局部关节曲线。新片段的来源标识为 `meow-authored`，不会伪装成上游 CC0 动作。项目整体许可证与原作署名不变。

| 动作 ID | 当前内容 | 第一阶段限制 |
| --- | --- | --- |
| `scratch` | 左右前肢交替抓挠，伴随躯干和头尾调整 | 不接触实际抓柱 |
| `paw` | 抬前爪、前探轻拍、收回 | 不对玩具施加力 |
| `climb-up` | 四肢交替上攀的原地骨骼循环 | 无实际向上位移或抓取 |
| `climb-down` | 独立节奏与关节曲线的向下攀爬练习 | 不直接倒放上攀；不检测平台 |
| `mantle` | 前爪扒边、躯干前倾、收腿回稳的姿势过程 | 无真实边缘或翻上平台 |
| `stretch` | 前肢伸展、身体舒展、回到原位 | 不等同于切换静态 `stretch` 造型 |

这些动作并非运动捕捉素材，也不构成写实猫行为或步态的保证。保守关节限制会使极端短腿/大头体型的幅度减小。没有新增足底锁定、IK、布料、物理攀爬、导航或动物行为树。现有 `rest-pose` 仍是源骨架休息姿势，不宣称新增趴下/睡眠动画。

## 模块职责

| 路径 | 职责 |
| --- | --- |
| `src/catMotion/skeleton.js` | 唯一骨骼层级、19 骨名称、预留目标槽位 |
| `clipCatalog.js` | 唯一动作元数据、来源、循环、时长、保护与标记 |
| `authoredPoses.js` | 六种新增局部关节曲线、局部到全局四元数转换 |
| `motionScript.js` | 有界 JSON 脚本校验和冻结时间轴，不执行任意代码 |
| `clipPlayer.js` | 骨骼与根节点平滑混合，复用现有网格和骨架 |
| `motionController.js` | 单时钟调度、优先级、排队、中断续播、暂停停止 |
| `motionEvents.js` | 语义标记跨帧发射、去重、订阅与生命周期 |
| `pet/skeletalPlayer.js` | 家长预览对现有绑定、播放器和控制器的适配 |
| `pet/studioRuntime.txt` | 家庭首页接入、授权检查、保留原位置与场景 |
| `pet/motionPrograms.mjs` | 兼容导出和业务奖励配置；不再复制片段元数据 |

原版单片段手动展示仍可以调用源采样器；家庭首页的脚本和家长预览使用公共播放器/控制器。`MESH2MOTION_ACTIONS` 保持只表示原 14 个源动作，避免改变旧源资产验收的含义。UI 与新脚本使用 20 个片段的总目录。

## 使用方式

正常使用不需要控制台：家长页的“互动动作”选择器和“自定义动作脚本”均已使用新目录。“添加骨骼动作奖励”只补缺失项，不覆盖已有奖励价格、门槛、所有权或流水。没有数据库结构迁移。

需要目标的 `scratch/paw/climb-up/climb-down/mantle`（以及包含它们的脚本）不会被孩子首页自动随机选择。本阶段可在家长页试播；未来由物体交互控制器触发。`stretch` 可以随已解锁动作进入原随机池。

### 核心 API

```js
import { createClipPlayer, createMotionController } from './src/catMotion/index.js';

// rig 为现有 createMesh2MotionSkinRig 返回的绑定，cat 为其拥有的模型。
const player = createClipPlayer(rig, cat);
const motion = createMotionController(player);

motion.play('walk', { duration: 4 });
motion.play('paw', { duration: 1.4 }, undefined, {
  priority: 10,
  resumePrevious: true,
});
motion.enqueue('stretch', { duration: 2.8 });

const unsubscribe = motion.on('paw_contact', event => {
  console.log(event.bone, event.phase, event.semanticOnly); // 只是语义时点
});

// 仅在项目原渲染循环中调用一次，dt 的单位是秒。
motion.update(dt);
motion.pause();
motion.resume();
motion.stop(); // 清空等待/续播任务并平滑回待机
motion.cancel(); // 立即取消，用于换模型、关闭页面、拾取前恢复
unsubscribe();
motion.dispose();
```

优先级为 0–100；同级请求替换当前可中断片段，显式 `enqueue` 排队，同级队列按请求顺序。跳跃、落下、翻越当前片段保护期间，新请求排队；`force: true` 可明确跳过片段保护，但不会越过更高优先级。`resumePrevious` 保存被中断任务的播放位置，恢复时从当前姿势混合，已发射事件不重复。

自然播放完成会继续队列或恢复挂起任务，然后混合回待机。暂停只冻结时钟，恢复不补播隐藏期间的时间。单步时差上限为 0.1 秒；调用方不应另起计时器追赶落后的帧。

### 连续动作

```js
motion.playScript([
  { clip: 'idle-alert', cycles: 1, speed: 1 },
  { clip: 'paw', cycles: 1, speed: 1 },
  { clip: 'stretch', cycles: 1, speed: 1 },
], { transition: 0.25, speed: 1 });
```

保留 1–8 步、单步最多 4 个循环、一次性片段不得循环、速度和总时长的校验。原 `greet/explore/pounce` 脚本与 `spin` ID 保持兼容；新增 `paw-practice/climb-practice` 为无物体的片段练习。编译结果和输入快照冻结，不允许外部修改后绕过校验。

### 家庭首页适配接口

生产家庭页面同源 iframe 内提供 `window.meowMotion`。它与 `petStudio.motion` 是同一外观接口，不启动另一套骨架或时钟。

```js
meowMotion.play('paw', ownedReward.motion, { priority: 10 });
meowMotion.playScript('paw-practice', ownedScriptReward.motion);
meowMotion.enqueue('stretch', ownedStretchReward.motion);
meowMotion.on('paw_contact', handler);
meowMotion.setTarget('frontLFoot', { x: 0, y: 1, z: 0 });
meowMotion.getState();
```

家庭首页仍只接受服务端当前授权列表中同一动作与参数配置；脚本也必须是已授权完整配置，不能通过新接口绕过解锁。核心 API 的第四个参数为调度选项，家庭接口第三个参数为调度选项，两者签名不同。`setTarget` 要在骨架准备好后调用。

目标槽位为四足、`head`、`root`。位置必须是有限数值，`null` 清除目标；内部复制目标值，读取不泄露可变引用。目前只保存位置，`getState().targetsApplied` 始终为 `false`，不驱动 IK 或碰撞。未来物体适配器再定义坐标系转换和接触求解。

## 事件语义

`takeoff/apex/landing/paw_contact/scratch_contact/climb_grab/bite_contact/mantle_complete` 是注册表中的**人工标记**。`phase` 在 0–1 之间，是片段归一化时间，不是秒。事件按时间轴速度/循环/交叠转换为实际时间；跨过标记才发射一次。双爪可在同一阶段各发一个标记，这是两个独立接触意图。

`semanticOnly: true` 明确表示没有检测到物理接触。订阅者仍需在后续阶段验证物体存在、距离与目标可达性；不能直接把这些标记当作“猫已站稳”或“抓到了球”。

根节点局部姿势与关节姿势一起混合。家庭渲染层只应用一次输出根变换；原有房间有限漫游仍在外层，不属于动画控制器。物体转换、世界位移和根动作提取留到下一阶段。

## 检查与维护

```bash
npm ci --ignore-scripts
npm run test:cat-motion
npm run test:pet
npm run test:motion
npm run pet:build
npm run build
```

浏览器测试需单独安装 Playwright（不加入生产依赖），安装 Chromium 后运行 `npm run test:cat-motion:browser`。CI 还保留模型奖励、成长与家长创作三个回归脚本，输出截图、骨骼采样及检查报告到 `pet/test-results/` 的构建产物。

单元测试覆盖目录唯一性、曲线区分、固定骨长、交叠、根姿势平滑、保护和强制中断、续播事件去重、暂停、队列容量、目标隔离、监听器重入与释放。生产构建的 WebGL 测试验证真实父级表单、六种新动作及旧片段、固定网格、参数极值和家庭授权接口。测试结果以当前分支 Actions 日志为准，不等同于实体 iPad Safari 帧率验收。

后续新增动作时只在目录和采样层增加数据，不再到 UI、API、时间轴分别维护一份名称/时长。接入物体时新增目标/导航适配器，不将家具名称写进 `motionController.js`。
