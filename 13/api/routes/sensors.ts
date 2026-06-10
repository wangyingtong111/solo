import { Router, type Request, type Response } from 'express';
import { SENSORS } from '../services/sensorSimulator.js';
import { getPrediction } from '../services/predictionModel.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    sensors: SENSORS,
  });
});

router.get('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const sensor = SENSORS.find(s => s.id === id);

  if (!sensor) {
    res.status(404).json({
      success: false,
      error: 'Sensor not found',
    });
    return;
  }

  const prediction = getPrediction(id);

  res.json({
    success: true,
    sensor,
    prediction,
  });
});

router.get('/:id/prediction', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const prediction = getPrediction(id);

  if (!prediction) {
    res.status(404).json({
      success: false,
      error: 'Prediction not available',
    });
    return;
  }

  res.json({
    success: true,
    prediction,
  });
});

export default router;
