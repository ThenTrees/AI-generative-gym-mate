export interface ChatMessage {
  message: string;
  userId?: string;
  conversationId?: string;
  context?: ChatContext;
}

export interface ChatContext {
  userProfile?: any;
  fitnessGoals?: any[];
  previousMessages?: any[];
}

export interface ChatResponse {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  conversationId: string;
  suggestions?: string[];
  actionItems?: string[];
  exercises?: ExerciseCard[];
  hasExercises?: boolean;
  exerciseType?: string | null;
  foods?: FoodCard[];
  hasFoods?: boolean;
  foodCategory?: string | null;
  mealTime?: string | null;
}

export interface ExerciseCard {
  id: string;
  name: string;
  description: string;
  muscle_groups: string[];
  equipment_list: string[];
  thumbnail_url: string;
  exercise_type: string;
  difficulty: string;
  instructions: string;
  sets_recommended: string;
  reps_recommended: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  exercises?: ExerciseCard[];
  hasExercises?: boolean;
  foods?: FoodCard[];
  hasFoods?: boolean;
}

export interface FoodCard {
  id: string;
  name: string;
  nameVi?: string;
  nameEn?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  category?: string;
  mealTime?: string;
  description?: string;
  benefits?: string;
  preparationTips?: string;
  commonCombinations?: string;
  imageUrl?: string;
  similarity?: number;
}

export interface ExerciseAnalysis {
  isExerciseQuery: boolean;
  targetMuscleGroup: string | null;
  exercises: any[];
}
