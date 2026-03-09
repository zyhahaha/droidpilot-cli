// LangChain.js 代理用于安卓自动化（CLI版本）
// 直接使用 AdbManager 执行 ADB 操作
// 集成 Agent Skills 系统（渐进式披露）

import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { tool, DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { AdbManager } from '../adb';
// Agent Skills - 渐进式披露机制
import {
  loadSkill,
  buildSkillsDiscoveryPrompt,
} from './skills/index';

// 重新导出 initSkillsLoader 供外部使用
export { initSkillsLoader } from './skills/index';

export interface AgentConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxIterations?: number;
}

export interface AgentStep {
  thought: string;
  action: string;
  observation: string;
  timestamp: number;
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'observing' | 'complete' | 'error' | 'stopped';

/** 当前屏幕分辨率缓存，用于坐标转换 */
let currentScreenSize = { width: 1080, height: 1920 };

/** 归一化坐标转像素坐标（0-1000 范围） */
function normalizedToPixel(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round((x / 1000) * currentScreenSize.width),
    y: Math.round((y / 1000) * currentScreenSize.height),
  };
}

/** 
 * 清理消息数组中的旧截图，只保留最新的 N 张
 * 【优化】将旧截图替换为文字描述占位，维持消息结构完整
 * @param messages 消息数组
 * @param keepCount 保留完整截图的数量（默认 1）
 * @returns 处理后的消息数组
 */
function cleanOldScreenshots(
  messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage>,
  keepCount: number = 1
): Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> {
  // 找出所有包含截图的 HumanMessage 索引及其信息
  const screenshotInfos: Array<{ index: number; width?: number; height?: number }> = [];
  
  messages.forEach((msg, index) => {
    if (msg instanceof HumanMessage && Array.isArray(msg.content)) {
      const imagePart = msg.content.find(
        (part): part is { type: 'image_url'; image_url: { url: string } } =>
          part.type === 'image_url' && 'image_url' in part
      );
      if (imagePart) {
        // 尝试从 text 部分提取分辨率信息
        const textPart = msg.content.find(p => p.type === 'text');
        let width: number | undefined;
        let height: number | undefined;
        if (textPart && 'text' in textPart && typeof textPart.text === 'string') {
          // 匹配 "1080x2400" 格式
          const match = textPart.text.match(/(\d+)x(\d+)/);
          if (match) {
            width = parseInt(match[1]);
            height = parseInt(match[2]);
          }
        }
        screenshotInfos.push({ index, width, height });
      }
    }
  });

  // 如果截图数量超过保留数量，处理旧截图
  if (screenshotInfos.length > keepCount) {
    const toReplace = screenshotInfos.slice(0, screenshotInfos.length - keepCount);
    
    // 创建新消息数组，将旧截图替换为简洁占位
    const newMessages = messages.map((msg, index) => {
      const replaceInfo = toReplace.find(info => info.index === index);
      if (replaceInfo && msg instanceof HumanMessage && Array.isArray(msg.content)) {
        const resolution = replaceInfo.width && replaceInfo.height 
          ? `${replaceInfo.width}x${replaceInfo.height}` 
          : '未知';
        // 简洁占位，不保留冗余信息
        return new HumanMessage({
          content: [
            { type: 'text', text: `[历史截图 ${resolution}]` }
          ],
        });
      }
      return msg;
    });
    
    console.log(`[Agent] 已将 ${toReplace.length} 张旧截图替换为文字描述，保留最新 ${keepCount} 张完整截图`);
    return newMessages;
  }

  return messages;
}

/**
 * 检测是否陷入操作循环
 */
