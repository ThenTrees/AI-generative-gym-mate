import { detailedColoredLogger } from "./src/middlewares/logger.middleware";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { logger } from "./src/utils/logger";
import { errorMiddleware } from "./src/middlewares/error.middleware";
import { RAGApplication } from "./src/main";
import routes from "./src/routes";
const app = express();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
app.use(detailedColoredLogger);

app.use("/", routes);

// Error middleware should be last
app.use(errorMiddleware);

const ragApp = new RAGApplication();
ragApp.initialize().then(() => {
  logger.info("RAG Application initialized");
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => logger.info(port.toString(), "RAG service started"));
