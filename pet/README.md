# Meow 积分小猫

给家庭使用的独立积分宠物模块。家长记录进步、发放积分，孩子兑换原作小猫的花色、体型、眼睛、姿态和互动。保留原编辑器和原始生成器，不改 `src/main.js` / `src/catBuilder.js`。新页面通过适配器直接调用原作 `buildCat`，不是换成一只平面示意猫。

## 启动（Windows / macOS / Linux）

安装 Node.js **22.16 或更高版本**。在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run pet:build
npm run pet:start
```

打开孩子页面 `http://localhost:8792/`，家长页面 `http://localhost:8792/parent.html`。首次启动终端会打印随机的一次性初始化口令。在家长页输入口令，自行设置 **6–12 位数字的家长密码**、**4–12 位数字的孩子进入码**和昵称。两种密码必须不同；没有默认密码。首次初始化完成后，口令作废。家长每次登录 15 分钟后过期，离开时请主动点击“锁定家长页面”。

开发模式为 `npm run pet:dev`，同一个 8792 端口同时提供 Vite 页面和积分 API，避免开发时跨域。原作仍使用 `npm run dev`，默认 8791，互不接管。

家长电脑运行服务，其他家庭设备通过同一电脑的局域网 IP 访问。PowerShell 示例：

```powershell
$env:MEOW_HOST="0.0.0.0"
npm run pet:start
```

另一设备打开 `http://家长电脑局域网IP:8792/`，填写孩子进入码。不需要在每台设备分别安装或导入数据；主机需保持服务运行。默认只监听本机。只在可信家庭网络上使用 HTTP；不要将 8792 端口直接映射到公网。公网场景需要 HTTPS 反向代理，并设置 `MEOW_ORIGIN=https://你的域名`、保留对应 Host。

## 积分规则

- **余额**用于兑换；**累计成长分**只随正向加分增加。兑换、余额更正都不会退级，不回收已拥有的奖励。
- `unlockAt` 是累计成长门槛；`cost` 是兑换费用。达到门槛仅开放购买，不会自动扣积分。`cost: 0` 的奖励在达到门槛后自动送出。
- 初始四个槽位免费；每件商品只购买一次。重复点击、请求重放不会重复记账。每次余额、拥有权、流水和幂等记录在同一 SQLite 事务中提交。
- 家长可填负数更正误记的余额，必须记录原因，余额不能小于 0。这是余额调整，不会撤销成长经历。没有签到断连惩罚、饥饿/死亡机制或随机抽奖。

初始目录有 20 项奖励：4 项初始配置、5 项其他花色、2 项外形、2 项眼睛、5 项其他姿态、2 项互动。具体以 `rewards.json` 为准。姿态使用原作参数（站立、伸懒腰、面包、侧卧、双足、香蕉）；“开心跳跳”“转个圈圈”是新增的整体变换小互动，不声称已经接通原作全部 Mesh2Motion 骨骼动画。

## JSON 预设与外置接口

`pet/rewards.json` 是新数据库的初始目录。数据库一旦创建，以家长保存的目录为准，修改种子文件不会偷偷覆盖已有设置。已有家庭请在家长页导入 JSON，或调用 `PUT /api/parent/catalog`。

```json
{
  "id": "coat-calico",
  "title": "三花小猫",
  "description": "橘色、白色和深色拼成的特别花纹。",
  "category": "coat",
  "cost": 40,
  "unlockAt": 80,
  "params": { "coatId": "calico" }
}
```

导入的是完整 `{ "schemaVersion": 1, "rewards": [...] }` 目录，不是上面的单项对象。可直接调整价格、门槛、名称、说明和支持范围内的参数，也可新增奖励。已有 ID、类别和初始标记不能删除或改变，保证流水及已解锁记录仍有稳定含义。原作支持的花色/姿态都由 `catalog.mjs` 白名单约束；体型使用温和区间。JSON 不接受任意代码、URL、积分字段或原型字段。**新增现有参数组合只改 JSON；新增全新动画或原作不支持的造型，需要扩展渲染适配器和校验器。**

家长页提供可视化价格与门槛编辑、JSON 导入导出。孩子每 4 秒拉取服务端快照；页面重新获得焦点时也会同步。离线时保留最后显示值，禁用兑换按钮；服务端不可达不会在本地伪造成功。

