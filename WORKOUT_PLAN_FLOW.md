# 📋 LUỒNG TẠO WORKOUT PLAN TỰ ĐỘNG - TỪNG BƯỚC CHI TIẾT

## 🎯 TỔNG QUAN

Hệ thống tạo workout plan tự động sử dụng AI (Gemini) và RAG (Retrieval-Augmented Generation) để tạo kế hoạch tập luyện cá nhân hóa dựa trên:

- Thông tin người dùng (User Profile)
- Mục tiêu tập luyện (Goal)
- Ghi chú sức khỏe (Health Notes)

---

## 🔄 LUỒNG XỬ LÝ CHÍNH

### **BƯỚC 1: NHẬN REQUEST TỪ CLIENT**

📍 **File**: `src/routes/gym-plan/index.ts` → `src/controllers/gymPlan.controller.ts`

```
POST /api/v1/gym-plan/generate-plan
Body: {
  userId: string,
  notes?: string  // Ghi chú sức khỏe tùy chọn
}
```

**Xử lý tại Controller:**

- Nhận request từ Express
- Validate dữ liệu đầu vào
- Gọi `WorkoutPlanGeneratorService.generateWorkoutPlan()`
- Trả về response với plan đã tạo

---

### **BƯỚC 2: LẤY THÔNG TIN NGƯỜI DÙNG VÀ MỤC TIÊU**

📍 **File**: `src/services/workoutPlanGenerator.service.ts` (dòng 71-86)

```typescript
// Lấy User Profile từ database
const profile = await mealPlanGenerator.getProfile(request.userId);

// Lấy Goal (mục tiêu) của user
const goal = await mealPlanGenerator.getGoalByUser(request.userId);
```

**Kiểm tra:**

- ✅ Profile phải tồn tại
- ✅ Goal phải tồn tại và đang active

**Dữ liệu quan trọng từ Profile:**

- `fitnessLevel`: BEGINNER, INTERMEDIATE, ADVANCED
- `age`: Tuổi
- `healthNote`: Ghi chú sức khỏe (nếu có)
- `gender`: Giới tính

**Dữ liệu quan trọng từ Goal:**

- `objectiveType`: BUILD_MUSCLE, LOSE_WEIGHT, IMPROVE_STRENGTH, etc.
- `sessionsPerWeek`: Số buổi tập/tuần (2-6)
- `sessionMinutes`: Thời gian mỗi buổi tập (30-120 phút)

---

### **BƯỚC 3: PHÂN TÍCH YÊU CẦU VÀ XÂY DỰNG CHIẾN LƯỢC**

📍 **File**: `src/services/workoutPlanGenerator.service.ts` → `analyzePlanRequirements()` (dòng 172-203)

#### 3.1. Phân tích sức khỏe với AI

📍 **Service**: `src/services/healthAnalysis.service.ts`

```typescript
specialConsiderations = await healthAnalysisService.analyzeHealthConsiderations(
  userProfile,
  request.notes
);
```

**Quy trình:**

1. **Thử AI Analysis trước** (Gemini):

   - Sử dụng Google Generative AI (Gemini 2.5 Flash)
   - Prompt được xây dựng từ: healthNote, age, gender, fitnessLevel
   - AI phân tích và trả về danh sách `HealthConsideration[]`:
     - `restrictions`: Các bài tập cần tránh
     - `modifications`: Các điều chỉnh cần thiết
     - `warnings`: Cảnh báo sức khỏe

2. **Fallback nếu AI thất bại**:
   - Sử dụng rule-based analysis
   - Tìm kiếm keywords: "knee", "back", "shoulder", "injury"
   - Tạo health considerations dựa trên keywords

**Ví dụ Health Consideration:**

```json
{
  "type": "RESTRICTION",
  "description": "Avoid high-impact exercises",
  "affectedBodyParts": ["knee"],
  "severity": "MODERATE"
}
```

#### 3.2. Xác định cấu trúc buổi tập

📍 **Method**: `determineSessionStructure()` (dòng 210-244)

Dựa trên `sessionsPerWeek`:

