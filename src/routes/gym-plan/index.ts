"use strick";
import express from "express";
import GymPlanController from "../../controllers/gymPlan.controller";
const router = express.Router();

router.post("/generate-plan", GymPlanController.generateWorkoutPlan);

export default router;
