# README 配图说明

配图均来自家庭积分应用的实际浏览器界面，不是设计稿或生成的UI。截图使用临时演示账户；昵称、积分、兑换数量和记录内容不属于真实家庭。不同图片的来源版本分别记录，不把旧图标成当前版本。

## 本次更新：2026-10-01

Luna（max）从 GitHub `main` 已提交的源码重新拍摄儿童首页、新叶喵、家长日常加分和家长创作页。来源提交为 [`94e84849d70cc4807b60ebd8304b3c4cd9ed3588`](https://github.com/cy677/Meow/commit/94e84849d70cc4807b60ebd8304b3c4cd9ed3588)，使用独立源码副本和临时内存SQLite实例，不读取家庭数据或本地未提交改动。

| 文件 | 展示内容 | 处理 |
| --- | --- | --- |
| `home.png` | 当前儿童首页、原版小猫与收藏小屋 | 本次实际截图 |
| `sprigatito.png` | 累计100成长分后切换的新叶喵模型与原材质 | 本次实际截图 |
| `parent-scoring.png` | 家长日常加分的项目卡片、分值和选填理由 | 本次实际截图 |
| `parent-studio.png` | 当前家长创作与参数编辑界面 | 本次实际截图 |

截图拍摄方式、浏览器、尺寸、来源与SHA-256以 [manifest.json](manifest.json) 中各图的记录为准。截图仅用于说明界面，不等同于执行完整浏览器回归，也不代表真实iPad Safari验收。

## 保留的成长流程配图

以下三张图沿用提交 `f06c8def41f5958ffd8281aced4ec48722a99fb1` 的浏览器回归截图，来源为 [Growth system checks](https://github.com/cy677/Meow/actions/runs/35312056885) 的 `meow-growth-evidence` 产物。根README中的操作入口名称已按当前代码更新；`family-records.png` 保留为历史材料，根README不再引用。

| 文件 | 展示内容 | 原始截图与处理 |
| --- | --- | --- |
| `growth-garden.png` | 儿童端六类成长花园 | `growth-child-garden.png`，完整截图 |
| `task-library.png` | 模式筛选、自定义与目标管理 | `growth-targets.png`，裁取项目库弹窗 |
| `family-records.png` | 家庭近期六类记录分布 | `growth-family-distribution.png`，裁取统计卡片 |

旧图仅经过原像素裁剪和PNG无损重新编码，没有修改界面分值、名称、文字或小猫外观。裁剪坐标采用原图左上角为原点的 `[left, top, right, bottom]`，原始文件哈希与尺寸保留在清单中。

图片保存在仓库内，根README通过相对路径引用，不依赖临时下载地址或Actions产物的保留期限。后续更换配图时，应同时更新对应图片的来源说明与清单。

原版小猫和素材继续保留[仓库许可证](../../LICENSE)及第三方署名。Required Notice: Copyright 2026 Simon_阿文 (Simon Lee) and Ring Hyacinth (海辛).