- **≤ 2 buổi/tuần**: `full_body` (toàn thân)
- **3 buổi/tuần**: `full_body_varied` (toàn thân đa dạng)
- **4 buổi/tuần**: `upper_lower` (trên/dưới)
- **≥ 5 buổi/tuần**: `body_part_split` (chia nhóm cơ)

**Tính số bài tập/buổi:**

- 2 buổi/tuần: 7 bài
- 3 buổi/tuần: 6 bài
- 4+ buổi/tuần: 5 bài

#### 3.3. Tính toán các thông số khác

**Intensity Level:**

- Dựa trên `fitnessLevel` và `objectiveType`
- BEGINNER → MODERATE
- INTERMEDIATE → MODERATE_HIGH
- ADVANCED → HIGH

**Volume Targets:**

- Sets/Reps phù hợp với mục tiêu:
  - BUILD_MUSCLE: 3-4 sets × 8-12 reps
  - LOSE_WEIGHT: 3-4 sets × 12-15 reps
  - IMPROVE_STRENGTH: 4-5 sets × 4-6 reps

**Progressive Overload Config:**

- Tạo config tự động dựa trên:
  - Fitness level
  - Objective type
  - Số tuần đề xuất

**Suggested Weeks:**

- Base weeks từ constants:
  - BEGINNER: 8-12 tuần
  - INTERMEDIATE: 6-10 tuần
  - ADVANCED: 4-8 tuần
- Điều chỉnh dựa trên:
  - Health issues (+2 tuần)
  - High frequency (-1 tuần)
  - Long sessions (-1 tuần)

**Kết quả**: `PlanStrategy` object chứa tất cả thông tin chiến lược

---

### **BƯỚC 4: CHỌN BÀI TẬP SỬ DỤNG RAG**

📍 **Service**: `src/services/exerciseSelection.service.ts`

#### 4.1. Xây dựng Search Queries

📍 **Method**: `buildMovementPatternQueries()` (dòng 84-200)

**Các Movement Patterns được tìm kiếm:**

1. **Squat** (Priority 1): "squat hip hinge quad glute compound lower body"
2. **Hinge** (Priority 1): "deadlift hip hinge posterior chain glute hamstring"
3. **Push** (Priority 1): "push press chest shoulder tricep upper body"
4. **Pull** (Priority 1): "pull row lat back bicep upper body"
5. **Carry** (Priority 2): "carry farmer walk loaded carry grip strength"
6. **Core** (Priority 2): "core abs plank stability trunk"
7. **Accessory** (Priority 3): Các bài tập bổ trợ

Mỗi query có:

- `searchText`: Từ khóa tìm kiếm
- `movementPattern`: Loại pattern
- `priority`: Độ ưu tiên (1-3)
- `maxResults`: Số kết quả tối đa (8-12)

#### 4.2. Thực hiện Vector Search

📍 **Service**: `src/services/pgVector.service.ts`

```typescript
const results = await this.pgVectorService.similaritySearch(
  query.searchText,
  query.maxResults,
  0.3 // similarity threshold
);
```

**Quy trình:**

1. Embedding search text thành vector
2. Tìm kiếm trong PostgreSQL với `pgvector`
3. Tính cosine similarity với exercise embeddings
4. Lọc kết quả có similarity ≥ 0.3
5. Lấy top N exercises (theo maxResults)

#### 4.3. Lọc và Sắp xếp Bài tập

📍 **Methods**: `removeDuplicateExercises()`, `applyExerciseFilters()`

**Loại bỏ trùng lặp:**

- Dựa trên `exercise.id`
- Giữ lại exercise có similarity score cao nhất

**Áp dụng Filters:**

1. **Difficulty Filter:**

   - BEGINNER: difficulty ≤ 3
   - INTERMEDIATE: difficulty 2-4
   - ADVANCED: difficulty ≥ 3

2. **Health Restrictions:**

   - Loại bỏ exercises vi phạm health considerations
   - Ví dụ: Nếu có knee problem → loại bỏ deep squats

3. **Equipment Preferences:**
   - Lọc theo equipment có sẵn (nếu có)

**Kết quả**: Danh sách `ExerciseWithScore[]` đã được lọc và sắp xếp