function detectLoop(
  messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage>,
  windowSize: number = 6
): boolean {
  if (messages.length < windowSize) return false;
  
  // 提取最近的操作序列
  const recentOps: string[] = [];
  const recentMessages = messages.slice(-windowSize);
  
  recentMessages.forEach(msg => {
    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0];
      const args = tc.args as Record<string, unknown>;
      // 标准化操作标识
      if (tc.name === 'tap_screen') {
        recentOps.push(`tap(${Math.round(Number(args.x) / 50) * 50},${Math.round(Number(args.y) / 50) * 50})`);
      } else if (tc.name === 'swipe_screen') {
        recentOps.push(`swipe`);
      } else {
        recentOps.push(tc.name);
      }
    }
  });
  
  // 检查是否有重复模式（如 A-B-A-B）
  if (recentOps.length >= 4) {
    const pattern2 = recentOps.slice(-4);
    if (pattern2[0] === pattern2[2] && pattern2[1] === pattern2[3]) {
      console.log('[Agent] 检测到操作循环:', pattern2);
      return true;
    }
  }
  
  return false;
}

/** 使用 AdbManager 构建 LangChain 兼容的工具 */
function buildLangChainTools(adbManager: AdbManager, onCapture?: (base64: string) => void) {
  const captureScreenshot: DynamicStructuredTool = tool(
    async () => {
      try {
        // 小延迟确保前一个操作已完成
        await new Promise((resolve) => setTimeout(resolve, 100));
        const capture = await adbManager.captureScreen();
        onCapture?.(capture.base64);
        
        // 更新当前屏幕分辨率（使用原始尺寸用于坐标转换）
        currentScreenSize = { width: capture.width, height: capture.height };

        // 返回 base64 图片数据和压缩后分辨率，让大模型能够"看到"屏幕并知道坐标范围
        // 注意：AI 看到的是压缩后的图片，所以告诉它压缩后的尺寸
        return `SCREENSHOT:${capture.compressedWidth}x${capture.compressedHeight}:${capture.base64}`;
      } catch (error) {
        return `截屏失败: ${error}`;
      }
    },
    {
      name: 'capture_screenshot',
      description: '截取安卓设备屏幕的截图。使用此工具查看当前屏幕状态。',
      schema: z.object({}),
    }
  );

  const tapScreen: DynamicStructuredTool = tool(
    async ({ x, y }: { x: number; y: number }) => {
      // 归一化坐标转像素坐标
      const pixel = normalizedToPixel(x, y);
      await adbManager.tap(pixel.x, pixel.y);
      // 等待点击后UI响应
      await new Promise((resolve) => setTimeout(resolve, 500));
      return `点击位置 [${x}, ${y}] -> 像素 (${pixel.x}, ${pixel.y})`;
    },
    {
      name: 'tap_screen',
      description: '在屏幕指定位置点击。使用归一化坐标（0-1000范围），其中[0,0]是左上角，[1000,1000]是右下角，[500,500]是屏幕中心。',
      schema: z.object({
        x: z.number().min(0).max(1000).describe('X坐标（归一化，0-1000范围，0表示最左边，1000表示最右边）'),
        y: z.number().min(0).max(1000).describe('Y坐标（归一化，0-1000范围，0表示最上边，1000表示最下边）'),
      }),
    }
  );

  const swipeScreen: DynamicStructuredTool = tool(
    async ({ x1, y1, x2, y2, duration }: { x1: number; y1: number; x2: number; y2: number; duration?: number }) => {
      // 归一化坐标转像素坐标
      const start = normalizedToPixel(x1, y1);
      const end = normalizedToPixel(x2, y2);
      await adbManager.swipe(start.x, start.y, end.x, end.y, duration ?? 300);
      // 等待滑动后UI响应
      await new Promise((resolve) => setTimeout(resolve, 500));
      return `滑动 [${x1},${y1}] -> [${x2},${y2}] | 像素 (${start.x},${start.y}) -> (${end.x},${end.y})`;
    },
    {
      name: 'swipe_screen',
      description: '从一个点到另一个点执行滑动手势。用于上下滚动（上滑/下滑）或左右滚动（左滑/右滑）。使用归一化坐标（0-1000范围）。',
      schema: z.object({
        x1: z.number().min(0).max(1000).describe('起始X坐标（归一化，0-1000）'),
        y1: z.number().min(0).max(1000).describe('起始Y坐标（归一化，0-1000）'),
        x2: z.number().min(0).max(1000).describe('结束X坐标（归一化，0-1000）'),
        y2: z.number().min(0).max(1000).describe('结束Y坐标（归一化，0-1000）'),
        duration: z.number().optional().describe('持续时间（毫秒，默认300）'),
      }),
    }
  );

  const typeTextTool: DynamicStructuredTool = tool(
    async ({ text }: { text: string }) => {
      await adbManager.typeText(text);
      // 等待文本输入完成
      await new Promise((resolve) => setTimeout(resolve, 500));
      return `已输入: "${text}"`;
    },
    {
      name: 'type_text',
      description: '使用虚拟键盘在设备上输入文本。',
      schema: z.object({
        text: z.string().describe('要输入的文本'),
      }),
    }
  );

  const pressButton: DynamicStructuredTool = tool(
    async ({ button }: { button: string }) => {
      const keyMap: Record<string, number> = {
        home: 3, back: 4, power: 26, volume_up: 24,
        volume_down: 25, enter: 66, delete: 67, recent: 187,
      };
      const keycode = keyMap[button.toLowerCase()];
      if (keycode === undefined) {
        return `未知按钮。可用按钮: ${Object.keys(keyMap).join(', ')}`;
      }
      await adbManager.keyEvent(keycode);
      // 等待操作完成
      await new Promise((resolve) => setTimeout(resolve, 500));
      return `已按下 ${button}`;
    },
    {
      name: 'press_button',
      description: '按下导航按钮：home、back、recent、enter、delete、power、volume_up、volume_down。',
      schema: z.object({
        button: z.string().describe('按钮名称'),
      }),
    }
  );

  const shellCommand: DynamicStructuredTool = tool(
    async ({ command }: { command: string }) => {
      const output = await adbManager.shell(command);
      // 等待命令完成
      await new Promise((resolve) => setTimeout(resolve, 300));
      return output.trim() || '(无输出)';
    },
    {
      name: 'shell_command',
      description: '在设备上执行shell命令。用于高级操作。',
      schema: z.object({
        command: z.string().describe('要执行的shell命令'),
      }),
    }
  );

  const waitTool: DynamicStructuredTool = tool(
    async ({ ms }: { ms: number }) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `已等待 ${ms}ms`;
    },
    {
      name: 'wait',
      description: '等待指定的时间（毫秒）。在操作后使用以等待UI更新。',
      schema: z.object({
        ms: z.number().describe('持续时间（毫秒）'),
      }),
    }
  );

  const longPress: DynamicStructuredTool = tool(
    async ({ x, y, duration }: { x: number; y: number; duration?: number }) => {
      // 归一化坐标转像素坐标
      const pixel = normalizedToPixel(x, y);
      await adbManager.longPress(pixel.x, pixel.y, duration ?? 1000);
      // 等待长按操作完成
      await new Promise((resolve) => setTimeout(resolve, 500));
      return `长按位置 [${x}, ${y}] -> 像素 (${pixel.x}, ${pixel.y})，持续 ${duration ?? 1000}ms`;
    },
    {
      name: 'long_press',
      description: '在指定坐标位置执行长按操作。使用归一化坐标（0-1000范围）。',
      schema: z.object({
        x: z.number().min(0).max(1000).describe('X坐标（归一化，0-1000范围）'),
        y: z.number().min(0).max(1000).describe('Y坐标（归一化，0-1000范围）'),
        duration: z.number().optional().describe('持续时间（毫秒，默认1000）'),
      }),
    }
  );

  const taskComplete: DynamicStructuredTool = tool(
    async ({ summary }: { summary: string }) => {
      return `TASK_COMPLETE: ${summary}`;
    },
    {
      name: 'task_complete',
      description: '任务完成时调用此工具。提供已完成任务的摘要。',
      schema: z.object({
        summary: z.string().describe('已完成任务的摘要'),
      }),
    }
  );

  // 【Agent Skills】技能加载工具 - AI 按需加载技能
  const loadSkillTool: DynamicStructuredTool = tool(
    async ({ skill_name }: { skill_name: string }) => {
      const skill = await loadSkill(skill_name);
      if (!skill) {
        return `技能 "${skill_name}" 不存在或加载失败。请检查技能名称是否正确。`;
      }
      return `SKILL_LOADED:${skill_name}:${skill.content}`;
    },
    {
      name: 'load_skill',
      description: '加载指定技能的完整指令。当你认为某个技能与当前任务相关时，调用此工具加载该技能的详细指导。参数：skill_name（技能名称）。',
      schema: z.object({
        skill_name: z.string().describe('要加载的技能名称（如 text-input, phone-gesture）'),
      }),
    }
  );

  return [captureScreenshot, tapScreen, swipeScreen, typeTextTool, pressButton, shellCommand, waitTool, longPress, taskComplete, loadSkillTool];
}

