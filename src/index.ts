#!/usr/bin/env node
/**
 * DroidPilot CLI - Android 设备自动化控制命令行工具
 * 
 * 使用方式:
 *   node cli.js                    # 交互模式
 *   node cli.js "打开微信"          # 直接执行任务
 *   node cli.js --config           # 查看配置
 *   node cli.js --help             # 显示帮助
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { AdbManager } from './adb';
import { AndroidAgent, type AgentConfig, type AgentStep } from './ai';
import { initSkillsLoader } from './ai/skills';

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const SKILLS_PATH = path.join(__dirname, '..', '.agents', 'skills');

// 默认配置
const DEFAULT_CONFIG: AgentConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  temperature: 0.1,
  maxIterations: 15,
};

// 命令行参数
interface CliArgs {
  task?: string;
  showHelp: boolean;
  showConfig: boolean;
  connectOnly: boolean;
  interactive: boolean;
}

/** 解析命令行参数 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    showHelp: false,
    showConfig: false,
    connectOnly: false,
    interactive: true,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.showHelp = true;
    } else if (arg === '--config' || arg === '-c') {
      result.showConfig = true;
    } else if (arg === '--connect') {
      result.connectOnly = true;
    } else if (!arg.startsWith('-')) {
      result.task = arg;
      result.interactive = false;
    }
  }

  return result;
}

/** 显示帮助信息 */
function showHelp() {
  console.log(`
DroidPilot CLI - Android 设备自动化控制命令行工具

使用方式:
  node cli.js                      交互模式
  node cli.js "打开微信"            直接执行任务
  node cli.js --connect            仅连接设备并显示信息
  node cli.js --config             查看当前配置
  node cli.js --help               显示此帮助信息

配置文件: cli/config.json
  {
    "apiKey": "your-api-key",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o",
    "temperature": 0.1,
    "maxIterations": 15
  }

环境变量:
  OPENAI_API_KEY     API Key（优先于配置文件）
  OPENAI_BASE_URL    API 基础 URL
  OPENAI_MODEL       模型名称

示例:
  # 交互模式
  node cli.js

  # 直接执行任务
  node cli.js "打开微信并发送给张三发送消息：你好"

  # 仅连接设备
  node cli.js --connect
`);
}

/** 加载配置 */
function loadConfig(): AgentConfig {
  let config = { ...DEFAULT_CONFIG };

  // 从配置文件加载
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const fileConfig = JSON.parse(fileContent);
      config = { ...config, ...fileConfig };
    } catch (e) {
      console.warn('警告: 无法加载配置文件:', e);
    }
  }

  // 环境变量覆盖
  if (process.env.OPENAI_API_KEY) {
    config.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.OPENAI_BASE_URL) {
    config.baseUrl = process.env.OPENAI_BASE_URL;
  }
  if (process.env.OPENAI_MODEL) {
    config.model = process.env.OPENAI_MODEL;
  }

  return config;
}

