# 通过 Pad 浏览器使用 Meow（局域网或公网）

业务数据保存在运行 Node.js 服务的机器上，默认路径为 `pet/data/pet.sqlite`，实际目录可由配置或 `MEOW_DATA_DIR` 指定。家庭电脑部署时在家庭电脑，公网服务器部署时在服务器，不在 Pad 浏览器。Pad 不需要安装应用，也不会使用浏览器缓存另建积分账本。服务停止时 Pad 无法连接；重启后继续使用原有数据。

摄像头合影只在 Pad 内存中生成，点击拍照即通过浏览器保存 PNG 文件，不上传到服务端，也没有网页本地相册。用法见 [第一版合影说明](../docs/photo-v1.md)。

## 1. 最简单的局域网 IP 访问（HTTP + 触摸）

需要 Node.js 22.16+。在仓库根目录执行：

```powershell
npm ci --ignore-scripts
npm run pet:build
npm run pet:lan
```

`pet:lan` 明确监听 `0.0.0.0`，默认端口 **8792**；`pet:start` 仍默认只监听本机。终端列出实际网卡 IP，例如：

```text
孩子页面：http://192.168.1.20:8792/
家长页面：http://192.168.1.20:8792/parent.html
```

把示例 IP 换成终端显示的、Pad 可以访问的实际 IP。多网卡电脑可能同时列出 VPN 或虚拟机地址，应选择家庭 Wi-Fi/以太网对应地址。Pad 和电脑连接同一局域网，在浏览器输入孩子页面地址即可。也能通过服务器 IP 打开家长页，仍需要家长密码。

首次启动在家长页输入终端的一次性口令并设定密码；已初始化的数据库不需要重做。先在电脑上确认页面可用，再打开 Pad 页面。

连接失败时检查电脑是否休眠、是否误用了 Pad 自己的 localhost、两台设备是否处于相互隔离的访客 Wi-Fi，以及服务器端口是否被占用。Windows 防火墙仅放行所用端口，**不要关闭防火墙**。下面是可由家长在管理员 PowerShell 中明确执行的规则示例（程序不会自动修改系统设置）：

```powershell
New-NetFirewallRule -DisplayName "Meow 家庭积分宠物 HTTP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8792 -Profile Private -RemoteAddress LocalSubnet
```

此规则仅限专用网络、本地子网。没有域名、云服务或公网端口映射需求。可在路由器设置 DHCP 地址保留，避免电脑 IP 改变后需重新输入。

## 2. 横屏 iPad 的小猫主窗口

孩子页现在以横屏 iPad 为设计目标：小猫画布铺满浏览器可用内容区，没有上方统计卡片、旁边成长栏或下方长列表。仅保留昵称、积分和悬浮操作；无需浏览器进入系统全屏，不锁定设备方向，也不另做竖屏布局。测试视口为 1024×768、1180×820、1366×1024 和浏览器工具栏缩小后的 1024×600，单位是 CSS 像素。

点“奖励小屋”或“我的收藏”打开当前页面内的弹窗，不打开新窗口。弹窗有发现奖励、我的收藏、成长记录三个页面；奖励每页 6 项，支持分类及前后翻页；成长记录每页 5 条，保留查询、过滤、奖励快照和前后翻页。换装或播放动作成功后自动回到小猫；兑换确认后留在弹窗，可以继续选择。关闭、取消或翻页不会扣积分。

后台加分不会重置孩子正在浏览的奖励页码。弹窗打开时，小猫不接收触摸，倾斜暂时让位；关闭后继续观看，不重建画布。家长页面及服务端数据库接口不变。详细布局和测试说明见 `LANDSCAPE.md`。

### 触摸及倾斜

单指拖动三维画面旋转；双指张合缩放。轻触孩子的小猫有短暂的抚摸反馈，拖动、多指操作和取消触摸不会误判为抚摸。底部还有放大、缩小和视角复位按钮，不依赖精细手势。

孩子主窗口不再上下滚动，分页列表和记录在弹窗内操作；家长页面保留正常滚动。只在三维 canvas 内接管手势。家长页滑块、下拉框、颜色和数值表单也可触摸。触摸设备使用至少 44 像素的主要按钮，并保留浏览器页面缩放；可用窗口尺寸改变后会重新适配画布，孩子页不提供独立竖屏布局。三维预览有独立的视角控制，不会更改孩子的装扮。

“开启倾斜”是可选的观看方式：授权后轻轻倾斜 Pad，让视角作有限幅度的变化。第一次有效读数作为中立握姿；“校准”可以重新确定中立位置。触摸期间传感器让位，松手后以当前握姿重设基准；横竖屏切换也会重新校准。切后台暂停接收数据；返回后重新校准，不重复弹授权。退出孩子页面、关闭倾斜或离开页面会停止监听。

传感器只在用户明确点击后申请，方向读数只用于当前页面，不上传、不保存。观看操作不会触发积分写入，不会解锁或代替购买奖励动作。没有读数、拒绝权限或浏览器不支持时显示原因，仍能用触摸操作。

## 3. 陀螺仪为什么不能保证在普通 IP HTTP 上使用