---

### **BƯỚC 5: TẠO WORKOUT SPLITS**

📍 **Service**: `src/services/workoutSplit.service.ts`

#### 5.1. Xác định loại Split

Dựa trên `sessionStructure.type` từ PlanStrategy:

**Full Body:**

- Mỗi buổi tập toàn thân
- Tần suất: 2-3 buổi/tuần

**Full Body Varied:**

- Toàn thân nhưng đa dạng bài tập
- Tần suất: 3 buổi/tuần

**Upper/Lower:**

- Buổi trên: Push + Pull + Core
- Buổi dưới: Squat + Hinge + Carry
- Tần suất: 4 buổi/tuần

**Body Part Split:**

- Chia theo nhóm cơ: Chest, Back, Shoulders, Legs, Arms
- Tần suất: 5-6 buổi/tuần

#### 5.2. Tạo Splits theo tuần

📍 **Method**: `generateWorkoutSplits()` (dòng 106-110)

```typescript
const workoutSplits = workoutSplitService.generateWorkoutSplits(
  goal,
  planStrategy,
  suggestedWeeks
);
```

**Quy trình:**

1. Tính tổng số buổi tập: `sessionsPerWeek × suggestedWeeks`
2. Tạo splits theo pattern đã chọn
3. Áp dụng Progressive Overload:
   - Tăng intensity theo tuần
   - Tăng volume theo tuần
   - Điều chỉnh RPE (Rate of Perceived Exertion)

**Ví dụ Split:**

```json
{
  "name": "Full Body - Week 1",
  "week": 1,
  "day": 1,
  "movementPatterns": ["squat", "push", "pull", "core"],
  "primaryMuscles": ["legs", "chest", "back", "core"],
  "exerciseCount": 6,
  "progressiveOverload": {
    "intensityMultiplier": 1.0,
    "volumeMultiplier": 1.0,
    "rpe": 6
  }
}
```

**Kết quả**: Mảng `WorkoutSplit[]` cho tất cả các buổi tập

---

### **BƯỚC 6: TẠO PLAN TRONG DATABASE**

📍 **Method**: `createPlanInDatabase()` (dòng 400-550)

#### 6.1. Tạo Plan Record

```sql
INSERT INTO plans (
  user_id, goal_id, title, start_date, end_date,
  total_weeks, status, created_at
) VALUES (...)
```

**Title Generation:**
📍 **Service**: `src/services/planTitle.service.ts`

```typescript
const title = planTitleService.generatePlanTitle(profile, goal, suggestedWeeks);
```

**Quy trình:**

1. Chọn template phù hợp:
   - "Beginner Strength Builder"
   - "Intermediate Muscle Growth Plan"
   - "Advanced Power Program"
2. Customize với:
   - Số tuần (nếu ≥ 12 tuần)
   - Tần suất tập (nếu đặc biệt)
   - Health considerations (nếu có)

#### 6.2. Tính toán Scheduled Dates

📍 **Method**: `calculateScheduledDate()` (dòng 790-807)

- Tính khoảng cách giữa các buổi tập
- `spacing = 7 / sessionsPerWeek` (ngày)
- Ví dụ: 3 buổi/tuần → spacing = 2.33 ngày

**Kết quả**: Plan record được tạo với ID

---

### **BƯỚC 7: TẠO PLAN DAYS VÀ PLAN ITEMS**

📍 **Method**: `generatePlanDays()` (dòng 570-690)

#### 7.1. Vòng lặp qua từng Split

```typescript
for (let dayIndex = 0; dayIndex < workoutSplits.length; dayIndex++) {
  const split = workoutSplits[dayIndex];
  // ...
}
```

#### 7.2. Tạo Plan Day

```sql
INSERT INTO plan_days (
  plan_id, day_index, split_name, scheduled_date
) VALUES (...)
```

#### 7.3. Chọn Exercises cho Split

📍 **Method**: `selectExercisesForSplit()` (dòng 692-760)

**Quy trình:**

1. Lọc exercises theo:
   - Movement patterns của split
   - Primary muscles của split
2. Sắp xếp theo:
   - Priority (từ RAG search)
   - Similarity score