/** 基础 System Prompt（会被 Skills 增强） */
const BASE_SYSTEM_PROMPT = `你是一个通过ADB控制安卓手机的AI代理。你可以通过截屏查看屏幕，并执行点击、滑动、输入和按键等操作。

## 技能优先原则 ⚠️

你拥有一个技能库。**技能是经过验证的操作流程，能显著提高任务成功率。**

**执行任何操作前，必须先检查：当前任务是否匹配某个技能？**
- 匹配 → 先调用 load_skill 加载该技能，按技能指导执行
- 不匹配 → 按常规流程执行

---

## 工作流程

1. **截屏** → 查看当前屏幕状态
2. **检查技能** → 判断任务是否匹配可用技能（见下方技能列表）
3. **加载技能**（如匹配）→ 调用 load_skill，严格按技能指令执行
4. **执行操作** → 点击、滑动、输入等（操作有内置延迟）
5. **等待响应** → 短暂等待UI更新，缓慢动画使用 wait 工具
6. **验证结果** → 再次截屏确认
7. **循环执行** → 直到任务完成
8. **完成任务** → 调用 task_complete

---

## 坐标系统

- 使用归一化坐标（0-1000范围，虚拟1000×1000屏幕）
- [0, 0] = 左上角，[1000, 1000] = 右下角，[500, 500] = 屏幕正中心
- 坐标自动转换为实际像素

---

## 操作指南

- 决定操作前**始终先截屏**
- 使用归一化坐标精确定位UI元素（瞄准元素中心）
- 每次操作有300ms自动延迟
- 缓慢动画使用 wait 工具（500-1000ms）
- 操作无效时尝试替代方案
- 完成后调用 task_complete`;

