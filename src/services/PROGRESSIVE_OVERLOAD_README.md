# Progressive Overload System

## Tổng quan

Hệ thống Progressive Overload được thiết kế để tăng dần cường độ tập luyện theo thời gian, giúp người dùng đạt được kết quả tối ưu và tránh plateau (ngừng tiến bộ). Hệ thống này tự động điều chỉnh volume, intensity, và weight dựa trên fitness level và mục tiêu của người dùng.

## Các thành phần chính

### 1. Progressive Phases (Các giai đoạn)

- **Foundation**: Giai đoạn khởi đầu, tập trung vào form và làm quen với bài tập
- **Build**: Giai đoạn xây dựng, tăng dần cường độ và volume
- **Peak**: Giai đoạn đỉnh, cường độ cao nhất trong chương trình
- **Deload**: Giai đoạn nghỉ ngơi, giảm cường độ để phục hồi

### 2. Progressive Methods (Phương pháp)

- **Linear**: Tăng cường độ đều đặn theo thời gian
- **Wave**: Tăng cường độ theo dạng sóng (có lên có xuống)
- **Block**: Tăng cường độ theo từng block (giai đoạn)
- **Undulating**: Tăng cường độ không đều, phù hợp với maintenance

### 3. Cấu hình theo Fitness Level và Objective

#### Beginner

- **LOSE_FAT**: 6 tuần, Linear method, deload mỗi 6 tuần
- **GAIN_MUSCLE**: 8 tuần, Linear method, deload mỗi 5 tuần
- **ENDURANCE**: 6 tuần, Wave method, deload mỗi 4 tuần
- **MAINTAIN**: 4 tuần, Undulating method, deload mỗi 8 tuần

#### Intermediate

- **LOSE_FAT**: 8 tuần, Wave method, deload mỗi 4 tuần
- **GAIN_MUSCLE**: 10 tuần, Block method, deload mỗi 4 tuần
- **ENDURANCE**: 8 tuần, Wave method, deload mỗi 3 tuần
- **MAINTAIN**: 6 tuần, Undulating method, deload mỗi 6 tuần

#### Advanced

- **LOSE_FAT**: 10 tuần, Block method, deload mỗi 3 tuần
- **GAIN_MUSCLE**: 12 tuần, Block method, deload mỗi 3 tuần
- **ENDURANCE**: 10 tuần, Block method, deload mỗi 3 tuần
- **MAINTAIN**: 8 tuần, Undulating method, deload mỗi 4 tuần

## Cách hoạt động

### 1. Tạo cấu hình Progressive Overload

```typescript
const config = ProgressiveOverloadCalculator.createDefaultConfig(
  FitnessLevel.INTERMEDIATE,
  Objective.GAIN_MUSCLE,
  10 // total weeks
);
```

### 2. Tính toán weekly progression

```typescript
const weeklyProgression =
  ProgressiveOverloadCalculator.calculateWeeklyProgression(
    config,
    week, // current week
    totalWeeks
  );
```

### 3. Áp dụng vào prescription

- **Sets**: Điều chỉnh theo volume modifier và sets adjustment
- **Reps**: Điều chỉnh theo reps adjustment
- **Weight**: Tăng theo weight increase mỗi tuần
- **RPE**: Tính toán dựa trên phase và fitness level

## Ví dụ cụ thể

### Beginner - GAIN_MUSCLE (8 tuần)

**Foundation Phase (2-3 tuần)**:

- Intensity: 85% base
- Volume: 90% base
- Weight increase: 2kg/tuần
- Reps: Không đổi
- Sets: +0.5/tuần

**Build Phase (4-5 tuần)**:

- Intensity: 100% base
- Volume: 100% base
- Weight increase: 2.5kg/tuần
- Reps: Không đổi
- Sets: Không đổi

**Peak Phase (1-2 tuần)**:

- Intensity: 105% base
- Volume: 110% base
- Weight increase: 2kg/tuần
- Reps: -1/tuần
- Sets: +0.5/tuần

**Deload Week (mỗi 5 tuần)**:

- Intensity: 70% base
- Volume: 60% base
- Weight: Giảm 2kg
- Reps: Giảm 1
- Sets: Giảm 0.5

## Lợi ích

1. **Tránh Plateau**: Tăng cường độ đều đặn giúp tránh ngừng tiến bộ
2. **An toàn**: Deload weeks giúp cơ thể phục hồi
3. **Cá nhân hóa**: Cấu hình khác nhau cho từng fitness level và mục tiêu
4. **Khoa học**: Dựa trên nguyên lý progressive overload đã được chứng minh
5. **Linh hoạt**: Nhiều phương pháp khác nhau phù hợp với từng tình huống

## Demo Functions

### demonstrateProgressiveOverload()

Hiển thị cấu hình và weekly progression cho một chương trình cụ thể.

```typescript
const demo = workoutPlanGenerator.demonstrateProgressiveOverload(
  "INTERMEDIATE",
  "GAIN_MUSCLE",
  10
);

console.log(demo.explanation);
// Hiển thị chi tiết về phases, progression, và weekly breakdown
```

## Tích hợp vào hệ thống

Progressive Overload được tích hợp vào:

- `PlanStrategy`: Chứa cấu hình progressive overload
- `WorkoutSplit`: Chứa weekly progression cho mỗi session
- `Prescription`: Áp dụng progressive overload vào sets/reps/weight
- `WorkoutPlanGenerator`: Tự động tạo và áp dụng progressive overload

Hệ thống này đảm bảo rằng mỗi workout plan sẽ có sự tiến bộ đều đặn và phù hợp với khả năng của người dùng.