### HTTP API v1（当前路径）

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| GET `/api/status` | 无需登录 | 仅返回是否已初始化 |
| POST `/api/parent/setup` | 一次性口令 | 初始化家长和孩子凭据 |
| POST `/api/parent/login` / `/api/child/login` | 对应密码 | `{ "code": "..." }` 登录 |
| GET `/api/parent/session` / `/api/child/session` | 对应会话 | 获取 CSRF、到期时间与状态 |
| POST `/api/parent/logout` / `/api/child/logout` | 对应会话 | 注销、吊销令牌 |
| GET `/api/state` / `/api/parent/state` | 孩子 / 家长 | 积分、拥有权、装扮和最近 100 条流水 |
| POST `/api/parent/points` | 家长 | `{delta, reason, idempotencyKey}` |
| GET/PUT `/api/parent/catalog` | 家长 | 导出/校验并保存完整目录 |
| PUT `/api/parent/profile` | 家长 | `{childName, petName}` 修改昵称 |
| PUT `/api/parent/credentials` | 家长 + 当前密码 | `{currentPin, newPin?, childCode?}` |
| GET `/api/parent/export` | 家长 | 当前状态、目录及全部流水，不含密码 |
| POST `/api/purchase` | 孩子 | `{rewardId, expectedCost, idempotencyKey}` |
| POST `/api/equip` | 孩子 | `{rewardId}`，装备已拥有的奖励 |
| POST `/api/play` | 孩子 | `{rewardId}`，核验已拥有动作并返回播放指令 |
| GET `/api/pet/config` | 孩子 | 已核验的渲染参数、当前槽位与允许动作 |

写请求使用 `Content-Type: application/json`、`X-Meow-Client: points-pet`。除初始化、登录外，写请求另需 `X-CSRF-Token`，值来自登录/session 响应，同时保留对应登录 Cookie。外部脚本使用 Cookie jar 即可调用，无需读写数据库。浏览器跨域默认拒绝；不要为了接入接口开放任意来源。

`idempotencyKey` 取新的 UUID；网络超时重试沿用原 ID 和原内容，新的业务操作换新 ID。服务端用实际目录价格扣款，`expectedCost` 仅用来验证孩子确认的价格没有过期，不能指定优惠价。同一 ID 被用于不同内容会返回 409。

## 数据与边界

默认数据位于 `pet/data/pet.sqlite`，凭据使用带随机盐的 scrypt 哈希；浏览器只保留 HttpOnly、SameSite Cookie，不存积分或密码到 localStorage。会话服务端持久化且检查过期，家长/孩子会话互相独立。密码/进入码修改会吊销对应角色旧会话。登录有限速，生产静态服务仅开放构建目录，数据库、源码不可通过静态路径下载。`pet/data/`、构建目录和测试产物已忽略。

`MEOW_PORT` 可改端口，`MEOW_DATA_DIR` 可指定数据库目录。完整备份请**停止服务后**复制整个 `pet/data` 目录；恢复前保留当前目录的副本，再用备份替换并重启。家长页 JSON 导出是可查阅的审计记录，没有实现自动恢复导入，不应把它当作完整数据库备份。不要把真实孩子记录、密码或数据库提交到公开仓库。

本版是一户家庭、一个孩子。双页面/多设备共享同一后台，不能只放 GitHub Pages 就运行积分服务。GitHub Pages 可继续承载原作静态编辑器；积分版需要常驻 Node 服务。浏览器开发工具可以修改本地视觉画面（任何前端都有此边界），但不能绕过服务端增加真实积分、修改目录或取得账户拥有权。已解锁动作可以反复播放，不重复收费。

## 验证

```sh
npm run test:pet
npm run pet:build
npm run build
```

`pet/tests/pet.test.mjs` 为可在本地运行的领域与 HTTP 集成测试。`.github/workflows/points-pet.yml` 另外安装固定版本的 Chromium 测试工具，运行 `pet/tests/browser.mjs`：实际完成初始化、家长加分、孩子兑换/换装/互动、两个独立浏览器会话同步、改目录、手机宽度、退出及越权拒绝，并保存截图。是否通过以实际 Actions 结果为准；脚本存在不代表测试已执行。

沿用仓库现有许可证和署名约束，未替换原始 LICENSE。
