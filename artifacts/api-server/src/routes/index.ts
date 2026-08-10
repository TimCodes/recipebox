import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recipesRouter from "./recipes";
import mealPlanRouter from "./meal-plan";
import groceryListRouter from "./grocery-list";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recipesRouter);
router.use(mealPlanRouter);
router.use(groceryListRouter);
router.use(dashboardRouter);

export default router;
