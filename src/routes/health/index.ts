"use strick";
import express from "express";
const healthRouter = express.Router();
healthRouter.get("/", (req, res) => {
  res.json({
    status: "OK",
    service: "Gym RAG Service",
    timestamp: new Date().toISOString(),
  });
});
export default healthRouter;
