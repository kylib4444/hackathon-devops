import { createClient, RedisClientType } from 'redis';
import { config } from '../config.js';

// Явна типізація клієнта
const client: RedisClientType = createClient({
  url: process.env.REDIS_URL || 'redis://jobmatch-dev-redis-master:6379'
});

// Явна типізація помилки
client.on('error', (err: Error) => console.error('Redis Client Error', err));

export async function connectCache(): Promise<void> {
  if (!client.isOpen) {
    await client.connect();
  }
}

// Заміна 'any' на більш конкретний тип для безпеки даних
export async function getCachedQuery(query: string, country: string): Promise<Record<string, unknown> | null> {
  const key = `query:${country}:${query.toLowerCase()}`;
  const data = await client.get(key);
  return data ? (JSON.parse(data) as Record<string, unknown>) : null;
}

export async function setCachedQuery(
  query: string, 
  country: string, 
  result: Record<string, unknown>, 
  ttl: number = 43200
): Promise<void> {
  const key = `query:${country}:${query.toLowerCase()}`;
  await client.set(key, JSON.stringify(result), { EX: ttl });
}