import { Client } from "pg";
import { DATABASE_CONFIG } from "../configs/database";
import { Exercise } from "../types/model/exercise.model";
import { Muscle } from "../types/model/muscle.model";

export class ExerciseLoader {
  private client: Client;

  constructor() {
    this.client = new Client(DATABASE_CONFIG);
  }

  async loadExercises(): Promise<Exercise[]> {
    await this.client.connect();

    try {
      // Use existing schema with proper JOINs
      const query = `
        SELECT 
          e.id,
          e.slug,
          e.name,
          e.primary_muscle,
          m.name as primary_muscle_name,
          e.equipment,
          e.body_part,
          e.exercise_category,
          e.difficulty_level,
          e.instructions,
          e.safety_notes,
          e.thumbnail_url,
          e.benefits,
          e.tags,
          e.alternative_names,
          m.name as muscle_name,
          bp.name as body_part_name,
          eq.name as equipment_name,
          ec.name as category_name
        FROM exercises e
        LEFT JOIN muscles m ON e.primary_muscle = m.code
        LEFT JOIN body_parts bp ON e.body_part = bp.code  
        LEFT JOIN equipments eq ON e.equipment = eq.code
        LEFT JOIN exercise_categories ec ON e.exercise_category = ec.code
        WHERE e.is_deleted = false
        ORDER BY e.name
      `;

      const result = await this.client.query(query);
      const exercises: Exercise[] = [];

      for (const row of result.rows) {
        const exercise: Exercise = {
          id: row.id,
          slug: row.slug,
          name: row.name,
          primaryMuscle: {
            code: row.primary_muscle,
            name: row.primary_muscle_name,
          },
          equipment: {
            code: row.equipment,
            name: row.equipment_name,
          },

          bodyPart: row.body_part_name ?? row.body_part,

          exerciseCategory: {
            code: row.exercise_category,
            name: row.category_name,
          },
          secondaryMuscles: [],
          difficultyLevel: row.difficulty_level,
          instructions: row.instructions,
          safetyNotes: row.safety_notes,
          thumbnailUrl: row.thumbnail_url,
          benefits: row.benefits,
          tags: row.tags || [],
          alternativeNames: row.alternative_names || [],
        };

        exercises.push(exercise);
      }

      console.log(`✅ Loaded ${exercises.length} exercises from database`);
      return exercises;
    } finally {
      await this.client.end();
    }
  }

  createExerciseContent(exercise: Exercise): string {
    const parts = [
      `Exercise: ${exercise.name}`,
      `Primary Muscle: ${exercise.primaryMuscle.name}`,
      `Body Part: ${exercise.bodyPart}`,
      `Equipment: ${exercise.equipment.name}`,
      `Category: ${exercise.exerciseCategory.name}`,
      `Difficulty: ${exercise.difficultyLevel}/5`,
      `Secondary Muscle: ${exercise.secondaryMuscles
        .map((muscle: Muscle) => muscle.name)
        .join(", ")}`,
    ];

    if (exercise.instructions) {
      parts.push(`Instructions: ${exercise.instructions}`);
    }

    if (exercise.benefits) {
      parts.push(`Benefits: ${exercise.benefits}`);
    }

    if (exercise.safetyNotes) {
      parts.push(`Safety: ${exercise.safetyNotes}`);
    }

    if (exercise.tags && exercise.tags.length > 0) {
      parts.push(`Tags: ${exercise.tags.join(", ")}`);
    }

    if (exercise.alternativeNames && exercise.alternativeNames?.length > 0) {
      parts.push(`Also known as: ${exercise.alternativeNames.join(", ")}`);
    }

    // Add generated tags
    parts.push(`Suitable for: ${this.generateTags(exercise)}`);

    return parts.join("\n");
  }

  private generateTags(exercise: Exercise): string {
    const tags: string[] = [];

    // Body part variations
    tags.push(exercise.bodyPart.toLowerCase());

    // Equipment-based tags
    if (exercise.equipment.code === "body_weight") {
      tags.push("no equipment", "home workout", "calisthenics", "bodyweight");
    } else if (exercise.equipment.name.includes("dumbbell")) {
      tags.push("free weights", "dumbbells", "unilateral");
    } else if (exercise.equipment.name.includes("barbell")) {
      tags.push("barbell", "heavy weights", "bilateral");
    } else if (exercise.equipment.name.includes("machine")) {
      tags.push("gym machine", "assisted", "guided movement");
    } else if (exercise.equipment.name.includes("cable")) {
      tags.push("cable machine", "variable resistance");
    } else if (exercise.equipment.name.includes("kettlebell")) {
      tags.push("kettlebell", "functional", "dynamic");
    } else if (exercise.equipment.name.includes("kettlebell")) {
      tags.push("kettlebell", "functional", "dynamic");
    }

    // Difficulty-based tags
    if (exercise.difficultyLevel <= 2) {
      tags.push("beginner", "easy", "starter", "basic");
    } else if (exercise.difficultyLevel >= 4) {
      tags.push("advanced", "challenging", "expert", "intense");
    } else {
      tags.push("intermediate", "moderate");
    }

    // Name-based functional tags
    const name = exercise.name.toLowerCase();
    if (name.includes("squat")) {
      tags.push(
        "compound",
        "functional",
        "lower body",
        "leg power",
        "hip hinge"
      );
    }
    if (name.includes("press") || name.includes("push")) {
      tags.push("pushing movement", "strength", "power");
    }
    if (name.includes("pull") || name.includes("row")) {
      tags.push("pulling movement", "back strength");
    }
    if (name.includes("curl")) {
      tags.push("isolation", "muscle building", "hypertrophy");
    }
    if (name.includes("plank") || name.includes("hold")) {
      tags.push("core stability", "isometric", "endurance");
    }
    if (name.includes("jump") || name.includes("explosive")) {
      tags.push("plyometric", "explosive", "power");
    }
    if (name.includes("deadlift")) {
      tags.push("compound", "full body", "posterior chain", "hip hinge");
    }
    if (name.includes("lunge")) {
      tags.push("unilateral", "balance", "functional", "single leg");
    }

    // Category-based tags
    if (exercise.exerciseCategory.code === "cardio") {
      tags.push("cardiovascular", "endurance", "fat burning", "aerobic");
    }
    if (exercise.exerciseCategory.code === "strength") {
      tags.push("strength training", "muscle building");
    }
    if (
      exercise.exerciseCategory.code === "stretching" ||
      exercise.exerciseCategory.code === "stretch"
    ) {
      tags.push("flexibility", "mobility", "recovery");
    }

    return [...new Set(tags)].join(", "); // Remove duplicates
  }
}