W3C 的 Device Orientation and Motion 规范把方向/运动数据限定为安全上下文，并要求相应权限；需要 `requestPermission()` 的浏览器要求从用户点击直接发起。普通 `http://局域网IP` 不是这类安全上下文。电脑上的 localhost 例外不能扩展到另一台 Pad 通过 IP 访问。

因此 HTTP 下不会假装开启陀螺仪或要求关闭浏览器安全保护；按钮会说明需要可信 HTTPS。触摸、积分和预设功能不受影响。HTTPS 仍可直接使用 **IP 地址**，不强制购买域名。

官方依据：
- https://www.w3.org/TR/orientation-event/
- https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
- https://threejs.org/docs/pages/OrbitControls.html

## 4. 通过 IP 使用 HTTPS（摄像头和传感器的前提）

已有公网 HTTPS 时优先沿用。证书由 iPad 已信任的公开 CA 签发、覆盖该 IP、证书链完整且有效时，不需要在 Pad 上安装证书；仍需首次确认摄像头权限。下面的 mkcert 安装步骤只针对自建 CA，并不是所有 HTTPS 部署的必做步骤。

程序已支持原生 Node HTTPS。准备一张 **Pad 信任、且包含服务器实际 IP 的证书**和对应私钥，然后设置以下路径。关闭旧 HTTP 服务后执行：

```powershell
$env:MEOW_TLS_CERT="C:\Meow\pet\certs\meow-cert.pem"
$env:MEOW_TLS_KEY="C:\Meow\pet\certs\meow-key.pem"
npm run pet:lan:https
```

HTTPS 默认端口 **8793**，仍使用同一个服务端数据库。例如 Pad 打开 `https://192.168.1.20:8793/`；浏览器确认连接可信后，点“开启倾斜”并允许方向传感器。`MEOW_PORT` 可以改端口。证书缺失或无效时启动失败，不会悄悄改成 HTTP。更新代码、切换 HTTP/HTTPS 都不要删除 `pet/data/`。

需要放行 HTTPS 端口时，家长可在管理员 PowerShell 中执行同样受限的规则：

```powershell
New-NetFirewallRule -DisplayName "Meow 家庭积分宠物 HTTPS" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8793 -Profile Private -RemoteAddress LocalSubnet
```

### 自己管理家庭设备时的证书示例

已有可信的私有 CA 或反向代理时可沿用。也可以由家长自行安装 mkcert，给自己管理的设备生成本地证书；它的官方项目是 https://github.com/FiloSottile/mkcert ，不是本项目的运行依赖。下面命令中的 IP 和目录必须替换为实际值：

```powershell
mkdir pet\certs
mkcert -install
mkcert -cert-file pet\certs\meow-cert.pem -key-file pet\certs\meow-key.pem 192.168.1.20 localhost 127.0.0.1
mkcert -CAROOT
```

Pad 需要安装并信任该 CA 的 **公开证书 `rootCA.pem`**；只信任电脑而没有让 Pad 信任是不够的。iPad 安装描述文件后，还需要在系统的证书信任设置中开启相应根证书的完全信任，具体路径以系统版本为准。Android 的证书安装和浏览器信任行为依版本/设备而异，必须确认目标浏览器已将页面视为安全连接。不能把“跳过证书警告”当作可信部署已经完成。

不要将 **`rootCA-key.pem` 或服务器私钥**发送给 Pad、他人或提交仓库。安装私有 CA 会让设备信任它签发的证书，应只在自己管理的设备上进行，并妥善保管或在不再使用时移除。项目忽略 `pet/certs/`；生产静态服务不提供这些文件，开发文件服务也禁止读取证书/私钥。普通网站访问和陀螺仪是否可用仍取决于浏览器、硬件和家长设置，不能保证所有型号都支持。

mkcert 官方说明（IP 证书、移动设备信任和 CA 私钥警告）：https://github.com/FiloSottile/mkcert#mobile-devices
Apple 手工安装证书信任说明：https://support.apple.com/en-us/102390

## 5. 数据、权限和测试边界

业务数据通过当前服务写入运行服务机器的 SQLite，不自动同步到 GitHub、外部传感器平台或第三方存储。公网部署时这台机器就是公网服务器。相机画面和照片不走这些业务接口。HTTPS 会话使用 Secure/HttpOnly/SameSite Cookie，HTTP 保留原角色校验；LAN 模式仍验证 Host、Origin、CSRF、价格和拥有权，不能因为监听 0.0.0.0 就绕过权限。

`node --test pet/tests/*.test.mjs` 包括真实网卡 IP 访问、TLS 证书验证、积分回归和传感器状态机测试。TLS 测试用临时 OpenSSL 证书，仅测试机内使用，不写入源码。`pet/tests/browser-landscape.mjs` 检查全窗口画布、奖励与历史分页、弹窗关闭/焦点、兑换/换装、后台加分和各横屏尺寸。`pet/tests/browser-pad.mjs` 使用 Chromium 的 CDP 单指/双指触摸输入，并对传感器做**模拟事件/授权测试**；这不是实体 iPad/Android 陀螺仪测试。现有双角色、参数预设和数据库重启用例仍保留。

程序没有在你的电脑配置网络、防火墙或证书。请依据你的实际 IP、Pad 型号和浏览器进行最终设备验收。
