import express from "express";
const router = express.Router();

import healthRoute from "./health";
import generationRoute from "./gym-plan";
import mealPlanRoute from "./meal-plan";

router.use("/health", healthRoute);
router.use("/api/v1/ai", generationRoute);
router.use("/api/v1/ai/nutrition", mealPlanRoute);

export default router;
