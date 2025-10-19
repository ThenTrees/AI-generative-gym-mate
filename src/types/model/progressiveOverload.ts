import { FitnessLevel, Objective } from "../../common/common-enum";

export enum ProgressivePhase {
  FOUNDATION = "foundation",
  BUILD = "build",
  PEAK = "peak",
  DELOAD = "deload",
}

export enum ProgressiveMethod {
  LINEAR = "linear",
  WAVE = "wave",
  BLOCK = "block",
  UNDULATING = "undulating",
}

export interface ProgressiveOverloadConfig {
  method: ProgressiveMethod;
  phases: ProgressivePhaseConfig[];
  intensityProgression: IntensityProgression;
  volumeProgression: VolumeProgression;
  deloadFrequency: number; // weeks between deloads
}

export interface ProgressivePhaseConfig {
  phase: ProgressivePhase;
  duration: number; // weeks
  intensityMultiplier: number; // 0.8 - 1.2
  volumeMultiplier: number; // 0.8 - 1.3
  weightIncrease: number; // kg per week
  repsAdjustment: number; // +/- reps per week
  setsAdjustment: number; // +/- sets per week
}

export interface IntensityProgression {
  baseIntensity: number; // 1-10 scale
  weeklyIncrease: number; // 0.1-0.5
  maxIntensity: number; // 1-10 scale
  rpeProgression: RPEProgression;
}

export interface VolumeProgression {
  baseSets: number;
  baseReps: number;
  weeklySetsIncrease: number; // 0-1
  weeklyRepsIncrease: number; // 0-2
  maxSets: number;
  maxReps: number;
}

export interface RPEProgression {
  baseRPE: number; // 5-9 scale
  weeklyIncrease: number; // 0.1-0.3
  maxRPE: number; // 7-10 scale
}

export interface ProgressiveOverloadStrategy {
  config: ProgressiveOverloadConfig;
  currentWeek: number;
  currentPhase: ProgressivePhase;
  phaseProgress: number; // 0-1, progress within current phase
  nextDeloadWeek: number;
}

export interface WeeklyProgression {
  week: number;
  phase: ProgressivePhase;
  intensityModifier: number;
  volumeModifier: number;
  weightIncrease: number;
  repsAdjustment: number;
  setsAdjustment: number;
  isDeloadWeek: boolean;
}

