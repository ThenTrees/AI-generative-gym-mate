import express from "express";
const router = express.Router();

import healthRoute from "./health";
import generationRoute from "./gym-plan";

router.use("/health", healthRoute);
router.use("/v1/api/ai", generationRoute);

export default router;