3. Chọn đảm bảo:
   - Đa dạng movement patterns
   - Đa dạng muscle groups
   - Số lượng = `split.exerciseCount` (5-8 bài)

#### 7.4. Tạo Prescription cho mỗi Exercise

📍 **Service**: `src/services/prescription.service.ts`

```typescript
const prescription = this.prescriptionService.generatePrescription(
  exercise,
  profile,
  goal,
  split
);
```

**Tính toán Prescription:**

1. **Sets & Reps:**

   - Dựa trên `volumeTargets` từ PlanStrategy
   - Điều chỉnh theo progressive overload

2. **Weight:**

   - Dựa trên `fitnessLevel` và `exercise.difficulty`
   - BEGINNER: 50-60% 1RM
   - INTERMEDIATE: 65-75% 1RM
   - ADVANCED: 75-85% 1RM

3. **Rest Time:**

   - Strength: 2-3 phút
   - Hypertrophy: 60-90 giây
   - Endurance: 30-60 giây

4. **RPE (Rate of Perceived Exertion):**

   - Tính từ progressive overload multiplier
   - Range: 6-9 (trên thang 10)

5. **Duration:**

   - Tính từ: sets × reps × tempo + rest time

6. **Exercise Notes:**
   - Form cues
   - Safety tips
   - Modifications (nếu có health issues)

**Ví dụ Prescription:**

```json
{
  "sets": 3,
  "reps": 10,
  "weight": "Bodyweight",
  "restTime": 90,
  "rpe": 7,
  "duration": 420,
  "tempo": "2-0-2-0"
}
```

#### 7.5. Insert Plan Item

```sql
INSERT INTO plan_items (
  plan_day_id, exercise_id, item_index,
  prescription, notes, similarity_score
) VALUES (...)
```

**Kết quả**: Mảng `PlanDay[]` với đầy đủ `PlanItem[]` cho mỗi ngày

---

### **BƯỚC 8: TÍNH TOÁN METADATA VÀ TRẢ VỀ**

📍 **Method**: `generateWorkoutPlan()` (dòng 135-160)

#### 8.1. Tính toán thống kê

- `totalExercises`: Tổng số bài tập trong plan
- `avgSessionDuration`: Thời gian trung bình mỗi buổi (phút)
- `generationTime`: Thời gian tạo plan (ms)

#### 8.2. Tạo Response

```typescript
return {
  ...plan, // Plan info từ DB
  planDays, // Tất cả các ngày tập
  aiMetadata: {
    generationTimeMs,
    searchStrategy: planStrategy,
    totalExercisesConsidered: selectedExercises.length,
  },
};
```

---

## 📊 SƠ ĐỒ LUỒNG TỔNG QUAN

