import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import knowledgeBase from './knowledgeBase.service';
import { PgVectorService } from './pgVector.service';
import { knowledgeVectorService } from './knowledgeVector.service';
import { foodVectorService } from './foodVector.service';
import { NutritionCalculationService } from './NutritionCalculation.service';
import { Objective } from '../common/common-enum';
import { NUTRITION_CONSTANTS } from '../utils/nutritionConstants';
import { v4 as uuidv4 } from 'uuid';
import { 
  ChatMessage, 
  ChatResponse, 
  ChatContext, 
  ExerciseCard, 
  ConversationMessage,
  ExerciseAnalysis,
  FoodCard
} from '../types/model/chatbot.model';

class ChatbotService {
  private openai: OpenAI | null = null;
  private gemini: GoogleGenerativeAI | null = null;
  private pgVector: PgVectorService;
  private nutritionCalculator: NutritionCalculationService;
  private conversations: Map<string, ConversationMessage[]> = new Map();
  private translationCache: Map<string, string> = new Map();

  constructor() {
    this.pgVector = new PgVectorService();
    this.nutritionCalculator = new NutritionCalculationService();
    this.initializeAI();
  }

  private initializeAI(): void {
    try {
      if (process.env.GEMINI_API_KEY_V2) {
        this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_V2);
        logger.info('Gemini AI V2 initialized ✅');
      }

      if (!this.openai && !this.gemini) {
        logger.warn('No AI API keys configured. Using fallback responses.');
      }
    } catch (error: any) {
      logger.error('Error initializing AI services:', error);
    }
  }

  async processMessage({ message, userId, conversationId, context }: ChatMessage): Promise<ChatResponse> {
    try {
      // Quick responses for greetings
      const quickResponse = this.checkQuickResponse(message, context?.userProfile);
      if (quickResponse) {
        logger.info(`Quick response for greeting: "${message}"`);

        this.storeConversationMessage(conversationId || '', {
          role: 'user',
          content: message,
          timestamp: new Date().toISOString()
        });

        this.storeConversationMessage(conversationId || '', {
          role: 'assistant',
          content: quickResponse.content,
          timestamp: new Date().toISOString()
        });

        return {
          id: uuidv4(),
          role: 'assistant',
          content: quickResponse.content,
          timestamp: new Date().toISOString(),
          conversationId: conversationId || uuidv4(),
          suggestions: quickResponse.suggestions,
          actionItems: quickResponse.actionItems
        };
      }

      const activeConversationId = conversationId || uuidv4();
      const conversationHistory = this.getConversationFromMemory(activeConversationId) || [];
      
      // Analyze message intent
      const intent = this.analyzeMessageIntent(message);
      logger.info(`Message intent analyzed: "${intent}" for message: "${message}"`);

      // Analyze exercise intent and search for relevant exercises
      const exerciseAnalysis = await this.analyzeExerciseIntent(message);
      if (exerciseAnalysis?.isExerciseQuery) {
        logger.info(`Exercise query detected! Found ${exerciseAnalysis.exercises.length} relevant exercises`);
      }

      // ✅ NEW: Analyze nutrition intent and search for relevant foods
      const nutritionAnalysis = await this.analyzeNutritionIntent(message, context?.userProfile, context?.fitnessGoals);
      if (nutritionAnalysis?.isNutritionQuery) {
        logger.info(`Nutrition query detected! Found ${nutritionAnalysis.foods.length} relevant foods`);
      }

      // Build AI context
      const aiContext = await this.buildAIContext({
        message,
        userProfile: context?.userProfile,
        conversationHistory: conversationHistory.slice(-5),
        intent,
        userId,
        exerciseAnalysis,
        nutritionAnalysis
      });

      // Generate AI response
      let response: any;
      if (this.gemini) {
        try {
          logger.info('Using Gemini AI for response generation');
          response = await this.generateGeminiResponse(aiContext);
        } catch (error: any) {
          logger.warn('Gemini failed, using fallback:', error.message);
          response = this.generateFallbackResponse(message, intent);
        }
      } else {
        logger.warn(' No AI service available, using fallback responses');
        response = this.generateFallbackResponse(message, intent);
      }

      // Add exercise data to response if available
      if (exerciseAnalysis?.isExerciseQuery && exerciseAnalysis.exercises.length > 0) {
        // Format exercises properly like in backend-ai
        response.exercises = exerciseAnalysis.exercises.map((ex: any) => ({
          id: ex.id || `ex-${Date.now()}`,
          name: ex.name,
          description: ex.description || ex.exercise_description || '',
          muscle_groups: Array.isArray(ex.muscle_groups)
            ? ex.muscle_groups
            : (ex.muscle_groups ? ex.muscle_groups.split(', ') : []),
          equipment_list: Array.isArray(ex.equipment_list)
            ? ex.equipment_list
            : (ex.equipment_list ? ex.equipment_list.split(', ') : []),
          thumbnail_url: ex.thumbnail_url || ex.image_url || '',
          exercise_type: ex.exercise_type || ex.exercise_category || 'general',
          difficulty: ex.difficulty || 'intermediate',
          instructions: ex.instructions || '',
          sets_recommended: ex.sets_recommended || '3',
          reps_recommended: ex.reps_recommended || '10-12'
        }));
        response.exerciseType = exerciseAnalysis.targetMuscleGroup;
        response.hasExercises = true;
        
        logger.info(`✅ Added ${response.exercises.length} structured exercises to response`);
        logger.info(`📊 Response structure: hasExercises=${response.hasExercises}, exerciseCount=${response.exercises.length}, exerciseType=${response.exerciseType}`);
      } else {
        logger.info(`⚠️ No exercises added - isExerciseQuery: ${exerciseAnalysis?.isExerciseQuery}, count: ${exerciseAnalysis?.exercises?.length || 0}`);
      }

      // ✅ NEW: Add food data to response if available
      if (nutritionAnalysis?.isNutritionQuery && nutritionAnalysis.foods.length > 0) {
        response.foods = nutritionAnalysis.foods.map((food: any) => ({
          id: food.id,
          name: food.name,
          nameVi: food.nameVi,
          nameEn: food.nameEn,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          fiber: food.fiber,
          category: food.category,
          mealTime: food.mealTime,
          description: food.description,
          benefits: food.benefits,
          preparationTips: food.preparationTips,
          commonCombinations: food.commonCombinations,
          imageUrl: food.imageUrl,
          similarity: food.similarity
        }));
        response.hasFoods = true;
        response.foodCategory = nutritionAnalysis.category;
        response.mealTime = nutritionAnalysis.mealTime;
        
        logger.info(`✅ Added ${response.foods.length} structured foods to response`);
        logger.info(`📊 Response structure: hasFoods=${response.hasFoods}, foodCount=${response.foods.length}, category=${response.foodCategory}`);
      } else {
        logger.info(`⚠️ No foods added - isNutritionQuery: ${nutritionAnalysis?.isNutritionQuery}, count: ${nutritionAnalysis?.foods?.length || 0}`);
      }

      // Store conversation
      this.storeConversationMessage(activeConversationId, {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      });

      this.storeConversationMessage(activeConversationId, {
        role: 'assistant',
        content: response.content,
        timestamp: new Date().toISOString(),
        exercises: response.exercises || [],
        hasExercises: response.hasExercises || false,
        foods: response.foods || [],
        hasFoods: response.hasFoods || false
      });

      return {
        id: uuidv4(),
        role: 'assistant',
        content: response.content,
        timestamp: new Date().toISOString(),
        conversationId: activeConversationId,
        suggestions: response.suggestions || [],
        actionItems: response.actionItems || [],
        exercises: response.exercises || [],
        hasExercises: response.hasExercises || false,
        exerciseType: response.exerciseType || null,
        foods: response.foods || [],
        hasFoods: response.hasFoods || false,
        foodCategory: response.foodCategory || null,
        mealTime: response.mealTime || null
      };

    } catch (error: any) {
      logger.error('Error processing message:', error);
      return {
        id: uuidv4(),
        role: 'assistant',
        content: 'Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau ít phút.',
        timestamp: new Date().toISOString(),
        conversationId: conversationId || uuidv4(),
        suggestions: ['Thử lại', 'Liên hệ hỗ trợ']
      };
    }
  }

  private checkQuickResponse(message: string, userProfile?: any): any {
    const lowerMessage = message.toLowerCase().trim();
    const userName = userProfile?.full_name || userProfile?.fullName || 'bạn';

    const greetingPatterns = [
      /^(hi|hello|hey|chào|xin chào|chao|helo|hê lô|chào bạn|xin chao)$/i,
      /^(hi there|hey there|hello there|chào AI|chao AI)$/i,
      /^(good morning|good afternoon|good evening|buổi sáng|buoi sang)$/i
    ];

    for (const pattern of greetingPatterns) {
      if (pattern.test(lowerMessage)) {
        const greetingResponses = [
          `👋 Chào ${userName}! Mình là AI Coach của NT GymMate.\nHãy chia sẻ mục tiêu của bạn nhé!`,
          `🤖 Hi ${userName}! Rất vui được hỗ trợ bạn!\n\n🌟 Một số chủ đề phổ biến:\n• Tạo kế hoạch tập luyện\n• Tư vấn dinh dưỡng\n• Gợi ý bài tập theo nhóm cơ\n• Động lực tập luyện\n\nBạn muốn bắt đầu với chủ đề nào? 🚀`,
          `👋 Xin chào ${userName}! Chào mừng đến với NT GymMate!\n\n💡 Hôm nay bạn muốn:\n🎯 Đặt mục tiêu fitness mới?\n🏃 Tìm bài tập phù hợp?\n🥗 Lên kế hoạch dinh dưỡng?\n📈 Theo dõi tiến độ?\n\nChỉ cần hỏi mình bất cứ điều gì! 😊`
        ];

        return {
          content: greetingResponses[Math.floor(Math.random() * greetingResponses.length)],
          suggestions: ['Tạo kế hoạch tập luyện', 'Gợi ý bài tập hôm nay', 'Tư vấn dinh dưỡng'],
          actionItems: [],
          quickResponse: true
        };
      }
    }

    const thankPatterns = [
      /^(thanks|thank you|cảm ơn|cam on|thanks a lot|thank you so much|cảm ơn nhiều)$/i
    ];

    for (const pattern of thankPatterns) {
      if (pattern.test(lowerMessage)) {
        const thankResponses = [
          `🙏 Không có gì! Luôn sẵn sàng hỗ trợ bạn trên hành trình fitness!\n\n💪 Keep up the great work!`,
          `😊 Rất vui được giúp đỡ! Hãy nhớ rằng mình luôn ở đây nếu bạn cần!\n\n🚀 Let's crush those goals!`,
          `✨ You're welcome! Chúc bạn tập luyện hiệu quả!\n\n🔥 Stay strong, stay motivated!`
        ];

        return {
          content: thankResponses[Math.floor(Math.random() * thankResponses.length)],
          suggestions: ['Tiếp tục hỏi đáp', 'Xem tiến độ', 'Tìm bài tập mới'],
          actionItems: [],
          quickResponse: true
        };
      }
    }

    return null;
  }

  private analyzeMessageIntent(message: string): string {
    const lowerMessage = message.toLowerCase();

    // Complex query detection
    if (lowerMessage.match(/lịch tập.*thực đơn|thực đơn.*lịch tập|plan.*nutrition|nutrition.*plan|tập.*ăn|ăn.*tập/)) {
      if (lowerMessage.match(/tăng cơ|tang co|muscle|bulk|mass|hypertrophy|xây dựng cơ/)) {
        return 'muscle_gain_comprehensive';
      }
      if (lowerMessage.match(/giảm cân|giam can|lose weight|weight loss|cut|fat loss/)) {
        return 'weight_loss_comprehensive';
      }
      return 'fitness_comprehensive';
    }

    if (lowerMessage.match(/tăng cơ|tang co|muscle gain|build muscle|bulk|hypertrophy/)) {
      return 'workout_planning';
    }

    if (lowerMessage.match(/giảm cân|giam can|lose weight|weight loss|giảm béo|giảm mỡ|cut|deficit|fat loss/)) {
      return 'workout_planning';
    }

    if (lowerMessage.match(/tập luyện|tap luyen|workout|gym|exercise|bài tập|bai tap|training/)) {
      if (lowerMessage.match(/plan|kế hoạch|ke hoach|lịch tập|lich tap|schedule|program/)) {
        return 'workout_planning';
      }
      if (lowerMessage.match(/form|kỹ thuật|ky thuat|technique|cách thực hiện|hướng dẫn/)) {
        return 'exercise_technique';
      }
      return 'workout_general';
    }

    if (lowerMessage.match(/an|dinh duong|nutrition|calo|protein|carb|fat|meal|thuc don|thuc an|do an/)) {
      if (lowerMessage.match(/plan|ke hoach|menu|meal plan|thuc don/)) {
        return 'nutrition_planning';
      }
      if (lowerMessage.match(/giam can|lose weight|cut|deficit/)) {
        return 'weight_loss_nutrition';
      }
      if (lowerMessage.match(/tang can|tang co|gain weight|bulk|surplus/)) {
        return 'weight_gain_nutrition';
      }
      return 'nutrition_general';
    }

    if (lowerMessage.match(/mục tiêu|goal|target|objective/)) {
      return 'goal_setting';
    }

    if (lowerMessage.match(/mệt|tired|lazy|lười|khó khăn|motivation|động lực|không muốn|chán|boring|give up|bỏ cuộc|stress|áp lực/)) {
      return 'motivation';
    }

    if (lowerMessage.match(/tiến độ|progress|kết quả|result|tracking|theo dõi|đo lường/)) {
      return 'progress_tracking';
    }

    return 'general';
  }

  private async buildAIContext(params: any): Promise<any> {
    const { message, userProfile, conversationHistory, intent, userId, exerciseAnalysis, nutritionAnalysis } = params;

    // ✅ NEW: Retrieve knowledge using RAG
    let retrievedKnowledge = '';
    
    try {
      // Determine category từ intent
      let category: string | undefined;
      if (intent.includes('workout') || intent.includes('exercise')) {
        category = 'exercise';
      } else if (intent.includes('nutrition') || intent.includes('meal')) {
        category = 'nutrition';
      } else if (intent.includes('goal') || intent.includes('motivation') || intent.includes('progress')) {
        category = 'fitness';
      }

      // Semantic search trong knowledge embeddings
      const knowledgeResults = await knowledgeVectorService.similaritySearch(
        message,
        5, // top 5
        category
      );

      if (knowledgeResults.length > 0) {
        retrievedKnowledge = '\n📚 KIẾN THỨC LIÊN QUAN (RAG):\n';
        knowledgeResults.forEach((result, idx) => {
          retrievedKnowledge += `${idx + 1}. ${result.content}\n`;
          if (result.subcategory) {
            retrievedKnowledge += `   (${result.category}/${result.subcategory}, similarity: ${(result.similarity! * 100).toFixed(1)}%)\n`;
          }
        });
        logger.info(`✅ Retrieved ${knowledgeResults.length} knowledge items using RAG`);
      } else {
        // Fallback: dùng old knowledge base nếu không tìm thấy
        logger.warn('No RAG results found, using fallback knowledge base');
        retrievedKnowledge = knowledgeBase.getRelevantKnowledge(message, intent);
      }
    } catch (error) {
      logger.error('Error retrieving knowledge with RAG:', error);
      // Fallback to old method
      retrievedKnowledge = knowledgeBase.getRelevantKnowledge(message, intent);
    }

    // Format exercise data for AI if available
    let exerciseData = '';
    if (exerciseAnalysis?.isExerciseQuery && exerciseAnalysis.exercises.length > 0) {
      exerciseData = '\n🏋️‍♂️ BÀI TẬP PHÙ HỢP TỪ DATABASE:\n';
      if (exerciseAnalysis.targetMuscleGroup) {
        exerciseData += `Nhóm cơ: ${exerciseAnalysis.targetMuscleGroup}\n\n`;
      }
      
      exerciseAnalysis.exercises.forEach((exercise: any, index: number) => {
        exerciseData += `${index + 1}. ${exercise.name}\n`;
        if (exercise.description) {
          exerciseData += `   - Mô tả: ${exercise.description}\n`;
        }
        if (exercise.muscle_groups && exercise.muscle_groups.length > 0) {
          const muscleGroups = Array.isArray(exercise.muscle_groups) 
            ? exercise.muscle_groups.join(', ') 
            : exercise.muscle_groups;
          exerciseData += `   - Nhóm cơ: ${muscleGroups}\n`;
        }
        if (exercise.difficulty) {
          exerciseData += `   - Độ khó: ${exercise.difficulty}\n`;
        }
        exerciseData += '\n';
      });

      exerciseData += '\n💡 HƯỚNG DẪN CHO AI:\n';
      exerciseData += '- Hãy giới thiệu những bài tập này một cách chi tiết và hấp dẫn\n';
      exerciseData += '- Đưa ra lời khuyên về cách thực hiện và lưu ý an toàn\n';
      exerciseData += '- Gợi ý số set, rep phù hợp với người dùng\n';
      exerciseData += '- Khuyến khích người dùng nhấn vào bài tập để xem chi tiết\n';
      exerciseData += '- Có thể đề xuất tạo kế hoạch tập luyện với những bài tập này\n\n';
    }

    // ✅ NEW: Format food data for AI if available
    let foodData = '';
    if (nutritionAnalysis?.isNutritionQuery && nutritionAnalysis.foods.length > 0) {
      foodData = '\n🍎 THỰC PHẨM PHÙ HỢP TỪ DATABASE:\n';
      
      // Add nutrition context if available
      if (nutritionAnalysis.nutritionContext) {
        const ctx = nutritionAnalysis.nutritionContext;
        foodData += `\n📊 NGỮ CẢNH DINH DƯỠNG CỦA NGƯỜI DÙNG:\n`;
        foodData += `- Mục tiêu: ${ctx.objective === Objective.LOSE_FAT ? 'Giảm cân' : ctx.objective === Objective.GAIN_MUSCLE ? 'Tăng cơ' : 'Duy trì'}\n`;
        foodData += `- TDEE: ${ctx.tdee} calories/ngày\n`;
        foodData += `- Target calories: ${ctx.targetCalories} calories/ngày\n`;
        foodData += `- Target protein: ${ctx.targetProtein}g/ngày\n`;
        foodData += `- Target carbs: ${ctx.targetCarbs}g/ngày\n`;
        foodData += `- Target fat: ${ctx.targetFat}g/ngày\n\n`;
      }
      
      if (nutritionAnalysis.category) {
        foodData += `Danh mục: ${nutritionAnalysis.category}\n`;
      }
      if (nutritionAnalysis.mealTime) {
        const mealTimeMap: Record<string, string> = {
          'breakfast': 'Bữa sáng',
          'lunch': 'Bữa trưa',
          'dinner': 'Bữa tối',
          'snack': 'Đồ ăn vặt'
        };
        foodData += `Bữa ăn: ${mealTimeMap[nutritionAnalysis.mealTime] || nutritionAnalysis.mealTime}\n`;
      }
      foodData += '\n';
      
      nutritionAnalysis.foods.forEach((food: any, index: number) => {
        foodData += `${index + 1}. ${food.name}\n`;
        foodData += `   - Calories: ${food.calories} kcal\n`;
        foodData += `   - Protein: ${food.protein}g\n`;
        foodData += `   - Carbs: ${food.carbs}g\n`;
        foodData += `   - Fat: ${food.fat}g\n`;
        if (food.fiber) {
          foodData += `   - Fiber: ${food.fiber}g\n`;
        }
        if (food.description) {
          foodData += `   - Mô tả: ${food.description.substring(0, 150)}${food.description.length > 150 ? '...' : ''}\n`;
        }
        if (food.benefits) {
          foodData += `   - Lợi ích: ${food.benefits.substring(0, 150)}${food.benefits.length > 150 ? '...' : ''}\n`;
        }
        if (food.preparationTips) {
          foodData += `   - Cách chế biến: ${food.preparationTips.substring(0, 100)}${food.preparationTips.length > 100 ? '...' : ''}\n`;
        }
        if (food.commonCombinations) {
          foodData += `   - Kết hợp với: ${food.commonCombinations}\n`;
        }
        foodData += '\n';
      });

      foodData += '\n💡 HƯỚNG DẪN CHO AI:\n';
      foodData += '- Giới thiệu các thực phẩm này một cách hấp dẫn và tự nhiên\n';
      foodData += '- Giải thích lợi ích dinh dưỡng phù hợp với mục tiêu của người dùng\n';
      foodData += '- Gợi ý cách chế biến và kết hợp các món ăn\n';
      foodData += '- Đưa ra lời khuyên về portion size phù hợp\n';
      foodData += '- Có thể đề xuất tạo meal plan với những thực phẩm này\n';
      foodData += '- Trả lời tự nhiên, thân thiện như một chuyên gia dinh dưỡng\n\n';
    }

    const systemPrompt = `Bạn là một AI Coach thông minh của ứng dụng GymMate, chuyên về fitness và dinh dưỡng.

THÔNG TIN NGƯỜI DÙNG:
${userProfile ? `
- Tên: ${userProfile.full_name || userProfile.fullName || 'Không rõ'}
- Email: ${userProfile.email || 'Không rõ'}
- Tuổi: ${userProfile.age || 'Không rõ'}
- Giới tính: ${userProfile.gender || 'Không rõ'}
- Cân nặng: ${userProfile.weight_kg || userProfile.weight || 'Không rõ'} kg
- Chiều cao: ${userProfile.height_cm || userProfile.height || 'Không rõ'} cm
- BMI: ${userProfile.bmi || 'Không rõ'}
` : 'Thông tin người dùng chưa có'}

NGỮ CẢNH CUỘC TRÒ CHUYỆN:
Intent: ${intent}
${conversationHistory.length > 0 ? `
Lịch sử chat gần đây:
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}
` : ''}

${retrievedKnowledge}
${exerciseData}
${foodData}

HƯỚNG DẪN:
1. Trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp
2. Cá nhân hóa lời khuyên dựa trên thông tin người dùng
3. 🚨 QUAN TRỌNG - FORMAT TEXT:
   - ❌ KHÔNG dùng dấu ** để in đậm (markdown không render)
   - ✅ Dùng CAPS cho tiêu đề quan trọng
   - ✅ Dùng emoji thay cho symbols: 🏋️ 💪 🔥 ✨ 🎯 etc.
   - ✅ VD: "🏋️ KẾ HOẠCH TẬP LUYỆN" thay vì "**Kế hoạch tập luyện**"
4. Đưa ra lời khuyên thực tế, dễ thực hiện
5. Khuyến khích và tạo động lực tích cực
6. Độ dài trả lời: 50-200 từ, súc tích và dễ đọc
7. Có thể đề xuất hành động cụ thể nếu phù hợp

Hãy trả lời câu hỏi sau một cách hữu ích và chuyên nghiệp:`;

    return {
      systemPrompt,
      userMessage: message,
      conversationHistory
    };
  }

  private async generateGeminiResponse(context: any): Promise<any> {
    try {
      const model = this.gemini!.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `${context.systemPrompt}\n\nCâu hỏi: ${context.userMessage}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const content = response.text();

      return {
        content: content.trim(),
        suggestions: this.generateSuggestions(context.userMessage),
        actionItems: this.generateActionItems(content, 'gemini_response')
      };
    } catch (error: any) {
      logger.error('Gemini API error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  private generateFallbackResponse(message: string, intent: string): any {
    const responses: any = {
      workout_planning: {
        content: 'Tôi có thể giúp bạn tạo kế hoạch tập luyện! 💪\n\nBạn có thể:\n• Tạo kế hoạch tự do theo ý muốn\n• Để AI tạo kế hoạch tối ưu cho bạn\n\nHãy cho tôi biết mục tiêu và thời gian có sẵn của bạn!',
        suggestions: ['Tăng cơ bắp', 'Giảm cân', 'Tăng sức bền', 'Tập cho người mới']
      },
      nutrition_planning: {
        content: 'Dinh dưỡng rất quan trọng! Hãy chia sẻ mục tiêu và sở thích ăn uống để tôi tư vấn phù hợp.',
        suggestions: ['Tăng cơ nutrition', 'Giảm mỡ nutrition', 'Tính TDEE', 'Meal prep']
      },
      motivation: {
        content: `💪 "Success isn't given. It's earned."\n\nTôi hiểu cảm giác này! Mọi champion đều trải qua những ngày khó khăn. Hãy nhớ:\n\n✨ Tiến bộ không phải đường thẳng\n🎯 Mỗi workout là đầu tư cho tương lai\n🔥 Bạn mạnh mẽ hơn mình nghĩ\n\nHôm nay chỉ cần 20 phút thôi. Start small, stay consistent! 🚀`,
        suggestions: ['Workout 15 phút', 'Đặt mục tiêu nhỏ', 'Tìm motivation']
      },
      general: {
        content: `🤖 TÔI LÀ AI COACH CỦA GYMMATE!\n\nTôi có thể giúp bạn:\n🏋️ Workout planning & technique\n🍎 Nutrition & meal prep\n💪 Motivation & goal setting\n📊 Progress tracking\n\nBạn muốn bắt đầu với chủ đề nào?`,
        suggestions: ['Workout planning', 'Nutrition advice', 'Motivation tips']
      }
    };

    const response = responses[intent] || responses.general;
    return {
      content: response.content,
      suggestions: response.suggestions,
      actionItems: this.generateActionItems(response.content, intent)
    };
  }

  private generateSuggestions(message: string): string[] {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('tập luyện') || lowerMessage.includes('workout')) {
      return ['Tạo plan tập luyện', 'Gợi ý bài tập', 'Hướng dẫn kỹ thuật'];
    }

    if (lowerMessage.includes('ăn') || lowerMessage.includes('nutrition')) {
      return ['Tính TDEE', 'Lập thực đơn', 'Tư vấn macro'];
    }

    return ['Workout planning', 'Nutrition advice', 'Motivation tips'];
  }

  private generateActionItems(content: string, intent: string): any[] {
    const actionItems: any[] = [];

    if (content.includes('kế hoạch') || content.includes('plan') || intent === 'workout_planning') {
      actionItems.push({ 
        type: 'create_plan', 
        text: 'Tạo kế hoạch tập luyện',
        screen: 'CreateCustomPlan'
      });
      actionItems.push({ 
        type: 'ai_plan', 
        text: 'Tạo kế hoạch bằng AI',
        screen: 'AIPlanner'
      });
    }

    return actionItems;
  }

  private storeConversationMessage(conversationId: string, message: ConversationMessage): void {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, []);
    }

    const conversation = this.conversations.get(conversationId)!;
    conversation.push(message);

    if (conversation.length > 20) {
      conversation.splice(0, conversation.length - 20);
    }
  }

  private getConversationFromMemory(conversationId: string): ConversationMessage[] {
    return this.conversations.get(conversationId) || [];
  }

  async getConversationHistory(conversationId: string, userId?: string): Promise<ConversationMessage[]> {
    return this.getConversationFromMemory(conversationId);
  }

  async clearConversation(conversationId: string, userId?: string): Promise<boolean> {
    this.conversations.delete(conversationId);
    return true;
  }

  /**
   * Translate Vietnamese query to English for better exercise search
   */
  private async translateQuery(query: string): Promise<string> {
    // Check cache first
    if (this.translationCache.has(query)) {
      const cached = this.translationCache.get(query)!;
      logger.info(`Using cached translation: "${query}" → "${cached}"`);
      return cached;
    }

    try {
      if (!this.gemini) {
        logger.warn('Gemini not available, using original query');
        return query;
      }

      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `Translate this Vietnamese fitness/exercise query to English. Return only the English translation, no explanation or additional text.

Vietnamese: "${query}"
English:`;

      const result = await model.generateContent(prompt);
      const translated = (await result.response.text()).trim();
      
      // Cache the translation
      this.translationCache.set(query, translated);
      
      logger.info(`✅ Translated: "${query}" → "${translated}"`);
      return translated;
    } catch (error: any) {
      logger.warn(`Translation failed for "${query}", using original:`, error.message);
      return query; // Fallback to original query
    }
  }

  /**
   * Analyze message for nutrition intent and search foods using FoodVector
   * Uses user profile to provide smart recommendations
   */
  private async analyzeNutritionIntent(
    message: string,
    userProfile?: any,
    fitnessGoals?: any[]
  ): Promise<{
    isNutritionQuery: boolean;
    foods: any[];
    category?: string;
    mealTime?: string;
    nutritionContext?: any;
  } | null> {
    try {
      const nutritionKeywords = [
        'thực phẩm', 'món ăn', 'đồ ăn', 'food', 'meal', 'món',
        'protein', 'carb', 'calo', 'calories', 'dinh dưỡng', 'nutrition',
        'ăn', 'bữa', 'sáng', 'trưa', 'tối', 'breakfast', 'lunch', 'dinner', 'snack',
        'thịt', 'cá', 'rau', 'trái cây', 'fruit', 'vegetable', 'meat', 'fish', 'seafood',
        'gà', 'bò', 'heo', 'chicken', 'beef', 'pork', 'tôm', 'cua',
        'gợi ý món', 'món gì', 'nên ăn', 'ăn gì', 'thực đơn',
        'giảm cân', 'tăng cơ', 'bulk', 'cut', 'diet',
        // ✅ MỞ RỘNG: Thêm keywords cho các query về dinh dưỡng
        'gợi ý', 'đề xuất', 'suggest', 'recommend', 'recommendation',
        'bữa sáng', 'bữa trưa', 'bữa tối', 'bữa phụ',
        'yến mạch', 'trứng', 'sữa', 'chuối', 'thịt gà', 'cá hồi',
        'healthy', 'lành mạnh', 'tốt cho', 'bổ dưỡng',
        'macro', 'macros', 'chất đạm', 'chất béo', 'tinh bột',
        'hỏi về', 'thông tin về', 'tác dụng của', 'lợi ích của'
      ];

      const lowerMessage = message.toLowerCase();
      
      // Check if message is about nutrition/food
      const isNutritionQuery = nutritionKeywords.some(keyword =>
        lowerMessage.includes(keyword.toLowerCase())
      );

      if (!isNutritionQuery) {
        return null;
      }

      // Extract meal time if mentioned
      let mealTime: string | undefined;
      if (lowerMessage.includes('sáng') || lowerMessage.includes('breakfast') || lowerMessage.includes('bữa sáng')) {
        mealTime = 'breakfast';
      } else if (lowerMessage.includes('trưa') || lowerMessage.includes('lunch') || lowerMessage.includes('bữa trưa')) {
        mealTime = 'lunch';
      } else if (lowerMessage.includes('tối') || lowerMessage.includes('dinner') || lowerMessage.includes('bữa tối')) {
        mealTime = 'dinner';
      } else if (lowerMessage.includes('snack') || lowerMessage.includes('ăn vặt')) {
        mealTime = 'snack';
      }

      // Extract category if mentioned
      let category: string | undefined;
      if (lowerMessage.includes('thịt') || lowerMessage.includes('meat')) {
        category = 'meat';
      } else if (lowerMessage.includes('cá') || lowerMessage.includes('fish') || lowerMessage.includes('seafood')) {
        category = 'seafood';
      } else if (lowerMessage.includes('rau') || lowerMessage.includes('vegetable')) {
        category = 'vegetable';
      } else if (lowerMessage.includes('trái cây') || lowerMessage.includes('fruit')) {
        category = 'fruit';
      } else if (lowerMessage.includes('gà') || lowerMessage.includes('chicken')) {
        category = 'poultry';
      }

      // Calculate nutrition context from user profile
      let nutritionContext: any = null;
      if (userProfile) {
        try {
          // Get user goal if available
          const goal = fitnessGoals && fitnessGoals.length > 0 ? fitnessGoals[0] : null;
          
          if (goal && userProfile.weight && userProfile.height && userProfile.age) {
            // Calculate nutrition targets
            const nutritionTarget = this.nutritionCalculator.calculateNutritionTarget(
              {
                age: userProfile.age,
                gender: userProfile.gender,
                height: userProfile.height_cm || userProfile.height,
                weight: userProfile.weight_kg || userProfile.weight,
                bmi: userProfile.bmi,
                fitnessLevel: userProfile.fitnessLevel || 'BEGINNER'
              },
              {
                id: goal.id || '',
                objectiveType: goal.objectiveType || Objective.MAINTAIN,
                sessionsPerWeek: goal.sessionsPerWeek || 3,
                sessionMinutes: goal.sessionMinutes || 60
              },
              true // Assume training day for now
            );

            nutritionContext = {
              targetCalories: nutritionTarget.targetCalories,
              targetProtein: nutritionTarget.macros.proteinG,
              targetCarbs: nutritionTarget.macros.carbsG,
              targetFat: nutritionTarget.macros.fatG,
              tdee: nutritionTarget.tdee,
              objective: goal.objectiveType || Objective.MAINTAIN
            };

            logger.info(`📊 Calculated nutrition context: ${nutritionContext.targetCalories} cal, ${nutritionContext.targetProtein}g protein`);
          }
        } catch (error) {
          logger.warn('Failed to calculate nutrition context:', error);
        }
      }

      // Search for foods
      let foods: any[] = [];

      try {
        // ✅ CẢI THIỆN: Build better query text giống meal plan service để embedding tốt hơn
        let searchQuery = message;
        if (mealTime && nutritionContext) {
          // Build query text chi tiết hơn với context
          const mealTimeMap: Record<string, string> = {
            'breakfast': 'bữa sáng',
            'lunch': 'bữa trưa',
            'dinner': 'bữa tối',
            'snack': 'đồ ăn vặt'
          };
          
          const mealCalories = Math.round(nutritionContext.targetCalories * 0.3);
          searchQuery = `Gợi ý món ăn cho ${mealTimeMap[mealTime] || mealTime} với khoảng ${mealCalories} calories`;
          
          if (nutritionContext.objective === Objective.GAIN_MUSCLE) {
            const mealProtein = Math.round(nutritionContext.targetProtein * 0.3);
            searchQuery += `, giàu protein khoảng ${mealProtein}g`;
          } else if (nutritionContext.objective === Objective.LOSE_FAT) {
            searchQuery += `, ít calo, nhiều chất xơ`;
          }
        } else if (mealTime) {
          // Nếu chỉ có mealTime, cải thiện query
          const mealTimeMap: Record<string, string> = {
            'breakfast': 'bữa sáng',
            'lunch': 'bữa trưa',
            'dinner': 'bữa tối',
            'snack': 'đồ ăn vặt'
          };
          searchQuery = `Gợi ý món ăn cho ${mealTimeMap[mealTime] || mealTime}`;
        }
        
        const queryEmbedding = await this.pgVector.embed(searchQuery);
        
        logger.info(`🔍 Searching foods for query: "${searchQuery}" (original: "${message}")`);

        // ✅ Build filters - GIỐNG MEAL PLAN SERVICE: chỉ dùng maxCalories, KHÔNG dùng minProtein
        const filters: any = {};
        if (category) filters.category = category;
        if (mealTime) filters.mealTime = mealTime;
        
        // Add nutrition filters if context available
        if (nutritionContext) {
          // Calculate max calories for this meal (30% of daily target) - giống meal plan service
          filters.maxCalories = Math.round(nutritionContext.targetCalories * 0.3);
          
          // ❌ BỎ minProtein filter - quá strict, loại bỏ nhiều foods
          // Scoring sẽ xử lý protein preference sau
        }

        logger.info(`📋 Food search filters: ${JSON.stringify(filters)}`);

        // Search foods with filters - dùng constant để có nhiều options
        const searchLimit = Math.min(NUTRITION_CONSTANTS.DEFAULT_SEARCH_LIMIT, 20); // Max 20 để không quá nhiều
        const foodResults = await foodVectorService.searchFoodsByVector(
          queryEmbedding,
          filters,
          [], // excludedIds - empty for now
          searchLimit
        );

        logger.info(`🔍 Initial search returned ${foodResults?.length || 0} foods`);

        // ✅ FALLBACK: Nếu không tìm thấy với filters, thử lại không có filters
        let finalResults = foodResults || [];
        if (finalResults.length === 0 && Object.keys(filters).length > 0) {
          logger.warn('⚠️ No foods found with filters, trying without filters...');
          const foodResultsNoFilter = await foodVectorService.searchFoodsByVector(
            queryEmbedding,
            {}, // No filters
            [],
            searchLimit
          );
          if (foodResultsNoFilter && foodResultsNoFilter.length > 0) {
            finalResults = foodResultsNoFilter;
            logger.info(`✅ Found ${finalResults.length} foods without filters`);
          }
        }

        if (finalResults && finalResults.length > 0) {
          // ✅ SORT và RANK theo nutrition context (giống meal plan service)
          let sortedFoods = finalResults;
          
          if (nutritionContext) {
            // Sort by similarity first, then by nutrition match
            sortedFoods = finalResults.sort((a: any, b: any) => {
              // Priority: similarity > protein (for muscle gain) > calories match
              let scoreA = (a.similarity || 0) * 100;
              let scoreB = (b.similarity || 0) * 100;
              
              if (nutritionContext.objective === Objective.GAIN_MUSCLE) {
                // Bonus for high protein foods (max 30 bonus points)
                scoreA += Math.min((a.protein || 0) / 2, 30);
                scoreB += Math.min((b.protein || 0) / 2, 30);
              } else if (nutritionContext.objective === Objective.LOSE_FAT) {
                // Bonus for lower calories (max 20 bonus points)
                scoreA += Math.max(0, 20 - (a.calories || 0) / 20);
                scoreB += Math.max(0, 20 - (b.calories || 0) / 20);
              }
              
              return scoreB - scoreA;
            });
          }
          
          // Take top foods after sorting (dùng constant thay vì hardcode)
          const maxFoods = NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS;
          foods = sortedFoods.slice(0, maxFoods).map((food: any) => ({
            id: food.foodId,
            name: food.foodNameVi || food.foodName,
            nameVi: food.foodNameVi,
            nameEn: food.foodName,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            fiber: food.fiber,
            category: food.category,
            mealTime: food.mealTime,
            description: food.description,
            benefits: food.detailedBenefits,
            preparationTips: food.preparationTips,
            commonCombinations: food.commonCombinations,
            imageUrl: food.imageUrl,
            similarity: food.similarity
          }));

          logger.info(`✅ Found ${foods.length} relevant foods from database (after sorting)`);
        } else {
          logger.warn(`⚠️ No foods found even without filters`);
        }
      } catch (error: any) {
        logger.error('Error searching foods with FoodVector:', error);
        foods = [];
      }

      return {
        isNutritionQuery: true,
        foods: foods || [],
        category,
        mealTime,
        nutritionContext
      };

    } catch (error: any) {
      logger.error('Error analyzing nutrition intent:', error);
      return null;
    }
  }

  /**
   * Analyze message for exercise intent and search exercises using pgVector
   */
  private async analyzeExerciseIntent(message: string): Promise<ExerciseAnalysis | null> {
    try {
      const exerciseKeywords = [
        'bài tập', 'tập', 'exercise', 'workout', 'luyện tập',
        'ngực', 'chest', 'bụng', 'abs', 'tay', 'arm', 'chân', 'leg',
        'vai', 'shoulder', 'lưng', 'back', 'bicep', 'tricep',
        'squat', 'push up', 'pull up', 'plank', 'deadlift',
        'gym', 'fitness', 'cardio', 'strength'
      ];

      const muscleGroupMap: Record<string, string> = {
        'ngực': 'chest',
        'chest': 'chest',
        'bụng': 'abs',
        'abs': 'abs',
        'core': 'abs',
        'tay': 'arms',
        'arm': 'arms',
        'arms': 'arms',
        'chân': 'legs',
        'leg': 'legs',
        'legs': 'legs',
        'vai': 'shoulders',
        'shoulder': 'shoulders',
        'shoulders': 'shoulders',
        'lưng': 'back',
        'back': 'back',
        'bicep': 'biceps',
        'biceps': 'biceps',
        'tricep': 'triceps',
        'triceps': 'triceps'
      };

      const lowerMessage = message.toLowerCase();

      // Check if message is about exercises
      const isExerciseQuery = exerciseKeywords.some(keyword =>
        lowerMessage.includes(keyword.toLowerCase())
      );

      if (!isExerciseQuery) {
        return null;
      }

      // Extract muscle group
      let targetMuscleGroup: string | null = null;
      for (const [keyword, muscleGroup] of Object.entries(muscleGroupMap)) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          targetMuscleGroup = muscleGroup;
          break;
        }
      }

      // Search for exercises
      let exercises: any[] = [];

      if (targetMuscleGroup) {
        logger.info(`🔍 Searching exercises for muscle group: ${targetMuscleGroup}`);
      }

      try {
        // Translate query to English for better search results
        const translatedQuery = await this.translateQuery(message);
        
        // Build search query with translated text
        const searchQuery = targetMuscleGroup 
          ? `${translatedQuery} ${targetMuscleGroup} exercises`
          : translatedQuery;
        
        logger.info(`🔍 Searching with translated query: "${searchQuery}"`);
        
        const results = await this.pgVector.similaritySearch(searchQuery, 5, 0.2);
        
        if (results && results.length > 0) {
          // Get exercise IDs from embedding documents
          const exerciseIds = results.map((doc: any) => doc.exerciseId).filter(Boolean);
          
          if (exerciseIds.length > 0) {
            // Fetch full exercise details from database
            const fullExercises = await this.pgVector.getExercisesByIds(exerciseIds);
            
            exercises = fullExercises.map((ex: any) => ({
              id: ex.id,
              name: ex.name,
              description: ex.instructions || '',
              exercise_description: ex.instructions || '',
              muscle_groups: ex.primaryMuscle || [],
              primaryMuscle: ex.primaryMuscle,
              equipment_list: ex.equipment || [],
              equipment: ex.equipment,
              thumbnail_url: ex.thumbnailUrl || '',
              image_url: ex.thumbnailUrl || '',
              exercise_type: ex.exerciseCategory || 'general',
              exercise_category: ex.exerciseCategory,
              difficulty: ex.difficultyLevel || 'intermediate',
              level: ex.difficultyLevel,
              instructions: ex.instructions || '',
              sets_recommended: '3',
              reps_recommended: '10-12',
              bodyPart: ex.bodyPart,
              benefits: ex.benefits,
              safetyNotes: ex.safetyNotes
            }));
            
            logger.info(`✅ Found ${exercises.length} exercises using pgVector + database`);
          }
        }
      } catch (error: any) {
        logger.error('Error searching exercises with pgVector:', error);
        exercises = [];
      }

      // Fallback to mock data if no results
      if (exercises.length === 0) {
        logger.info(`⚠️ No exercises from database, using mock data`);
        exercises = this.getMockExercises(targetMuscleGroup || 'general');
      }

      logger.info(`✅ Final exercises count: ${exercises.length}`);

      return {
        isExerciseQuery: true,
        targetMuscleGroup,
        exercises: exercises || []
      };

    } catch (error: any) {
      logger.error('Error analyzing exercise intent:', error);
      return null;
    }
  }

  /**
   * Get mock exercises for fallback
   */
  private getMockExercises(muscleGroup: string): ExerciseCard[] {
    const mockData: Record<string, ExerciseCard[]> = {
      chest: [
        {
          id: 'mock-1',
          name: 'Push-ups',
          description: 'Bài tập cơ bản hiệu quả cho ngực',
          muscle_groups: ['Ngực', 'Vai', 'Tay sau'],
          equipment_list: ['Không cần dụng cụ'],
          thumbnail_url: '',
          difficulty: 'beginner',
          exercise_type: 'strength',
          sets_recommended: '3-4',
          reps_recommended: '10-15',
          instructions: 'Nằm sấp, tay đặt rộng vai, đẩy người lên xuống'
        },
        {
          id: 'mock-2',
          name: 'Bench Press',
          description: 'Bài tập nâng tạ cho ngực',
          muscle_groups: ['Ngực', 'Vai', 'Tay sau'],
          equipment_list: ['Ghế tập', 'Tạ đòn'],
          thumbnail_url: '',
          difficulty: 'intermediate',
          exercise_type: 'strength',
          sets_recommended: '4',
          reps_recommended: '8-12',
          instructions: 'Nằm ngửa trên ghế, hạ tạ xuống ngực rồi đẩy lên'
        }
      ],
      back: [
        {
          id: 'mock-3',
          name: 'Pull-ups',
          description: 'Bài tập xà đơn cho lưng',
          muscle_groups: ['Lưng', 'Tay trước'],
          equipment_list: ['Xà đơn'],
          thumbnail_url: '',
          difficulty: 'intermediate',
          exercise_type: 'strength',
          sets_recommended: '3',
          reps_recommended: '5-10',
          instructions: 'Treo người trên xà, kéo người lên đến khi cằm qua xà'
        }
      ],
      general: [
        {
          id: 'mock-4',
          name: 'Burpees',
          description: 'Bài toàn thân đốt mỡ hiệu quả',
          muscle_groups: ['Toàn thân'],
          equipment_list: ['Không cần dụng cụ'],
          thumbnail_url: '',
          difficulty: 'intermediate',
          exercise_type: 'cardio',
          sets_recommended: '3',
          reps_recommended: '10-15',
          instructions: 'Squat, chống tay xuống, kick chân ra sau, push-up, nhảy lên'
        }
      ]
    };

    return mockData[muscleGroup] || mockData.general;
  }
}

export default new ChatbotService();
