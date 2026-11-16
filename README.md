# 灵动交互水晶灵龙 · Procedural Interactive Chameleon Pet

一个基于 **Three.js + Vite + MediaPipe Hands** 的程序化生成交互宠物 Demo。

龙的身体完全由代码实时生成（无外部 3D 模型资源），支持 **陆地爬行 / 腾云游龙** 双形态、**鼠标 / 摄像头手势** 双控制方式，并具备脊椎跟随、四肢 IK、眼球追踪、3D 弹射吐舌捕食与张掌警戒等程序化动画与情绪表现。

## ✨ 特性

- **双形态自由切换**：🐾 陆地爬行（脚掌贴地锁定 + 对角步态拱形迈步）/ 🐉 腾云游龙（四肢后收流线型 + 大幅 S 形游动）
- **程序化生物力学**：20 段脊椎链跟随 + 角度约束 + S 形游动波、两段式 IK、龙角弹簧惯性摆动、眼球独立追踪/游离/汇聚
- **3D 弹射捕食**：蓄力 → 头部后缩 → 弯曲舌管射出 → 回收的完整状态机，一次性触发防连发
- **情绪系统**：张掌进入 ALERT 警戒（抬角、鼓身、伏低、双眼聚焦、皮肤泛琥珀警告色、脊椎颤抖）
- **5 套水晶皮肤**：翡翠玉龙 / 落樱粉晶 / 赛博霓虹 / 熔岩赤金 / 全息极光，基于 `MeshPhysicalMaterial` 的清漆、透射、虹彩与丝光平滑过渡
- **双输入模式**：鼠标 raycast 与 MediaPipe 手势识别一键切换；手势带 EMA 平滑与捏合迟滞检测
- **视觉表现**：ACES 色调映射、PCF 软阴影、极简 `ShadowMaterial` 地面、蓝色轮廓光、星空渐变背景、毛玻璃 UI

## 🚀 快速开始

需要 Node.js 18+。

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。摄像头手势模式需要授予浏览器摄像头权限（建议在 `localhost` 或 HTTPS 环境下使用）。

生产构建：

```bash
npm run build
```

## 🎮 操作指南

| 操作 | 效果 |
| --- | --- |
| 移动鼠标 | 灵光球跟随鼠标，龙头舞龙式尾随，身体 S 形跟随 |
| 鼠标左键点击 | 吐舌弹射捕食 + 身体闪白脉冲 |
| `空格` / `Tab` | 陆地爬行 ⇄ 腾云游龙 |
| `1` ~ `5` | 切换 5 套水晶皮肤 |
| 左上角 UI 按钮 | 切换形态 / 切换输入模式 / 点击调色盘换肤 |

摄像头手势模式：

| 手势 | 效果 |
| --- | --- |
| 移动食指 | 控制灵光球位置（镜像映射） |
| 拇指 + 食指捏合 | 触发一次吐舌捕食（捏住不放不连发） |
| 张开手掌 | 进入警戒状态 |
| 手移出画面 | 空闲 `IDLE` |

## 🧩 项目结构

```
chameleon-pet/
├── index.html                  # 页面入口、UI 与样式
├── package.json                # 依赖与脚本
├── vite.config.js              # Vite 开发服务器配置
└── src/
    ├── main.js                 # 应用主入口 DragonApp：场景装配、主循环、状态编排
    ├── creature/               # 龙的身体与行为（程序化几何 + 动力学）
    │   ├── ChameleonModel.js   # 整体模型：头/角/眼/身/四肢网格、材质换肤、弹性龙角、警戒动画
    │   ├── SpineChain.js       # 20 段脊椎链：头部跟随、S 形游动波、角度约束
    │   ├── LimbIK.js           # 四肢两段式 IK：贴地迈步、游龙收拢、落脚求解
    │   ├── EyeTracker.js       # 眼球追踪：注视 / 游离 / 进食汇聚
    │   └── TongueSystem.js     # 吐舌捕食：CatmullRom 曲线 + TubeGeometry，射出/收回状态机
    └── input/                  # 输入系统
        ├── InputManager.js     # 输入中枢：鼠标 raycast + 手势状态机派发 ActionState
        └── HandTracker.js      # MediaPipe Hands 封装：指尖平滑、捏合迟滞、张掌检测
```

## 🛠️ 技术栈

| 类别 | 技术 |
| --- | --- |
| 3D 渲染 | Three.js 0.160 |
| 构建工具 | Vite 5 |
| 手势识别 | MediaPipe Hands / camera_utils |
| 语言 | ES Modules (原生 JavaScript) |

> MediaPipe 的 wasm 与模型文件通过 jsDelivr CDN 加载，首次进入手势模式需联网。

## 📄 说明

仓库中的 `项目.md`、`项目源码归档.md`、`优化.md` 为开发过程文档，其中 `项目.md` 描述的是早期方案，可能与当前源码存在差异；实际实现以 `src/` 目录为准。
