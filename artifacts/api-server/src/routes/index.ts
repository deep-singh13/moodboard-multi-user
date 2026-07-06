import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import itemsRouter from "./items";
import fetchOgRouter from "./fetchOg";
import movieSearchRouter from "./movieSearch";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(itemsRouter);
router.use(fetchOgRouter);
router.use(movieSearchRouter);

export default router;
