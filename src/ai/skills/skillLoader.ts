/**
 * Agent Skills 加载器
 * 实现渐进式披露（Progressive Disclosure）机制
 * 
 * Level 1: 只加载元数据（name + description）~100 tokens
 * Level 2: 按需加载完整 SKILL.md 内容
 * Level 3: 按需读取脚本/资源文件
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SkillMetadata, Skill, DiscoveredSkills } from './types';

/** 已加载的技能缓存 */
const skillsCache = new Map<string, Skill>();

/** 技能元数据缓存（Level 1） */
let metadataCache: SkillMetadata[] | null = null;

/** 技能目录路径 */
let skillsRootPath: string;

/**
 * 初始化技能系统
 */
export function initSkillsLoader(skillsPath: string): void {
  skillsRootPath = skillsPath;
  // 清除缓存
  metadataCache = null;
  skillsCache.clear();
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseSkillMd(content: string): { metadata: SkillMetadata; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    throw new Error('Invalid SKILL.md format: missing YAML frontmatter');
  }
  
  const yamlContent = match[1];
  const body = match[2];
  
  // 简单解析 YAML（仅支持基本字段）
  const metadata: Record<string, string | boolean> = {};
  const lines = yamlContent.split('\n');
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value: string | boolean = line.slice(colonIndex + 1).trim();
      
      // 移除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // 解析布尔值
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      
      metadata[key] = value;
    }
  }
  
  return {
    metadata: metadata as unknown as SkillMetadata,
    body,
  };
}

/**
 * Level 1: 发现所有技能，只加载元数据
 * 这会返回所有可用技能的 name 和 description
 */
export async function discoverSkills(): Promise<DiscoveredSkills> {
  if (metadataCache) {
    return {
      metadata: metadataCache,
      names: metadataCache.map(s => s.name),
    };
  }

  const metadata: SkillMetadata[] = [];
  
  try {
    if (!skillsRootPath || !fs.existsSync(skillsRootPath)) {
      return { metadata: [], names: [] };
    }

    const skillDirs = fs.readdirSync(skillsRootPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const skillDir of skillDirs) {
      try {
        const skillMdPath = path.join(skillsRootPath, skillDir, 'SKILL.md');
        
        if (!fs.existsSync(skillMdPath)) {
          continue;
        }
        
        // 只读取文件前 500 字符来获取元数据
        const fd = fs.openSync(skillMdPath, 'r');
        const buffer = Buffer.alloc(500);
        const bytesRead = fs.readSync(fd, buffer, 0, 500, 0);
        fs.closeSync(fd);
        
        const partialContent = buffer.toString('utf-8', 0, bytesRead);
        const { metadata: meta } = parseSkillMd(partialContent);
        metadata.push(meta);
      } catch (e) {
        console.warn(`[Skills] 解析技能元数据失败: ${skillDir}`, e);
      }
    }
  } catch (e) {
    console.warn('[Skills] 发现技能失败:', e);
  }

  metadataCache = metadata;
  
  return {
    metadata,
    names: metadata.map(s => s.name),
  };
}

/**
 * Level 2: 按需加载完整技能内容
 * 只有当 AI 决定使用该技能时才调用
 */
export async function loadSkill(name: string): Promise<Skill | null> {
  // 检查缓存
  if (skillsCache.has(name)) {
    return skillsCache.get(name)!;
  }

  try {
    if (!skillsRootPath) {
      console.warn('[Skills] Skills 未初始化');
      return null;
    }

    const skillMdPath = path.join(skillsRootPath, name, 'SKILL.md');
    
    if (!fs.existsSync(skillMdPath)) {
      console.warn(`[Skills] 技能不存在: ${name}`);
      return null;
    }
    
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { metadata, body } = parseSkillMd(content);
    
    const skill: Skill = {
      ...metadata,
      content: body,
      path: name,
    };
    
    // 缓存
    skillsCache.set(name, skill);
    
    return skill;
  } catch (e) {
    console.error(`[Skills] 加载技能失败: ${name}`, e);
    return null;
  }
}

/**
 * Level 3: 读取技能资源文件
 */
export async function loadSkillResource(
  skillName: string,
  resourcePath: string
): Promise<string | null> {
  try {
    if (!skillsRootPath) {
      console.warn('[Skills] Skills 未初始化');
      return null;
    }

    const fullPath = path.join(skillsRootPath, skillName, resourcePath);
    
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (e) {
    console.error(`[Skills] 加载资源失败: ${skillName}/${resourcePath}`, e);
    return null;
  }
}

/**
 * 构建技能发现提示词
 * 这是注入到 System Prompt 的内容，让 AI 知道有哪些技能可用
 */
export async function buildSkillsDiscoveryPrompt(): Promise<string> {
  const { metadata } = await discoverSkills();
  
  if (metadata.length === 0) {
    return '';
  }
  
  const skillsList = metadata
    .map(s => `- **${s.name}**: ${s.description}`)
    .join('\n');
  
  return `
## 可用技能清单

以下技能已针对特定场景优化。**在执行相关操作前，请务必检查是否匹配：**

${skillsList}

---

### 技能使用规则

1. **强制检查**：每次截屏后，检查当前任务是否匹配上述技能
2. **先加载后执行**：匹配技能时，必须先调用 \`load_skill\` 加载详细指令，再执行操作
3. **严格遵循**：加载技能后，严格按照技能指令的步骤执行
4. **禁止跳过**：禁止跳过匹配的技能直接凭直觉操作
5. **避免滥用**：不要在无关任务上强行使用技能
`;
}

/**
 * 清除缓存
 */
export function clearSkillsCache(): void {
  metadataCache = null;
  skillsCache.clear();
}
