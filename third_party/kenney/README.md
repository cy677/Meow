# Kenney 模型来源与许可

本目录保留4个原始包的许可，以及逐文件来源清单。第一批奖励使用 Cube Pets 2.0、Toy Car Kit 1.2、Brick Kit 1.0、Furniture Kit 2.0；均为 Creative Commons Zero (CC0)。模型作者为 Kenney，官方入口：<https://kenney.nl/assets>。

共选择22个GLB，而不是把整个资源包加入项目。发布路径为 `public/models/kenney/`。原始 GLB 引用的本地调色板图片已嵌入 data URI，几何和动画保留原数据。`manifest.json` 同时记录压缩包 SHA256、原始模型 SHA256、调色板 SHA256 和转换后 GLB SHA256。

`previews/` 中的PNG由 `scripts/render_model_previews.mjs` 使用这些模型渲染。渲染器中对模型应用项目统一的 Toon 材质、暖色调和深棕描边。

不要把本目录或模型重新标成 PolyForm-only；第三方素材保留 CC0。使用这些素材不会改变 Meow 原程序的非商业许可和原作者署名要求。
