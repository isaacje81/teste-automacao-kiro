/**
 * Classe base para todos os agentes autônomos
 * Define o contrato e ciclo de vida comum
 */
import { AgentConfig, AgentResult, AgentError, AgentType } from '../types/index.js';

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected logs: string[] = [];
  protected startTime: number = 0;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get type(): AgentType {
    return this.config.type;
  }

  /**
   * Executa o agente com retry e timeout
   */
  async execute(input: unknown): Promise<AgentResult> {
    this.startTime = Date.now();
    this.logs = [];
    this.log(`🚀 Agente "${this.name}" iniciando execução...`);

    let lastError: AgentError | undefined;

    for (let attempt = 1; attempt <= this.config.retryCount; attempt++) {
      try {
        if (attempt > 1) {
          this.log(`🔄 Tentativa ${attempt}/${this.config.retryCount}...`);
        }

        const result = await this.withTimeout(
          this.run(input),
          this.config.timeout
        );

        this.log(`✅ Agente "${this.name}" concluído com sucesso`);
        return {
          agent: this.type,
          success: true,
          message: result.message,
          data: result.data,
          logs: this.logs,
          duration: Date.now() - this.startTime,
        };
      } catch (error) {
        const agentError = this.normalizeError(error);
        lastError = agentError;
        this.log(`❌ Erro na tentativa ${attempt}: ${agentError.message}`);

        if (!agentError.recoverable) {
          break;
        }

        if (attempt < this.config.retryCount) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.log(`⏳ Aguardando ${delay}ms antes de nova tentativa...`);
          await this.sleep(delay);
        }
      }
    }

    this.log(`💥 Agente "${this.name}" falhou após ${this.config.retryCount} tentativa(s)`);
    return {
      agent: this.type,
      success: false,
      message: lastError?.message || 'Erro desconhecido',
      logs: this.logs,
      duration: Date.now() - this.startTime,
      errors: lastError ? [lastError] : [],
    };
  }

  /**
   * Método abstrato que cada agente implementa com sua lógica específica
   */
  protected abstract run(input: unknown): Promise<{ message: string; data?: unknown }>;

  /**
   * Registra log de execução do agente
   */
  protected log(message: string): void {
    const timestamp = new Date().toISOString();
    this.logs.push(`[${timestamp}] ${message}`);
  }

  /**
   * Verifica se o agente pode continuar executando
   */
  protected checkTimeout(): void {
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.config.timeout) {
      throw new AgentTimeoutError(
        `Agente "${this.name}" excedeu o timeout de ${this.config.timeout}ms`
      );
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new AgentTimeoutError(`Timeout de ${ms}ms excedido`));
      }, ms);
    });

    return Promise.race([promise, timeout]);
  }

  private normalizeError(error: unknown): AgentError {
    if (error instanceof AgentTimeoutError) {
      return {
        code: 'TIMEOUT',
        message: error.message,
        recoverable: false,
      };
    }

    if (error instanceof Error) {
      return {
        code: 'EXECUTION_ERROR',
        message: error.message,
        details: error.stack,
        recoverable: true,
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
      recoverable: false,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class AgentTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentTimeoutError';
  }
}
