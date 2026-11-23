import type { ProviderModel } from "./model-config";
import {
  getProviderModelForAttempt,
  type ModelEnvironment,
} from "./model-config";

export async function executeProviderAttempt<T>(
  attemptNumber: number,
  invoke: (target: ProviderModel) => Promise<T>,
  onProviderSelected?: (target: ProviderModel) => void,
  env?: ModelEnvironment,
): Promise<{ target: ProviderModel; value: T }> {
  const target = getProviderModelForAttempt(attemptNumber, env);
  onProviderSelected?.(target);
  const value = await invoke(target);
  return { target, value };
}
