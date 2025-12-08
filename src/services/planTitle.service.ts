import { UserProfile } from "../types/model/userProfile.model";
import { Goal } from "../types/model/goal.model";

/**
 * Service responsible for generating workout plan titles
 */
export class PlanTitleService {
  /**
   * Generate an AI-suggested title for the workout plan
   */
  generatePlanTitle(
    userProfile: UserProfile,
    goal: Goal,
    suggestedWeeks: number
  ): string {
    const fitnessLevel = userProfile.fitnessLevel;
    const objective = goal.objectiveType;

    // Create contextual title based on user profile and goals
    const titleTemplates = this.getTitleTemplates(fitnessLevel, objective);
    const selectedTemplate = this.selectBestTemplate(
      titleTemplates,
      userProfile,
      goal,
      suggestedWeeks
    );

    return this.customizeTitle(
      selectedTemplate,
      userProfile,
      goal,
      suggestedWeeks
    );
  }

  /**
   * Get title templates based on fitness level and objective
   */
  private getTitleTemplates(fitnessLevel: string, objective: string): string[] {
    const templates: Record<string, Record<string, string[]>> = {
      BEGINNER: {
        LOSE_FAT: [
          "Beginner's Fat Loss Journey",
          "Start Your Weight Loss Transformation",
          "Foundation Fat Burn Program",
          "Beginner's Weight Loss Challenge",
          "Your First Fat Loss Adventure",
        ],
        GAIN_MUSCLE: [
          "Beginner's Muscle Building Program",
          "Start Building Your Strength",
          "Foundation Muscle Growth Plan",
          "Your First Muscle Building Journey",
          "Beginner's Strength Development",
        ],
        ENDURANCE: [
          "Beginner's Endurance Builder",
          "Start Your Fitness Journey",
          "Foundation Cardio Program",
          "Beginner's Stamina Challenge",
          "Your First Endurance Adventure",
        ],
        MAINTAIN: [
          "Beginner's Wellness Program",
          "Start Your Healthy Lifestyle",
          "Foundation Fitness Plan",
          "Beginner's Health Journey",
          "Your First Wellness Program",
        ],
      },
      INTERMEDIATE: {
        LOSE_FAT: [
          "Advanced Fat Loss Transformation",
          "Intermediate Weight Loss Challenge",
          "Serious Fat Burn Program",
          "Intermediate Body Recomposition",
          "Advanced Weight Loss Journey",
        ],
        GAIN_MUSCLE: [
          "Intermediate Muscle Building Program",
          "Advanced Strength Development",
          "Serious Muscle Growth Plan",
          "Intermediate Hypertrophy Program",
          "Advanced Muscle Building Journey",
        ],
        ENDURANCE: [
          "Intermediate Endurance Challenge",
          "Advanced Cardio Program",
          "Serious Stamina Builder",
          "Intermediate Fitness Challenge",
          "Advanced Endurance Journey",
        ],
        MAINTAIN: [
          "Intermediate Wellness Program",
          "Advanced Health Maintenance",
          "Serious Fitness Plan",
          "Intermediate Lifestyle Program",
          "Advanced Wellness Journey",
        ],
      },
      ADVANCED: {
        LOSE_FAT: [
          "Elite Fat Loss Program",
          "Advanced Body Recomposition",
          "Expert Weight Loss Challenge",
          "Elite Fat Burn Transformation",
          "Advanced Fat Loss Mastery",
        ],
        GAIN_MUSCLE: [
          "Elite Muscle Building Program",
          "Advanced Hypertrophy Challenge",
          "Expert Strength Development",
          "Elite Muscle Growth Plan",
          "Advanced Muscle Mastery",
        ],
        ENDURANCE: [
          "Elite Endurance Program",
          "Advanced Cardio Challenge",
          "Expert Stamina Builder",
          "Elite Fitness Challenge",
          "Advanced Endurance Mastery",
        ],
        MAINTAIN: [
          "Elite Wellness Program",
          "Advanced Health Mastery",
          "Expert Fitness Plan",
          "Elite Lifestyle Program",
          "Advanced Wellness Mastery",
        ],
      },
    };

    return (
      templates[fitnessLevel]?.[objective] || [
        `${objective.replace("_", " ")} Training Program`,
        `${fitnessLevel} ${objective.replace("_", " ")} Program`,
        "Personalized Training Plan",
      ]
    );
  }

  /**
   * Select the best template based on user context
   */
  private selectBestTemplate(
    templates: string[],
    userProfile: UserProfile,
    goal: Goal,
    suggestedWeeks: number
  ): string {
    let selectedTemplate = templates[0]; // Default to first template

    // Health considerations
    if (userProfile.healthNote) {
      const healthNote = userProfile.healthNote.toLowerCase();
      if (healthNote.includes("knee") || healthNote.includes("back")) {
        // Choose more conservative titles
        selectedTemplate =
          templates.find(
            (t) =>
              t.toLowerCase().includes("foundation") ||
              t.toLowerCase().includes("start")
          ) || templates[0];
      }
    }

    // Plan duration considerations
    if (suggestedWeeks >= 10) {
      // Longer plans - choose more comprehensive titles
      selectedTemplate =
        templates.find(
          (t) =>
            t.toLowerCase().includes("journey") ||
            t.toLowerCase().includes("transformation") ||
            t.toLowerCase().includes("program")
        ) || templates[0];
    } else if (suggestedWeeks <= 6) {
      // Shorter plans - choose more focused titles
      selectedTemplate =
        templates.find(
          (t) =>
            t.toLowerCase().includes("challenge") ||
            t.toLowerCase().includes("start")
        ) || templates[0];
    }

    return selectedTemplate;
  }

  /**
   * Customize the selected template with user-specific details
   */
  private customizeTitle(
    template: string,
    userProfile: UserProfile,
    goal: Goal,
    suggestedWeeks: number
  ): string {
    let customizedTitle = template;

    // Add duration context for longer plans
    if (suggestedWeeks >= 12) {
      customizedTitle += ` (${suggestedWeeks}-Week Program)`;
    } else if (suggestedWeeks >= 8) {
      customizedTitle += ` (${suggestedWeeks}-Week Challenge)`;
    }

    // Add frequency context for specific cases
    if (goal.sessionsPerWeek <= 2) {
      customizedTitle += " - Low Frequency";
    } else if (goal.sessionsPerWeek >= 5) {
      customizedTitle += " - High Frequency";
    }

    // Add session duration context
    if (goal.sessionMinutes <= 30) {
      customizedTitle += " - Quick Sessions";
    } else if (goal.sessionMinutes >= 90) {
      customizedTitle += " - Extended Sessions";
    }

    return customizedTitle;
  }
}

export const planTitleService = new PlanTitleService();
