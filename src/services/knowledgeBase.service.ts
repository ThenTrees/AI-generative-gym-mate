import { logger } from '../utils/logger';

interface KnowledgeCategory {
  [key: string]: string[];
}

class KnowledgeBaseService {
  private exerciseKnowledge: KnowledgeCategory;
  private nutritionKnowledge: KnowledgeCategory;
  private fitnessKnowledge: KnowledgeCategory;

  constructor() {
    this.exerciseKnowledge = this.initializeExerciseKnowledge();
    this.nutritionKnowledge = this.initializeNutritionKnowledge();
    this.fitnessKnowledge = this.initializeFitnessKnowledge();
  }

  getRelevantKnowledge(message: string, intent: string): string {
    const lowerMessage = message.toLowerCase();
    let knowledge: string[] = [];

    switch (intent) {
      case 'workout_planning':
      case 'workout_general':
      case 'exercise_technique':
        knowledge.push(...this.getExerciseKnowledge(lowerMessage));
        break;
        
      case 'nutrition_planning':
      case 'nutrition_general':
      case 'weight_loss_nutrition':
      case 'weight_gain_nutrition':
        knowledge.push(...this.getNutritionKnowledge(lowerMessage));
        break;
        
      case 'goal_setting':
      case 'motivation':
      case 'progress_tracking':
        knowledge.push(...this.getFitnessKnowledge(lowerMessage));
        break;
        
      default:
        knowledge.push(...this.getGeneralKnowledge());
    }

    return knowledge.slice(0, 5).join('\n');
  }

  private getExerciseKnowledge(message: string): string[] {
    const knowledge: string[] = [];
    
    if (message.includes('chest') || message.includes('ngực')) {
      knowledge.push(...this.exerciseKnowledge.chest);
    }
    if (message.includes('back') || message.includes('lưng')) {
      knowledge.push(...this.exerciseKnowledge.back);
    }
    if (message.includes('legs') || message.includes('chân')) {
      knowledge.push(...this.exerciseKnowledge.legs);
    }
    if (message.includes('shoulders') || message.includes('vai')) {
      knowledge.push(...this.exerciseKnowledge.shoulders);
    }
    if (message.includes('arms') || message.includes('tay')) {
      knowledge.push(...this.exerciseKnowledge.arms);
    }
    if (message.includes('cardio')) {
      knowledge.push(...this.exerciseKnowledge.cardio);
    }
    if (message.includes('strength') || message.includes('tăng cơ')) {
      knowledge.push(...this.exerciseKnowledge.strength);
    }

    return knowledge.length > 0 ? knowledge : this.exerciseKnowledge.general;
  }

  private getNutritionKnowledge(message: string): string[] {
    const knowledge: string[] = [];
    
    if (message.includes('protein')) {
      knowledge.push(...this.nutritionKnowledge.protein);
    }
    if (message.includes('carb') || message.includes('tinh bột')) {
      knowledge.push(...this.nutritionKnowledge.carbs);
    }
    if (message.includes('fat') || message.includes('chất béo')) {
      knowledge.push(...this.nutritionKnowledge.fats);
    }
    if (message.includes('calo') || message.includes('calories')) {
      knowledge.push(...this.nutritionKnowledge.calories);
    }
    if (message.includes('meal') || message.includes('bữa ăn')) {
      knowledge.push(...this.nutritionKnowledge.mealTiming);
    }

    return knowledge.length > 0 ? knowledge : this.nutritionKnowledge.general;
  }

  private getFitnessKnowledge(message: string): string[] {
    const knowledge: string[] = [];
    
    if (message.includes('goal') || message.includes('mục tiêu')) {
      knowledge.push(...this.fitnessKnowledge.goalSetting);
    }
    if (message.includes('progress') || message.includes('tiến độ')) {
      knowledge.push(...this.fitnessKnowledge.progressTracking);
    }
    if (message.includes('motivation') || message.includes('động lực')) {
      knowledge.push(...this.fitnessKnowledge.motivation);
    }

    return knowledge.length > 0 ? knowledge : this.fitnessKnowledge.general;
  }

  private getGeneralKnowledge(): string[] {
    return [
      'Thành công trong fitness = 70% dinh dưỡng + 20% tập luyện + 10% nghỉ ngơi',
      'Progressive overload là nguyên tắc quan trọng nhất để phát triển cơ bắp',
      'Consistency beats intensity - tập đều đặn quan trọng hơn tập cường độ cao thỉnh thoảng'
    ];
  }

