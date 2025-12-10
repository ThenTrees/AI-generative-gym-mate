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
    profile: UserProfile,
    notes?: string
  ): string {
    return `Ngữ cảnh: Bạn là chuyên gia về sức khỏe và thể dục.

YÊU CẦU CHUNG:
- Phân tích "Input" (dòng dưới) và trả về **CHỈ** một JSON array (có thể rỗng []).
- Mỗi phần tử phải có các trường: "type", "affectedArea", "restrictions", "modifications".
- Chỉ dùng các giá trị từ danh sách hợp lệ cho "restrictions" và "modifications" (không tạo giá trị mới).

DANH SÁCH HỢP LỆ:
restrictions: ["high_impact","deep_squat","heavy_loading","spinal_flexion","overhead","internal_rotation","jumping","running","push_up","heavy_pressing","hyperextension"]
modifications: ["partial_range","low_impact_alternatives","neutral_spine","core_focus","reduced_range","stability_focus","controlled_range","neutral_grip","wrist_support","neutral_position","mobility_focus","supportive_bracing","balance_training"]

PHƯƠNG PHÁP (theo bước):
BƯỚC 1: Trích từ khóa y tế / triệu chứng trong input.
BƯỚC 2: Xác định vùng bị ảnh hưởng (ví dụ: "knee","spine","shoulder","hip","ankle","wrist","neck","elbow").
BƯỚC 3: Gán type: "joint_limitation" | "injury_history" | "mobility_issue".
BƯỚC 4: Map triệu chứng -> restrictions bằng cách dùng danh sách hợp lệ.
BƯỚC 5: Đề xuất tối đa 4 modifications phù hợp từ danh sách hợp lệ.
BƯỚC 6: Nếu không tìm thấy vấn đề rõ ràng, trả về [].

VÍ DỤS:
Input: "Tôi bị đau khớp gối khi squat sâu"
Output:
[
  {
    "type": "joint_limitation",
    "affectedArea": "knee",
    "restrictions": ["deep_squat","high_impact"],
    "modifications": ["partial_range","low_impact_alternatives"]
  }
]

Input: "Thoát vị đĩa đệm L4-L5, đau khi gập người"
Output:
[
  {
    "type": "injury_history",
    "affectedArea": "spine",
    "restrictions": ["spinal_flexion","heavy_loading"],
    "modifications": ["neutral_spine","reduced_range","core_focus"]
  }
]

BÂY GIỜ PHÂN TÍCH THIS CASE:
User profile:
- Age: ${profile.age || "Không rõ"}
- Gender: ${profile.gender || "Không rõ"}
- Weight: ${profile.weight || "Không rõ"} kg
- Height: ${profile.height || "Không rõ"} cm
Notes: "${notes || profile.healthNote || ""}"

QUY TẮC TRẢ VỀ:
- CHỈ TRẢ VỀ JSON array, KHÔNG có văn bản giải thích.
- Mọi giá trị trong "restrictions" và "modifications" phải là 1 trong danh sách hợp lệ ở trên.
- Giới hạn tối đa 6 phần tử trong mảng.
`;
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
