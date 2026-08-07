import type { gpioStatePayloadSchema } from './generated/gpio_control';
import type { z } from 'zod';

export { gpioControlContract } from './generated/gpio_control';

export const MIN_GPIO_PIN = 0;
export const MAX_GPIO_PIN = 39;
export type GpioStatePayload = z.infer<typeof gpioStatePayloadSchema>;