  private initializeExerciseKnowledge(): KnowledgeCategory {
    return {
      chest: [
        'Push-ups là bài tập cơ bản tuyệt vời cho ngực, có thể modify từ dễ đến khó',
        'Bench press nên thực hiện với full range of motion, đụng nhẹ thanh vào ngực',
        'Dumbbell flyes giúp stretch và squeeze ngực hiệu quả, tập trung vào form',
        'Incline exercises phát triển phần ngực trên, decline cho phần ngực dưới'
      ],
      back: [
        'Pull-ups/chin-ups là bài tập compound tuyệt vời cho toàn bộ lưng',
        'Bent-over row cần giữ lưng thẳng, pull về phía bụng dưới',
        'Deadlift là king of exercises, phát triển toàn thân nhưng cần technique chuẩn',
        'Lat pulldown: squeeze shoulder blades, pull về phía ngực trên'
      ],
      legs: [
        'Squats: depth đến parallel hoặc sâu hơn, đầu gối theo hướng bàn chân',
        'Deadlifts phát triển cả hamstrings và glutes, form quan trọng hơn weight',
        'Lunges giúp cải thiện balance và unilateral strength',
        'Calf raises: full range of motion từ stretch đến peak contraction'
      ],
      shoulders: [
        'Overhead press phát triển toàn bộ vai, cần core stability tốt',
        'Lateral raises: controlled movement, avoid swinging',
        'Face pulls tuyệt vời cho rear delts và posture',
        'Pike push-ups là bodyweight alternative cho overhead press'
      ],
      arms: [
        'Bicep curls: avoid swinging, focus on squeeze at the top',
        'Tricep dips có thể modify difficulty bằng cách thay đổi góc chân',
        'Close-grip push-ups target triceps nhiều hơn regular push-ups',
        'Hammer curls phát triển brachialis, tạo độ dày cho tay'
      ],
      cardio: [
        'HIIT hiệu quả cho fat loss và cải thiện VO2 max trong thời gian ngắn',
        'LISS cardio tốt cho recovery và base building',
        'Zone 2 cardio (60-70% max HR) tối ưu cho fat oxidation',
        'Cardio sau strength training tối ưu cho body composition'
      ],
      strength: [
        'Progressive overload: tăng weight, reps, sets, hoặc giảm rest time',
        'Compound movements nên là nền tảng của strength training',
        'Rep ranges: 1-5 cho strength, 6-12 cho hypertrophy, 12+ cho endurance',
        'Recovery between sets: 2-5 phút cho compound, 1-2 phút cho isolation'
      ],
      general: [
        'Form luôn quan trọng hơn weight - quality over quantity',
        'Warm-up 5-10 phút trước tập, cool-down sau tập',
        'Track workouts để đảm bảo progressive overload',
        'Listen to your body - rest khi cần thiết'
      ]
    };
  }

  private initializeNutritionKnowledge(): KnowledgeCategory {
    return {
      protein: [
        'Protein: 1.6-2.2g/kg body weight cho muscle building',
        'Complete proteins chứa đủ 9 essential amino acids',
        'Leucine trigger muscle protein synthesis, nhiều trong whey và chicken',
        'Protein timing: 20-40g mỗi bữa, đặc biệt post-workout'
      ],
      carbs: [
        'Carbs là năng lượng chính cho high-intensity training',
        'Complex carbs (oats, rice, sweet potato) cung cấp năng lượng ổn định',
        'Pre-workout: 1-4g carbs/kg body weight 1-4 giờ trước tập',
        'Post-workout: 1-1.2g carbs/kg body weight để replenish glycogen'
      ],
      fats: [
        'Healthy fats cần thiết cho hormone production và absorption',
        'Omega-3 (fish, nuts) chống viêm và hỗ trợ recovery',
        'Fat intake: 20-35% total calories, tối thiểu 0.5g/kg body weight',
        'Avoid trans fats, ưu tiên mono và polyunsaturated fats'
      ],
      calories: [
        'TDEE = BMR × Activity Factor, base để tính calorie needs',
        'Weight loss: deficit 300-500 calo/ngày cho 0.5-1 pound/week',
        'Weight gain: surplus 200-300 calo/ngày cho lean gains',
        'Track calories ít nhất 2 tuần để hiểu eating patterns'
      ],
      mealTiming: [
        'Meal frequency không quan trọng bằng total daily intake',
        'Pre-workout meal 1-3 giờ trước: carbs + moderate protein',
        'Post-workout trong 2 giờ: protein + carbs cho recovery',
        'Evening protein (casein) có thể hỗ trợ overnight recovery'
      ],
      general: [
        'Hydration: 35ml/kg body weight/day, thêm 500-750ml/hour exercise',
        'Micronutrients: eat rainbow colors để đảm bảo vitamin/mineral',
        'Fiber: 25-35g/day cho digestive health',
        'Meal prep giúp maintain consistency và control portions'
      ]
    };
  }

  private initializeFitnessKnowledge(): KnowledgeCategory {
    return {
      goalSetting: [
        'SMART goals: Specific, Measurable, Achievable, Relevant, Time-bound',
        'Focus on process goals (workout 4x/week) hơn outcome goals (lose 10kg)',
        'Break big goals thành smaller milestones để maintain motivation',
        'Regular goal review và adjustment based on progress'
      ],
      progressTracking: [
        'Body composition quan trọng hơn scale weight',
        'Progress photos, measurements, performance metrics',
        'Track workouts: weights, reps, sets, RPE',
        'Weekly weigh-ins same conditions: morning, after bathroom, before eating'
      ],
      motivation: [
        'Motivation gets you started, discipline keeps you going',
        'Build systems và habits thay vì rely on willpower',
        'Find intrinsic motivation - health, energy, confidence',
        'Celebrate small wins và learn from setbacks'
      ],
      general: [
        'Consistency beats perfection - aim for 80% compliance',
        'Recovery is when adaptations happen - prioritize sleep',
        'Stress management affects hormones và recovery',
        'Find activities you enjoy để maintain long-term adherence'
      ]
    };
  }

  searchKnowledge(query: string): Array<{ category: string; content: string }> {
    const results: Array<{ category: string; content: string }> = [];
    const lowerQuery = query.toLowerCase();

    const allKnowledge = {
      ...this.exerciseKnowledge,
      ...this.nutritionKnowledge,
      ...this.fitnessKnowledge
    };

    Object.entries(allKnowledge).forEach(([category, items]) => {
      items.forEach(item => {
        if (item.toLowerCase().includes(lowerQuery)) {
          results.push({ category, content: item });
        }
      });
    });

    return results;
  }

  getKnowledgeByCategory(category: string): string[] {
    const allKnowledge = {
      ...this.exerciseKnowledge,
      ...this.nutritionKnowledge,
      ...this.fitnessKnowledge
    };

    return allKnowledge[category] || [];
  }
}

export default new KnowledgeBaseService();
