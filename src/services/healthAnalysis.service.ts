import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../utils/logger";
import { loadConfig } from "../configs/environment";
import { UserProfile } from "../types/model/userProfile.model";
import { HealthConsideration } from "../types/model/healthConsideration";

const config = loadConfig();
/**
 * Service responsible for analyzing user health conditions
 * and generating health considerations for workout planning
 */
export class HealthAnalysisService {
  private gemini: GoogleGenerativeAI | null = null;

  constructor() {
    this.initializeAI();
  }

  private initializeAI(): void {
    try {
      if (config.gemini.apiKey) {
        this.gemini = new GoogleGenerativeAI(config.gemini.apiKey);
        logger.info("Gemini AI initialized for health analysis ✅");
      } else {
        logger.warn(
          "GEMINI_API_KEY not configured. Health analysis will use fallback method."
        );
      }
    } catch (error: any) {
      logger.error("Error initializing AI services:", error);
    }
  }

  /**
   * Analyze health considerations for a user
   * Tries AI analysis first, falls back to rule-based if AI is unavailable
   */
  async analyzeHealthConsiderations(
    userProfile: UserProfile,
    notes?: string
  ): Promise<HealthConsideration[]> {
    // Try AI analysis first if available
    if (this.gemini && notes !== "") {
      try {
        const aiConsiderations = await this.analyzeWithAI(userProfile, notes);
        if (aiConsiderations && aiConsiderations.length > 0) {
          logger.info(
            `AI health analysis completed: ${aiConsiderations.length} considerations found`
          );
          return aiConsiderations;
        }
      } catch (error: any) {
        logger.warn(
          `AI health analysis failed, falling back to rule-based: ${error.message}`
        );
      }
    }

    // Fallback to rule-based analysis
    return this.analyzeFallback(userProfile);
  }

