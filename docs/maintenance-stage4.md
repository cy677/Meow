# Meow 模块化改造与配置保护说明

基线为 `9903a5bfa6628e346c7cce56876689c304a6ba80`。本分支纳入简化计划的阶段1—4，并完成阶段5的配置、数据边界及发布脚本整理。保留 Node.js、SQLite、Three.js、现有积分规则及单儿童数据库，不强制移动已有数据目录。

## 实现范围

| 部分 | 入口与行为 |
| --- | --- |
| 明确错误 | 拍照框依据视口计算明确宽高；默认奖励迁移校验内置身份；成长配置先校验对象；启动器保留显式 Host；更新拒绝清单外文件、哈希不符和链接。 |
| 后端分层 | `pet/api/` 管理路由和请求，`services/` 管理业务及事务，`repositories/` 管理 SQLite 查询。旧 `store.mjs`、`growthStore.mjs` 保留兼容导出。 |
| 前端分层 | `pet/ui/` 分离请求、会话、奖励和成长视图；`src/camera/` 管理拍照覆盖层生命周期。 |
| 原版集成 | 行为从 `studioRuntime.txt` 移入 `pet/runtime/createStudioAdapter.js`，删除文本桥接文件；`studioBuild.mjs` 仍保留少量严格计数的兼容锚点，不是全部去除了文本转换。 |
| 扩展接口 | 服务端生成 UserContext；模型注册表和当前小猫适配器；场景拍照提供者；分类、逐日和周成长统计。 |
| 配置与更新 | 三个启动入口共用 `pet/config/`；分离示例和实际配置；发布脚本共用 `runtimeFiles.mjs`；补丁先暂存校验、备份再替换。 |

完整多用户、设备摄像头、新模型、完整成长图表、云同步与大规模性能优化均未实现。当前设备摄像头接口会明确提示尚未接入，不会偷偷请求权限。模型接口只是扩展点，新模型仍需编写资源和动作适配。

## 数据和接口

默认数据库仍为 `pet/data/pet.sqlite`。66个默认成长任务改为显式 ID，但所有旧 ID 保持原值；源码排序不再定义持久化身份。没有重新计算历史积分或重命名家庭记录。

认证后可读取 `/api/me`、`/api/parent/me` 和各自的 `/api/growth/summary`、`/api/parent/growth/summary?days=7`。角色沿用儿童和家长会话。上下文由服务端产生，当前拒绝通过 `userId/profileId` 查询参数选择其他档案。

成长统计区分余额、累计经验及所选期间积分，按持久化的 awardDay 分组，并排除已被更正替代的旧记录。更新家庭时区不会重新标记过去的记录日。当前成长页面已读取这一统计层。

## 配置与升级

优先级为环境变量、实际 `pet-settings.json`、`pet-settings.example.json`、内置默认值。相对数据及证书路径以安装根目录为基准；实际配置存在时逐字节保留，只在内存中补足默认项。首次启动缺少实际配置时才独占创建文件。显式回环 Host 不会被 LAN 启动器覆盖。

仓库及新发行包只保存示例配置。旧源码安装在 Git 更新前，应先把实际配置和完整数据目录备份到安装目录之外。Git 若提示本地配置有冲突，不要强制覆盖；保留并在更新后恢复自己的实际配置。示例文件不能替代家庭配置。

Ubuntu 补丁的使用前提是停止所有使用同一家庭数据目录的服务。直接运行 Node 不经过便携启动器的操作锁，因此仅取得锁不代表其他直接启动实例已经停止。补丁对整个 payload 做文件集合及哈希检查，先将程序写入暂存区，再备份数据、配置和旧程序；捕获替换异常时回退程序。没有实现断电自动恢复或数据库版本降级。

数据和旧程序备份位于 `update-backups/<时间>/family-data`、`program`，实际配置单独保留。备份包含家庭敏感信息，目录不要公开、提交或当作发行包分享。HTTPS 私钥按原路径单独保管。

```bash
npm ci --ignore-scripts
npm run test:pet
npm run pet:build
npm run build
node scripts/package_ubuntu_update.mjs --name Meow-maintenance-update
bash scripts/package_ubuntu_archives.sh Meow-maintenance-update update
```

打包前必须用目标提交重新构建，不能使用其他分支残留的 `pet/dist`。补丁生成器拒绝复用同名输出目录；`--base-build` 可选指定旧 BUILD 元数据，不再依赖写死的旧目录。SHA-256 校验不等于发布者签名。

## 必要验证

新增维护与配置单元测试；已有核心测试继续运行。CI 对当前完整页面执行登录、加分与统计、兑换、原版 iframe、拍照框、PNG、关闭重开、家长草稿保存重载的聚焦验证，不启动大规模浏览器或性能矩阵。记录以本提交对应的 CI 结果为准，旧测试记录不代表新提交通过。

本地 Node 22.16.0 检查记录：125项中122通过、0失败、3项既有 Windows 专用测试跳过；积分版与原版构建通过。真实 iPad 和 Windows 便携版未实测。旧导航专用浏览器脚本留作历史参考，不计入本轮有效覆盖；当前入口为 `pet/tests/browser-maintenance.mjs`。
