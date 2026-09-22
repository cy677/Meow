# 第一版 iPad 摄像头合影

## 使用方式

在儿童页点“拍照 · 留影”，再点“与我合影”。Safari 第一次会请求摄像头权限。默认优先前置镜头，可切换前后镜头；前置默认镜像，镜像只改变真人画面，不反转小猫、相框和文字。单指拖动调整小猫位置，双指张合调整大小，“还原构图”恢复本次初始视角。

拍摄后展示最终的 1200×1600 PNG，并立即释放摄像头。点“存储到 iPad 照片”，在系统菜单选择“存储图像”。不支持文件分享时长按图片保存。网页只能发起系统菜单，不能静默写入系统照片库，不能限定分享菜单的所有目标，也不能读取相册确认结果；取消系统菜单时不会显示“已保存”。请在系统“照片”中确认重要照片。

家庭版普通小猫纪念卡也先预览，由用户通过系统菜单或长按保存；不自动下载到“文件”。原版独立静态生成器保留原有的普通场景 PNG 下载接口。纪念卡预览和 PNG 像素里的底部仓库链接栏均移除，仓库中的原作者说明、许可证和出处不变。

## 数据边界

摄像头流、照片 Blob 和预览地址仅留在当前浏览器内存中。没有照片上传接口，没有服务端相册，没有 IndexedDB/localStorage/Cache Storage 相册。关闭预览或退出页面会释放对象地址；未自行保存的照片不保留。合影不调用人脸识别、云端 AI 或麦克风。保存到系统照片库以后的 iCloud 同步等行为由设备设置控制，不是 Meow 上传。

积分、理由、奖励和成长记录与照片是两条独立路径。业务数据经当前服务写入运行 Node.js 的电脑或服务器的 SQLite，默认路径仍为 `pet/data/pet.sqlite`，实际路径以配置和家长页显示为准。公网部署时业务数据就在公网服务器，而不是 iPad。此次没有修改数据库结构、账户、积分规则、历史流水、装备拥有权或实际配置文件。

## 实现结构

`src/shareCard.js` 继续管理纪念卡取景与导出。原有卡片图案和描述器分离至 `src/camera/cardArtwork.js`；`cameraOverlay.js` 继续负责确定尺寸和关闭生命周期。`pet/runtime/cameraProvider.js` 使用同一个设备摄像头实现，并将家庭版照片输出设置为系统保存预览。

`deviceCamera.js` 负责显式授权、前后镜头、有效首帧、超时、取消和轨道释放。权限对话框本身不能由网页撤销，所以关闭期间尚未返回的授权结果也会在返回后立即停止轨道。退出合影、退出账户、页面切后台、页面离开、WebGL 丢失和设备中断时停止相机；回来后由用户重新开启，不自动继续录制。

`photoSession.js` 只复用现有 Three.js renderer、相机和小猫，不创建第二套小猫或 WebGL 上下文。VideoTexture 的裁切与镜像使用取景窗坐标；窗口变化时重新计算。视频纹理标为 sRGB，避免给真人背景套用小猫的 ACES 色调映射。镜头或视频尺寸改变时释放旧纹理。

房间、背景和雾效只在渲染回调中临时替换，并在本次渲染结束后恢复。这样原有天气模拟下一帧仍然可以访问 Color 背景与 Fog，不会因 VideoTexture 或 null fog 报错。合影拖动改变的是临时构图相机，结束恢复视角，不通过“重置房间”改变玩具或装备。原有自动动作在纪念卡打开时暂停。

`photoMode.js` 管理设备按钮与最终预览。照片先编码完成，再由一次新的用户点击发起 `navigator.share({files})`，避免异步编码消耗临时用户激活。系统菜单不可用或取消时保留内存预览供长按保存，不把照片改传服务器。样式以同源外部 CSS 输出，不能被打包成会遭生产 CSP 拒绝的 data URL。

## HTTPS 和权限

使用浏览器信任的 HTTPS。公开可信 CA 签发、覆盖当前访问地址、未过期且证书链完整的证书，不需要在 iPad 上额外安装。自建 CA 才需要在受管理设备上安装并信任；不能把跳过证书警告当作完成部署。此功能不签发证书、不改变服务器实际证书或续期任务。

`pet/api/cameraPolicy.mjs` 仅对 `/`、`/index.html` 和 `/studio.html` 开放同源相机，其他页面保持禁用。儿童入口与渲染 iframe 都要允许摄像头；父页面若发出 `camera=()`，iframe 的 `allow` 不能将其放开。麦克风、定位和磁力计仍禁用，外部页面不能嵌入此应用获取权限。

反向代理必须保留一致的 HTTPS origin，不得额外注入 `camera=()` 或禁用 `web-share`。保留现有 Host、Origin、CSRF、登录会话、CSP 与同源 iframe 限制。iPad 首次使用仍需主动允许相机；证书信任不等于相机授权。

## 测试和验收

`npm run test:pet` 包括新增的设备生命周期、延迟授权释放、首帧等待、镜头切换、拒绝/超时恢复、裁切镜像、链接栏移除、权限路由和不含照片持久化/上传路径测试。

`pet/tests/browser-maintenance.mjs` 使用隔离的内存家庭数据，在原有登录、加分、兑换、草稿回归中加入 `browser-photo-checks.mjs`。浏览器检查使用 Chromium 假摄像头和文件分享桩，检查多帧渲染、前后镜头、PNG、无自动下载、释放轨道、无业务变更和无照片网络写入；不启动大规模性能测试。CI 图片只包含模拟画面和临时演示小猫，不含家庭照片。

Node 22.16.0 本地回归记录为 137 项：134 通过、0 失败、3 项既有平台相关测试跳过。完整构建和浏览器结果以该提交对应的 GitHub Actions 为准。模拟浏览器通过不代表真实 iPad 已验收；实体 iPad 上仍须确认权限弹窗、横屏构图、长按菜单、系统“存储图像”和前后镜头行为。

升级只替换本分支程序文件，重新运行 `npm run pet:build` 并重启服务。保留实际配置、证书/私钥和完整数据目录，升级前照常备份。提交到 GitHub 不等于已经部署到公网网站。

## API 依据

- MDN getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- MDN Web Share: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- WebKit iOS inline video: https://webkit.org/blog/6784/new-video-policies-for-ios/
- Three.js VideoTexture: https://threejs.org/docs/pages/VideoTexture.html
- Vite static asset/no-inline handling: https://vite.dev/guide/assets
