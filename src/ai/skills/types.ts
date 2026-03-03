/**
 * Agent Skills 类型定义
 */

/** 技能元数据 */
export interface SkillMetadata {
  name: string;
  description: string;
  'argument-hint'?: string;
  'user-invokable'?: boolean;
  'disable-model-invocation'?: boolean;
}

/** 完整技能定义 */
export interface Skill extends SkillMetadata {
  /** SKILL.md 正文内容 */
  content: string;
  /** 技能目录路径 */
  path: string;
}

/** 技能发现结果 */
export interface DiscoveredSkills {
  /** 元数据列表（Level 1） */
  metadata: SkillMetadata[];
  /** 可用技能名 */
  names: string[];
}
