// 视觉模型服务 - 可配置的AI视觉API

export interface VisionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface VisionAnalysis {
  description: string;
  elements: ScreenElement[];
  suggestedAction?: string;
  rawResponse: string;
}

export interface ScreenElement {
  type: string;
  text?: string;
  description: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

const DEFAULT_CONFIG: VisionConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
};

/**
 * 视觉模型服务。
 * 将截图发送到可配置的视觉API进行分析。
 * 支持OpenAI兼容的端点。
 */
export class VisionService {
  private config: VisionConfig;

  constructor(config?: Partial<VisionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  updateConfig(config: Partial<VisionConfig>) {
    this.config = { ...this.config, ...config };
  }

  get isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  /** 使用视觉模型分析截图 */
  async analyzeScreen(
    base64Image: string,
    userPrompt: string,
    systemPrompt?: string
  ): Promise<VisionAnalysis> {
    if (!this.config.apiKey) {
      throw new Error('API Key 未配置');
    }

    const messages = [
      {
        role: 'system' as const,
        content:
          systemPrompt ||
          `你是一个分析安卓手机截图的AI助手。请描述你在屏幕上看到的内容，识别可交互元素（按钮、文本框、图标、链接），并建议完成用户目标的最佳操作。

在建议操作时，请在回复中使用以下JSON格式：
{
  "description": "你在屏幕上看到的内容",
  "elements": [
    { "type": "button|text|input|icon|image", "text": "可见文本", "description": "元素描述", "bounds": { "x": 0, "y": 0, "width": 100, "height": 50 } }
  ],
  "suggestedAction": "建议的下一步操作描述"
}

请始终使用有效的JSON格式回复。`,
      },
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`,
              detail: 'high',
            },
          },
        ],
      },
    ];

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: 4096,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`视觉 API 错误 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    // 尝试解析结构化响应
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          description: parsed.description ?? content,
          elements: parsed.elements ?? [],
          suggestedAction: parsed.suggestedAction,
          rawResponse: content,
        };
      }
    } catch {
      // 继续处理非结构化响应
    }

    return {
      description: content,
      elements: [],
      rawResponse: content,
    };
  }
}