```
┌─────────────────────────────────────────────────────────────┐
│  1. CLIENT REQUEST                                          │
│     POST /api/v1/gym-plan/generate-plan                    │
│     { userId, notes? }                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  2. CONTROLLER                                              │
│     - Validate request                                      │
│     - Call WorkoutPlanGeneratorService                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  3. GET USER DATA                                           │
│     - User Profile (fitnessLevel, age, healthNote)         │
│     - Goal (objectiveType, sessionsPerWeek, sessionMinutes) │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  4. ANALYZE PLAN REQUIREMENTS                               │
│     ├─ Health Analysis (AI/Rule-based)                    │
│     ├─ Determine Session Structure                         │
│     ├─ Calculate Intensity Level                           │
│     ├─ Calculate Volume Targets                            │
│     └─ Create Progressive Overload Config                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  5. SELECT EXERCISES (RAG)                                  │
│     ├─ Build Movement Pattern Queries                      │
│     ├─ Vector Search (pgvector)                            │
│     ├─ Remove Duplicates                                   │
│     └─ Apply Filters (difficulty, health, equipment)       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  6. GENERATE WORKOUT SPLITS                                 │
│     ├─ Determine Split Type                                 │
│     ├─ Create Splits for all weeks                         │
│     └─ Apply Progressive Overload                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  7. CREATE PLAN IN DATABASE                                 │
│     ├─ Generate Plan Title (AI)                            │
│     ├─ Insert Plan Record                                   │
│     └─ Calculate Scheduled Dates                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  8. GENERATE PLAN DAYS & ITEMS                              │
│     For each split:                                         │
│     ├─ Create Plan Day                                     │
│     ├─ Select Exercises for Split                          │
│     ├─ Generate Prescription (sets, reps, weight, etc.)    │
│     ├─ Generate Exercise Notes                             │
│     └─ Insert Plan Items                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  9. RETURN RESPONSE                                         │
│     - Plan with all days and items                          │
│     - Metadata (generation time, stats)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 CÁC SERVICE CHÍNH

### 1. **WorkoutPlanGeneratorService** (Orchestrator)

- Điều phối toàn bộ quy trình
- Quản lý database transactions
- Tổng hợp kết quả

### 2. **HealthAnalysisService**

- Phân tích sức khỏe với AI (Gemini)
- Fallback rule-based nếu AI thất bại
- Tạo health considerations

### 3. **ExerciseSelectionService**

- Xây dựng search queries
- Tích hợp với PgVectorService để tìm exercises
- Lọc và sắp xếp exercises

### 4. **WorkoutSplitService**

- Tạo workout splits theo loại
- Áp dụng progressive overload
- Quản lý cấu trúc buổi tập

### 5. **PrescriptionService**

- Tính toán sets, reps, weight
- Tính rest time, RPE, duration
- Tạo exercise notes

### 6. **PlanTitleService**

- Tạo title cho plan
- Customize theo user profile và goal

### 7. **PgVectorService**

- Vector search trong PostgreSQL
- Embedding và similarity search
- Quản lý exercise embeddings

---

## 🎯 ĐIỂM NỔI BẬT

### ✅ **AI-Powered Health Analysis**

- Sử dụng Gemini AI để phân tích ghi chú sức khỏe
- Tự động phát hiện restrictions và modifications
- Fallback mechanism đảm bảo reliability

### ✅ **RAG-based Exercise Selection**

- Vector search với pgvector
- Tìm kiếm semantic (ý nghĩa) thay vì keyword matching
- Đa dạng movement patterns và muscle groups

### ✅ **Progressive Overload**

- Tự động tăng intensity và volume theo tuần
- Điều chỉnh RPE phù hợp với fitness level
- Đảm bảo tiến bộ liên tục

### ✅ **Personalization**

- Cá nhân hóa theo fitness level
- Điều chỉnh theo health considerations
- Phù hợp với mục tiêu và tần suất tập

### ✅ **Modular Architecture**

- Tách biệt concerns thành các service riêng
- Dễ maintain và test
- Có thể mở rộng dễ dàng

---

## 📈 METRICS VÀ PERFORMANCE

**Thời gian xử lý:**

- Health Analysis: ~500-1000ms (AI) / ~50ms (fallback)
- Exercise Selection: ~200-500ms (RAG search)
- Plan Generation: ~2-5 giây (tổng thể)

**Số lượng exercises:**

- Được xem xét: 50-100 exercises
- Được chọn: 20-40 exercises (sau filtering)
- Mỗi buổi tập: 5-8 exercises

**Database Operations:**

- 1 INSERT plan
- N INSERT plan_days (N = số buổi tập)
- M INSERT plan_items (M = tổng số exercises)

---

## 🔄 ERROR HANDLING

1. **User Profile không tồn tại** → Throw error
2. **Goal không tồn tại** → Throw error
3. **AI Health Analysis thất bại** → Fallback to rule-based
4. **RAG Search không có kết quả** → Sử dụng exercises mặc định
5. **Database transaction lỗi** → Rollback và throw error

---

## 🚀 KẾT LUẬN

Hệ thống tạo workout plan tự động là một hệ thống phức tạp kết hợp:

- **AI** cho health analysis và title generation
- **RAG** cho exercise selection
- **Rule-based logic** cho calculations và filtering
- **Progressive overload** cho program design

Tất cả được tích hợp trong một luồng xử lý tự động, tạo ra kế hoạch tập luyện cá nhân hóa, an toàn và hiệu quả cho từng người dùng.
