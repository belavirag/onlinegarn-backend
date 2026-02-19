import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import healthRoutes from './routes/health';
import productsRoutes from './routes/products';
import productInventoryRoutes from './routes/product-inventory';
import redis from './services/redis';
import { initShopify } from './services/shopify';
import { AppError } from './errors';

const app: Application = express();

app.use(cors());

app.use('/', healthRoutes);
app.use('/', productsRoutes);
app.use('/', productInventoryRoutes);

// Global error handler - returns JSON instead of Express's default HTML error page
app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('Unhandled error:', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

async function start(): Promise<void> {
  try {
    await redis.connect();
    await initShopify();
  } catch (error) {
    console.error('Failed to initialize services:', error);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

start();

export default app;
