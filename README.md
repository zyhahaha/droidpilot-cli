# DroidPilot CLI

> Android 设备自动化控制命令行工具 - AI 驱动

一个基于 AI 的 Android 设备自动化控制工具，通过 ADB 连接设备，使用大语言模型（如 GPT-4o、GLM-4 等）智能执行各种自动化任务。

## ✨ 特性

- 🤖 **AI 驱动**: 基于 LangChain.js，支持 OpenAI 兼容 API（GPT-4o、GLM-4V 等）
- 📱 **ADB 控制**: 完整的 ADB 设备管理功能
- 🎯 **智能识别**: 通过视觉模型识别屏幕内容并自动操作
- 💡 **技能系统**: 渐进式披露机制，按需加载优化后的操作流程
- 🖥️ **交互模式**: 支持交互式命令行界面
- 📸 **截图压缩**: 自动压缩截图以节省 token 消耗

## 📋 前置要求

- Node.js >= 20.0.0
- Android SDK (ADB 命令需在 PATH 中)
- Android 设备已开启 USB 调试模式
- OpenAI 兼容的 API Key（支持多模态视觉模型）

## 🚀 快速开始

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd droidpilot-cli

# 安装依赖
npm install

# 构建项目
npm run build
```

### 配置

创建 `config.json` 文件（可复制 `config.json.example`）：

```json
{
  "apiKey": "your_api_key_here",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "model": "glm-4.6v",
  "temperature": 0.1,
  "maxIterations": 150
}
```

**配置说明**:

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `apiKey` | API 密钥 | - |
| `baseUrl` | API 基础 URL | `https://api.openai.com/v1` |
| `model` | 模型名称（需支持视觉） | `gpt-4o` |
| `temperature` | 生成温度 | `0.1` |
| `maxIterations` | 最大迭代次数 | `150` |

**环境变量**（优先级高于配置文件）:

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4o"
```

### 使用

#### 交互模式

```bash
node cli.js
```

进入交互模式后，可以输入各种任务指令：

```
请输入任务: 打开微信
请输入任务: 发送消息给张三：你好
请输入任务: exit
```

#### 直接执行模式

```bash
node cli.js "打开微信并发送给张三发送消息：你好"
```

#### 其他命令

```bash
# 仅连接设备并显示信息
node cli.js --connect

# 查看当前配置
node cli.js --config

# 显示帮助
node cli.js --help
```

## 🎮 可用工具

Agent 可以调用以下工具来控制设备：

| 工具 | 说明 |
|------|------|
| `capture_screenshot` | 截取设备屏幕 |
| `tap_screen` | 点击屏幕指定位置（归一化坐标 0-1000） |
| `swipe_screen` | 滑动屏幕（用于滚动） |
| `long_press` | 长按屏幕位置 |
| `type_text` | 输入文本（支持中文） |
| `press_button` | 按下导航键（home、back、recent 等） |
| `shell_command` | 执行 ADB shell 命令 |
| `wait` | 等待指定时间 |
| `task_complete` | 标记任务完成 |
| `load_skill` | 加载技能指令 |

## 🔧 坐标系统

使用归一化坐标系统（0-1000 范围），简化不同分辨率设备的操作：

- `[0, 0]` - 左上角
- `[500, 500]` - 屏幕中心
- `[1000, 1000]` - 右下角

坐标会自动转换为实际像素位置。

## 💡 Agent Skills 系统

基于渐进式披露（Progressive Disclosure）机制的技能系统：

### 三级加载机制

1. **Level 1**: 元数据优先 - 只加载技能名称和描述（~100 tokens）
2. **Level 2**: 按需加载 - AI 决定使用时才加载完整指令
3. **Level 3**: 资源访问 - 按需读取脚本/资源文件

### 技能目录结构

```
.agents/
└── skills/
    ├── text-input/
    │   └── SKILL.md
    ├── phone-gesture/
    │   └── SKILL.md
    └── ...
```

### 技能文件格式 (SKILL.md)

```markdown
---
name: skill-name
description: 技能描述
argument-hint: 可选参数提示
user-invokable: true
disable-model-invocation: false
---

## 详细指令内容

这里是具体的操作步骤和指导...
```

## 📁 项目结构

```
droidpilot-cli/
├── cli.js                 # CLI 入口文件
├── config.json           # 配置文件
├── config.json.example   # 配置示例
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript 配置
├── vite.config.ts        # Vite 构建配置
├── src/
│   ├── index.ts          # 主入口（CLI 逻辑）
│   ├── adb/              # ADB 模块
│   │   ├── index.ts      # ADB Manager（高层 API）
│   │   ├── protocol.ts   # ADB 协议处理
│   │   ├── transport.ts  # ADB 传输层
│   │   └── types.ts      # 类型定义和常量
│   └── ai/               # AI 模块
│       ├── index.ts      # 模块导出
│       ├── agent.ts      # Android Agent（LangChain）
│       └── skills/       # Skills 系统
│           ├── index.ts
│           ├── skillLoader.ts
│           └── types.ts
└── dist/                 # 编译输出
```

## 🔨 开发

```bash
# 开发模式（构建+运行）
npm run dev

# 仅构建
npm run build

# 仅运行
npm run start
```

## 📝 注意事项

### 中文输入支持

输入中文文本时，需要安装 [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard)：

1. 下载并安装 ADBKeyboard APK
2. 在设置中启用 ADBKeyboard 输入法
3. 程序会自动切换到 ADBKeyboard 进行中文输入

### 截图压缩

默认关闭截图压缩。如需启用，修改 `src/adb/index.ts` 中的配置：

```typescript
const SCREENSHOT_CONFIG = {
  enableCompression: true,  // 启用压缩
  targetWidth: 720,         // 目标宽度
  compressionLevel: 9,      // PNG 压缩级别
};
```

### 循环检测

Agent 内置操作循环检测机制，当检测到重复操作时会自动尝试替代方案。

## 🤝 支持的 API 提供商

理论上支持所有 OpenAI 兼容的多模态 API：

- 智谱 AI (GLM-4.6V)
- 阿里云通义千问 (Qwen-VL)
- 字节跳动豆包 (Doubao-Seed)
- 月之暗面 (Kimi-K2.5)
- 其他兼容提供商

> 📖 **推荐模型**：详见 [推荐模型.md](./src/推荐模型.md)

## 📄 License

MIT

## 🙏 致谢

- [LangChain.js](https://github.com/langchain-ai/langchainjs) - AI Agent 框架
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) - 中文输入支持
- [Sharp](https://github.com/lovell/sharp) - 图片处理
