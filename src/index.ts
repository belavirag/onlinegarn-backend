import express, { Application } from 'express';
import healthRoutes from './routes/health';
import redis from './services/redis';

const app: Application = express();

app.use('/', healthRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await redis.connect();
});
