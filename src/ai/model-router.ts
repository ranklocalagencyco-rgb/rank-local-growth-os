export type ModelRequest = {
  workflow: string;
  input: unknown;
  schemaName: string;
};

export type ModelResponse<T> = {
  output: T;
  provider: string;
  model: string;
  inputHash: string;
};

export interface ModelRouter {
  complete<T>(request: ModelRequest): Promise<ModelResponse<T>>;
}

export class NoopModelRouter implements ModelRouter {
  async complete<T>(request: ModelRequest): Promise<ModelResponse<T>> {
    return {
      output: {} as T,
      provider: "none",
      model: "disabled",
      inputHash: stableInputHash(request.input),
    };
  }
}

export function stableInputHash(input: unknown): string {
  const serialized = JSON.stringify(input, Object.keys(input ?? {}).sort());
  let hash = 2166136261;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