/**
 * 使用LangChain.js工具调用的安卓自动化代理（CLI版本）。
 */
export class AndroidAgent {
  private adbManager: AdbManager;
  private config: AgentConfig;
  private _status: AgentStatus = 'idle';
  private _steps: AgentStep[] = [];
  private _stopped = false;
  private onStatusChange?: (status: AgentStatus) => void;
  private onStepAdd?: (step: AgentStep) => void;
  private onScreenCapture?: (base64: string) => void;

  constructor(
    adbManager: AdbManager,
    config: AgentConfig,
    callbacks?: {
      onStatusChange?: (status: AgentStatus) => void;
      onStepAdd?: (step: AgentStep) => void;
      onScreenCapture?: (base64: string) => void;
    }
  ) {
    this.adbManager = adbManager;
    this.config = config;
    this.onStatusChange = callbacks?.onStatusChange;
    this.onStepAdd = callbacks?.onStepAdd;
    this.onScreenCapture = callbacks?.onScreenCapture;
  }

  get status(): AgentStatus {
    return this._status;
  }

  get steps(): AgentStep[] {
    return [...this._steps];
  }

  private setStatus(status: AgentStatus) {
    this._status = status;
    this.onStatusChange?.(status);
  }

  private addStep(step: AgentStep) {
    this._steps.push(step);
    this.onStepAdd?.(step);
  }

