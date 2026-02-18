import express, { Application } from 'express';
import healthRoutes from './routes/health';
import productInventoryRoutes from './routes/product-inventory';
import redis from './services/redis';
import { initShopify } from './services/shopify';

const app: Application = express();

app.use('/', healthRoutes);
app.use('/', productInventoryRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await redis.connect();
  await initShopify();
});
