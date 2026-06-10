import { Router, type Request, type Response } from 'express';
import { getRecentAlerts, setKurtosisThreshold, getKurtosisThreshold } from '../services/alertService.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const alerts = getRecentAlerts(limit);

  res.json({
    success: true,
    alerts,
    total: alerts.length,
  });
});

router.get('/threshold', (req: Request, res: Response) => {
  res.json({
    success: true,
    threshold: getKurtosisThreshold(),
  });
});

router.post('/threshold', (req: Request, res: Response) => {
  const { threshold } = req.body;

  if (typeof threshold !== 'number' || threshold <= 0) {
    res.status(400).json({
      success: false,
      error: 'Invalid threshold value',
    });
    return;
  }

  setKurtosisThreshold(threshold);

  res.json({
    success: true,
    threshold: getKurtosisThreshold(),
  });
});

export default router;
