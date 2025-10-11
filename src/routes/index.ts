import express from "express";
const router = express.Router();

import healthRoute from "./health";
import generationRoute from "./gym-plan";
import mealPlanRoute from "./meal-plan";

router.use("/health", healthRoute);
router.use("/v1/api/ai", generationRoute);
router.use("/v1/api/ai/nutrition", mealPlanRoute);

export default router;