  /** 使用任务运行代理 */
  async run(task: string): Promise<string> {
    this._steps = [];
    this._stopped = false;

    try {
      this.setStatus('thinking');

      // 【Level 1: 技能发现】只加载元数据，让 AI 知道有哪些技能可用
      let skillsDiscovery = '';
      try {
        skillsDiscovery = await buildSkillsDiscoveryPrompt();
      } catch {
        // 技能发现失败不影响主流程
      }

      // 构建 System Prompt（包含技能目录，但不预加载技能内容）
      const systemPrompt = BASE_SYSTEM_PROMPT + 
        (skillsDiscovery ? '\n\n' + skillsDiscovery : '');

      const tools = buildLangChainTools(this.adbManager, this.onScreenCapture);

      const llm = new ChatOpenAI({
        apiKey: this.config.apiKey,
        model: this.config.model,
        temperature: this.config.temperature ?? 0.1,
        configuration: {
          baseURL: this.config.baseUrl,
          apiKey: this.config.apiKey,
        },
      }).bindTools(tools);

      const toolMap = new Map(tools.map((t) => [t.name, t]));

      // 构建初始消息（包含技能目录）
      let messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`任务: ${task}\n\n首先截屏查看当前屏幕。`),
      ];

      const maxIterations = this.config.maxIterations ?? 15;

      this.addStep({
        thought: `开始任务: ${task}`,
        action: 'initialize',
        observation: 'Agent 初始化完成，开始执行...',
        timestamp: Date.now(),
      });