/** 保存配置 */
function saveConfig(config: AgentConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/** 显示配置 */
function showConfig(config: AgentConfig) {
  console.log('\n当前配置:');
  console.log(JSON.stringify({
    ...config,
    apiKey: config.apiKey ? `${config.apiKey.slice(0, 10)}...` : '(未设置)',
  }, null, 2));
  console.log(`\n配置文件: ${CONFIG_FILE}`);
}

/** 打印步骤信息 */
function printStep(step: AgentStep, index: number) {
  console.log(`\n[步骤 ${index + 1}] ${new Date(step.timestamp).toLocaleTimeString()}`);
  console.log(`  思考: ${step.thought}`);
  console.log(`  动作: ${step.action}`);
  console.log(`  观察: ${step.observation}`);
}

/** 创建 readline 接口 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/** 提示输入 */
function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/** 主函数 */
async function main() {
  const args = parseArgs();

  // 显示帮助
  if (args.showHelp) {
    showHelp();
    return;
  }

  // 加载配置
  const config = loadConfig();

  // 显示配置
  if (args.showConfig) {
    showConfig(config);
    return;
  }

  // 检查 API Key
  if (!config.apiKey) {
    console.error('错误: API Key 未配置');
    console.log('\n请设置环境变量 OPENAI_API_KEY 或在配置文件中设置 apiKey');
    console.log(`配置文件路径: ${CONFIG_FILE}`);
    
    // 提示输入 API Key
    const rl = createReadlineInterface();
    const apiKey = await prompt(rl, '请输入 API Key: ');
    rl.close();
    
    if (apiKey) {
      config.apiKey = apiKey;
      saveConfig(config);
      console.log('API Key 已保存到配置文件');
    } else {
      process.exit(1);
    }
  }

  // 初始化 Skills 系统
  initSkillsLoader(SKILLS_PATH);

  // 创建 ADB 管理器
  const adbManager = new AdbManager((state) => {
    console.log(`[ADB] 连接状态: ${state}`);
  });

  console.log('\n========================================');
  console.log('  DroidPilot CLI - Android 自动化工具');
  console.log('========================================\n');

  try {
    // 检查 ADB 可用性
    const adbAvailable = await AdbManager.isSupported();
    if (!adbAvailable) {
      console.error('错误: ADB 不可用，请确保 adb 命令在 PATH 中');
      process.exit(1);
    }

    // 连接设备
    console.log('正在连接设备...');
    const deviceInfo = await adbManager.connect();
    console.log(`设备已连接: ${deviceInfo.model} (${deviceInfo.serial})`);
    console.log(`产品: ${deviceInfo.product}`);
    console.log(`设备: ${deviceInfo.device}`);

    // 仅连接模式
    if (args.connectOnly) {
      console.log('\n设备连接成功！');
      await adbManager.disconnect();
      return;
    }

    // 获取屏幕尺寸
    const screenSize = await adbManager.getScreenSize();
    console.log(`分辨率: ${screenSize.width}x${screenSize.height}`);

    // 创建 Agent
    const agent = new AndroidAgent(adbManager, config, {
      onStatusChange: (status) => {
        const statusMap: Record<string, string> = {
          idle: '空闲',
          thinking: '思考中',
          acting: '执行中',
          observing: '观察中',
          complete: '完成',
          error: '错误',
          stopped: '已停止',
        };
        console.log(`\n[Agent] 状态: ${statusMap[status] || status}`);
      },
      onStepAdd: (step) => {
        printStep(step, agent.steps.length - 1);
      },
    });

    // 直接执行任务模式
    if (args.task) {
      console.log(`\n执行任务: ${args.task}`);
      console.log('----------------------------------------');
      
      const result = await agent.run(args.task);
      console.log('\n========================================');
      console.log('任务结果:', result);
      console.log('========================================');
    } 
    // 交互模式
    else {
      console.log('\n进入交互模式 (输入 "exit" 退出, "help" 显示帮助)');
      console.log('----------------------------------------');

      const rl = createReadlineInterface();

      while (true) {
        const task = await prompt(rl, '\n请输入任务: ');
        
        if (task.toLowerCase() === 'exit' || task.toLowerCase() === 'quit') {
          break;
        }
        
        if (task.toLowerCase() === 'help') {
          console.log(`
命令:
  help        显示帮助
  exit/quit   退出程序
  config      显示当前配置
  screenshot  截取屏幕并保存
  
任务示例:
  打开微信
  发送消息给张三：你好
  打开设置并启用深色模式
  搜索附近的餐厅
`);
          continue;
        }
        
        if (task.toLowerCase() === 'config') {
          showConfig(config);
          continue;
        }
        
        if (task.toLowerCase() === 'screenshot') {
          const capture = await adbManager.captureScreen();
          const screenshotPath = `screenshot_${Date.now()}.png`;
          const buffer = Buffer.from(capture.base64, 'base64');
          fs.writeFileSync(screenshotPath, buffer);
          console.log(`截图已保存: ${screenshotPath} (${capture.compressedWidth}x${capture.compressedHeight}, 原始 ${capture.width}x${capture.height})`);
          continue;
        }

        if (!task) {
          continue;
        }

        try {
          console.log('\n执行任务...');
          console.log('----------------------------------------');
          const result = await agent.run(task);
          console.log('\n结果:', result);
        } catch (e) {
          console.error('任务执行失败:', e);
        }
      }

      rl.close();
    }

  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    // 断开连接
    await adbManager.disconnect();
    console.log('\n设备已断开连接');
  }
}

// 运行主函数
main().catch(console.error);
