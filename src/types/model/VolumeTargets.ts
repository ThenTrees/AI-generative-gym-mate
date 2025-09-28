type RepsRange = Readonly<[number, number]>;

export interface VolumeTargets {
  setsPerMuscleGroup: number;
  repsRange: RepsRange;
  weeklyVolume: number;
}