      for (let i = 0; i < maxIterations; i++) {
        if (this._stopped) {
          return '任务已被用户停止';
        }

        // 【循环检测】检查是否陷入操作循环
        if (detectLoop(messages, 6)) {
          // 【修复】追加到现有 SystemMessage，而非添加新的（OpenAI API 只允许一条 SystemMessage）
          const loopWarningContent = `\n\n⚠️ 检测到操作循环。请尝试不同的方法：
1. 使用 back 键返回上一页
2. 使用 home 键回到主屏幕
3. 尝试完全不同的操作路径
4. 如果当前方法持续失败，考虑替代方案`;
          const firstSysIdx = messages.findIndex(msg => msg instanceof SystemMessage);
          if (firstSysIdx >= 0) {
            const existingMsg = messages[firstSysIdx] as SystemMessage;
            const existingContent = typeof existingMsg.content === 'string' ? existingMsg.content : '';
            messages[firstSysIdx] = new SystemMessage(existingContent + loopWarningContent);
          }
        }

        // 调用LLM
        this.setStatus('thinking');
        const response = await llm.invoke(messages);
        messages.push(response);

        // 记录LLM思考过程
        const thinkingContent = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
        if (thinkingContent && thinkingContent.trim()) {
          console.log('[LLM 思考]:', thinkingContent);
        }

        // 检查工具调用
        const toolCalls = response.tool_calls ?? [];

        if (toolCalls.length === 0) {
          // 无工具调用 - LLM已完成
          this.addStep({
            thought: thinkingContent || '(无思考内容)',
            action: 'respond',
            observation: 'Agent 已给出最终回复',
            timestamp: Date.now(),
          });
          this.setStatus('complete');
          return thinkingContent;
        }

        // 执行工具调用
        for (const tc of toolCalls) {
          if (this._stopped) return '任务已被用户停止';

          this.setStatus('acting');
          const toolName = tc.name;
          const toolArgs = tc.args;
          const toolFn = toolMap.get(toolName);

          // 在步骤中包含LLM思考
          const thoughtPrefix = thinkingContent && thinkingContent.trim()
            ? `💭 ${thinkingContent}\n\n`
            : '';

          this.addStep({
            thought: `${thoughtPrefix}调用工具: ${toolName}`,
            action: `${toolName}(${JSON.stringify(toolArgs)})`,
            observation: '执行中...',
            timestamp: Date.now(),
          });

          let result: string;
          try {
            if (toolFn) {
              const output = await toolFn.invoke(toolArgs);
              result = typeof output === 'string' ? output : JSON.stringify(output);
            } else {
              result = `未知工具: ${toolName}`;
            }
          } catch (error) {
            result = `工具错误: ${error instanceof Error ? error.message : String(error)}`;
          }

          // 用观察结果更新最后一个步骤
          if (this._steps.length > 0) {
            this._steps[this._steps.length - 1].observation = result.startsWith('SCREENSHOT:') 
              ? '截图成功，已发送给大模型分析' 
              : result;
          }

          // 处理截图结果 - 将图片作为多模态消息发送给大模型
          if (result.startsWith('SCREENSHOT:')) {
            // 解析格式: SCREENSHOT:widthxheight:base64
            const parts = result.split(':');
            const [width, height] = parts[1].split('x').map(Number);
            const base64 = parts.slice(2).join(':'); // base64 本身可能包含冒号
            
            // 先添加工具确认
            messages.push(new ToolMessage({
              tool_call_id: tc.id ?? `call_${i}_${toolName}`,
              content: '截图成功',
            }));
            
            // 【优化】截图提示保持关键信息（坐标系统示例 + 明确指令）
            const screenshotCount = messages.filter(msg => 
              msg instanceof HumanMessage && 
              Array.isArray(msg.content) &&
              msg.content.some(p => p.type === 'image_url')
            ).length;
            
            const promptText = screenshotCount === 0 
              ? `当前屏幕截图（${width}x${height}）。

坐标系统示例：
- 点击左上角：tap_screen(x=0, y=0)
- 点击中心：tap_screen(x=500, y=500)
- 点击右下角：tap_screen(x=1000, y=1000)

请分析屏幕内容，给出归一化坐标（0-1000范围）。`
              : `屏幕截图（${width}x${height}）。请分析并给出归一化坐标（0-1000）。`;
            
            // 添加图片作为 HumanMessage
            messages.push(new HumanMessage({
              content: [
                { type: 'text', text: promptText },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${base64}`,
                    detail: 'high',
                  },
                },
              ],
            }));
            
            // 【内存优化】清理旧截图，只保留最新的 1 张
            messages = cleanOldScreenshots(messages, 1);
          } else {
            messages.push(new ToolMessage({
              tool_call_id: tc.id ?? `call_${i}_${toolName}`,
              content: result,
            }));
          }

          // 【Agent Skills】处理技能加载结果
          if (result.startsWith('SKILL_LOADED:')) {
            const parts = result.split(':');
            const skillName = parts[1];
            const skillContent = parts.slice(2).join(':');
            
            // 【优化】移除之前的 ToolMessage（只保留简短确认）
            // 找到最后一条 ToolMessage 并替换为简短版本
            const lastToolMsgIndex = messages.length - 1;
            if (messages[lastToolMsgIndex] instanceof ToolMessage) {
              messages[lastToolMsgIndex] = new ToolMessage({
                tool_call_id: tc.id ?? `call_${i}_${toolName}`,
                content: `技能 "${skillName}" 已加载`,
              });
            }
            
            // 【修复】将技能内容追加到现有的 SystemMessage 中（OpenAI API 只允许一条 SystemMessage）
            const skillContentText = `\n\n【已加载技能: ${skillName}】

${skillContent}

请根据上述技能指导继续执行任务。`;
            
            // 找到第一个 SystemMessage 并追加内容
            const firstSystemMsgIndex = messages.findIndex(msg => msg instanceof SystemMessage);
            if (firstSystemMsgIndex >= 0) {
              const existingMsg = messages[firstSystemMsgIndex] as SystemMessage;
              const existingContent = typeof existingMsg.content === 'string' ? existingMsg.content : '';
              messages[firstSystemMsgIndex] = new SystemMessage(existingContent + skillContentText);
            } else {
              // 如果没有 SystemMessage，插入到开头
              messages.unshift(new SystemMessage(skillContentText));
            }
          }

          // 检查任务是否完成
          if (result.startsWith('TASK_COMPLETE:')) {
            this.setStatus('complete');
            return result.replace('TASK_COMPLETE: ', '');
          }

          this.setStatus('observing');
        }
      }

      this.setStatus('complete');
      return '已达到最大迭代次数，任务可能未完成';
    } catch (error) {
      this.setStatus('error');
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addStep({
        thought: 'Agent 遇到错误',
        action: 'error',
        observation: errorMsg,
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  /** 停止正在运行的代理 */
  stop() {
    this._stopped = true;
    this.setStatus('stopped');
    this.addStep({
      thought: 'Agent 已被用户停止',
      action: 'stop',
      observation: '执行已中止',
      timestamp: Date.now(),
    });
  }

  /** 更新代理配置 */
  updateConfig(config: Partial<AgentConfig>) {
    this.config = { ...this.config, ...config };
  }
}
