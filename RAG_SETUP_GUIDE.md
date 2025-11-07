# 🚀 RAG Setup Guide - Chatbot Implementation

Hướng dẫn setup và sử dụng RAG (Retrieval-Augmented Generation) cho chatbot.

## ✅ Đã hoàn thành

1. ✅ Database migration cho `knowledge_embeddings` table
2. ✅ Knowledge Vector Service - Convert internal knowledge sang RAG
3. ✅ Update Chatbot Service - Dùng RAG thay vì hardcoded knowledge
4. ✅ Update main.ts - Initialize knowledge embeddings
5. ✅ Test script để verify RAG hoạt động

## 📋 Các bước setup

### Bước 1: Chạy Database Migration

```bash
# Chạy SQL migration để tạo knowledge_embeddings table
psql -U postgres -d gymhealthtech -f migrations/V8__add_knowledge_embeddings_table.sql

# Hoặc chạy trực tiếp trong psql:
psql -U postgres -d gymhealthtech
\i migrations/V8__add_knowledge_embeddings_table.sql
```

### Bước 2: Generate Knowledge Embeddings

Có 2 cách:

#### Cách 1: Tự động khi start app (khuyến nghị)
```bash
# Set trong .env
RUN_BATCH=true

# Start app
npm run dev
```

App sẽ tự động:
- Check nếu chưa có embeddings → generate
- Nếu đã có → skip

#### Cách 2: Manual generation
```typescript
// Trong code hoặc script
import { knowledgeVectorService } from './services/knowledgeVector.service';
await knowledgeVectorService.loadAndStoreKnowledge();
```

### Bước 3: Test RAG

```bash
# Chạy test script
npm run test-rag
```

Script sẽ test:
- Check số lượng embeddings
- Test semantic search với các queries khác nhau
- Verify results quality

### Bước 4: Test Chatbot

```bash
# Start app
npm run dev

# Test API endpoint
POST /api/chatbot/chat
{
  "message": "cách tập ngực hiệu quả",
  "userId": "test-user"
}
```

## 🔍 Kiểm tra RAG hoạt động

### 1. Check database

```sql
-- Check số lượng embeddings
SELECT COUNT(*) FROM knowledge_embeddings;

-- Check categories
SELECT category, COUNT(*) 
FROM knowledge_embeddings 
GROUP BY category;

-- Check một vài records
SELECT knowledge_id, category, subcategory, content 
FROM knowledge_embeddings 
LIMIT 5;
```

### 2. Check logs

Khi chatbot nhận message, bạn sẽ thấy logs:
```
✅ Retrieved 5 knowledge items using RAG
```

Nếu không có RAG results:
```
⚠️ No RAG results found, using fallback knowledge base
```

### 3. Test với các queries khác nhau

```bash
# Exercise query
"cách tập ngực hiệu quả"
"bài tập cho lưng"
"progressive overload là gì"

# Nutrition query
"protein cần bao nhiêu để tăng cơ"
"carbs cho workout"
"calorie deficit là gì"

# Fitness query
"động lực tập luyện"
"cách đặt mục tiêu fitness"
"theo dõi tiến độ"
```

## 📊 So sánh Trước/Sau

### Trước (Hardcoded)
- ❌ Keyword matching đơn giản
- ❌ Không hiểu semantic meaning
- ❌ Không scale được
- ❌ Không có external knowledge

### Sau (RAG)
- ✅ Semantic search - hiểu meaning
- ✅ Tự động tìm relevant knowledge
- ✅ Có thể mở rộng với external sources
- ✅ Fallback nếu RAG fail
- ✅ Better accuracy

## 🛠️ Troubleshooting

### Lỗi: "knowledge_embeddings table not found"
**Giải pháp:** Chạy migration SQL file

### Lỗi: "No embeddings found"
**Giải pháp:** 
```bash
# Set RUN_BATCH=true và restart app
# Hoặc chạy manual:
npm run dev
```

### Lỗi: "No RAG results found"
**Nguyên nhân:** 
- Embeddings chưa được generate
- Query không match với knowledge
- Threshold quá cao

**Giải pháp:**
- Check embeddings trong database
- Test với query đơn giản hơn
- Check logs để xem similarity scores

### Performance chậm
**Giải pháp:**
- Check database indexes
- Consider caching (sẽ implement sau)
- Optimize embedding generation

## 📈 Next Steps (Optional)

Sau khi RAG cơ bản hoạt động, có thể implement:

1. **Cache Layer** - Cache embeddings và search results
2. **Chunking Strategy** - Chunk long documents
3. **External Data** - Crawl và integrate external sources
4. **Unified Search** - Search across all data sources
5. **Reranking** - Improve result quality

## 📝 Notes

- Knowledge embeddings được refresh tự động mỗi ngày lúc 3 AM
- Fallback về hardcoded knowledge nếu RAG fail
- Similarity threshold mặc định: 0.3 (có thể adjust)
- Top K results mặc định: 5 (có thể adjust)

## 🎯 Kết quả mong đợi

Sau khi setup xong:
- Chatbot sẽ tự động tìm knowledge liên quan từ vector database
- Response quality cải thiện đáng kể
- Có thể mở rộng dễ dàng với external sources
- System logs sẽ show "✅ Retrieved X knowledge items using RAG"

---

**Happy coding! 🚀**