export class ProgressiveOverloadCalculator {
  static createDefaultConfig(
    fitnessLevel: FitnessLevel,
    objective: Objective,
    totalWeeks: number
  ): ProgressiveOverloadConfig {
    const configs = {
      [FitnessLevel.BEGINNER]: {
        [Objective.LOSE_FAT]: {
          method: ProgressiveMethod.LINEAR,
          deloadFrequency: 6,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.4),
              intensityMultiplier: 0.8,
              volumeMultiplier: 0.9,
              weightIncrease: 1,
              repsAdjustment: 1,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.4),
              intensityMultiplier: 0.95,
              volumeMultiplier: 1.0,
              weightIncrease: 2,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.1,
              weightIncrease: 1,
              repsAdjustment: -1,
              setsAdjustment: 0.5,
            },
          ],
          intensityProgression: {
            baseIntensity: 6,
            weeklyIncrease: 0.2,
            maxIntensity: 8,
            rpeProgression: {
              baseRPE: 6,
              weeklyIncrease: 0.1,
              maxRPE: 8,
            },
          },
          volumeProgression: {
            baseSets: 2,
            baseReps: 12,
            weeklySetsIncrease: 0.1,
            weeklyRepsIncrease: 0.5,
            maxSets: 4,
            maxReps: 15,
          },
        },
        [Objective.GAIN_MUSCLE]: {
          method: ProgressiveMethod.LINEAR,
          deloadFrequency: 5,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.3),
              intensityMultiplier: 0.85,
              volumeMultiplier: 0.9,
              weightIncrease: 2,
              repsAdjustment: 0,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.5),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.0,
              weightIncrease: 2.5,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 1.05,
              volumeMultiplier: 1.1,
              weightIncrease: 2,
              repsAdjustment: -1,
              setsAdjustment: 0.5,
            },
          ],
          intensityProgression: {
            baseIntensity: 7,
            weeklyIncrease: 0.15,
            maxIntensity: 9,
            rpeProgression: {
              baseRPE: 7,
              weeklyIncrease: 0.1,
              maxRPE: 9,
            },
          },
          volumeProgression: {
            baseSets: 3,
            baseReps: 10,
            weeklySetsIncrease: 0.2,
            weeklyRepsIncrease: 0,
            maxSets: 5,
            maxReps: 12,
          },
        },
        [Objective.ENDURANCE]: {
          method: ProgressiveMethod.WAVE,
          deloadFrequency: 4,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.4),
              intensityMultiplier: 0.8,
              volumeMultiplier: 1.0,
              weightIncrease: 0,
              repsAdjustment: 2,
              setsAdjustment: 0,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.4),
              intensityMultiplier: 0.9,
              volumeMultiplier: 1.1,
              weightIncrease: 0,
              repsAdjustment: 1,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.2,
              weightIncrease: 0,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
          ],
          intensityProgression: {
            baseIntensity: 5,
            weeklyIncrease: 0.1,
            maxIntensity: 7,
            rpeProgression: {
              baseRPE: 6,
              weeklyIncrease: 0.05,
              maxRPE: 7,
            },
          },
          volumeProgression: {
            baseSets: 2,
            baseReps: 15,
            weeklySetsIncrease: 0.1,
            weeklyRepsIncrease: 1,
            maxSets: 4,
            maxReps: 25,
          },
        },
        [Objective.MAINTAIN]: {
          method: ProgressiveMethod.UNDULATING,
          deloadFrequency: 8,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.6),
              intensityMultiplier: 0.9,
              volumeMultiplier: 0.95,
              weightIncrease: 1,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.4),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.0,
              weightIncrease: 1,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
          ],
          intensityProgression: {
            baseIntensity: 6,
            weeklyIncrease: 0.05,
            maxIntensity: 7,
            rpeProgression: {
              baseRPE: 6,
              weeklyIncrease: 0.05,
              maxRPE: 7,
            },
          },
          volumeProgression: {
            baseSets: 3,
            baseReps: 10,
            weeklySetsIncrease: 0.05,
            weeklyRepsIncrease: 0,
            maxSets: 4,
            maxReps: 12,
          },
        },
      },
      [FitnessLevel.INTERMEDIATE]: {
        [Objective.LOSE_FAT]: {
          method: ProgressiveMethod.WAVE,
          deloadFrequency: 4,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.25),
              intensityMultiplier: 0.9,
              volumeMultiplier: 1.0,
              weightIncrease: 2,
              repsAdjustment: 0,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.5),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.1,
              weightIncrease: 2.5,
              repsAdjustment: -1,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.25),
              intensityMultiplier: 1.1,
              volumeMultiplier: 1.2,
              weightIncrease: 2,
              repsAdjustment: -2,
              setsAdjustment: 0,
            },
          ],
          intensityProgression: {
            baseIntensity: 7,
            weeklyIncrease: 0.2,
            maxIntensity: 9,
            rpeProgression: {
              baseRPE: 7,
              weeklyIncrease: 0.15,
              maxRPE: 9,
            },
          },
          volumeProgression: {
            baseSets: 3,
            baseReps: 10,
            weeklySetsIncrease: 0.2,
            weeklyRepsIncrease: 0,
            maxSets: 5,
            maxReps: 12,
          },
        },
        [Objective.GAIN_MUSCLE]: {
          method: ProgressiveMethod.BLOCK,
          deloadFrequency: 4,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 0.9,
              volumeMultiplier: 1.0,
              weightIncrease: 2.5,
              repsAdjustment: 0,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.6),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.1,
              weightIncrease: 3,
              repsAdjustment: -1,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 1.05,
              volumeMultiplier: 1.2,
              weightIncrease: 2.5,
              repsAdjustment: -2,
              setsAdjustment: 0.5,
            },
          ],
          intensityProgression: {
            baseIntensity: 8,
            weeklyIncrease: 0.15,
            maxIntensity: 10,
            rpeProgression: {
              baseRPE: 8,
              weeklyIncrease: 0.1,
              maxRPE: 10,
            },
          },
          volumeProgression: {
            baseSets: 4,
            baseReps: 8,
            weeklySetsIncrease: 0.25,
            weeklyRepsIncrease: 0,
            maxSets: 6,
            maxReps: 10,
          },
        },
        [Objective.ENDURANCE]: {
          method: ProgressiveMethod.WAVE,
          deloadFrequency: 3,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.3),
              intensityMultiplier: 0.85,
              volumeMultiplier: 1.1,
              weightIncrease: 0,
              repsAdjustment: 3,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.5),
              intensityMultiplier: 0.95,
              volumeMultiplier: 1.2,
              weightIncrease: 0,
              repsAdjustment: 2,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.3,
              weightIncrease: 0,
              repsAdjustment: 1,
              setsAdjustment: 0,
            },
          ],
          intensityProgression: {
            baseIntensity: 6,
            weeklyIncrease: 0.15,
            maxIntensity: 8,
            rpeProgression: {
              baseRPE: 7,
              weeklyIncrease: 0.1,
              maxRPE: 8,
            },
          },
          volumeProgression: {
            baseSets: 3,
            baseReps: 15,
            weeklySetsIncrease: 0.15,
            weeklyRepsIncrease: 1.5,
            maxSets: 5,
            maxReps: 30,
          },
        },
        [Objective.MAINTAIN]: {
          method: ProgressiveMethod.UNDULATING,
          deloadFrequency: 6,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.5),
              intensityMultiplier: 0.95,
              volumeMultiplier: 1.0,
              weightIncrease: 1.5,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.5),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.05,
              weightIncrease: 1.5,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
          ],
          intensityProgression: {
            baseIntensity: 7,
            weeklyIncrease: 0.1,
            maxIntensity: 8,
            rpeProgression: {
              baseRPE: 7,
              weeklyIncrease: 0.05,
              maxRPE: 8,
            },
          },
          volumeProgression: {
            baseSets: 4,
            baseReps: 8,
            weeklySetsIncrease: 0.1,
            weeklyRepsIncrease: 0,
            maxSets: 5,
            maxReps: 10,
          },
        },
      },
      [FitnessLevel.ADVANCED]: {
        [Objective.LOSE_FAT]: {
          method: ProgressiveMethod.BLOCK,
          deloadFrequency: 3,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 0.95,
              volumeMultiplier: 1.0,
              weightIncrease: 3,
              repsAdjustment: -1,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.5),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.1,
              weightIncrease: 3.5,
              repsAdjustment: -2,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.3),
              intensityMultiplier: 1.1,
              volumeMultiplier: 1.2,
              weightIncrease: 3,
              repsAdjustment: -3,
              setsAdjustment: 0.5,
            },
          ],
          intensityProgression: {
            baseIntensity: 8,
            weeklyIncrease: 0.25,
            maxIntensity: 10,
            rpeProgression: {
              baseRPE: 8,
              weeklyIncrease: 0.2,
              maxRPE: 10,
            },
          },
          volumeProgression: {
            baseSets: 4,
            baseReps: 8,
            weeklySetsIncrease: 0.25,
            weeklyRepsIncrease: -0.5,
            maxSets: 6,
            maxReps: 10,
          },
        },
        [Objective.GAIN_MUSCLE]: {
          method: ProgressiveMethod.BLOCK,
          deloadFrequency: 3,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.15),
              intensityMultiplier: 0.95,
              volumeMultiplier: 1.0,
              weightIncrease: 3,
              repsAdjustment: 0,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.65),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.1,
              weightIncrease: 3.5,
              repsAdjustment: -1,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.2),
              intensityMultiplier: 1.05,
              volumeMultiplier: 1.2,
              weightIncrease: 3,
              repsAdjustment: -2,
              setsAdjustment: 0.5,
            },
          ],
          intensityProgression: {
            baseIntensity: 8,
            weeklyIncrease: 0.2,
            maxIntensity: 10,
            rpeProgression: {
              baseRPE: 8,
              weeklyIncrease: 0.15,
              maxRPE: 10,
            },
          },
          volumeProgression: {
            baseSets: 5,
            baseReps: 6,
            weeklySetsIncrease: 0.3,
            weeklyRepsIncrease: 0,
            maxSets: 8,
            maxReps: 8,
          },
        },
        [Objective.ENDURANCE]: {
          method: ProgressiveMethod.BLOCK,
          deloadFrequency: 3,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.25),
              intensityMultiplier: 0.9,
              volumeMultiplier: 1.1,
              weightIncrease: 0,
              repsAdjustment: 4,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.5),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.2,
              weightIncrease: 0,
              repsAdjustment: 3,
              setsAdjustment: 0.5,
            },
            {
              phase: ProgressivePhase.PEAK,
              duration: Math.ceil(totalWeeks * 0.25),
              intensityMultiplier: 1.05,
              volumeMultiplier: 1.3,
              weightIncrease: 0,
              repsAdjustment: 2,
              setsAdjustment: 0.5,
            },
          ],
          intensityProgression: {
            baseIntensity: 7,
            weeklyIncrease: 0.2,
            maxIntensity: 9,
            rpeProgression: {
              baseRPE: 7,
              weeklyIncrease: 0.15,
              maxRPE: 9,
            },
          },
          volumeProgression: {
            baseSets: 4,
            baseReps: 15,
            weeklySetsIncrease: 0.2,
            weeklyRepsIncrease: 2,
            maxSets: 6,
            maxReps: 35,
          },
        },
        [Objective.MAINTAIN]: {
          method: ProgressiveMethod.UNDULATING,
          deloadFrequency: 4,
          phases: [
            {
              phase: ProgressivePhase.FOUNDATION,
              duration: Math.ceil(totalWeeks * 0.4),
              intensityMultiplier: 1.0,
              volumeMultiplier: 1.0,
              weightIncrease: 2,
              repsAdjustment: 0,
              setsAdjustment: 0,
            },
            {
              phase: ProgressivePhase.BUILD,
              duration: Math.ceil(totalWeeks * 0.6),
              intensityMultiplier: 1.05,
              volumeMultiplier: 1.1,
              weightIncrease: 2,
              repsAdjustment: 0,
              setsAdjustment: 0.5,
            },
          ],
          intensityProgression: {
            baseIntensity: 8,
            weeklyIncrease: 0.15,
            maxIntensity: 9,
            rpeProgression: {
              baseRPE: 8,
              weeklyIncrease: 0.1,
              maxRPE: 9,
            },
          },
          volumeProgression: {
            baseSets: 5,
            baseReps: 6,
            weeklySetsIncrease: 0.15,
            weeklyRepsIncrease: 0,
            maxSets: 6,
            maxReps: 8,
          },
        },
      },
    };

    return (
      configs[fitnessLevel]?.[objective] ||
      configs[FitnessLevel.INTERMEDIATE][Objective.MAINTAIN]
    );
  }

  static calculateWeeklyProgression(
    config: ProgressiveOverloadConfig,
    week: number,
    totalWeeks: number
  ): WeeklyProgression {
    const currentPhase = this.getCurrentPhase(config, week);
    const phaseProgress = this.getPhaseProgress(config, week, currentPhase);
    const isDeloadWeek = this.isDeloadWeek(config, week);

    const phaseConfig = config.phases.find((p) => p.phase === currentPhase)!;

    return {
      week,
      phase: currentPhase,
      intensityModifier: isDeloadWeek ? 0.7 : phaseConfig.intensityMultiplier,
      volumeModifier: isDeloadWeek ? 0.6 : phaseConfig.volumeMultiplier,
      weightIncrease: isDeloadWeek
        ? -phaseConfig.weightIncrease
        : phaseConfig.weightIncrease,
      repsAdjustment: isDeloadWeek
        ? -phaseConfig.repsAdjustment
        : phaseConfig.repsAdjustment,
      setsAdjustment: isDeloadWeek
        ? -phaseConfig.setsAdjustment
        : phaseConfig.setsAdjustment,
      isDeloadWeek,
    };
  }

  private static getCurrentPhase(
    config: ProgressiveOverloadConfig,
    week: number
  ): ProgressivePhase {
    let currentWeek = 1;

    for (const phase of config.phases) {
      if (week <= currentWeek + phase.duration - 1) {
        return phase.phase;
      }
      currentWeek += phase.duration;
    }

    return config.phases[config.phases.length - 1].phase;
  }

  private static getPhaseProgress(
    config: ProgressiveOverloadConfig,
    week: number,
    currentPhase: ProgressivePhase
  ): number {
    let currentWeek = 1;

    for (const phase of config.phases) {
      if (phase.phase === currentPhase) {
        const phaseStartWeek = currentWeek;
        const phaseProgress = (week - phaseStartWeek + 1) / phase.duration;
        return Math.min(1, Math.max(0, phaseProgress));
      }
      currentWeek += phase.duration;
    }

    return 0;
  }

  private static isDeloadWeek(
    config: ProgressiveOverloadConfig,
    week: number
  ): boolean {
    return week % config.deloadFrequency === 0;
  }
}
