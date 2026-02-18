import Redis from 'ioredis';

const redisHost = process.env.REDISHOST || 'localhost';
const redisPort = parseInt(process.env.REDISPORT || '6379', 10);
const redisPassword = process.env.REDISPASSWORD;

const redis = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPassword || undefined,
  lazyConnect: true,
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

export default redis;