  /**
   * Analyze health considerations using AI (Gemini)
   */
  private async analyzeWithAI(
    userProfile: UserProfile,
    notes?: string
  ): Promise<HealthConsideration[]> {
    if (!this.gemini || notes === "") {
      return [];
    }

    try {
      const model = this.gemini.getGenerativeModel({
        model: "gemini-2.5-flash",
      });

      const prompt = this.buildHealthAnalysisPrompt(userProfile, notes);
      console.log("prompt", prompt);
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      return this.parseAIResponse(text);
    } catch (error: any) {
      logger.error(`AI health analysis error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build the prompt for AI health analysis
   */
  private buildHealthAnalysisPrompt(
    userProfile: UserProfile,
    notes?: string
  ): string {
    return `Bạn là một chuyên gia về sức khỏe và thể dục. Phân tích thông tin sức khỏe của người dùng và đưa ra các cân nhắc về sức khỏe cho việc tập luyện.

THÔNG TIN NGƯỜI DÙNG:
- Tuổi: ${userProfile.age || "Không rõ"}
- Giới tính: ${userProfile.gender || "Không rõ"}
- Cân nặng: ${userProfile.weight || "Không rõ"} kg
- Chiều cao: ${userProfile.height || "Không rõ"} cm
- Ghi chú sức khỏe: ${notes || userProfile.healthNote || "Không có"}

NHIỆM VỤ:
Phân tích ghi chú sức khỏe và trả về danh sách các cân nhắc về sức khỏe dưới dạng JSON. Mỗi cân nhắc bao gồm:
- type: "joint_limitation" | "injury_history" | "mobility_issue"
- affectedArea: vùng cơ thể bị ảnh hưởng (ví dụ: "knee", "spine", "shoulder", "hip", "ankle", "wrist", "neck", "elbow")
- restrictions: mảng các hạn chế (ví dụ: ["high_impact", "deep_squat", "heavy_loading", "overhead", "jumping", "running"])
- modifications: mảng các điều chỉnh đề xuất (ví dụ: ["partial_range", "low_impact_alternatives", "neutral_spine", "core_focus"])

CÁC LOẠI HẠN CHẾ PHỔ BIẾN:
- "high_impact": các bài tập tác động mạnh
- "deep_squat": squat sâu
- "heavy_loading": tải trọng nặng
- "spinal_flexion": gập cột sống
- "overhead": động tác trên đầu
- "internal_rotation": xoay trong
- "jumping": nhảy
- "running": chạy
- "push_up": hít đất
- "heavy_pressing": ép/đẩy nặng
- "hyperextension": duỗi quá mức

CÁC ĐIỀU CHỈNH PHỔ BIẾN:
- "partial_range": phạm vi chuyển động một phần
- "low_impact_alternatives": thay thế tác động thấp
- "neutral_spine": giữ cột sống trung tính
- "core_focus": tập trung vào cơ core
- "reduced_range": giảm phạm vi
- "stability_focus": tập trung vào ổn định
- "controlled_range": phạm vi có kiểm soát
- "neutral_grip": nắm trung tính
- "wrist_support": hỗ trợ cổ tay
- "neutral_position": vị trí trung tính
- "mobility_focus": tập trung vào linh hoạt
- "supportive_bracing": nẹp hỗ trợ
- "balance_training": tập thăng bằng

TRẢ LỜI:
Chỉ trả về JSON array, không có text giải thích. Nếu không có vấn đề sức khỏe nào được phát hiện, trả về mảng rỗng [].

Ví dụ format:
[
  {
    "type": "injury_history",
    "affectedArea": "knee",
    "restrictions": ["high_impact", "deep_squat"],
    "modifications": ["partial_range", "low_impact_alternatives"]
  }
]`;
  }

  /**
   * Parse AI response and extract health considerations
   */
  private parseAIResponse(text: string): HealthConsideration[] {
    let considerations: HealthConsideration[] = [];
    try {
      // Extract JSON from response (might have markdown code blocks)
      let jsonText = text.trim();
      // Remove markdown code blocks if present
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
      jsonText = jsonText.trim();

      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        considerations = parsed;
      } else if (
        parsed.considerations &&
        Array.isArray(parsed.considerations)
      ) {
        considerations = parsed.considerations;
      }

      // Validate structure
      considerations = considerations.filter((c) => {
        return (
          c.type &&
          c.affectedArea &&
          Array.isArray(c.restrictions) &&
          Array.isArray(c.modifications)
        );
      });

      logger.info(
        `✅ AI analyzed health note: found ${considerations.length} considerations`
      );
    } catch (parseError: any) {
      logger.error(
        `Failed to parse AI response: ${parseError.message}. Response: ${text}`
      );
      return [];
    }
    console.log("considerations", considerations);
    return considerations;
  }

  /**
   * Fallback rule-based health analysis
   */
  private analyzeFallback(userProfile: UserProfile): HealthConsideration[] {
    const considerations: HealthConsideration[] = [];

    if (!userProfile.healthNote) {
      return considerations;
    }

    const healthNote = userProfile.healthNote.toLowerCase();

    // Health condition mappings
    const healthConditions: Record<
      string,
      Omit<HealthConsideration, "affectedArea">
    > = {
      knee: {
        type: "injury_history",
        restrictions: ["high_impact", "deep_squat"],
        modifications: ["partial_range", "low_impact_alternatives"],
      },
      back: {
        type: "joint_limitation",
        restrictions: ["heavy_loading", "spinal_flexion"],
        modifications: ["neutral_spine", "core_focus"],
      },
      shoulder: {
        type: "injury_history",
        restrictions: ["overhead", "internal_rotation"],
        modifications: ["reduced_range", "stability_focus"],
      },
      hip: {
        type: "mobility_issue",
        restrictions: ["deep_squat", "high_impact"],
        modifications: ["shallow_squat", "controlled_range"],
      },
      ankle: {
        type: "injury_history",
        restrictions: ["jumping", "running"],
        modifications: ["low_impact", "balance_training"],
      },
      wrist: {
        type: "injury_history",
        restrictions: ["push_up", "heavy_pressing"],
        modifications: ["neutral_grip", "wrist_support"],
      },
      neck: {
        type: "mobility_issue",
        restrictions: ["heavy_shrugs", "awkward_positions"],
        modifications: ["neutral_position", "mobility_focus"],
      },
      elbow: {
        type: "injury_history",
        restrictions: ["heavy_pressing", "hyperextension"],
        modifications: ["controlled_range", "supportive_bracing"],
      },
    };

    // Check for each health condition
    for (const [condition, consideration] of Object.entries(healthConditions)) {
      if (healthNote.includes(condition)) {
        logger.info(`Detected ${condition} problem`);
        considerations.push({
          ...consideration,
          affectedArea: condition === "back" ? "spine" : condition,
        });
      }
    }

    if (considerations.length === 0) {
      logger.info("No health issues detected - user health is good!");
    }

    return considerations;
  }
}

export const healthAnalysisService = new HealthAnalysisService();
