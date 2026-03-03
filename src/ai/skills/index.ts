/**
 * Agent Skills 入口
 * 基于 Anthropic Agent Skills 开放标准实现
 * 
 * 核心机制：渐进式披露（Progressive Disclosure）
 * - Level 1: 元数据优先（~100 tokens）
 * - Level 2: 按需加载完整指令
 * - Level 3: 按需访问脚本/资源
 */

// 从 skillLoader 导出函数
export {
  initSkillsLoader,
  discoverSkills,
  loadSkill,
  loadSkillResource,
  buildSkillsDiscoveryPrompt,
  clearSkillsCache,
} from './skillLoader';

// 从 types 导出类型
export type {
  SkillMetadata,
  Skill,
  DiscoveredSkills,
} from './types';
