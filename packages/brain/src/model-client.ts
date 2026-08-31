import type { ModelCompletion, ModelEvent, ModelRequest } from './schemas';

export interface ModelClient {
  readonly provider: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelCompletion>;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  cancel(requestId: string): Promise<void>;
}

export class ModelClientError extends Error {
  constructor(message: string, readonly code: 'configuration' | 'network' | 'provider' | 'protocol' | 'timeout') {
    super(message);
    this.name = 'ModelClientError';
  }
}
